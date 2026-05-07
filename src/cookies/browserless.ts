import https from "https";
import type { IncomingHttpHeaders } from "http";
import fs from "fs";
import path from "path";
import { cookie } from "./cookie";
import { buildProxyUrl } from "./proxy";
import type { ProxyConfig } from "../types";

const debug = require("debug")("mineflayer-custom-auth:cookie-browserless");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const UserAgent = require("user-agents");

const MINECRAFT_CLIENT_ID = "7d5c843b-fe26-45f7-9073-b683b2ac7ec3";
const MINECRAFT_COBRAND_ID = "8058f65d-ce06-4c30-9559-473c9275a65d";
const MINECRAFT_LOGIN_URL = "https://www.minecraft.net/en-us/login";
const MICROSOFT_REDIRECT_URI = "https://sisu.xboxlive.com/connect/oauth/XboxLive";
const MICROSOFT_SCOPE = "XboxLive.Signin XboxLive.offline_access";

const ENDPOINTS = {
  sisuConnect: "https://sisu.xboxlive.com/connect/XboxLive/",
  microsoftAuthorize: "https://login.live.com/oauth20_authorize.srf",
  minecraftLogin: "https://api.minecraftservices.com/authentication/login_with_xbox",
  minecraftProfile: "https://api.minecraftservices.com/minecraft/profile",
};

type HttpResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
};

type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  proxy?: ProxyConfig | string;
};

type ContinueForm = {
  action: string;
  method: "GET" | "POST";
  body: string;
};

type CookieJar = cookie.Cookie[];

type MinecraftLoginResponse = {
  access_token?: string;
};

type SisuTokenItem = {
  Item1?: string;
  Item2?: {
    DisplayClaims?: {
      xui?: Array<{
        uhs?: string;
      }>;
    };
    Token?: string;
  };
};

type MinecraftProfileResponse = {
  id?: string;
  name?: string;
};

type SilentAuthFailureReason =
  | "missing_cookie_header"
  | "sisu_connect_no_redirect"
  | "microsoft_no_sisu_redirect"
  | "microsoft_continue_no_redirect"
  | "microsoft_redirect_error"
  | "sisu_callback_no_minecraft_redirect"
  | "sisu_redirect_error"
  | "sisu_redirect_missing_access_token";

export type CookieBrowserlessAuthResult = {
  username: string;
  uuid: string;
  accessToken: string;
};

function getRandomUserAgent(): string {
  return new UserAgent().toString();
}

function getFirstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getRedirectLocation(response: HttpResponse, fromUrl: string) {
  const location = getFirstHeader(response.headers.location);
  if (!location) return undefined;

  return new URL(location, fromUrl).toString();
}

function redactUrl(urlString: string) {
  const url = new URL(urlString);
  const sensitiveKeys = new Set(["accessToken", "access_token", "code", "state", "uaid", "tid"]);

  for (const key of Array.from(url.searchParams.keys())) {
    if (sensitiveKeys.has(key)) url.searchParams.set(key, "<redacted>");
  }

  if (url.hash) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    for (const key of Array.from(fragment.keys())) {
      fragment.set(key, sensitiveKeys.has(key) ? "<redacted>" : "<present>");
    }
    url.hash = fragment.toString();
  }

  return url.toString();
}

function getBodyPreview(body: string) {
  return body.replace(/\s+/g, " ").trim().slice(0, 240);
}

function stripNoScriptBlocks(body: string) {
  return body.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
}

