import path from 'path'
const { createHash } = require("prismarine-auth/src/common/Util");


/**
 * Generate cache file name for a given username
 */
export function generateCacheFileName(pathName: string, cacheName: string, username: string): string {
  return  path.join(pathName,`${createHash(username)}_${cacheName}-cache.json`)
}


export function getJwtExpiry(accessToken: string): number | undefined {
  const [, payload] = accessToken.split(".");
  if (!payload) return;

  const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
  const decodedPayload = Buffer.from(paddedPayload, "base64").toString("utf8");
  const parsedPayload = JSON.parse(decodedPayload) as { exp?: unknown };

  return typeof parsedPayload.exp === "number" ? parsedPayload.exp * 1000 : undefined;
}
