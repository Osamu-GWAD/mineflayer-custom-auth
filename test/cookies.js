const { createBot, cookie } = require('../dist')
const fs = require('fs')

const { parseCookies } = cookie

const cookiePath = '/home/generel/Documents/code/typescript/mineflayer/mineflayer-custom-auth/test/data/Nyxoxh.txt';
const fileData = fs.readFileSync(cookiePath, 'utf-8')

// provided utility method to parse cookies.
const cookies = parseCookies(fileData)

const bot = createBot({
    profilesFolder: __dirname + '/cache',
    username: 'Generel_Schwerz',
    host: 'play.hypixel.net',

    auth: 'cookies',
    cookieOptions: {
        headless: false,
        cookies: cookies,   
        
        // Note: do NOT include http:// or https://, this is handled internally.
        // this also does not support SOCKS5 proxies.
        // proxy: "127.0.0.1:1080" // optional, can be a ProxyConfig object or a string URL
    },
})

bot.on('spawn', () => {
    console.log(bot.username)
})

bot.on('kicked', (reason) => {
    console.log('Kicked:', reason)
})