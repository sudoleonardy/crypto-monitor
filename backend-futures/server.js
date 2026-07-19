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
  await db.execute(`CREATE TABLE IF NOT EXISTS signals (
    symbol TEXT PRIMARY KEY, name TEXT, 
    price_change_24h REAL, volume_usdt REAL,
    rvol REAL, avg_volume_7d REAL,
    oi_change_24h REAL, funding_rate REAL,
    buy_volume_pct REAL,
    signal_direction TEXT, signal_confidence REAL, signal_reason TEXT,
    entry_price REAL, stop_loss REAL, take_profit REAL,
    updated_at INTEGER
  )`);
  console.log('✅ Database Turso initialized (Futures)');
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

app.get('/api/signals', async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM signals ORDER BY signal_confidence DESC LIMIT 30', args: [] });
  res.json(result.rows);
});

app.get('/', (req, res) => res.send('Backend Futures is running...'));

// === ENDPOINT TEST TELEGRAM ===
app.get('/test-telegram', async (req, res) => {
  try {
    const message = `🧪 *TEST BOT FUTURES*\n\nIni adalah pesan tes dari Futures Backend.\nWaktu: ${new Date().toLocaleString()}\nToken: ${TELEGRAM_BOT_TOKEN ? 'Set' : 'Missing'}\nChat ID: ${TELEGRAM_CHAT_ID ? 'Set' : 'Missing'}`;
    
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

async function sendTelegramAlert(signal) {
  const direction = signal.signal_direction === 'LONG' ? '🟢' : '🔴';
  const confidence = signal.signal_confidence >= 80 ? 'TINGGI' : signal.signal_confidence >= 60 ? 'SEDANG' : 'RENDAH';
  
  const message = `${direction} *SINYAL ${signal.signal_direction} - ${confidence}*\n\n` +
    `💎 *Token:* ${signal.name} (${signal.symbol})\n` +
    `📊 *Price 24h:* ${signal.price_change_24h > 0 ? '+' : ''}${signal.price_change_24h.toFixed(2)}%\n` +
    `🔥 *Volume:* $${(signal.volume_usdt / 1000000).toFixed(2)}M | RVOL: ${signal.rvol.toFixed(2)}x\n` +
    `📈 *OI Change:* ${signal.oi_change_24h?.toFixed(2)}% | FR: ${(signal.funding_rate * 100).toFixed(4)}%\n` +
    `💹 *Buy/Sell:* ${signal.buy_volume_pct?.toFixed(1)}% / ${(100 - signal.buy_volume_pct).toFixed(1)}%\n` +
    `🎯 *Confidence:* ${signal.signal_confidence.toFixed(0)}%\n` +
    `📝 *Alasan:* ${signal.signal_reason}\n` +
    ` *Entry:* $${signal.entry_price?.toFixed(4)} | SL: $${signal.stop_loss?.toFixed(4)} | TP: $${signal.take_profit?.toFixed(4)}\n` +
    ` *Chart:* https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol}`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown', disable_web_page_preview: false })
    });
  } catch (err) { console.error(`❌ Gagal kirim Telegram:`, err.message); }
}

async function fetchBinanceTickers() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const tickers = await res.json();
    return tickers.filter(t => t.symbol.endsWith('USDT')).map(t => ({
      symbol: t.symbol, name: t.symbol.replace('USDT', ''),
      price_change_24h: parseFloat(t.priceChangePercent),
      volume_usdt: parseFloat(t.quoteVolume),
      current_price: parseFloat(t.lastPrice)
    }));
  } catch { return []; }
}