function getMicrosoftPageKind(body: string) {
  const scriptEnabledBody = stripNoScriptBlocks(body);

  if (/<title>\s*Continue\s*<\/title>/i.test(scriptEnabledBody)) return "continue";
  if (/GetCredentialType\.srf|urlGetCredentialType|urlPost|PPFT/i.test(body)) return "interactive-sign-in";
  if (/PreprocessInfo:\s*CBA/i.test(body)) return "cba";
  if (/JavaScript (?:is )?required to sign in|jsDisabledTitle/i.test(body)) return "javascript-required";

  return "unknown";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#x3a;/gi, ":")
    .replace(/&#x3d;/gi, "=")
    .replace(/&#x26;/gi, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeJavascriptString(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\\u0026/g, "&")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

function extractHiddenInputs(formHtml: string) {
  const params = new URLSearchParams();
  const inputPattern = /<input\b[^>]*>/gi;
  const attrPattern = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)=["']([^"']*)["']/g;
  const inputs = formHtml.match(inputPattern) ?? [];

  for (const input of inputs) {
    const attrs: Record<string, string> = {};
    let attr: RegExpExecArray | null;

    while ((attr = attrPattern.exec(input)) != null) {
      attrs[attr[1].toLowerCase()] = decodeHtmlEntities(attr[2]);
    }

    if (attrs.name) params.set(attrs.name, attrs.value ?? "");
  }

  return params;
}

function extractMicrosoftContinueForm(body: string, fromUrl: string): ContinueForm | undefined {
  const scriptEnabledBody = stripNoScriptBlocks(body);
  if (!/<title>\s*(?:Continue|Working\.\.\.)\s*<\/title>/i.test(scriptEnabledBody)) return undefined;

  const form = scriptEnabledBody.match(/<form\b[\s\S]*?<\/form>/i)?.[0];
  if (!form || !/document\.(?:[A-Za-z0-9_$]+|forms\[[0-9]+\])\.submit\(\)/i.test(scriptEnabledBody)) return undefined;

  const action = form.match(/\saction=["']([^"']+)["']/i)?.[1];
  if (!action) return undefined;

  const method = form.match(/\smethod=["']([^"']+)["']/i)?.[1]?.toUpperCase() === "GET" ? "GET" : "POST";
  const bodyParams = extractHiddenInputs(form);

  return {
    action: new URL(decodeJavascriptString(action), fromUrl).toString(),
    method,
    body: bodyParams.toString(),
  };
}

function request(urlString: string, options: RequestOptions = {}) {
  return new Promise<HttpResponse>((resolve, reject) => {
    const url = new URL(urlString);
    const proxy = buildProxyUrl(options.proxy);
    const proxyAgent = proxy
      ? proxy.protocol === "http:" || proxy.protocol === "https:"
        ? new HttpsProxyAgent(proxy.url)
        : new SocksProxyAgent(proxy.url)
      : undefined;

    debug("request:start", options.method ?? "GET", redactUrl(urlString), {
      hasBody: !!options.body,
      headerNames: Object.keys(options.headers ?? {}),
      proxy: proxy ? proxy.protocol.replace(":", "") : "none",
    });

    const startedAt = Date.now();
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        agent: proxyAgent,
        maxHeaderSize: 256 * 1024,
      },
      (res) => {
        let body = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const response = {
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body,
          };

          debug("request:end", options.method ?? "GET", redactUrl(urlString), {
            statusCode: response.statusCode,
            elapsedMs: Date.now() - startedAt,
            hasLocation: !!getFirstHeader(response.headers.location),
            bodyLength: body.length,
          });

          resolve(response);
        });
      }
    );

    req.on("error", (error) => {
      debug("request:error", options.method ?? "GET", redactUrl(urlString), error);
      reject(error);
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function getSetCookieHeaders(response: HttpResponse) {
  const header = response.headers["set-cookie"];
  if (!header) return [];

  return Array.isArray(header) ? header : [header];
}

function defaultCookiePath(requestPath: string) {
  if (!requestPath || requestPath === "/") return "/";

  const lastSlash = requestPath.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : requestPath.slice(0, lastSlash);
}

function parseSetCookie(header: string, fromUrl: string): cookie.Cookie | undefined {
  const url = new URL(fromUrl);
  const parts = header.split(";").map((part) => part.trim());
  const [nameValue, ...attributes] = parts;
  const separator = nameValue.indexOf("=");
  if (separator <= 0) return undefined;

  const ret: cookie.Cookie = {
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
    domain: url.hostname,
    path: defaultCookiePath(url.pathname),
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValue] = attribute.split("=");
    const name = rawName.toLowerCase();
    const value = rawValue.join("=");

    if (name === "domain" && value) ret.domain = value.toLowerCase();
    if (name === "path" && value) ret.path = value;
    if (name === "secure") ret.secure = true;
    if (name === "httponly") ret.httpOnly = true;
    if (name === "expires" && value) ret.expires = Math.floor(new Date(value).getTime() / 1000);
    if (name === "max-age" && value) ret.expires = Math.floor(Date.now() / 1000) + Number(value);
  }

  return ret;
}

function mergeCookie(jar: CookieJar, next: cookie.Cookie) {
  const nextDomain = next.domain.toLowerCase();
  const nextPath = next.path ?? "/";
  const index = jar.findIndex((item) => item.name === next.name && item.domain.toLowerCase() === nextDomain && (item.path ?? "/") === nextPath);

  if (typeof next.expires === "number" && next.expires > 0 && next.expires <= Math.floor(Date.now() / 1000)) {
    if (index !== -1) jar.splice(index, 1);
    return;
  }

  if (index === -1) {
    jar.push(next);
  } else {
    jar[index] = next;
  }
}

function storeSetCookies(jar: CookieJar, response: HttpResponse, fromUrl: string) {
  const headers = getSetCookieHeaders(response);
  if (headers.length === 0) return;

  const names: string[] = [];
  for (const header of headers) {
    const parsed = parseSetCookie(header, fromUrl);
    if (!parsed) continue;

    names.push(parsed.name);
    mergeCookie(jar, parsed);
  }

  debug("cookies:set-cookie", redactUrl(fromUrl), {
    count: names.length,
    names,
  });
}

function isMicrosoftAuthorizeHost(urlString: string) {
  const host = new URL(urlString).hostname;
  return host === "login.live.com" || host.endsWith(".login.live.com");
}

function isAllowedMicrosoftIntermediate(urlString: string) {
  const host = new URL(urlString).hostname;
  return host === "login.live.com" || host.endsWith(".login.live.com") || host.endsWith(".copilot.microsoft.com") || host.endsWith(".copilot.com");
}

function isSisuCallback(urlString: string) {
  const url = new URL(urlString);
  return url.hostname === "sisu.xboxlive.com" && url.pathname.toLowerCase() === "/connect/oauth/xboxlive";
}

function parseJson<T>(response: HttpResponse, context: string): T {
  try {
    return JSON.parse(response.body) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${context} response: ${(error as Error).message}`);
  }
}

function assertStatus(response: HttpResponse, expectedStatus: number, context: string) {
  if (response.statusCode === expectedStatus) return;

  const preview = getBodyPreview(response.body);
  throw new Error(`${context} failed with HTTP ${response.statusCode}${preview ? `: ${preview}` : ""}`);
}

function isCookieExpired(item: cookie.Cookie) {
  return typeof item.expires === "number" && item.expires > 0 && item.expires <= Math.floor(Date.now() / 1000);
}

function domainMatches(host: string, cookieDomain: string) {
  const normalizedHost = host.toLowerCase();
  const normalizedDomain = cookieDomain.toLowerCase().replace(/^\./, "");

  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function pathMatches(requestPath: string, cookiePath?: string) {
  if (!cookiePath || cookiePath === "/") return true;

  return requestPath === cookiePath || requestPath.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`);
}

function buildCookieHeader(cookies: cookie.Cookie[], urlString: string) {
  const url = new URL(urlString);
  const matchingCookies = cookies
    .filter((item) => item.name && item.value && item.value !== "Disabled")
    .filter((item) => !isCookieExpired(item))
    .filter((item) => domainMatches(url.hostname, item.domain))
    .filter((item) => pathMatches(url.pathname, item.path))
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0));

  debug("cookies:header", redactUrl(urlString), {
    totalCookies: cookies.length,
    matchingCookies: matchingCookies.length,
    names: matchingCookies.map((item) => item.name),
  });

  return matchingCookies.map((item) => `${item.name}=${item.value}`).join("; ");
}

