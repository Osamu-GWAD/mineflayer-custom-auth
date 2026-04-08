const { createBot } = require('../dist')

const bot = createBot({
    profilesFolder: __dirname + '/cache',
    username: 'Generel_Schwerz',
    host: 'play.hypixel.net',

    // custom auth
    auth: 'accessToken',
    accessToken: 'eyJraWQiOiIwNDkxODEiLCJhbGciOiJSUzI1NiJ9.eyJ4dWlkIjoiMjUzNTQwOTUwNDM5MDk1NiIsImFnZyI6IkFkdWx0Iiwic3ViIjoiOWNiNDY0M2YtMzNlZS00MmU0LWI2OTMtZDkxMmRiMGFlM2ZiIiwiYXV0aCI6IlhCT1giLCJwZmlkIjoiQTY4NDlFMDYwNjRDRTU5RCIsIm5zIjoiZGVmYXVsdCIsInJvbGVzIjpbXSwiaXNzIjoiYXV0aGVudGljYXRpb24iLCJmbGFncyI6WyJtdWx0aXBsYXllciJdLCJwcm9maWxlcyI6eyJtYyI6IjllODhiYTViLTM5YjQtNDZlMi1iMDZkLWM2N2I2ZmU4NzIzMyJ9LCJtaWQiOiJBNjg0OUUwNjA2NENFNTlEIiwicG1pZCI6IjRkMTNlMzRjLTA5MzMtNTdkMC1iYzI1LWMyZGE5YTZkMzE3ZCIsInBsYXRmb3JtIjoiUENfTEFVTkNIRVIiLCJ0aWQiOiJFOTlCMCIsInBmZCI6W3sidHlwZSI6Im1jIiwiaWQiOiI5ZTg4YmE1Yi0zOWI0LTQ2ZTItYjA2ZC1jNjdiNmZlODcyMzMiLCJuYW1lIjoiR2VuZXJlbF9TY2h3ZXJ6In1dLCJ4aWQiOiIyNTM1NDA5NTA0MzkwOTU2IiwibmJmIjoxNzc1Njg0MjQwLCJleHAiOjE3NzU3NzA2NDAsImlhdCI6MTc3NTY4NDI0MCwiYWlkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDQ0MWNjOTZiIn0.egz11LMXU9p29kBLMEFuxXFevSik56G6X-pHvnatuNHPbACYpcFSEBC-TO3G1HNkui2-3z7Ykdiufn4y7jPbH4XhrcSK_Lk7xmUf83DG1xlLhwVMzcZ8sUNXyUVedwVXWWdrO-vGbo8PbjL_UxVr39xh5Vx1KuPqEPvhAh7ALzwHnoGC09qmTvxmSQZTfD0iIjJPGgKFTtMc-xxwkQuzHS3mzDmPCF2BMXw7x0UyHpcnJzNWM5FZZWXaa-LlqSGb_2Jvo9woO9Z7bAxjWtvP4r9_pRUtcfO-nFqsoVffI7bEiGsMpx8RMlYU4MnNWLmUhbvk8i-qpdwnMDA3fH2A2g',
})

bot.on('spawn', () => {
    console.log(bot.username)
})

bot.on('kicked', (reason) => {
    console.log('Kicked:', reason)
})