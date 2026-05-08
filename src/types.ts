import { cookie } from "./cookies/cookie";


/**
 * Interface for proxy configuration
 */
export interface ProxyConfig {
  server: string;
  port: string;
  username?: string;
  password?: string;
  protocol?: "http" | "https" | "socks" | "socks4" | "socks5";
}

export type CookieAuthMethod = "auto" | "browserless" | "browser";

export interface CookieOptions {
  cookies: cookie.Cookie[];
  proxy?: ProxyConfig | string;
  headless?: boolean;
  executablePath?: string;
  authMethod?: CookieAuthMethod;
  allowUnsafeProxyTls?: boolean;
}


export type CachedAccessToken = {
  valid: boolean;
  until: number;
  token: string;
  data: {
    access_token: string;
    expires_in: number;
    obtainedOn: number;
    token_type: "Bearer";
  };
};

/**
 * Interface for Minecraft authentication cache object
 */
export interface MinecraftAuthCache {
  mca: {
    username: string;
    roles: string[];
    metadata: Record<string, unknown>;
    access_token: string;
    expires_in: number;
    token_type: string;
    obtainedOn: number;
  };
}

export type MinecraftJavaCacheEntry = {
  mca?: CachedAccessToken["data"];
};

export type LiveCacheEntry = {
  token?: {
    token_type: string;
    expires_in: number;
    scope: string;
    access_token: string;
    refresh_token: string;
    user_id: string;
    obtainedOn: number;
  }
}


export type XSTSTokenRequest = {
    userXUID: string | null;
    userHash: string;
    XSTSToken: string;
    expiresOn: string;
}

export type TokenManagerLike<T extends unknown> = {
  cache: {
    getCached: () => Promise<T>;
  };

    getAccessToken?: (xsts: XSTSTokenRequest) => Promise<string>;
};


