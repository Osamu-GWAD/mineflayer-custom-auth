import path from "path";
import { MinecraftAuthenticator } from "./cookies/cookieManager";
import { buildPatchedManager } from "./accessToken";
import { BotOptions, createBot as oldCreateBot } from "mineflayer";
import type { Client, ClientOptions } from "minecraft-protocol";
import { CookieOptions } from ".";

// Constants
const { Authflow, Titles } = require("prismarine-auth");
const minecraftFolderPath = require("minecraft-folder-path");
const microsoftAuth = require("minecraft-protocol/src/client/microsoftAuth");
const debug = require("debug")("mineflayer-custom-auth");

type AuthflowLike = {
  mca: unknown;
};

type AuthClient = Client & {
  authflow?: AuthflowLike;
};

type ExtendedClientOptions = ClientOptions & {
  deviceType?: string;
  flow?: string;
  haveCredentials?: boolean;
};

function validateOptions(options: ClientOptions) {
  const extendedOptions = options as ExtendedClientOptions;

  if (!options.profilesFolder) {
    options.profilesFolder = path.join(minecraftFolderPath, "nmp-cache");
  }
  if (options.authTitle === undefined) {
    options.authTitle = Titles.MinecraftNintendoSwitch;
    extendedOptions.deviceType = "Nintendo";
    extendedOptions.flow = "live";
  }
}

/**
 * Handle authentication using cached tokens or Microsoft auth
 */
async function authenticateWithCache(client: Client, clientOptions: ClientOptions, cookieOptions: CookieOptions) {
  // Initialize authenticator
  validateOptions(clientOptions);

  if (!cookieOptions || !cookieOptions.cookies) {
    throw new Error("Missing cookie options for authentication.");
  }

  // technically, this will always be a string. potential typing error on pris-auth's end?
  const cachePath = clientOptions.profilesFolder as unknown as string; // validated above.
  const auth = new MinecraftAuthenticator(cachePath, cookieOptions.headless, cookieOptions.executablePath);
  const proxy = cookieOptions.proxy;


  try {
    // Try to pre-authenticate and prepare cache
    const authResult = await auth.processAccount(clientOptions.username, cookieOptions.cookies, proxy);

    if (authResult.success) {
      debug(`Pre-authentication ${authResult.fromCache ? "from cache" : "successful"}`);
    }
  } catch (err) {
    debug("Pre-authentication failed:", err);
  } finally {
    // Always use minecraft-protocol's built-in auth as fallback
    await microsoftAuth.authenticate(client, clientOptions);
  }
}

const maybeClearCookieCache = async (client: Client, clientOptions: ClientOptions) => {
  validateOptions(clientOptions);
  const cachePath = clientOptions.profilesFolder as unknown as string; // validated above.
  const auth = new MinecraftAuthenticator(cachePath);

  try {
    const res = await auth.getCachedAccessToken(clientOptions.username);
    if (res != null) {
      if (res.is_cookie) {
        debug("Clearing cookie cache for Microsoft auth");
        await auth.clearCache(clientOptions.username);
      }
    } else {
      debug("No cached token found for Microsoft auth, continue as normal.")
    }
  } catch (err) {
    debug("Failed to clear cookie cache:", err);
  } finally {
    // Always use minecraft-protocol's built-in auth as fallback
    await microsoftAuth.authenticate(client, clientOptions);
  }
};

function setAccessTokenAuthflow(client: Client, clientOptions: ClientOptions) {
  const authClient = client as AuthClient;
  const extendedOptions = clientOptions as ExtendedClientOptions;

  validateOptions(clientOptions);

  if (!clientOptions.accessToken) {
    throw new Error('Missing "accessToken" for accessToken authentication.');
  }

  if (!authClient.authflow) {
    authClient.authflow = new Authflow(clientOptions.username, clientOptions.profilesFolder, extendedOptions, clientOptions.onMsaCode);
  }

  const authflow = authClient.authflow!;

  authflow.mca = buildPatchedManager(
    authflow.mca as { getCachedAccessToken: () => Promise<unknown> },
    clientOptions.accessToken
  );
}

async function authenticateWithAccessToken(client: Client, clientOptions: ClientOptions) {
  setAccessTokenAuthflow(client, clientOptions);
  await microsoftAuth.authenticate(client, clientOptions);
}

export function createBot(botOptions: BotOptions) {
  switch (botOptions.auth) {
    case "cookies": {
      botOptions.auth = async (client: Client, clientOptions: ClientOptions) => {
        if (!botOptions.cookieOptions || !botOptions.cookieOptions.cookies) {
          throw new Error("Missing cookie path for authentication in bot options.");
        }
        await authenticateWithCache(client, clientOptions, botOptions.cookieOptions);
      };
      break;
    }

    case "accessToken": {
      botOptions.auth = authenticateWithAccessToken;
      break;
    }

    case "microsoft": {
      botOptions.auth = maybeClearCookieCache;
      break;
    }
  }

  return oldCreateBot(botOptions);
}
