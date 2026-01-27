import { cookie } from "./cookies/cookie";


/**
 * Interface for proxy configuration
 */
export interface ProxyConfig {
  server: string;
  port: string;
  username: string;
  password: string;
}

export interface CookieOptions {
  cookies: cookie.Cookie[];
  proxy?: ProxyConfig | string;
  headless?: boolean;
  executablePath?: string;
}
