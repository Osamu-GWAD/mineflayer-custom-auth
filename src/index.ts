export {
  BrowserCookieAuthenticator,
  BrowserlessCookieAuthenticator,
  CookieCacheManager,
  createCookieAuthenticator,
  MinecraftAuthenticator,
} from "./cookies/cookieManager";

import {cookie} from './cookies/cookie'
import type { ClientOptions } from "minecraft-protocol";

import "mineflayer";
import { CookieOptions } from "./types";



declare module "mineflayer" {
  interface BotOptions {
    auth: ClientOptions["auth"] | "cookies" | "accessToken" | "refreshToken";
    cookieOptions?: CookieOptions;
  }
}

declare module "minecraft-protocol" {
  interface ClientOptions {
    javaAccessToken?: string;
    liveAccessToken?: string;
    liveRefreshToken?: string;
  }
}


export type { CookieAuthMethod, CookieOptions } from "./types";
export { createBot } from "./impl";
export { cookie } from './cookies/cookie';
export { buildJavaPatchedManager as buildPatchedManager } from "./tokenAccess";
