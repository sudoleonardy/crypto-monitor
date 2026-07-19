'use client';
import { useEffect, useState } from 'react';

type CEXToken = {
  symbol: string; name: string; exchange: string; price_change_24h: number;
  volume_usdt: number; rvol: number; buy_volume_pct: number; oi_status: string;
  entry_price: number; stop_loss: number; take_profit: number;
};
type FuturesSignal = {
  symbol: string; name: string; price_change_24h: number; volume_usdt: number;
  rvol: number; oi_change_24h: number; funding_rate: number; buy_volume_pct: number;
  signal_direction: string; signal_confidence: number; signal_reason: string;
  entry_price: number; stop_loss: number; take_profit: number;
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<'cex' | 'futures'>('cex');
  const [cexTokens, setCexTokens] = useState<CEXToken[]>([]);
  const [futuresSignals, setFuturesSignals] = useState<FuturesSignal[]>([]);

  useEffect(() => {
    const CEX_API = process.env.NEXT_PUBLIC_CEX_API || 'http://localhost:4000';
    const FUTURES_API = process.env.NEXT_PUBLIC_FUTURES_API || 'http://localhost:4001';

    fetch(`${CEX_API}/api/tokens`).then(r => r.json()).then(d => setCexTokens(d.sort((a, b) => b.rvol - a.rvol)));
    fetch(`${FUTURES_API}/api/signals`).then(r => r.json()).then(d => setFuturesSignals(d.sort((a, b) => b.signal_confidence - a.signal_confidence)));

    const cexSource = new EventSource(`${CEX_API}/stream`);
    cexSource.onmessage = (e) => {
      const map = new Map(cexTokens.map(t => [t.symbol, t]));
      JSON.parse(e.data).forEach((t: CEXToken) => map.set(t.symbol, t));
      setCexTokens(Array.from(map.values()).sort((a, b) => b.rvol - a.rvol));
    };

    const futSource = new EventSource(`${FUTURES_API}/stream`);
    futSource.onmessage = (e) => {
      const map = new Map(futuresSignals.map(t => [t.symbol, t]));
      JSON.parse(e.data).forEach((t: FuturesSignal) => map.set(t.symbol, t));
      setFuturesSignals(Array.from(map.values()).sort((a, b) => b.signal_confidence - a.signal_confidence));
    };
    return () => { cexSource.close(); futSource.close(); };
  }, []);

  return (
    <main className="p-6 bg-gray-950 text-gray-100 min-h-screen font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-red-400">🚀 Crypto Scanner Dashboard</h1>
        <div className="flex gap-2 mb-6">
          <button onClick={() => setActiveTab('cex')} className={`px-6 py-3 rounded-lg font-semibold ${activeTab === 'cex' ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400'}`}>🏦 CEX Scanner</button>
          <button onClick={() => setActiveTab('futures')} className={`px-6 py-3 rounded-lg font-semibold ${activeTab === 'futures' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400'}`}>📈 Futures Signals</button>
        </div>

        {activeTab === 'cex' && (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-left">
              <thead className="bg-gray-800 text-gray-300 uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-4">Token</th><th className="p-4">RVOL</th><th className="p-4">OI Status</th>
                  <th className="p-4 text-green-400">Entry</th><th className="p-4 text-red-400">Stop Loss</th><th className="p-4 text-blue-400">Take Profit</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {cexTokens.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-gray-500">Memindai CEX...</td></tr> :
                  cexTokens.map((t) => (
                    <tr key={t.symbol} className="hover:bg-gray-800/50">
                      <td className="p-4 font-semibold">{t.name} <span className="text-xs text-gray-500">({t.symbol})</span></td>
                      <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${t.rvol >= 3.0 ? 'bg-green-900/50 text-green-400' : t.rvol >= 2.5 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400'}`}>{t.rvol.toFixed(2)}x</span></td>
                      <td className="p-4 text-xs">{t.oi_status}</td>
                      <td className="p-4 text-sm text-green-400 font-mono">${t.entry_price?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-red-400 font-mono">${t.stop_loss?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-blue-400 font-mono">${t.take_profit?.toFixed(4)}</td>
                      <td className="p-4"><a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${t.symbol}`} target="_blank" className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded">Chart ↗</a></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'futures' && (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-left">
              <thead className="bg-gray-800 text-gray-300 uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-4">Signal</th><th className="p-4">Token</th><th className="p-4">Confidence</th>
                  <th className="p-4 text-green-400">Entry</th><th className="p-4 text-red-400">Stop Loss</th><th className="p-4 text-blue-400">Take Profit</th>
                  <th className="p-4">Alasan</th><th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {futuresSignals.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-gray-500">Memindai sinyal futures...</td></tr> :
                  futuresSignals.map((s) => (
                    <tr key={s.symbol} className="hover:bg-gray-800/50">
                      <td className="p-4"><span className={`px-3 py-1 rounded text-sm font-bold ${s.signal_direction === 'LONG' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>{s.signal_direction}</span></td>
                      <td className="p-4 font-semibold">{s.name}</td>
                      <td className="p-4"><span className={`px-2 py-1 rounded text-xs font-bold ${s.signal_confidence >= 80 ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>{s.signal_confidence.toFixed(0)}%</span></td>
                      <td className="p-4 text-sm text-green-400 font-mono">${s.entry_price?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-red-400 font-mono">${s.stop_loss?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-blue-400 font-mono">${s.take_profit?.toFixed(4)}</td>
                      <td className="p-4 text-xs text-gray-400 max-w-xs truncate">{s.signal_reason}</td>
                      <td className="p-4"><a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${s.symbol}`} target="_blank" className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded">Chart ↗</a></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}