async function fetchHistoricalVolume(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=7`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const klines = await res.json();
    const volumes = klines.map(k => parseFloat(k[7]));
    return volumes.reduce((a, b) => a + b, 0) / volumes.length;
  } catch { return null; }
}

async function fetchBuySellVolume(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const trades = await res.json();
    let buyVolume = 0, sellVolume = 0;
    trades.forEach(trade => {
      const volume = parseFloat(trade.q);
      if (trade.m) sellVolume += volume;
      else buyVolume += volume;
    });
    const total = buyVolume + sellVolume;
    return total > 0 ? (buyVolume / total) * 100 : 50;
  } catch { return null; }
}

async function fetchFuturesData(symbol) {
  try {
    const [oiRes, histRes, frRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) }),
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`, { signal: AbortSignal.timeout(3000) }),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) })
    ]);
    if (!oiRes.ok || !histRes.ok || !frRes.ok) return null;
    const [oiData, histData, frData] = await Promise.all([oiRes.json(), histRes.json(), frRes.json()]);
    const currentOI = parseFloat(oiData.openInterest);
    const oldOI = histData.length > 0 ? parseFloat(histData[0].sumOpenInterest) : currentOI;
    const oiChange = oldOI > 0 ? ((currentOI - oldOI) / oldOI) * 100 : 0;
    const fundingRate = parseFloat(frData.lastFundingRate);
    return { oi_change_24h: oiChange, funding_rate: fundingRate };
  } catch { return null; }
}

function generateSignal(ticker, rvol, futuresData, buyVolumePct, currentPrice) {
  let direction = null;
  let confidence = 0;
  let reasons = [];
  
  if (rvol >= 2.0 && futuresData.oi_change_24h > 10 && futuresData.funding_rate < 0.0003 && buyVolumePct > 55) {
    direction = 'LONG';
    if (rvol >= 3.0) { confidence += 25; reasons.push('RVOL sangat tinggi'); }
    else if (rvol >= 2.5) { confidence += 20; reasons.push('RVOL tinggi'); }
    else { confidence += 15; reasons.push('RVOL moderat'); }
    if (futuresData.oi_change_24h > 20) { confidence += 25; reasons.push('OI naik signifikan'); }
    else if (futuresData.oi_change_24h > 15) { confidence += 20; reasons.push('OI naik'); }
    else { confidence += 15; reasons.push('OI naik moderat'); }
    if (futuresData.funding_rate < 0) { confidence += 20; reasons.push('FR negatif'); }
    else if (futuresData.funding_rate < 0.0001) { confidence += 15; reasons.push('FR rendah'); }
    else { confidence += 10; reasons.push('FR netral'); }
    if (buyVolumePct > 65) { confidence += 20; reasons.push('Buy volume dominan'); }
    else if (buyVolumePct > 60) { confidence += 15; reasons.push('Buy volume lebih tinggi'); }
    else { confidence += 10; reasons.push('Buy volume sedikit dominan'); }
    if (ticker.price_change_24h >= -2 && ticker.price_change_24h <= 5) { confidence += 10; reasons.push('Price sideways'); }
  }
  else if (rvol >= 2.0 && futuresData.oi_change_24h > 10 && futuresData.funding_rate > 0.0005 && buyVolumePct < 45) {
    direction = 'SHORT';
    if (rvol >= 3.0) { confidence += 25; reasons.push('RVOL sangat tinggi'); }
    else if (rvol >= 2.5) { confidence += 20; reasons.push('RVOL tinggi'); }
    else { confidence += 15; reasons.push('RVOL moderat'); }
    if (futuresData.oi_change_24h > 20) { confidence += 25; reasons.push('OI naik signifikan'); }
    else if (futuresData.oi_change_24h > 15) { confidence += 20; reasons.push('OI naik'); }
    else { confidence += 15; reasons.push('OI naik moderat'); }
    if (futuresData.funding_rate > 0.001) { confidence += 20; reasons.push('FR sangat tinggi'); }
    else if (futuresData.funding_rate > 0.0007) { confidence += 15; reasons.push('FR tinggi'); }
    else { confidence += 10; reasons.push('FR moderat tinggi'); }
    if (buyVolumePct < 35) { confidence += 20; reasons.push('Sell volume dominan'); }
    else if (buyVolumePct < 40) { confidence += 15; reasons.push('Sell volume lebih tinggi'); }
    else { confidence += 10; reasons.push('Sell volume sedikit dominan'); }
    if (ticker.price_change_24h >= -5 && ticker.price_change_24h <= 2) { confidence += 10; reasons.push('Price sideways'); }
  }
  
  if (!direction) return null;
  
  const entryPrice = currentPrice;
  let stopLoss, takeProfit;
  if (direction === 'LONG') { stopLoss = entryPrice * 0.97; takeProfit = entryPrice * 1.06; } 
  else { stopLoss = entryPrice * 1.03; takeProfit = entryPrice * 0.94; }
  
  return {
    symbol: ticker.symbol, name: ticker.name, price_change_24h: ticker.price_change_24h,
    volume_usdt: ticker.volume_usdt, rvol: rvol, avg_volume_7d: ticker.avg_volume_7d,
    oi_change_24h: futuresData.oi_change_24h, funding_rate: futuresData.funding_rate,
    buy_volume_pct: buyVolumePct, signal_direction: direction, signal_confidence: confidence,
    signal_reason: reasons.join(' | '), entry_price: entryPrice, stop_loss: stopLoss,
    take_profit: takeProfit, updated_at: Date.now()
  };
}

