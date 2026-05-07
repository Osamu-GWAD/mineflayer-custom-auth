# Cookie Login

## Cookie Format
<!-- link src/cookies/cookie.ts 's "parseCookies" -->
If you are using [parseCookies](../src/cookies/cookie.ts#L14) to parse cookies, the format should be as follows:
```bash
<website>	<something>	<path>	<secure>	<expiration>	<name>	<value>
```

### Example File
```txt
.live.com   TRUE    /	FALSE	3784011825	MSPAuth	Disabled
.live.com	TRUE	/	FALSE	3784011825	PPLState	1
.login.live.com	TRUE	/	FALSE	3784011825	MSPBack	0
```

I only use `website, path, name, value` in the code. The rest is auto-filled in. It still needs to be in the above format though.

## Auth Method

`cookieOptions.authMethod` controls how cookies are exchanged for a Minecraft token:

- `"auto"`: try the browserless flow first, then fall back to Puppeteer. This is the default.
- `"browserless"`: only use the browserless flow from `src/cookies/browserless.ts`.
- `"browser"`: only use the original Puppeteer flow.

Proxy strings should include a scheme:

```ts
cookieOptions: {
  cookies,
  authMethod: "browserless",
  proxy: "socks5://127.0.0.1:1080",
}
```

The browserless flow supports `http://`, `https://`, `socks://`, `socks4://`, and `socks5://` proxies.

The Puppeteer browser flow supports only `http://` and `https://` proxies. It throws a runtime error if you pass `socks://`, `socks4://`, or `socks5://`.
