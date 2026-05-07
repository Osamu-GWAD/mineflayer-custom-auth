import {createBot, cookie} from "../"
import fs from 'fs'

const {parseCookies} = cookie

const cookiePath = '/home/generel/Documents/code/typescript/mineflayer/mineflayer-custom-auth/test/data/Nyxoxh.txt';
const fileData = fs.readFileSync(cookiePath, 'utf-8')

// provided utility method to parse cookies.
const cookies = parseCookies(fileData)


const bot = createBot({
    username: 'Generel_Schwerz',
    host: 'anticheat-test.com',
    auth: 'cookies',
    profilesFolder: __dirname + '/cache',  
    cookieOptions: {
        cookies: cookies,
        headless: false,
        // executablePath: '/path/to/chrome', // optional
        // proxy: "https://127.0.0.1:8080" // browser and browserless
        // proxy: "socks5://127.0.0.1:1080" // browserless only
    }
})

bot.on('spawn', () => {
    console.log(bot.username)
})
