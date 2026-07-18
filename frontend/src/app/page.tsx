'use client';
import { useEffect, useState } from 'react';

type CEXToken = {
  symbol: string;
  name: string;
  exchange: string;
  price_change_24h: number;
  volume_usdt: number;
  rvol: number;
  buy_volume: number;
  sell_volume: number;
  buy_volume_pct: number;
  oi_status: string;
};

type FuturesSignal = {
  symbol: string;
  name: string;
  price_change_24h: number;
  volume_usdt: number;
  rvol: number;
  oi_change_24h: number;
  funding_rate: number;
  buy_volume_pct: number;
  signal_direction: string;
  signal_confidence: number;
  signal_reason: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<'cex' | 'futures'>('cex');
  const [cexTokens, setCexTokens] = useState<CEXToken[]>([]);
  const [futuresSignals, setFuturesSignals] = useState<FuturesSignal[]>([]);

  useEffect(() => {
    // Fetch CEX
    fetch('http://localhost:4000/api/tokens')
      .then(res => res.json())
      .then(data => setCexTokens(data.sort((a: CEXToken, b: CEXToken) => b.rvol - a.rvol)))
      .catch(err => console.error("CEX Error:", err));

    // Fetch Futures
    fetch('http://localhost:4001/api/signals')
      .then(res => res.json())
      .then(data => setFuturesSignals(data.sort((a: FuturesSignal, b: FuturesSignal) => b.signal_confidence - a.signal_confidence)))
      .catch(err => console.error("Futures Error:", err));

    // SSE CEX
    const cexSource = new EventSource('http://localhost:4000/stream');
    cexSource.onmessage = (event) => {
      const newData: CEXToken[] = JSON.parse(event.data);
      setCexTokens(prev => {
        const map = new Map(prev.map(t => [t.symbol, t]));
        newData.forEach(t => map.set(t.symbol, t));
        return Array.from(map.values()).sort((a, b) => b.rvol - a.rvol);
      });
    };

    // SSE Futures
    const futuresSource = new EventSource('http://localhost:4001/stream');
    futuresSource.onmessage = (event) => {
      const newData: FuturesSignal[] = JSON.parse(event.data);
      setFuturesSignals(prev => {
        const map = new Map(prev.map(t => [t.symbol, t]));
        newData.forEach(t => map.set(t.symbol, t));
        return Array.from(map.values()).sort((a, b) => b.signal_confidence - a.signal_confidence);
      });
    };

    return () => {
      cexSource.close();
      futuresSource.close();
    };
  }, []);

  return (
    <main className="p-6 bg-gray-950 text-gray-100 min-h-screen font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-red-400">🚀 Crypto Scanner Dashboard</h1>
        
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('cex')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'cex'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            🏦 CEX Scanner (RVOL + OI)
          </button>
          <button
            onClick={() => setActiveTab('futures')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'futures'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            📈 Futures Signals (LONG/SHORT)
          </button>
        </div>

        {/* CEX Tab */}
        {activeTab === 'cex' && (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-left">
              <thead className="bg-gray-800 text-gray-300 uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-4">Exchange</th>
                  <th className="p-4">Token</th>
                  <th className="p-4">Price 24h</th>
                  <th className="p-4">Volume 24h</th>
                  <th className="p-4">RVOL</th>
                  <th className="p-4">Buy/Sell</th>
                  <th className="p-4">OI Status</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {cexTokens.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-gray-500">Memindai CEX...</td></tr>
                ) : (
                  cexTokens.map((t) => (
                    <tr key={t.symbol} className="hover:bg-gray-800/50">
                      <td className="p-4 text-sm">{t.exchange}</td>
                      <td className="p-4 font-semibold">{t.name} ({t.symbol})</td>
                      <td className={`p-4 ${t.price_change_24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.price_change_24h.toFixed(2)}%
                      </td>
                      <td className="p-4 text-blue-400">${(t.volume_usdt / 1000000).toFixed(2)}M</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          t.rvol >= 3.0 ? 'bg-green-900/50 text-green-400' :
                          t.rvol >= 2.5 ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-red-900/50 text-red-400'
                        }`}>
                          {t.rvol.toFixed(2)}x
                        </span>
                      </td>
                      <td className="p-4 text-xs">
                        <span className="text-green-400">{t.buy_volume_pct?.toFixed(0)}%</span>
                        {' / '}
                        <span className="text-red-400">{(100 - (t.buy_volume_pct || 0)).toFixed(0)}%</span>
                      </td>
                      <td className="p-4 text-xs">{t.oi_status}</td>
                      <td className="p-4">
                        <a href={`https://www.tradingview.com/chart/?symbol=${t.exchange}:${t.symbol}`} target="_blank"
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded">
                          Chart ↗
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Futures Tab */}
        {activeTab === 'futures' && (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-left">
              <thead className="bg-gray-800 text-gray-300 uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-4">Signal</th>
                  <th className="p-4">Token</th>
                  <th className="p-4">Confidence</th>
                  <th className="p-4">Entry</th>
                  <th className="p-4">Stop Loss</th>
                  <th className="p-4">Take Profit</th>
                  <th className="p-4">Alasan</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {futuresSignals.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-gray-500">Memindai sinyal futures...</td></tr>
                ) : (
                  futuresSignals.map((s) => (
                    <tr key={s.symbol} className="hover:bg-gray-800/50">
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded text-sm font-bold ${
                          s.signal_direction === 'LONG' 
                            ? 'bg-green-900/50 text-green-400 border border-green-800' 
                            : 'bg-red-900/50 text-red-400 border border-red-800'
                        }`}>
                          {s.signal_direction === 'LONG' ? '🟢' : '🔴'} {s.signal_direction}
                        </span>
                      </td>
                      <td className="p-4 font-semibold">{s.name} ({s.symbol})</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          s.signal_confidence >= 80 ? 'bg-green-900/50 text-green-400' :
                          s.signal_confidence >= 60 ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-red-900/50 text-red-400'
                        }`}>
                          {s.signal_confidence.toFixed(0)}%
                        </span>
                      </td>
                      <td className="p-4 text-sm">${s.entry_price?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-red-400">${s.stop_loss?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-green-400">${s.take_profit?.toFixed(4)}</td>
                      <td className="p-4 text-xs text-gray-400 max-w-xs truncate" title={s.signal_reason}>
                        {s.signal_reason}
                      </td>
                      <td className="p-4">
                        <a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${s.symbol}`} target="_blank"
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded">
                          Chart ↗
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}