async function scanSignals() {
  console.log(`\n--- [${new Date().toLocaleTimeString()}] Scan Sinyal Futures ---`);
  const tickers = await fetchBinanceTickers();
  console.log(`✅ Diambil: ${tickers.length} pair`);
  const signals = [];
  
  for (const ticker of tickers) {
    if (ticker.volume_usdt < 10000000) continue;
    const avgVolume7d = await fetchHistoricalVolume(ticker.symbol);
    if (!avgVolume7d || avgVolume7d === 0) continue;
    const rvol = ticker.volume_usdt / avgVolume7d;
    if (rvol < 2.0) continue;
    const futuresData = await fetchFuturesData(ticker.symbol);
    if (!futuresData) continue;
    await new Promise(resolve => setTimeout(resolve, 200));
    const buyVolumePct = await fetchBuySellVolume(ticker.symbol);
    if (buyVolumePct === null) continue;
    await new Promise(resolve => setTimeout(resolve, 150));
    
    ticker.avg_volume_7d = avgVolume7d;
    const signal = generateSignal(ticker, rvol, futuresData, buyVolumePct, ticker.current_price);
    
    if (signal && signal.signal_confidence >= 60) {
      const existing = await db.execute({ sql: 'SELECT symbol FROM signals WHERE symbol = ?', args: [signal.symbol] });
      if (existing.rows.length === 0) sendTelegramAlert(signal);
      await db.execute({
        sql: `INSERT OR REPLACE INTO signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [signal.symbol, signal.name, signal.price_change_24h, signal.volume_usdt, signal.rvol, signal.avg_volume_7d, signal.oi_change_24h, signal.funding_rate, signal.buy_volume_pct, signal.signal_direction, signal.signal_confidence, signal.signal_reason, signal.entry_price, signal.stop_loss, signal.take_profit, signal.updated_at]
      });
      signals.push(signal);
      console.log(`${signal.signal_direction} ${signal.symbol} - Confidence: ${signal.signal_confidence}%`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (signals.length > 0) { broadcast(signals); console.log(`🚀 DITEMUKAN: ${signals.length} sinyal futures!`); } 
  else { console.log(`⚠️ Tidak ada sinyal futures saat ini.`); }
}

async function startServer() {
  await initDB();
  cron.schedule('*/10 * * * *', scanSignals);
  scanSignals();
  const PORT = process.env.PORT || 4001;
  app.listen(PORT, () => console.log(`\n🟢 Backend Futures berjalan di port ${PORT}\n`));
}

startServer();