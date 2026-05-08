const path = require('path');
const { createBot, cookie } = require('../dist')
const fs = require('fs')

const { parseCookies } = cookie

const cookiePath = path.join(__dirname, 'data', 'gen.txt');
const fileData = fs.readFileSync(cookiePath, 'utf-8')

// provided utility method to parse cookies.
const cookies = parseCookies(fileData)

const bot = createBot({
    profilesFolder: __dirname + '/cache',
    username: 'Generel_Schwerz',
    host: 'mc.pvplegacy.net',

    auth: 'cookies',
    cookieOptions: {
        // headless: false,
        cookies: cookies,
        authMethod: 'browserless',   

        // HTTP(S) proxies work with browserless and browser auth.
        // proxy: "https://127.0.0.1:8080"

        // SOCKS proxies work with browserless auth only.
        // proxy: "socks5://127.0.0.1:1080"
        // allowUnsafeProxyTls: true
    },
})

bot.on('spawn', () => {
    console.log(bot.username)
})

bot.on('kicked', (reason) => {
    console.log('Kicked:', reason)
})
