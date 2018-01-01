import Telegraf from 'telegraf'
import Markup from 'telegraf/markup'
import telegramAws from 'telegraf-aws'
import AWS from 'aws-sdk'
import got from 'got'

const documentClient = new AWS.DynamoDB.DocumentClient()

const bot = new Telegraf(process.env.BOT_API_KEY || "", {
  webhookReply: true
})
const updateHandler = telegramAws(bot, {
  timeout: 10000
})

if (process.env.WEBHOOK_URL)
  bot.telegram.setWebhook(process.env.WEBHOOK_URL)

bot.command('btc', async (ctx) => {
  try {
    let date = new Date()
    date.setHours(0, 0, 0, 0)

    let query = await documentClient.query({
      TableName: 'btcInfo',
      KeyConditionExpression: '#day = :day AND #created > :created',
      ExpressionAttributeNames: {
        '#created': 'created',
        '#day': 'day'
      },
      ExpressionAttributeValues: {
        ':created': Date.now() - (6 * 60 * 1000),
        ':day': date.getTime()
      }
    }).promise()

    if (!query || !query.Items || query.Items.length < 1) {
      return ctx.reply('Data not found')
    }

    let data = query.Items[0]
    let tableData = []
    tableData = tableData.concat([
      '-',
      'Price',
      'Wait',
      'USD'
    ])

    const avgTransactionGas = 226
    const btcPrice = data.btcPrice

    const typeNames = {
      low: 'Low',
      normal: 'Normal',
      fast: 'Fast',
    }

    for(let type of ['low', 'normal', 'fast']) {
      tableData.push(typeNames[type])
      tableData.push(`${data[type].price}`)
      tableData.push(`${data[type].minMinutes}-${data[type].maxMinutes} m`)


      let satoshiAmount = data[type].price
      const avgTsPrice = avgTransactionGas * satoshiAmount

      let avgUsdPrice = avgTsPrice / Math.pow(10, 3)
      avgUsdPrice = Math.floor(avgUsdPrice) / 10
      tableData.push(`${avgUsdPrice} $`)
    }

    let keyboardButtons = tableData.map(s => Markup.callbackButton(s, s))

    ctx.reply(`Bitcoin network fees:`,
      Markup.inlineKeyboard(keyboardButtons, {
        columns: 4
      }).extra()
    )
  } catch(err) {
    console.log('Query result:', err)
    ctx.reply(`ERR: ${JSON.stringify(err)}`)
  }
})

bot.on('text', async (ctx) => {
  try {
    let date = new Date()
    date.setHours(0, 0, 0, 0)

    let query = await documentClient.query({
      TableName: 'etherInfo',
      KeyConditionExpression: '#day = :day AND #created > :created',
      ExpressionAttributeNames: {
        '#created': 'created',
        '#day': 'day'
      },
      ExpressionAttributeValues: {
        ':created': Date.now() - (6 * 60 * 1000),
        ':day': date.getTime()
      }
    }).promise()

    if (!query || !query.Items || query.Items.length < 1) {
      return ctx.reply('Data not found')
    }

    let data = query.Items[0]
    let tableData = []
    tableData = tableData.concat([
      '-',
      'Price',
      'Wait',
      'USD'
    ])

    const avgTransactionGas = 21000
    const etherPrice = data.etherPrice

    const waitMappings = {
      safeLow: 'safeLowWait',
      average: 'avgWait',
      fast: 'fastWait',
      fastest: 'fastestWait'
    }
    const typeNames = {
      safeLow: 'Low',
      average: 'Normal',
      fast: 'Fast',
      fastest: 'Fastest'
    }
    for(let type of ['safeLow', 'average', 'fast', 'fastest']) {
      tableData.push(typeNames[type])
      tableData.push(`${data[type] / 10} Gwei`)
      tableData.push(data[waitMappings[type]] >= 1.0
        ? `${data[waitMappings[type]]} m`
        : `${Math.floor(data[waitMappings[type]] * 60)} s`,)


      let gweiAmount = data[type]
      let avgTsEtherPrice = avgTransactionGas * gweiAmount // Actually not gwei, but gwei / 10, but we will not convert it, because we can just use one less 0 later

      let avgUsdPrice = avgTsEtherPrice * etherPrice / Math.pow(10, 7)
      avgUsdPrice = Math.floor(avgUsdPrice) / 1000
      tableData.push(`${avgUsdPrice} $`)
    }

    let keyboardButtons = tableData.map(s => Markup.callbackButton(s, s))

    ctx.reply(`Data is actual for block #${data.blockNum}. Blockchain load: ${Math.floor(data.speed * 100)}%`,
      Markup.inlineKeyboard(keyboardButtons, {
        columns: 4
      }).extra()
    )
  } catch(err) {
    console.log('Query result:', err)
    ctx.reply(`ERR: ${JSON.stringify(err)}`)
  }
})

export const telegram = async (event, context, callback) => {
  updateHandler(event, callback)
}

export const background = async (event, context, callback) => {
  callback(null, [await getEthereumInfo(), await getBitcoinInfo()])
}

async function getEthereumInfo () {
  let api = await got('https://ethgasstation.info/json/ethgasAPI.json', {
    json: true
  })
  let res = api.body


  let { body: currencyApi } = await got('https://api.coinmarketcap.com/v1/ticker/?limit=5', {
    json: true
  })

  let ether = currencyApi.filter(e => e.id === 'ethereum')[0]
  let date = new Date()
  date.setHours(0, 0, 0, 0)
  let putResult = await documentClient.put({
    TableName: 'etherInfo',
    Item: {
      day: date.getTime(),
      created: Date.now(),
      createdAt: (new Date()).toISOString(),
      avgWait: res.avgWait,
      fastest: res.fastest,
      fastWait: res.fastWait,
      fastestWait: res.fastestWait,
      average: res.average,
      fast: res.fast,
      speed: res.speed,
      safeLowWait: res.safeLowWait,
      block_time: res.block_time,
      blockNum: res.blockNum,
      safeLow: res.safeLow,
      etherPrice: ether.price_usd
    }
  }).promise()

  return putResult
}

async function getBitcoinInfo () {
  let { body: recommendedFees } = await got('https://bitcoinfees.earn.com/api/v1/fees/recommended', {
    json: true
  })

  let { body: feesList } = await got('https://bitcoinfees.earn.com/api/v1/fees/list', {
    json: true
  })

  feesList = feesList.fees

  let fees = {
    low: recommendedFees['hourFee'],
    normal: recommendedFees['halfHourFee'],
    fast: recommendedFees['fastestFee']
  }

  let waitTimes = { }
  for (let type of Object.keys(fees)) {
    let price = fees[type]
    for (let fee of feesList) {
      if (fee.minFee <= price && fee.maxFee >= price) {
        waitTimes[type] = fee
      }
    }
  }

  let { body: currencyApi } = await got('https://api.coinmarketcap.com/v1/ticker/?limit=5', {
    json: true
  })

  let btc = currencyApi.filter(e => e.id === 'bitcoin')[0]
  let date = new Date()
  date.setHours(0, 0, 0, 0)

  let toInsert = {
    day: date.getTime(),
    created: Date.now(),
    createdAt: (new Date()).toISOString(),
    btcPrice: btc.price_usd
  }

  for (let type of Object.keys(fees)) {
    toInsert[type] = {
      price: fees[type],
      minMinutes: waitTimes[type]['minMinutes'],
      maxMinutes: waitTimes[type]['maxMinutes']
    }
  }

  let putResult = await documentClient.put({
    TableName: 'btcInfo',
    Item: toInsert
  }).promise()

  return putResult
}
