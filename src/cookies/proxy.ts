import type { ProxyConfig } from "../types";

export type ParsedProxy = {
  url: string;
  protocol: "http:" | "https:" | "socks:" | "socks4:" | "socks5:";
};

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks:", "socks4:", "socks5:"]);

function normalizeProxyString(proxy: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}

export function buildProxyUrl(proxy?: ProxyConfig | string): ParsedProxy | undefined {
  if (!proxy) return undefined;

  const rawUrl =
    typeof proxy === "string"
      ? normalizeProxyString(proxy)
      : `${proxy.protocol ?? "http"}://${proxy.username || proxy.password ? `${encodeURIComponent(proxy.username ?? "")}:${encodeURIComponent(proxy.password ?? "")}@` : ""}${proxy.server}:${proxy.port}`;

  const url = new URL(rawUrl);
  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Unsupported proxy protocol "${url.protocol}". Use http://, https://, socks://, socks4://, or socks5://.`);
  }

  return {
    url: url.toString(),
    protocol: url.protocol as ParsedProxy["protocol"],
  };
}

export function assertBrowserProxy(proxy: ParsedProxy) {
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new Error(`The browser cookie auth path only supports http:// and https:// proxies. Use authMethod: "browserless" for ${proxy.protocol}// proxies.`);
  }
}
