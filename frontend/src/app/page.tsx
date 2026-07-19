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

type FilterSettings = {
  minVolume: boolean;
  minRVOL: boolean;
  oiVerified: boolean;
  priceSideways: boolean;
  highConfidence: boolean;
  longOnly: boolean;
  shortOnly: boolean;
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<'cex' | 'futures'>('cex');
  const [cexTokens, setCexTokens] = useState<CEXToken[]>([]);
  const [futuresSignals, setFuturesSignals] = useState<FuturesSignal[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  
  const [filters, setFilters] = useState<FilterSettings>({
    minVolume: true,
    minRVOL: true,
    oiVerified: false,
    priceSideways: true,
    highConfidence: false,
    longOnly: false,
    shortOnly: false,
  });

  useEffect(() => {
    const CEX_API = process.env.NEXT_PUBLIC_CEX_API || 'http://localhost:4000';
    const FUTURES_API = process.env.NEXT_PUBLIC_FUTURES_API || 'http://localhost:4001';

    fetch(`${CEX_API}/api/tokens`)
      .then(r => r.json())
      .then((d: CEXToken[]) => setCexTokens(d));
    
    fetch(`${FUTURES_API}/api/signals`)
      .then(r => r.json())
      .then((d: FuturesSignal[]) => setFuturesSignals(d));

    const cexSource = new EventSource(`${CEX_API}/stream`);
    cexSource.onmessage = (e) => {
      const newData: CEXToken[] = JSON.parse(e.data);
      setCexTokens(prev => {
        const map = new Map(prev.map(t => [t.symbol, t]));
        newData.forEach(t => map.set(t.symbol, t));
        return Array.from(map.values());
      });
    };

    const futSource = new EventSource(`${FUTURES_API}/stream`);
    futSource.onmessage = (e) => {
      const newData: FuturesSignal[] = JSON.parse(e.data);
      setFuturesSignals(prev => {
        const map = new Map(prev.map(t => [t.symbol, t]));
        newData.forEach(t => map.set(t.symbol, t));
        return Array.from(map.values());
      });
    };

    return () => { cexSource.close(); futSource.close(); };
  }, []);

  const toggleFilter = (key: keyof FilterSettings) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Filter CEX tokens
  const filteredCEX = cexTokens.filter(token => {
    if (filters.minVolume && token.volume_usdt < 5000000) return false;
    if (filters.minRVOL && token.rvol < 2.0) return false;
    if (filters.oiVerified && !token.oi_status.includes('✅')) return false;
    if (filters.priceSideways && (token.price_change_24h < -4 || token.price_change_24h > 5)) return false;
    return true;
  }).sort((a, b) => b.rvol - a.rvol);

  // Filter Futures signals
  const filteredFutures = futuresSignals.filter(signal => {
    if (filters.minVolume && signal.volume_usdt < 10000000) return false;
    if (filters.minRVOL && signal.rvol < 2.0) return false;
    if (filters.highConfidence && signal.signal_confidence < 80) return false;
    if (filters.longOnly && signal.signal_direction !== 'LONG') return false;
    if (filters.shortOnly && signal.signal_direction !== 'SHORT') return false;
    return true;
  }).sort((a, b) => b.signal_confidence - a.signal_confidence);

  return (
    <main className="p-6 bg-gray-950 text-gray-100 min-h-screen font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-red-400"> Crypto Scanner Dashboard</h1>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
          >
            {showFilters ? '❌ Tutup Filter' : '⚙️ Filter'}
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-800">
            <h3 className="text-lg font-semibold mb-4 text-orange-400">
              {activeTab === 'cex' ? '🏦 CEX Scanner Filters' : '📈 Futures Signals Filters'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeTab === 'cex' ? (
                <>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.minVolume}
                      onChange={() => toggleFilter('minVolume')}
                      className="w-4 h-4 rounded border-gray-600 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm">💰 Volume {'>'} $5M</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.minRVOL}
                      onChange={() => toggleFilter('minRVOL')}
                      className="w-4 h-4 rounded border-gray-600 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm">📊 RVOL {'>'} 2.0x</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.oiVerified}
                      onChange={() => toggleFilter('oiVerified')}
                      className="w-4 h-4 rounded border-gray-600 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm">✅ OI Verified Only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.priceSideways}
                      onChange={() => toggleFilter('priceSideways')}
                      className="w-4 h-4 rounded border-gray-600 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm">️ Price Sideways</span>
                  </label>
                </>
              ) : (
                <>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.minVolume}
                      onChange={() => toggleFilter('minVolume')}
                      className="w-4 h-4 rounded border-gray-600 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm"> Volume {'>'} $10M</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.minRVOL}
                      onChange={() => toggleFilter('minRVOL')}
                      className="w-4 h-4 rounded border-gray-600 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm">📊 RVOL {'>'} 2.0x</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.highConfidence}
                      onChange={() => toggleFilter('highConfidence')}
                      className="w-4 h-4 rounded border-gray-600 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm">🎯 Confidence {'>'} 80%</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.longOnly}
                      onChange={() => toggleFilter('longOnly')}
                      className="w-4 h-4 rounded border-gray-600 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm">🟢 LONG Only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 p-2 rounded">
                    <input 
                      type="checkbox" 
                      checked={filters.shortOnly}
                      onChange={() => toggleFilter('shortOnly')}
                      className="w-4 h-4 rounded border-gray-600 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm">🔴 SHORT Only</span>
                  </label>
                </>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800 text-sm text-gray-400">
              Menampilkan: <span className="text-white font-bold">{activeTab === 'cex' ? filteredCEX.length : filteredFutures.length}</span> token
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('cex')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'cex' ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            🏦 CEX Scanner
          </button>
          <button
            onClick={() => setActiveTab('futures')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'futures' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            📈 Futures Signals
          </button>
        </div>

        {/* CEX Table */}
        {activeTab === 'cex' && (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-left">
              <thead className="bg-gray-800 text-gray-300 uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-4">Token</th>
                  <th className="p-4">RVOL</th>
                  <th className="p-4">OI Status</th>
                  <th className="p-4 text-green-400">Entry</th>
                  <th className="p-4 text-red-400">Stop Loss</th>
                  <th className="p-4 text-blue-400">Take Profit</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredCEX.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-gray-500">
                    {cexTokens.length === 0 ? 'Memindai CEX...' : 'Tidak ada token yang sesuai filter'}
                  </td></tr>
                ) : (
                  filteredCEX.map((t) => (
                    <tr key={t.symbol} className="hover:bg-gray-800/50">
                      <td className="p-4 font-semibold">{t.name} <span className="text-xs text-gray-500">({t.symbol})</span></td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          t.rvol >= 3.0 ? 'bg-green-900/50 text-green-400' :
                          t.rvol >= 2.5 ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-red-900/50 text-red-400'
                        }`}>{t.rvol.toFixed(2)}x</span>
                      </td>
                      <td className="p-4 text-xs">{t.oi_status}</td>
                      <td className="p-4 text-sm text-green-400 font-mono">${t.entry_price?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-red-400 font-mono">${t.stop_loss?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-blue-400 font-mono">${t.take_profit?.toFixed(4)}</td>
                      <td className="p-4">
                        <a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${t.symbol}`} target="_blank" 
                          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-500">Chart ↗</a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Futures Table */}
        {activeTab === 'futures' && (
          <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
            <table className="w-full text-left">
              <thead className="bg-gray-800 text-gray-300 uppercase text-xs tracking-wider">
                <tr>
                  <th className="p-4">Signal</th>
                  <th className="p-4">Token</th>
                  <th className="p-4">Confidence</th>
                  <th className="p-4 text-green-400">Entry</th>
                  <th className="p-4 text-red-400">Stop Loss</th>
                  <th className="p-4 text-blue-400">Take Profit</th>
                  <th className="p-4">Alasan</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredFutures.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-gray-500">
                    {futuresSignals.length === 0 ? 'Memindai sinyal futures...' : 'Tidak ada sinyal yang sesuai filter'}
                  </td></tr>
                ) : (
                  filteredFutures.map((s) => (
                    <tr key={s.symbol} className="hover:bg-gray-800/50">
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded text-sm font-bold ${
                          s.signal_direction === 'LONG' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                        }`}>{s.signal_direction}</span>
                      </td>
                      <td className="p-4 font-semibold">{s.name}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          s.signal_confidence >= 80 ? 'bg-green-900/50 text-green-400' :
                          s.signal_confidence >= 60 ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-red-900/50 text-red-400'
                        }`}>{s.signal_confidence.toFixed(0)}%</span>
                      </td>
                      <td className="p-4 text-sm text-green-400 font-mono">${s.entry_price?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-red-400 font-mono">${s.stop_loss?.toFixed(4)}</td>
                      <td className="p-4 text-sm text-blue-400 font-mono">${s.take_profit?.toFixed(4)}</td>
                      <td className="p-4 text-xs text-gray-400 max-w-xs truncate" title={s.signal_reason}>{s.signal_reason}</td>
                      <td className="p-4">
                        <a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${s.symbol}`} target="_blank" 
                          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-500">Chart ↗</a>
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