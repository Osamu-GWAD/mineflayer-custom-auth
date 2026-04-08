const { createBot } = require('../dist')

const bot = createBot({
    profilesFolder: __dirname + '/cache',
    username: 'Generel_Schwerz',
    host: 'play.hypixel.net',

    // custom auth
    auth: 'accessToken',
    accessToken: 'eyJraWQiOiIwNDkx4dWlkIjoiMjUzN...',

})

bot.on('spawn', () => {
    console.log(bot.username)
})

bot.on('kicked', (reason) => {
    console.log('Kicked:', reason)
})