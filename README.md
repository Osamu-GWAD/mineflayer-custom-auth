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
    // headless: false,
    // proxy: "127.0.0.1:1080",
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
  accessToken: "your-minecraft-access-token",
});

bot.on("spawn", () => {
  console.log(bot.username);
});
```

## Notes

- If you switch the same username between `microsoft` auth and `cookies` auth, the cookie cache may be cleared.
- Proxy support is HTTP-only right now. Do not include `http://` or `https://` in the proxy string.
- The `accessToken` flow relies on the same upstream Microsoft auth path in `minecraft-protocol`, but swaps in your supplied Minecraft token through a patched `prismarine-auth` manager.

## Support

If this package saves you time and you want to support the project:

- [Ko-fi: generel](https://ko-fi.com/generel)
