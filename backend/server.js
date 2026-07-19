require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@libsql/client');

const app = express();
app.use(cors());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN
});

async function initDB() {
  await db.execute(`CREATE TABLE IF NOT EXISTS tokens (
    symbol TEXT PRIMARY KEY, name TEXT, exchange TEXT, 
    price_change_24h REAL, volume_usdt REAL, trade_count INTEGER,
    rvol REAL, avg_volume_7d REAL,
    buy_volume REAL, sell_volume REAL, buy_volume_pct REAL,
    oi_change_24h REAL, funding_rate REAL, has_futures INTEGER,
    oi_status TEXT, updated_at INTEGER
  )`);
  console.log('✅ Database Turso initialized');
}

let clients = [];
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.push(res);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});

function broadcast(data) {
  clients.forEach(c => c.write(`data: ${JSON.stringify(data)}\n\n`));
}

app.get('/api/tokens', async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM tokens ORDER BY rvol DESC LIMIT 50', args: [] });
  res.json(result.rows);
});

app.get('/', (req, res) => res.send('Backend CEX is running...'));

// === ENDPOINT TEST TELEGRAM ===
app.get('/test-telegram', async (req, res) => {
  try {
    const message = `🧪 *TEST BOT CEX*\n\nIni adalah pesan tes dari CEX Backend.\nWaktu: ${new Date().toLocaleString()}\nToken: ${TELEGRAM_BOT_TOKEN ? 'Set' : 'Missing'}\nChat ID: ${TELEGRAM_CHAT_ID ? 'Set' : 'Missing'}`;
    
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      res.send('✅ Pesan terkirim! Cek Telegram Anda.');
    } else {
      res.status(500).send('❌ Telegram API Error: ' + JSON.stringify(data));
    }
  } catch (err) {
    res.status(500).send('❌ Gagal: ' + err.message);
  }
});

async function sendTelegramAlert(token) {
  const exchangeUrl = token.exchange.toUpperCase();
  const message = ` *HIGH RVOL DETECTED*\n\n` +
    `💎 *Token:* ${token.name} (${token.symbol})\n` +
    `🏛️ *Exchange:* ${token.exchange}\n` +
    `📊 *RVOL:* ${token.rvol.toFixed(2)}x\n` +
    `🏷️ *Status:* ${token.oi_status}\n` +
    `🔗 *Chart:* https://www.tradingview.com/chart/?symbol=${exchangeUrl}:${token.symbol}`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' })
    });
  } catch (err) { console.error(`❌ Telegram error:`, err.message); }
}

async function fetchBinanceHistorical(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=7`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const klines = await res.json();
    const volumes = klines.map(k => parseFloat(k[7]));
    return volumes.reduce((a, b) => a + b, 0) / volumes.length;
  } catch { return null; }
}

async function fetchBinance() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const tickers = await res.json();
    return tickers.filter(t => t.symbol.endsWith('USDT')).map(t => ({
      symbol: t.symbol, name: t.symbol.replace('USDT', ''), exchange: 'Binance',
      price_change_24h: parseFloat(t.priceChangePercent),
      volume_usdt: parseFloat(t.quoteVolume),
      trade_count: parseInt(t.count)
    }));
  } catch { return []; }
}

async function fetchBinanceFuturesData(symbol) {
  try {
    const oiRes = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) });
    if (!oiRes.ok) return { has_futures: 0, oi_change_24h: null, funding_rate: null };
    
    const histRes = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`, { signal: AbortSignal.timeout(3000) });
    if (!histRes.ok) return { has_futures: 0, oi_change_24h: null, funding_rate: null };
    
    const frRes = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) });
    if (!frRes.ok) return { has_futures: 0, oi_change_24h: null, funding_rate: null };
    
    const [oiData, histData, frData] = await Promise.all([oiRes.json(), histRes.json(), frRes.json()]);
    
    const currentOI = parseFloat(oiData.openInterest);
    const oldOI = histData.length > 0 ? parseFloat(histData[0].sumOpenInterest) : currentOI;
    const oiChange = oldOI > 0 ? ((currentOI - oldOI) / oldOI) * 100 : 0;
    const fundingRate = parseFloat(frData.lastFundingRate);
    
    return { has_futures: 1, oi_change_24h: oiChange, funding_rate: fundingRate };
  } catch { return { has_futures: 0, oi_change_24h: null, funding_rate: null }; }
}

async function fetchAndFilter() {
  console.log(`\n--- [${new Date().toLocaleTimeString()}] Scan CEX ---`);
  const tickers = await fetchBinance();
  console.log(`✅ Diambil: ${tickers.length} pair`);
  
  const accumulated = [];

  for (const t of tickers) {
    const isSideways = t.price_change_24h >= -4 && t.price_change_24h <= 5;
    const isHighVolume = t.volume_usdt >= 5000000;
    const isActive = t.trade_count >= 10000;

    if (isSideways && isHighVolume && isActive) {
      const avgVolume7d = await fetchBinanceHistorical(t.symbol);
      if (!avgVolume7d || avgVolume7d === 0) continue;

      const rvol = t.volume_usdt / avgVolume7d;
      if (rvol >= 2.0) {
        const futuresData = await fetchBinanceFuturesData(t.symbol);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        let oiStatus = 'No Futures';
        if (futuresData.has_futures) {
          const oiHealthy = futuresData.oi_change_24h > 10;
          const frHealthy = futuresData.funding_rate >= -0.0001 && futuresData.funding_rate <= 0.0003;
          if (oiHealthy && frHealthy) oiStatus = '✅ Verified';
          else if (!oiHealthy) oiStatus = `⚠️ OI Low`;
          else oiStatus = `⚠️ FR Issue`;
        }
        
        t.rvol = rvol;
        t.avg_volume_7d = avgVolume7d;
        t.buy_volume = 0;
        t.sell_volume = 0;
        t.buy_volume_pct = 50;
        t.oi_change_24h = futuresData.oi_change_24h;
        t.funding_rate = futuresData.funding_rate;
        t.has_futures = futuresData.has_futures;
        t.oi_status = oiStatus;
        
        const existing = await db.execute({ sql: 'SELECT symbol FROM tokens WHERE symbol = ?', args: [t.symbol] });
        if (existing.rows.length === 0) sendTelegramAlert(t);

        await db.execute({
          sql: 'INSERT OR REPLACE INTO tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [t.symbol, t.name, t.exchange, t.price_change_24h, t.volume_usdt, 
                 t.trade_count, t.rvol, t.avg_volume_7d, t.buy_volume, t.sell_volume, 
                 t.buy_volume_pct, t.oi_change_24h, t.funding_rate, t.has_futures, t.oi_status, Date.now()]
        });
        accumulated.push(t);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (accumulated.length > 0) {
    broadcast(accumulated);
    console.log(`🚀 DITEMUKAN: ${accumulated.length} token!`);
  }
}

async function startServer() {
  await initDB();
  cron.schedule('*/10 * * * *', fetchAndFilter);
  fetchAndFilter();
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`\n🟢 Backend CEX berjalan di port ${PORT}\n`));
}

startServer();