function buildSisuConnectUrl() {
  const url = new URL(ENDPOINTS.sisuConnect);
  url.searchParams.set("state", "login");
  url.searchParams.set("cobrandId", MINECRAFT_COBRAND_ID);
  url.searchParams.set("tid", Math.floor(Math.random() * 1_000_000_000).toString());
  url.searchParams.set("ru", MINECRAFT_LOGIN_URL);
  url.searchParams.set("aid", "1142970254");
  url.searchParams.set("as", "1");

  return url.toString();
}

function buildFallbackMicrosoftAuthorizeUrl() {
  const url = new URL(ENDPOINTS.microsoftAuthorize);
  url.searchParams.set("redirect_uri", MICROSOFT_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", MINECRAFT_CLIENT_ID);
  url.searchParams.set("scope", MICROSOFT_SCOPE);
  url.searchParams.set("lw", "1");
  url.searchParams.set("fl", "dob,easi2");
  url.searchParams.set("xsup", "1");
  url.searchParams.set("cobrandid", MINECRAFT_COBRAND_ID);
  url.searchParams.set("nopa", "2");

  return url.toString();
}

function parseOAuthFields(urlString: string, fallbackBaseUrl: string) {
  const url = new URL(urlString, fallbackBaseUrl);
  const fragment = new URLSearchParams(url.hash.slice(1));

  return {
    accessToken: fragment.get("accessToken") ?? undefined,
    error: url.searchParams.get("error") ?? fragment.get("error") ?? undefined,
    errorDescription: url.searchParams.get("error_description") ?? fragment.get("error_description") ?? undefined,
  };
}

function decodeBase64Json<T>(value: string): T {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
}

function getSisuResourceLabel(item: SisuTokenItem) {
  return item.Item1?.replace(/^https?:\/\//i, "").replace(/^rp:\/\//i, "rp://");
}

function buildMinecraftIdentityToken(sisuAccessToken: string) {
  const items = decodeBase64Json<SisuTokenItem[]>(sisuAccessToken);
  const minecraftServicesItem = items.find((item) => item.Item1?.toLowerCase() === "rp://api.minecraftservices.com/");
  const token = minecraftServicesItem?.Item2?.Token;
  const uhs = minecraftServicesItem?.Item2?.DisplayClaims?.xui?.[0]?.uhs;

  debug("sisu-token:decoded", {
    itemCount: items.length,
    resources: items.map(getSisuResourceLabel),
    hasMinecraftServicesToken: !!token,
    hasUhs: !!uhs,
  });

  if (!token || !uhs) throw new Error("Sisu access token did not include a Minecraft Services XBL token.");
  return `XBL3.0 x=${uhs};${token}`;
}

function failSilentAuth(reason: SilentAuthFailureReason, details?: Record<string, unknown>) {
  debug("silent-auth:failed", reason, details ?? {});
  return undefined;
}

function writeDebugPage(name: string, response: HttpResponse) {
  if (process.env.MINEFLAYER_CUSTOM_AUTH_WRITE_DEBUG_PAGES !== "1") return;
  if (!response.body.trim()) return;

  const dir = path.join(process.cwd(), "test", "data");
  if (!fs.existsSync(dir)) return;

  const file = path.join(dir, `browserless-debug-${name}-${Date.now()}.html`);
  fs.writeFileSync(file, response.body);
  debug("debug-page:written", file);
}

async function getSisuAuthorizeUrl(proxy?: ProxyConfig | string) {
  const connectUrl = buildSisuConnectUrl();
  debug("sisu-connect:start", redactUrl(connectUrl));

  const response = await request(connectUrl, {
    headers: {
      "User-Agent": getRandomUserAgent(),
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "close",
    },
    proxy,
  });

  const location = getRedirectLocation(response, connectUrl);
  if (location) {
    debug("sisu-connect:redirect", redactUrl(location));
    return location;
  }

  debug("sisu-connect:no-redirect", {
    statusCode: response.statusCode,
    preview: getBodyPreview(response.body),
  });

  return buildFallbackMicrosoftAuthorizeUrl();
}

async function requestMicrosoftAuthorize(authorizeUrl: string, jar: CookieJar, proxy?: ProxyConfig | string) {
  const cookieHeader = buildCookieHeader(jar, authorizeUrl);
  if (isMicrosoftAuthorizeHost(authorizeUrl) && !cookieHeader) return undefined;

  const response = await request(authorizeUrl, {
    headers: {
      "User-Agent": getRandomUserAgent(),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "close",
    },
    proxy,
  });

  storeSetCookies(jar, response, authorizeUrl);
  return response;
}

async function submitMicrosoftContinueForm(
  fromUrl: string,
  response: HttpResponse,
  jar: CookieJar,
  proxy?: ProxyConfig | string
): Promise<{ url: string; response: HttpResponse } | undefined> {
  const form = extractMicrosoftContinueForm(response.body, fromUrl);
  if (!form) return undefined;

  const requestUrl = form.method === "GET" && form.body ? `${form.action}${form.action.includes("?") ? "&" : "?"}${form.body}` : form.action;
  const cookieHeader = buildCookieHeader(jar, requestUrl);

  debug("microsoft-continue:submit", {
    method: form.method,
    action: redactUrl(form.action),
    fieldNames: Array.from(new URLSearchParams(form.body).keys()),
  });

  const nextResponse = await request(requestUrl, {
    method: form.method,
    headers: {
      "User-Agent": getRandomUserAgent(),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(fromUrl).origin,
      Referer: fromUrl,
      Connection: "close",
    },
    body: form.method === "POST" ? form.body : undefined,
    proxy,
  });

  storeSetCookies(jar, nextResponse, requestUrl);
  return { url: requestUrl, response: nextResponse };
}

async function resolveMicrosoftAuthorizeRedirect(
  authorizeUrl: string,
  authorizeResponse: HttpResponse,
  jar: CookieJar,
  proxy?: ProxyConfig | string
) {
  let currentUrl = authorizeUrl;
  let currentResponse = authorizeResponse;

  for (let attempt = 0; attempt < 6; attempt++) {
    const location = getRedirectLocation(currentResponse, currentUrl);
    if (location) {
      debug("microsoft-authorize:intermediate-redirect", {
        attempt: attempt + 1,
        fromUrl: redactUrl(currentUrl),
        location: redactUrl(location),
      });

      if (isSisuCallback(location)) return location;
      if (!isAllowedMicrosoftIntermediate(location)) return location;

      const nextResponse = await requestMicrosoftAuthorize(location, jar, proxy);
      if (!nextResponse) {
        writeDebugPage("microsoft-redirect-missing-cookies", currentResponse);
        return undefined;
      }

      currentUrl = location;
      currentResponse = nextResponse;
      continue;
    }

    const continued = await submitMicrosoftContinueForm(currentUrl, currentResponse, jar, proxy);
    if (!continued) {
      writeDebugPage(`microsoft-authorize-${getMicrosoftPageKind(currentResponse.body)}`, currentResponse);
      debug("microsoft-authorize:stopped", {
        attempt: attempt + 1,
        currentUrl: redactUrl(currentUrl),
        statusCode: currentResponse.statusCode,
        pageKind: getMicrosoftPageKind(currentResponse.body),
        preview: getBodyPreview(currentResponse.body),
      });
      return undefined;
    }

    currentUrl = continued.url;
    currentResponse = continued.response;
  }

  writeDebugPage(`microsoft-authorize-max-attempts-${getMicrosoftPageKind(currentResponse.body)}`, currentResponse);
  return undefined;
}

async function getXblIdentityTokenFromSisu(cookies: cookie.Cookie[], proxy?: ProxyConfig | string) {
  debug("silent-auth:start");
  const jar = [...cookies];

  const authorizeUrl = await getSisuAuthorizeUrl(proxy);
  const cookieHeader = buildCookieHeader(jar, authorizeUrl);
  if (!cookieHeader) return failSilentAuth("missing_cookie_header", { authorizeUrl: redactUrl(authorizeUrl) });

  debug("microsoft-authorize:start", redactUrl(authorizeUrl));
  const authorizeResponse = await requestMicrosoftAuthorize(authorizeUrl, jar, proxy);
  if (!authorizeResponse) return failSilentAuth("missing_cookie_header", { authorizeUrl: redactUrl(authorizeUrl) });

  const sisuCallbackUrl = await resolveMicrosoftAuthorizeRedirect(authorizeUrl, authorizeResponse, jar, proxy);
  if (!sisuCallbackUrl) {
    const pageKind = getMicrosoftPageKind(authorizeResponse.body);
    return failSilentAuth(pageKind === "continue" ? "microsoft_continue_no_redirect" : "microsoft_no_sisu_redirect", {
      statusCode: authorizeResponse.statusCode,
      pageKind,
      authorizeUrl: redactUrl(authorizeUrl),
      preview: getBodyPreview(authorizeResponse.body),
    });
  }

  const callbackHost = new URL(sisuCallbackUrl).hostname;
  if (callbackHost !== "sisu.xboxlive.com") {
    const fields = parseOAuthFields(sisuCallbackUrl, MICROSOFT_REDIRECT_URI);
    return failSilentAuth(fields.error ? "microsoft_redirect_error" : "microsoft_no_sisu_redirect", {
      redirectUrl: redactUrl(sisuCallbackUrl),
      error: fields.error,
      errorDescription: fields.errorDescription,
    });
  }

  debug("microsoft-authorize:redirect", redactUrl(sisuCallbackUrl));
  const callbackResponse = await request(sisuCallbackUrl, {
    headers: {
      "User-Agent": getRandomUserAgent(),
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "close",
    },
    proxy,
  });

  const minecraftRedirectUrl = getRedirectLocation(callbackResponse, sisuCallbackUrl);
  if (!minecraftRedirectUrl) {
    writeDebugPage("sisu-callback", callbackResponse);
    return failSilentAuth("sisu_callback_no_minecraft_redirect", {
      statusCode: callbackResponse.statusCode,
      callbackUrl: redactUrl(sisuCallbackUrl),
      preview: getBodyPreview(callbackResponse.body),
    });
  }

  debug("sisu-callback:redirect", redactUrl(minecraftRedirectUrl));
  const fields = parseOAuthFields(minecraftRedirectUrl, MINECRAFT_LOGIN_URL);
  if (fields.error) {
    return failSilentAuth("sisu_redirect_error", {
      redirectUrl: redactUrl(minecraftRedirectUrl),
      error: fields.error,
      errorDescription: fields.errorDescription,
    });
  }

  if (!fields.accessToken) {
    return failSilentAuth("sisu_redirect_missing_access_token", {
      redirectUrl: redactUrl(minecraftRedirectUrl),
    });
  }

  debug("silent-auth:success", {
    redirectUrl: redactUrl(minecraftRedirectUrl),
    hasAccessToken: true,
  });

  return fields.accessToken;
}

async function loginWithMinecraft(sisuAccessToken: string, proxy?: ProxyConfig | string) {
  const identityToken = buildMinecraftIdentityToken(sisuAccessToken);

  debug("minecraft-login:start", {
    identityTokenKind: "XBL3.0",
  });

  const response = await request(ENDPOINTS.minecraftLogin, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      identityToken,
      platform: "WEB",
      ensureLegacyEnabled: true,
    }),
    proxy,
  });

  assertStatus(response, 200, "Minecraft login");

  const data = parseJson<MinecraftLoginResponse>(response, "Minecraft login");
  if (!data.access_token) throw new Error("Minecraft login response was missing an access token.");

  debug("minecraft-login:success");
  return data.access_token;
}

async function getMinecraftProfile(accessToken: string, proxy?: ProxyConfig | string): Promise<{ id: string; name: string }> {
  debug("minecraft-profile:start");

  const response = await request(ENDPOINTS.minecraftProfile, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    proxy,
  });

  assertStatus(response, 200, "Minecraft profile lookup");

  const data = parseJson<MinecraftProfileResponse>(response, "Minecraft profile");
  if (!data.id || !data.name) throw new Error("Minecraft profile response was missing profile data.");

  debug("minecraft-profile:success", {
    username: data.name,
    uuid: data.id,
  });

  return {
    id: data.id,
    name: data.name,
  };
}

export async function authenticateWithBrowserlessCookies(
  cookies: cookie.Cookie[],
  proxy?: ProxyConfig | string
): Promise<CookieBrowserlessAuthResult | undefined> {
  const xblIdentityToken = await getXblIdentityTokenFromSisu(cookies, proxy);
  if (!xblIdentityToken) return undefined;

  const minecraftAccessToken = await loginWithMinecraft(xblIdentityToken, proxy);
  const profile = await getMinecraftProfile(minecraftAccessToken, proxy);

  return {
    username: profile.name,
    uuid: profile.id,
    accessToken: minecraftAccessToken,
  };
}
