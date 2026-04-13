const { createBot } = require('../dist')

const bot = createBot({
    profilesFolder: __dirname + '/cache',
    username: 'Generel_Schwerz',
    host: 'connect.2b2t.org',

    // custom auth
    // auth: 'accessToken',
    // javaAccessToken: 'wfqwfwe....',
    auth: 'refreshToken',
    liveAccessToken: 'EwDoA+pvBAAUKods...'
})

bot.on('login', () => {
    console.log(bot.username)
})

bot.on('kicked', (reason) => {
    console.log('Kicked:', reason)
})