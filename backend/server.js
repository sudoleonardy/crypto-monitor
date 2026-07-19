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
    oi_status TEXT, 
    entry_price REAL, stop_loss REAL, take_profit REAL,
    updated_at INTEGER
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

function broadcast(data) { clients.forEach(c => c.write(`data: ${JSON.stringify(data)}\n\n`)); }

app.get('/api/tokens', async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM tokens ORDER BY rvol DESC LIMIT 50', args: [] });
  res.json(result.rows);
});
app.get('/', (req, res) => res.send('Backend CEX is running...'));

app.get('/test-telegram', async (req, res) => {
  try {
    const message = `🧪 *TEST BOT CEX*\n\nWaktu: ${new Date().toLocaleString()}`;
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' })
    });
    res.send(response.ok ? '✅ Pesan terkirim!' : '❌ Error: ' + JSON.stringify(await response.json()));
  } catch (err) { res.status(500).send('❌ Gagal: ' + err.message); }
});

async function sendTelegramAlert(t) {
  const message = `🚀 *ACCUMULATION DETECTED*\n\n` +
    `💎 *Token:* ${t.name} (${t.symbol})\n` +
    `📊 *RVOL:* ${t.rvol.toFixed(2)}x | *OI:* ${t.oi_status}\n` +
    `💰 *Entry:* $${t.entry_price.toFixed(4)}\n` +
    `🛑 *SL:* $${t.stop_loss.toFixed(4)}\n` +
    `🎯 *TP:* $${t.take_profit.toFixed(4)}`;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' })
    });
  } catch (err) { console.error(err); }
}

async function fetchBinance() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return (await res.json()).filter(t => t.symbol.endsWith('USDT')).map(t => ({
      symbol: t.symbol, name: t.symbol.replace('USDT', ''), exchange: 'Binance',
      price_change_24h: parseFloat(t.priceChangePercent),
      volume_usdt: parseFloat(t.quoteVolume),
      trade_count: parseInt(t.count),
      current_price: parseFloat(t.lastPrice),
      low_price: parseFloat(t.lowPrice),
      high_price: parseFloat(t.highPrice)
    }));
  } catch { return []; }
}

async function fetchBinanceHistorical(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=7`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const klines = await res.json();
    return klines.map(k => parseFloat(k[7])).reduce((a, b) => a + b, 0) / 7;
  } catch { return null; }
}

async function fetchBinanceFuturesData(symbol) {
  try {
    const [oiRes, histRes, frRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) }),
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`, { signal: AbortSignal.timeout(3000) }),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) })
    ]);
    if (!oiRes.ok || !histRes.ok || !frRes.ok) return { has_futures: 0, oi_change_24h: null, funding_rate: null };
    const [oiData, histData, frData] = await Promise.all([oiRes.json(), histRes.json(), frRes.json()]);
    const currentOI = parseFloat(oiData.openInterest);
    const oldOI = histData.length > 0 ? parseFloat(histData[0].sumOpenInterest) : currentOI;
    return { 
      has_futures: 1, 
      oi_change_24h: oldOI > 0 ? ((currentOI - oldOI) / oldOI) * 100 : 0, 
      funding_rate: parseFloat(frData.lastFundingRate) 
    };
  } catch { return { has_futures: 0, oi_change_24h: null, funding_rate: null }; }
}

async function fetchAndFilter() {
  console.log(`\n--- [${new Date().toLocaleTimeString()}] Scan CEX ---`);
  const tickers = await fetchBinance();
  const accumulated = [];

  for (const t of tickers) {
    if (t.price_change_24h < -4 || t.price_change_24h > 5) continue;
    if (t.volume_usdt < 5000000 || t.trade_count < 10000) continue;

    const avgVolume7d = await fetchBinanceHistorical(t.symbol);
    if (!avgVolume7d || avgVolume7d === 0) continue;

    const rvol = t.volume_usdt / avgVolume7d;
    if (rvol < 2.0) continue;

    const futuresData = await fetchBinanceFuturesData(t.symbol);
    await new Promise(r => setTimeout(r, 200));
    
    let oiStatus = 'No Futures';
    if (futuresData.has_futures) {
      if (futuresData.oi_change_24h > 10 && futuresData.funding_rate >= -0.0001 && futuresData.funding_rate <= 0.0003) oiStatus = '✅ Verified';
      else if (futuresData.oi_change_24h <= 10) oiStatus = '⚠️ OI Low';
      else oiStatus = '⚠️ FR Issue';
    }
    
    // Hitung Entry, SL, TP berdasarkan struktur 24 jam
    const entry_price = t.low_price * 1.005; // 0.5% di atas low 24h
    const stop_loss = t.low_price * 0.98;    // 2% di bawah low 24h
    const take_profit = t.high_price * 1.05; // 5% di atas high 24h

    t.rvol = rvol; t.avg_volume_7d = avgVolume7d;
    t.buy_volume = 0; t.sell_volume = 0; t.buy_volume_pct = 50;
    t.oi_change_24h = futuresData.oi_change_24h;
    t.funding_rate = futuresData.funding_rate;
    t.has_futures = futuresData.has_futures;
    t.oi_status = oiStatus;
    t.entry_price = entry_price;
    t.stop_loss = stop_loss;
    t.take_profit = take_profit;
    
    const existing = await db.execute({ sql: 'SELECT symbol FROM tokens WHERE symbol = ?', args: [t.symbol] });
    if (existing.rows.length === 0) sendTelegramAlert(t);

    await db.execute({
      sql: 'INSERT OR REPLACE INTO tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [t.symbol, t.name, t.exchange, t.price_change_24h, t.volume_usdt, t.trade_count, t.rvol, t.avg_volume_7d, 
             t.buy_volume, t.sell_volume, t.buy_volume_pct, t.oi_change_24h, t.funding_rate, t.has_futures, t.oi_status,
             t.entry_price, t.stop_loss, t.take_profit, Date.now()]
    });
    accumulated.push(t);
    await new Promise(r => setTimeout(r, 100));
  }

  if (accumulated.length > 0) { broadcast(accumulated); console.log(`🚀 DITEMUKAN: ${accumulated.length} token!`); }
}

async function startServer() {
  await initDB();
  cron.schedule('*/10 * * * *', fetchAndFilter);
  fetchAndFilter();
  app.listen(process.env.PORT || 4000, () => console.log(`🟢 Backend CEX berjalan`));
}
startServer();