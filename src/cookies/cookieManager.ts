/**
 * Minecraft Authentication System
 *
 * This module keeps the browser and browserless cookie auth paths separate.
 * They share cache/proxy helpers, but each authenticator owns one execution path.
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { generateCacheFileName } from "../utils";
import { cookie } from "./cookie";
import { assertBrowserProxy, buildProxyUrl } from "./proxy";
import type { CookieAuthMethod, CookieOptions, MinecraftAuthCache, ProxyConfig } from "../types";
import { authenticateWithBrowserlessCookies } from "./browserless";

const FileCache = require("prismarine-auth/src/common/cache/FileCache");
const debug = require("debug")("mineflayer-custom-auth");

export interface ProcessAccRes {
  success: boolean;
  fromCache: boolean;
  token?: string;
  error?: string;
}

type CachedTokenResult = {
  is_cookie: boolean;
  valid: boolean;
  until: number;
  token: string;
  data: MinecraftAuthCache["mca"];
};

export interface CookieAuthenticator {
  processAccount(referencedUsername: string, cookies: cookie.Cookie[], proxyConfig?: ProxyConfig | string): Promise<ProcessAccRes>;
  getToken(referencedUsername: string, cookies: cookie.Cookie[], proxyConfig?: ProxyConfig | string): Promise<string | undefined>;
}

export class CookieCacheManager {
  protected readonly cachePath: string;
  protected readonly cacheName: string;

  constructor(cachePath = path.join(__dirname, "cache"), cacheName = "mca") {
    this.cachePath = cachePath;
    this.cacheName = cacheName;
    this.ensureCacheDirectory();
  }

  protected ensureCacheDirectory(): void {
    if (!fs.existsSync(this.cachePath)) {
      fs.mkdirSync(this.cachePath, { recursive: true });
    }
  }

  protected getCacheFile(username: string): typeof FileCache {
    return new FileCache(generateCacheFileName(this.cachePath, this.cacheName, username));
  }

  public clearCache(username: string): void {
    this.getCacheFile(username).reset();
  }

  public async getCachedAccessToken(referencedUsername: string, onlyCookieStorage = true): Promise<CachedTokenResult | undefined> {
    try {
      const { mca: token, cookie } = await this.getCacheFile(referencedUsername).getCached();
      debug("token cache", token, "is from cookie:", !!cookie);
      if (!token || (onlyCookieStorage && !cookie)) return;

      const expires = token.obtainedOn + token.expires_in * 1000;
      const remaining = expires - Date.now();
      const valid = remaining > 1000;

      return { is_cookie: !!cookie, valid, until: expires, token: token.access_token, data: token };
    } catch (error) {
      console.error("Error getting cached access token:", error);
      return undefined;
    }
  }

  protected createAuthCacheObject(accessToken: string, username = "thisreallydoesntmatter"): MinecraftAuthCache {
    return {
      mca: {
        username,
        roles: [],
        metadata: {},
        access_token: accessToken,
        expires_in: 86400,
        token_type: "Bearer",
        obtainedOn: Date.now(),
      },
    };
  }

  protected async saveAuthCacheObject(cacheFile: typeof FileCache, authCache: MinecraftAuthCache) {
    debug("saving auth cache", authCache);
    await cacheFile.setCachedPartial({
      mca: {
        ...authCache.mca,
        obtainedOn: Date.now(),
      },
      cookie: true,
    });
  }
}

abstract class BaseCookieAuthenticator extends CookieCacheManager implements CookieAuthenticator {
  protected async getCachedProcessResult(referencedUsername: string): Promise<ProcessAccRes | undefined> {
    const cachedToken = await this.getCachedAccessToken(referencedUsername);
    if (!cachedToken?.valid) return undefined;

    debug(`Already authenticated via cache: ${referencedUsername}`);
    return {
      success: true,
      fromCache: true,
      token: cachedToken.token,
    };
  }

  protected validateCookies(cacheFileName: string, cookies: cookie.Cookie[]): ProcessAccRes | undefined {
    if (cookies.length !== 0) return undefined;

    debug(`No valid cookies found in ${cacheFileName}`);
    return {
      success: false,
      fromCache: false,
    };
  }

  public abstract processAccount(
    referencedUsername: string,
    cookies: cookie.Cookie[],
    proxyConfig?: ProxyConfig | string
  ): Promise<ProcessAccRes>;

  public async getToken(referencedUsername: string, cookies: cookie.Cookie[], proxyConfig?: ProxyConfig | string) {
    const result = await this.processAccount(referencedUsername, cookies, proxyConfig);
    if (result.success) return result.token;

    throw new Error(result.fromCache ? "Failed to get token from cache" : "Failed to authenticate with provided credentials");
  }
}

export class BrowserlessCookieAuthenticator extends BaseCookieAuthenticator {
  private readonly allowUnsafeProxyTls: boolean;

  constructor(cachePath = path.join(__dirname, "cache"), cacheName = "mca", allowUnsafeProxyTls = false) {
    super(cachePath, cacheName);
    this.allowUnsafeProxyTls = allowUnsafeProxyTls;
  }

  public async processAccount(
    referencedUsername: string,
    cookies: cookie.Cookie[],
    proxyConfig?: ProxyConfig | string
  ): Promise<ProcessAccRes> {
    const cachedResult = await this.getCachedProcessResult(referencedUsername);
    if (cachedResult) return cachedResult;

    const cacheFile = this.getCacheFile(referencedUsername);
    const validationError = this.validateCookies(generateCacheFileName(this.cachePath, this.cacheName, referencedUsername), cookies);
    if (validationError) return validationError;

    try {
      const result = await authenticateWithBrowserlessCookies(cookies, proxyConfig, {
        allowUnsafeProxyTls: this.allowUnsafeProxyTls,
      });
      if (!result?.accessToken) {
        debug(`Browserless cookie authentication did not produce a token for ${referencedUsername}`);
        return {
          success: false,
          fromCache: false,
        };
      }

      debug(`Successfully authenticated via browserless cookies: ${referencedUsername} (${result.username})`);
      await this.saveAuthCacheObject(cacheFile, this.createAuthCacheObject(result.accessToken, result.uuid));

      return {
        success: true,
        fromCache: false,
        token: result.accessToken,
      };
    } catch (error) {
      debug(`Browserless cookie authentication failed for ${referencedUsername}:`, error);
      return {
        success: false,
        fromCache: false,
        error: (error as Error).message,
      };
    }
  }
}

export class BrowserCookieAuthenticator extends BaseCookieAuthenticator {
  private readonly headless: boolean;
  private readonly executableName: string;
  private readonly allowUnsafeProxyTls: boolean;

  constructor(cachePath = path.join(__dirname, "cache"), headless = false, executableName = "", cacheName = "mca", allowUnsafeProxyTls = false) {
    super(cachePath, cacheName);
    this.headless = headless;
    this.executableName = executableName;
    this.allowUnsafeProxyTls = allowUnsafeProxyTls;
  }

  private extractAccessToken(cookieString: string): string {
    const bearerToken = "bearer_token=";
    const start = cookieString.indexOf(bearerToken) + bearerToken.length;
    if (start <= bearerToken.length) return "";

    const end = cookieString.indexOf(";", start);
    return end === -1 ? cookieString.substring(start) : cookieString.substring(start, end);
  }

  public async processAccount(
    referencedUsername: string,
    cookies: cookie.Cookie[],
    proxyConfig?: ProxyConfig | string
  ): Promise<ProcessAccRes> {
    const cachedResult = await this.getCachedProcessResult(referencedUsername);
    if (cachedResult) return cachedResult;

    const proxy = buildProxyUrl(proxyConfig);
    if (proxy) assertBrowserProxy(proxy);

    const cacheFile = this.getCacheFile(referencedUsername);
    const validationError = this.validateCookies(generateCacheFileName(this.cachePath, this.cacheName, referencedUsername), cookies);
    if (validationError) return validationError;

    try {
      const args = [];
      let proxyUrl = null;
      if (proxy != null) {
        proxyUrl = new URL(proxy.url);
        args.push(`--proxy-server=${proxyUrl.protocol}//${proxyUrl.host}`);
      }
      if (this.allowUnsafeProxyTls) {
        args.push("--ignore-certificate-errors");
      }

      const browser = await puppeteer.launch({
        args,
        executablePath: this.executableName || undefined,
        headless: this.headless,
      });

      const page = await browser.newPage();

      if (proxyUrl != null && proxyUrl.username && proxyUrl.password) {
        await page.authenticate({
          username: decodeURIComponent(proxyUrl.username),
          password: decodeURIComponent(proxyUrl.password),
        });
      }

      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0");

      try {
        const pageCookies = await page.cookies();
        for (const cookie of pageCookies) {
          await page.deleteCookie(cookie);
        }

        const hasMicrosoftCookies = cookies.some(
          (cookie) => cookie.domain === ".live.com" || cookie.domain === "login.live.com" || cookie.domain === ".login.live.com"
        );

        if (hasMicrosoftCookies) {
          await page.goto("https://login.live.com", { waitUntil: "networkidle0" });
          await page.setCookie(...cookies);
        } else {
          debug(`Warning: No Microsoft login cookies found for ${referencedUsername}`);
        }

        await page.goto("https://login.live.com", { waitUntil: "networkidle0" });
        await page.reload({ waitUntil: "networkidle0" });
        await page.goto("https://www.minecraft.net/en-us/login", { waitUntil: "networkidle0" });

        const msaButton = '[data-testid="MSALoginButtonLink"]';
        await page.waitForSelector(msaButton);
        await page.click(msaButton);

        await new Promise((resolve) => setTimeout(resolve, 3000));
        await page.goto("https://www.minecraft.net/en-us/msaprofile/mygames", { waitUntil: "networkidle0" });

        const cookieString = await page.evaluate(() => document.cookie);
        const accessToken = this.extractAccessToken(cookieString);

        if (!accessToken.startsWith("ey")) {
          debug(`Authentication failed for ${referencedUsername} - invalid or locked account`);
          debug(`Extracted token: ${accessToken}`);
          return {
            success: false,
            fromCache: false,
          };
        }

        debug(`Successfully authenticated via browser cookies: ${referencedUsername}`);
        await this.saveAuthCacheObject(cacheFile, this.createAuthCacheObject(accessToken));

        return {
          success: true,
          fromCache: false,
          token: accessToken,
        };
      } finally {
        await browser.close();
      }
    } catch (error) {
      console.error(`Error processing account ${referencedUsername}:`, error);
      return {
        success: false,
        fromCache: false,
        error: (error as Error).message,
      };
    }
  }
}

class AutoCookieAuthenticator extends CookieCacheManager implements CookieAuthenticator {
  private readonly browserless: BrowserlessCookieAuthenticator;
  private readonly browser: BrowserCookieAuthenticator;

  constructor(
    cachePath = path.join(__dirname, "cache"),
    headless = false,
    executableName = "",
    cacheName = "mca",
    allowUnsafeProxyTls = false
  ) {
    super(cachePath, cacheName);
    this.browserless = new BrowserlessCookieAuthenticator(cachePath, cacheName, allowUnsafeProxyTls);
    this.browser = new BrowserCookieAuthenticator(cachePath, headless, executableName, cacheName, allowUnsafeProxyTls);
  }

  public async processAccount(referencedUsername: string, cookies: cookie.Cookie[], proxyConfig?: ProxyConfig | string) {
    const browserlessResult = await this.browserless.processAccount(referencedUsername, cookies, proxyConfig);
    if (browserlessResult.success) return browserlessResult;

    debug(`Browserless auth failed for ${referencedUsername}; trying browser auth`);
    return this.browser.processAccount(referencedUsername, cookies, proxyConfig);
  }

  public async getToken(referencedUsername: string, cookies: cookie.Cookie[], proxyConfig?: ProxyConfig | string) {
    const result = await this.processAccount(referencedUsername, cookies, proxyConfig);
    if (result.success) return result.token;

    throw new Error(result.fromCache ? "Failed to get token from cache" : "Failed to authenticate with provided credentials");
  }
}

export function createCookieAuthenticator(
  authMethod: CookieAuthMethod = "auto",
  cachePath = path.join(__dirname, "cache"),
  headless = false,
  executableName = "",
  cacheName = "mca",
  options: Pick<CookieOptions, "allowUnsafeProxyTls"> = {}
): CookieAuthenticator {
  switch (authMethod) {
    case "browserless":
      return new BrowserlessCookieAuthenticator(cachePath, cacheName, options.allowUnsafeProxyTls ?? false);
    case "browser":
      return new BrowserCookieAuthenticator(cachePath, headless, executableName, cacheName, options.allowUnsafeProxyTls ?? false);
    case "auto":
      return new AutoCookieAuthenticator(cachePath, headless, executableName, cacheName, options.allowUnsafeProxyTls ?? false);
  }
}

export { BrowserCookieAuthenticator as MinecraftAuthenticator };
