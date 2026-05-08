# mineflayer-custom-auth

Extra authentication methods for `mineflayer`, focused on cases that do not fit cleanly into the main project.

Right now this package supports:

- Microsoft cookie-based login
- Direct `accessToken` login

## Why this exists

Some auth flows are heavier than normal bot setup. Cookie login, for example, uses Puppeteer and extra cache handling, which makes it a better fit as a separate package instead of a built-in `mineflayer` feature.

## Installation

```bash
npm install mineflayer-custom-auth
```

## Quick Start

### Cookie login

```ts
import { createBot, cookie } from "mineflayer-custom-auth";
import fs from "fs";

const { parseCookies } = cookie;

const fileData = fs.readFileSync("./cookies.txt", "utf8");
const cookies = parseCookies(fileData);

const bot = createBot({
  username: "Generel_Schwerz",
  host: "play.hypixel.net",
  auth: "cookies",
  cookieOptions: {
    cookies,
    // authMethod: "auto", // "auto" tries browserless cookies first, then Puppeteer.
    // headless: false,
    // proxy: "https://127.0.0.1:8080", // browser and browserless
    // proxy: "socks5://127.0.0.1:1080", // browserless only
    // allowUnsafeProxyTls: true, // bypasses TLS certificate failures from intercepting proxies
  },
});

bot.on("spawn", () => {
  console.log(bot.username);
});
```

Cookie file formatting is documented here:

- [Cookie Login Docs](./docs/COOKIES.md)

### Access token login

```ts
import { createBot } from "mineflayer-custom-auth";

const bot = createBot({
  username: "Generel_Schwerz",
  host: "play.hypixel.net",
  auth: "accessToken",
  javaAccessToken: "your-minecraft-access-token",
});

bot.on("spawn", () => {
  console.log(bot.username);
});
```

## Notes

- If you switch the same username between `microsoft` auth and `cookies` auth, the cookie cache may be cleared.
- Cookie auth supports `authMethod: "auto" | "browserless" | "browser"`. Use `"browserless"` to force the browserless cookie flow, or `"browser"` to force Puppeteer.
- Proxy strings should include a scheme, such as `https://127.0.0.1:8080` or `socks5://user:pass@127.0.0.1:1080`.
- The browserless cookie flow supports `http://`, `https://`, `socks://`, `socks4://`, and `socks5://` proxies.
- The Puppeteer browser cookie flow supports only `http://` and `https://` proxies and throws if given a SOCKS proxy.
- `allowUnsafeProxyTls: true` can bypass TLS certificate failures caused by intercepting proxies. This is unsafe because the proxy may see or modify auth traffic.
- The `accessToken` flow relies on the same upstream Microsoft auth path in `minecraft-protocol`, but swaps in your supplied Minecraft token through a patched `prismarine-auth` manager.

## Support

If this package saves you time and you want to support the project:

- [Ko-fi: generel](https://ko-fi.com/generel)
