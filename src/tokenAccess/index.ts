import { LiveCacheEntry, MinecraftJavaCacheEntry, TokenManagerLike, XSTSTokenRequest } from "../types";
import { getJwtExpiry } from "../utils";

const { Endpoints, fetchOptions } = require('prismarine-auth/src/common/Constants')


type LiveTokenSetup = {
    readonly accessToken?: string;
    readonly refreshToken?: string;
}


function buildAccessToken(accessToken: string): MinecraftJavaCacheEntry {
    const obtainedOn = Date.now();
    const until = getJwtExpiry(accessToken) ?? obtainedOn + 86400 * 1000;

    return {
        mca: {
            access_token: accessToken,
            expires_in: Math.floor((until - obtainedOn) / 1000),
            obtainedOn,
            token_type: "Bearer",
        },
    };
}


export function buildJavaPatchedManager<T extends TokenManagerLike<MinecraftJavaCacheEntry>>(manager: T, accessToken: string): T {
    if (!accessToken) {
        throw new Error("Access token must be provided for accessToken authentication.");
    }

    // both accessToken and refreshToken setups can provide an accessToken, so we can reuse the same patched manager for both.
    const originalGetCached = manager.cache.getCached.bind(manager.cache);

    manager.cache.getCached = async () => {
        const cached = await originalGetCached() as MinecraftJavaCacheEntry;
        const obtainedOn = Date.now();
        const until = getJwtExpiry(accessToken) ?? obtainedOn + 86400 * 1000;
        const remaining = until - Date.now();

        if (remaining <= 1000) {
            throw new Error(`Provided accessToken ${accessToken.slice(0, 12)}... is expired.`);
        }

        return {
            ...cached,
            mca: buildAccessToken(accessToken).mca,
        };
    };

    return manager;
}


export function buildLivePatchedManager<T extends TokenManagerLike<LiveCacheEntry>>(manager: T, tokens: LiveTokenSetup): T {
    if (!tokens.accessToken && !tokens.refreshToken) {
        throw new Error("At least one of accessToken or refreshToken must be provided.");
    }

    const originalGetCached = manager.cache.getCached.bind(manager.cache);

    manager.cache.getCached = async () => {
        const cached = await originalGetCached() as LiveCacheEntry;
        const obtainedOn = Date.now();
        const expiresIn = 86400;

        const ret: Required<LiveCacheEntry> = { token: {} as unknown as NonNullable<LiveCacheEntry["token"]> }; // filled in later.

        if (cached.token != null) ret.token = { ...cached.token };
        
        if (tokens.accessToken || tokens.refreshToken) {
            if (tokens.accessToken) ret.token.access_token = tokens.accessToken;
            if (tokens.refreshToken) ret.token.refresh_token = tokens.refreshToken;

            ret.token.expires_in = expiresIn;
            ret.token.obtainedOn = obtainedOn;
            ret.token.token_type = "Bearer";
        }

        return ret;
    };

    return manager;
}


