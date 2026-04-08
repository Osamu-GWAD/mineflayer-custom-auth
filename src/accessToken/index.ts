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

type MinecraftJavaTokenManagerLike = {
  getCachedAccessToken: () => Promise<unknown>;
};

function getJwtExpiry(accessToken: string): number | undefined {
  const [, payload] = accessToken.split(".");
  if (!payload) return;

  const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
  const decodedPayload = Buffer.from(paddedPayload, "base64").toString("utf8");
  const parsedPayload = JSON.parse(decodedPayload) as { exp?: unknown };

  return typeof parsedPayload.exp === "number" ? parsedPayload.exp * 1000 : undefined;
}

export function buildPatchedManager<T extends MinecraftJavaTokenManagerLike>(manager: T, accessToken: string): T {
  const patchedManager = Object.create(Object.getPrototypeOf(manager)) as T;
  Object.assign(patchedManager, manager);

  patchedManager.getCachedAccessToken = async () => {
    const obtainedOn = Date.now();
    const until = getJwtExpiry(accessToken) ?? obtainedOn + 86400 * 1000;
    const remaining = until - Date.now();

    if (remaining <= 1000) {
      throw new Error(`Provided accessToken ${accessToken.slice(0, 12)}... is expired.`);
    }

    return {
      valid: true,
      until,
      token: accessToken,
      data: {
        access_token: accessToken,
        expires_in: Math.floor((until - obtainedOn) / 1000),
        obtainedOn,
        token_type: "Bearer",
      },
    };
  };

  return patchedManager;
}
