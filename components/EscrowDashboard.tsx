import React, { useState, useEffect, useRef, useMemo } from 'react';
import { EscrowJob, EscrowAlgo, SessionStats } from '../types';
import { RefreshCw, Download, Search, UploadCloud, AlertTriangle, DollarSign, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Calendar, FileText, Filter, X, Loader2, Settings, Zap, Save, BrainCircuit, TrendingUp, BarChart3, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// --- Types ---
export interface AutoUploadSettings {
  enabled: boolean;
  threshold: number;
}

interface EscrowDashboardProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  initialSubmissionData?: string; 
  initialAlgoId?: string;
  autoUploadSettings: AutoUploadSettings;
  onUpdateAutoUploadSettings: (settings: AutoUploadSettings) => void;
  sessions: Record<string, SessionStats>;
  activeSessionId: string | null;
}

interface HistoryItem {
  date: string; // YYYY-MM-DD
  displayDate: string; // Formatted for X-Axis
  usdValue: number; // Base USD value
  convertedValue: number; // Value in selected currency
  validHashes: number;
  raw: { btc: number, xmr: number, ltc: number };
}

// Supported Currencies
const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'RUB', symbol: '₽', name: 'Russian Ruble' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
];

const EscrowDashboard: React.FC<EscrowDashboardProps> = ({ 
  apiKey, 
  setApiKey, 
  initialSubmissionData, 
  initialAlgoId,
  autoUploadSettings,
  onUpdateAutoUploadSettings,
  sessions,
  activeSessionId
}) => {
  const { t } = useTranslation();
  
  // --- STATE ---
  const [jobs, setJobs] = useState<EscrowJob[]>([]);
  const [algos, setAlgos] = useState<EscrowAlgo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Balance & Currency State
  const [balances, setBalances] = useState<{ currency: string, amount: string, usd: string }[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() => localStorage.getItem('reactor_currency') || 'USD');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });
  
  // Filters & Pagination
  const [filterAlgo, setFilterAlgo] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  
  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });
  
  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [submissionAlgo, setSubmissionAlgo] = useState('');
  const [submissionContent, setSubmissionContent] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  
  // Mass Download Modal State
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [dlAlgo, setDlAlgo] = useState(''); 
  const [dlMinPrice, setDlMinPrice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number, total: number, found: number } | null>(null);
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);

  // Auto-Upload Settings
  const [showAutoSettings, setShowAutoSettings] = useState(false);
  const [tempAutoSettings, setTempAutoSettings] = useState<AutoUploadSettings>(autoUploadSettings);

  // Searchable Algo Dropdown
  const [algoSearch, setAlgoSearch] = useState('');
  const [showAlgoList, setShowAlgoList] = useState(false);
  const algoListRef = useRef<HTMLDivElement>(null);

  // History & Analytics
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [hoveredChartPoint, setHoveredChartPoint] = useState<HistoryItem | null>(null);

  // --- EFFECTS ---

  // Click outside listener for Algo Dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (algoListRef.current && !algoListRef.current.contains(event.target as Node)) {
        setShowAlgoList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch Fiat Exchange Rates (USD base)
  useEffect(() => {
    const fetchFiatRates = async () => {
        try {
            // Using a free, public API for standard fiat rates
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            if (res.ok) {
                const data = await res.json();
                if (data && data.rates) {
                    setExchangeRates(data.rates);
                }
            }
        } catch (e) {
            console.warn("Failed to fetch fiat rates, defaulting to USD", e);
        }
    };
    fetchFiatRates();
  }, []);

  // Handle Currency Selection Change
  useEffect(() => {
      localStorage.setItem('reactor_currency', selectedCurrency);
  }, [selectedCurrency]);

  // Initial Algo Load
  useEffect(() => {
    const loadAlgos = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/escrow/proxy?url=' + encodeURIComponent('https://hashes.com/en/api/algorithms'));
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) { setAlgos(data); return; }
            if (data.success && Array.isArray(data.list)) { setAlgos(data.list); return; }
        }
      } catch (e) { console.warn("Could not fetch algos via proxy", e); }
    };
    loadAlgos();
  }, []);

  // Sync Initial Props
  useEffect(() => {
    if (initialSubmissionData) setSubmissionContent(initialSubmissionData);
    if (initialAlgoId && algos.length > 0) {
      const algo = algos.find(a => a.id.toString() === initialAlgoId);
      if (algo) {
        setSubmissionAlgo(algo.id.toString());
        setAlgoSearch(algo.algorithmName);
      } else {
        setSubmissionAlgo(initialAlgoId);
        setAlgoSearch(`ID: ${initialAlgoId}`);
      }
    }
    setTempAutoSettings(autoUploadSettings);
  }, [initialSubmissionData, initialAlgoId, algos, autoUploadSettings]);

  // --- API ACTIONS ---

  const fetchBalance = async () => {
      if (!apiKey) return;
      try {
          const balanceUrl = `https://hashes.com/en/api/balance?key=${apiKey}`;
          const balanceRes = await fetch(`http://localhost:3001/api/escrow/proxy?url=${encodeURIComponent(balanceUrl)}`);
          if(!balanceRes.ok) throw new Error("Failed to fetch balance");
          const balanceData = await balanceRes.json();
          if(!balanceData.success) throw new Error(balanceData.message || "Balance API error");

          delete balanceData.success;
          
          const convUrl = `https://hashes.com/en/api/conversion`;
          const convRes = await fetch(`http://localhost:3001/api/escrow/proxy?url=${encodeURIComponent(convUrl)}`);
          const convData = convRes.ok ? await convRes.json() : {};

          const formatted = Object.entries(balanceData).map(([currency, amount]) => {
              const amt = parseFloat(amount as string);
              if (amt <= 0) return null;
              let usdVal = "0.00";
              if (convData && convData[currency]) {
                  usdVal = (amt * parseFloat(convData[currency])).toFixed(2);
              }
              return { currency, amount: amt.toFixed(7), usd: usdVal };
          }).filter(Boolean) as { currency: string, amount: string, usd: string }[];

          setBalances(formatted);
          return convData; 
      } catch (e) {
          console.error("Balance fetch error:", e);
          return {};
      }
  };

  const fetchHistory = async (conversionRates: any) => {
    if (!apiKey) return;
    try {
        const uploadsUrl = `https://hashes.com/en/api/uploads?key=${apiKey}`;
        const res = await fetch(`http://localhost:3001/api/escrow/proxy?url=${encodeURIComponent(uploadsUrl)}`);
        if (!res.ok) throw new Error("Failed to fetch history");
        
        const data = await res.json();
        if (data.success && Array.isArray(data.list)) {
            const aggMap = new Map<string, HistoryItem>();
            
            data.list.forEach((item: any) => {
                const dateKey = item.date.split(' ')[0]; 
                
                if (!aggMap.has(dateKey)) {
                    aggMap.set(dateKey, { 
                        date: dateKey, 
                        displayDate: dateKey,
                        usdValue: 0, 
                        convertedValue: 0,
                        validHashes: 0, 
                        raw: { btc: 0, xmr: 0, ltc: 0 } 
                    });
                }
                
                const entry = aggMap.get(dateKey)!;
                const btc = parseFloat(item.btc) || 0;
                const xmr = parseFloat(item.xmr) || 0;
                const ltc = parseFloat(item.ltc) || 0;
                const valid = parseInt(item.validHashes) || 0;

                // Crypto -> USD
                let usd = 0;
                if (conversionRates.BTC) usd += btc * parseFloat(conversionRates.BTC);
                if (conversionRates.XMR) usd += xmr * parseFloat(conversionRates.XMR);
                if (conversionRates.LTC) usd += ltc * parseFloat(conversionRates.LTC);

                entry.usdValue += usd;
                entry.validHashes += valid;
                entry.raw.btc += btc;
                entry.raw.xmr += xmr;
                entry.raw.ltc += ltc;
            });

            const sortedHistory = Array.from(aggMap.values()).sort((a, b) => 
                new Date(a.date).getTime() - new Date(b.date).getTime()
            );

            setHistory(sortedHistory);
        }
    } catch (e) {
        console.error("History fetch error:", e);
    }
  };

  const fetchJobs = async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    
    // Fetch balance first to get crypto conversion rates, then fetch history
    const rates = await fetchBalance(); 
    if (rates) await fetchHistory(rates);

    try {
      const jobsUrl = `https://hashes.com/en/api/jobs?key=${apiKey}`;
      const proxyUrl = `http://localhost:3001/api/escrow/proxy?url=${encodeURIComponent(jobsUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
          const text = await response.text();
          throw new Error(`Proxy Error: ${response.status} - ${text}`);
      }
      
      const json = await response.json();
      if (json.success === true && Array.isArray(json.list)) {
          setJobs(json.list);
          setCurrentPage(1);
      } else if (json.message) {
          throw new Error(json.message);
      } else {
          throw new Error("Invalid response format from Hashes.com");
      }

    } catch (e: any) {
      console.error("Fetch Jobs Error:", e);
      setError(e.message || "Failed to fetch jobs. Check API Key or Network.");
      setJobs([]); 
    } finally {
      setLoading(false);
    }
  };

  // --- MEMOS & HELPERS ---

  const activeCurrency = useMemo(() => {
    return CURRENCIES.find(c => c.code === selectedCurrency) || CURRENCIES[0];
  }, [selectedCurrency]);

  const convertedHistory = useMemo(() => {
    const rate = exchangeRates[selectedCurrency] || 1;
    
    // 1. Convert Values
    const rawData = history.map(h => ({
        ...h,
        convertedValue: h.usdValue * rate
    }));

    // 2. Intelligent Binning (Aggregation) to prevent "Crammed" graph
    // If > 60 days, group by Week. If > 180 days, group by Month.
    if (rawData.length <= 45) return rawData;

    const binnedData: HistoryItem[] = [];
    let currentBin: HistoryItem | null = null;
    
    // Helper to get bin key
    const getBinKey = (dateStr: string, mode: 'week'|'month') => {
        const d = new Date(dateStr);
        if (mode === 'month') return `${d.getFullYear()}-${d.getMonth() + 1}`; // YYYY-M
        // For week, approximate by getting start of week
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        return monday.toISOString().slice(0, 10);
    };

    const binMode = rawData.length > 180 ? 'month' : 'week';

    rawData.forEach(item => {
        const binKey = getBinKey(item.date, binMode);
        
        if (!currentBin || getBinKey(currentBin.date, binMode) !== binKey) {
            if (currentBin) binnedData.push(currentBin);
            
            // Format Display Date based on mode
            let display = item.date;
            if (binMode === 'month') {
                const [y, m] = item.date.split('-');
                const d = new Date(parseInt(y), parseInt(m)-1);
                display = d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
            } else {
                const [y, m, d] = item.date.split('-');
                display = `${m}/${d}`; // Simple MM/DD
            }

            currentBin = { ...item, displayDate: display };
        } else {
            // Aggregate
            currentBin.usdValue += item.usdValue;
            currentBin.convertedValue += item.convertedValue;
            currentBin.validHashes += item.validHashes;
            currentBin.raw.btc += item.raw.btc;
            currentBin.raw.xmr += item.raw.xmr;
            currentBin.raw.ltc += item.raw.ltc;
            // Keep the bin start date as the data date
        }
    });
    if (currentBin) binnedData.push(currentBin);

    return binnedData;
  }, [history, selectedCurrency, exchangeRates]);

  const handleSort = (key: string) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      const jobPrice = parseFloat(j.pricePerHashUsd);
      const filterPriceVal = parseFloat(minPrice);
      const meetsPrice = !isNaN(filterPriceVal) ? jobPrice >= filterPriceVal : true;
      const meetsAlgo = filterAlgo 
        ? (j.algorithmName.toLowerCase().includes(filterAlgo.toLowerCase()) || j.algorithmId.toString() === filterAlgo)
        : true;
      return meetsPrice && meetsAlgo;
    });
  }, [jobs, minPrice, filterAlgo]);

  // FIX: This memo was missing, causing TS2552 errors in the JSX
  const filteredAlgos = useMemo(() => {
    if (!algoSearch) return algos;
    return algos.filter(a =>
        a.algorithmName.toLowerCase().includes(algoSearch.toLowerCase()) ||
        a.id.toString().includes(algoSearch)
    );
  }, [algos, algoSearch]);

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      const { key, direction } = sortConfig;
      let comparison = 0;
      if (key === 'pricePerHashUsd') {
        comparison = parseFloat(a.pricePerHashUsd) - parseFloat(b.pricePerHashUsd);
      } else if (key === 'leftHashes') {
        comparison = a.leftHashes - b.leftHashes;
      } else if (key === 'createdAt') {
         comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (key === 'maxCracksNeeded') {
         const valA = (a as any).maxCracksNeeded || 0;
         const valB = (b as any).maxCracksNeeded || 0;
         comparison = valA - valB;
      }
      return direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredJobs, sortConfig]);

  const totalPages = Math.ceil(sortedJobs.length / itemsPerPage);
  const paginatedJobs = sortedJobs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const calculateDownloadableCount = () => {
    return jobs.filter(j => {
        const meetsAlgo = dlAlgo ? j.algorithmId.toString() === dlAlgo : true;
        const meetsPrice = dlMinPrice ? parseFloat(j.pricePerHashUsd) >= parseFloat(dlMinPrice) : true;
        return meetsAlgo && meetsPrice && j.leftList;
    }).length;
  };

  // --- CHART RENDERING (SMART BAR CHART) ---
  const renderChart = () => {
      if (convertedHistory.length === 0) return (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 border border-dashed border-slate-700 rounded-lg bg-slate-950/30">
             <BarChart3 className="mb-2 opacity-50" size={32} />
             <span>No history data available.</span>
          </div>
      );

      const height = 240;
      const width = 800; // SVG coordinate space
      const padding = { top: 20, right: 20, bottom: 40, left: 50 };
      
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;

      const maxVal = Math.max(...convertedHistory.map(h => h.convertedValue), 1);
      
      // Calculate Bar Layout
      const barWidth = Math.max(Math.min((chartWidth / convertedHistory.length) * 0.7, 40), 4);
      const gap = (chartWidth - (barWidth * convertedHistory.length)) / (convertedHistory.length + 1);

      return (
        <div className="relative w-full h-64 select-none">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                {/* Y Axis Grid */}
                {[0, 0.25, 0.5, 0.75, 1].map(tick => {
                    const y = height - padding.bottom - tick * chartHeight;
                    return (
                        <g key={tick}>
                            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={padding.left - 10} y={y + 4} textAnchor="end" className="text-[10px] fill-slate-500 font-mono">
                                {activeCurrency.symbol}{(tick * maxVal).toFixed(2)}
                            </text>
                        </g>
                    );
                })}

                {/* Bars */}
                {convertedHistory.map((h, i) => {
                    const barHeight = (h.convertedValue / maxVal) * chartHeight;
                    const x = padding.left + gap + i * (barWidth + gap);
                    const y = height - padding.bottom - barHeight;

                    const isHovered = hoveredChartPoint?.date === h.date;

                    return (
                        <g key={i}>
                            <rect 
                                x={x} 
                                y={y} 
                                width={barWidth} 
                                height={barHeight} 
                                className={`transition-all duration-200 cursor-pointer ${isHovered ? 'fill-emerald-400' : 'fill-emerald-600/80 hover:fill-emerald-500'}`}
                                onMouseEnter={() => setHoveredChartPoint(h)}
                                onMouseLeave={() => setHoveredChartPoint(null)}
                            />
                            {/* Invisible hit rect for easier hovering on small bars */}
                            <rect 
                                x={x - gap/2}
                                y={padding.top}
                                width={barWidth + gap}
                                height={chartHeight}
                                fill="transparent"
                                onMouseEnter={() => setHoveredChartPoint(h)}
                                onMouseLeave={() => setHoveredChartPoint(null)}
                            />
                        </g>
                    );
                })}

                {/* X Axis Labels (Skip based on density) */}
                {convertedHistory.map((h, i) => {
                    // Show roughly 6-8 labels max
                    const step = Math.ceil(convertedHistory.length / 8);
                    if (i % step !== 0) return null;

                    const x = padding.left + gap + i * (barWidth + gap) + barWidth / 2;
                    return (
                        <text key={i} x={x} y={height - 10} textAnchor="middle" className="text-[10px] fill-slate-500 font-mono">
                            {h.displayDate}
                        </text>
                    );
                })}
            </svg>

            {/* Hover Tooltip */}
            {hoveredChartPoint && (
                <div 
                    className="absolute z-10 pointer-events-none bg-slate-900 border border-slate-700 p-3 rounded shadow-xl text-xs"
                    style={{ 
                        left: '50%', 
                        top: '10%',
                        transform: 'translateX(-50%)' 
                    }}
                >
                    <div className="font-bold text-slate-200 mb-1 border-b border-slate-700 pb-1 text-center">
                        {hoveredChartPoint.displayDate} ({hoveredChartPoint.date})
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <span className="text-slate-400">Earnings:</span>
                        <span className="text-emerald-400 font-mono font-bold">
                            {activeCurrency.symbol}{hoveredChartPoint.convertedValue.toFixed(3)}
                        </span>
                        
                        <span className="text-slate-400">Valid Hashes:</span>
                        <span className="text-slate-200 font-mono">{hoveredChartPoint.validHashes}</span>
                    </div>
                </div>
            )}
        </div>
      );
  };

  // --- RENDER MAIN UI ---
  return (
    <div className="space-y-6 pb-10 relative">
      {/* Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 items-end md:items-center justify-between shadow-sm">
        <div className="flex-1 w-full md:w-auto">
          <label className="text-xs text-slate-500 uppercase font-bold tracking-wider">{t('escrow_api_label')}</label>
          <div className="flex gap-2 mt-1">
            <input 
              type="password" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white w-full md:w-64 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              placeholder="Key..."
            />
            <button 
              onClick={fetchJobs}
              disabled={loading || !apiKey}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded flex items-center gap-2 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-900/20"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              {t('escrow_btn_load')}
            </button>
          </div>

          {/* Balance Display */}
          {balances.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {balances.map(b => (
                <div key={b.currency} className="text-xs font-mono text-slate-400 flex items-center gap-2">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                   <span>{b.amount} {b.currency}</span>
                   <span className="text-slate-600">(${b.usd})</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex gap-3 flex-wrap items-end">
           {/* Currency Selector */}
           <div>
               <label className="text-xs text-slate-500 uppercase font-bold">Currency</label>
               <div className="relative mt-1">
                   <Globe size={14} className="absolute left-2.5 top-2.5 text-slate-500"/>
                   <select 
                       value={selectedCurrency}
                       onChange={(e) => setSelectedCurrency(e.target.value)}
                       className="bg-slate-950 border border-slate-700 rounded pl-8 pr-3 py-2 text-sm text-white outline-none focus:border-indigo-500 cursor-pointer appearance-none min-w-[120px]"
                   >
                       {CURRENCIES.map(c => (
                           <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>
                       ))}
                   </select>
               </div>
           </div>

           {/* Auto Upload Settings Toggle */}
           <button
             onClick={() => setShowAutoSettings(true)}
             className={`h-10 px-4 rounded border flex items-center gap-2 transition-all font-medium text-xs uppercase tracking-wider ${
                 autoUploadSettings.enabled 
                 ? 'bg-amber-500/10 border-amber-500/50 text-amber-500 hover:bg-amber-500/20' 
                 : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
             }`}
           >
              <Zap size={16} className={autoUploadSettings.enabled ? "fill-current" : ""} />
              {autoUploadSettings.enabled ? 'Auto-Upload' : 'Auto-Upload'}
           </button>

           {/* View Filters */}
           <div>
              <label className="text-xs text-slate-500 uppercase font-bold">{t('escrow_view_min_usd')}</label>
              <div className="relative mt-1">
                <DollarSign size={14} className="absolute left-2.5 top-2.5 text-slate-500"/>
                <input 
                  type="number" 
                  value={minPrice}
                  onChange={e => setMinPrice(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded pl-8 pr-3 py-2 text-sm text-white w-24 outline-none focus:border-indigo-500"
                  placeholder="0.00"
                />
              </div>
           </div>
           <div>
              <label className="text-xs text-slate-500 uppercase font-bold">{t('escrow_view_algo')}</label>
              <div className="relative mt-1">
                <Filter size={14} className="absolute left-3 top-2.5 text-slate-500"/>
                <select
                  value={filterAlgo}
                  onChange={e => setFilterAlgo(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded pl-9 pr-3 py-2 text-sm text-white w-36 outline-none appearance-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">All Algos</option>
                  {algos.map(a => (
                    <option key={a.id} value={a.algorithmName}>{a.algorithmName}</option>
                  ))}
                </select>
              </div>
           </div>
           
           {/* Mass Download Button */}
           <button 
             onClick={() => setShowDownloadModal(true)}
             disabled={jobs.length === 0}
             className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded flex items-center gap-2 transition-colors h-10 disabled:opacity-50 font-medium shadow-lg shadow-emerald-900/20"
           >
             <Settings size={16} />
             {t('escrow_btn_mass_dl')}
           </button>
        </div>
      </div>

      {/* --- EARNINGS ANALYTICS CARD --- */}
      {convertedHistory.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div 
                  className="bg-slate-950/50 p-4 border-b border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition-colors"
                  onClick={() => setShowAnalytics(!showAnalytics)}
              >
                 <div className="flex items-center gap-2">
                     <TrendingUp size={18} className="text-emerald-400" />
                     <h3 className="text-sm font-bold text-slate-200">Earnings Analytics</h3>
                     <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700 font-mono">
                        Total: {activeCurrency.symbol}{convertedHistory.reduce((a, b) => a + b.convertedValue, 0).toFixed(2)} {activeCurrency.code}
                     </span>
                 </div>
                 {showAnalytics ? <ChevronUp size={18} className="text-slate-500"/> : <ChevronDown size={18} className="text-slate-500"/>}
              </div>
              
              {showAnalytics && (
                  <div className="p-6">
                      <div className="mb-4 flex justify-between items-end">
                         <div>
                             <p className="text-xs text-slate-400 mb-1">
                                 {convertedHistory.length > 45 ? 'Aggregated Earnings (Weekly/Monthly)' : 'Daily Earnings'}
                             </p>
                             <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                {activeCurrency.symbol}{convertedHistory.reduce((a, b) => a + b.convertedValue, 0).toFixed(2)}
                                <span className="text-sm font-normal text-slate-500">{activeCurrency.code} Lifetime</span>
                             </h2>
                         </div>
                         <div className="text-right text-xs text-slate-500">
                             <p>Records: {history.length}</p>
                             <p>Range: {history[0]?.date} - {history[history.length - 1]?.date}</p>
                         </div>
                      </div>
                      {renderChart()}
                  </div>
              )}
          </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3 animate-pulse">
          <AlertTriangle size={20} />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Auto Upload Settings Modal */}
      {showAutoSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
             <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center shrink-0">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        <Zap size={18} className="text-amber-500"/>
                        Auto-Upload Settings
                    </h3>
                    <button onClick={() => setShowAutoSettings(false)} className="text-slate-500 hover:text-white">
                        <X size={20}/>
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    <p className="text-xs text-slate-400 bg-slate-800/50 p-3 rounded border border-slate-800">
                        When enabled, Reactor will automatically upload recovered hashes to Hashes.com whenever the count of new, unsent hashes reaches the threshold.
                    </p>
                    
                    <div className="flex items-center justify-between">
                         <label className="text-sm font-bold text-slate-200">Enable Auto-Upload</label>
                         <button 
                            onClick={() => setTempAutoSettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                            className={`w-12 h-6 rounded-full transition-colors relative ${tempAutoSettings.enabled ? 'bg-amber-500' : 'bg-slate-700'}`}
                         >
                             <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tempAutoSettings.enabled ? 'left-7' : 'left-1'}`} />
                         </button>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Upload Threshold (Hashes)</label>
                        <input 
                            type="number" 
                            min="1"
                            value={tempAutoSettings.threshold}
                            onChange={(e) => setTempAutoSettings(prev => ({ ...prev, threshold: parseInt(e.target.value) || 10 }))}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white outline-none focus:border-amber-500"
                        />
                    </div>

                    <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex gap-3 items-start">
                        <BrainCircuit className="text-indigo-400 shrink-0 mt-0.5" size={18} />
                        <div>
                            <h4 className="text-xs font-bold text-indigo-300 uppercase mb-1">Smart Detection</h4>
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                                Reactor will automatically match the hash type of each running session (e.g., MD5, SHA256) to the correct Hashes.com algorithm ID. This allows you to run concurrent sessions with different hash types seamlessly.
                            </p>
                        </div>
                    </div>

                    <button 
                        onClick={() => {
                            onUpdateAutoUploadSettings(tempAutoSettings);
                            setShowAutoSettings(false);
                        }}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all"
                    >
                        <Save size={18} />
                        Save Settings
                    </button>
                </div>
             </div>
        </div>
      )}

      {/* Jobs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-950 text-slate-400 uppercase text-xs font-semibold tracking-wider select-none">
                <th className="p-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort('createdAt')}>
                   {t('escrow_col_created')} {sortConfig.key === 'createdAt' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-4">{t('escrow_col_algo')}</th>
                <th className="p-4 text-right">{t('escrow_col_total')}</th>
                
                <th className="p-4 text-right cursor-pointer hover:text-slate-200" onClick={() => handleSort('maxCracksNeeded')}>
                   <div className="flex items-center justify-end gap-1">
                      {t('escrow_col_max')} {sortConfig.key === 'maxCracksNeeded' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                   </div>
                </th>
                <th className="p-4 text-right cursor-pointer hover:text-emerald-400 transition-colors" onClick={() => handleSort('pricePerHashUsd')}>
                  <div className="flex items-center justify-end gap-1">
                     {t('escrow_col_price')} {sortConfig.key === 'pricePerHashUsd' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                  </div>
                </th>
                <th className="p-4 text-right">{t('escrow_col_progress')}</th>
                <th className="p-4 text-right cursor-pointer hover:text-slate-200 transition-colors" onClick={() => handleSort('leftHashes')}>
                  <div className="flex items-center justify-end gap-1">
                    {t('escrow_col_remaining')} {sortConfig.key === 'leftHashes' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                  </div>
                </th>
                <th className="p-4 text-center">{t('escrow_col_files')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {paginatedJobs.map(job => (
                <tr key={job.id} className="hover:bg-slate-800/50 transition-colors group">
                  <td className="p-4 text-slate-500 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} />
                      {job.createdAt}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-indigo-400">{job.algorithmName}</div>
                    <div className="text-xs text-slate-600 font-mono">ID: {job.algorithmId}</div>
                  </td>
                  <td className="p-4 text-right font-mono text-slate-400">{job.totalHashes.toLocaleString()}</td>
                 
                  <td className="p-4 text-right font-mono text-slate-400">
                    {(job as any).maxCracksNeeded ? (job as any).maxCracksNeeded.toLocaleString() : 'N/A'}
                  </td>
                  <td className="p-4 text-right">
                     <div className="text-emerald-400 font-mono font-bold">${parseFloat(job.pricePerHashUsd).toFixed(4)}</div>
                     <div className="text-xs text-slate-500 font-mono">{parseFloat(job.pricePerHash).toFixed(8)} {job.currency}</div>
                  </td>
                  <td className="p-4 text-right font-mono text-slate-300">
                    {job.totalHashes > 0 
                      ? `${(((job.totalHashes - job.leftHashes) / job.totalHashes) * 100).toFixed(1)}%` 
                      : '0%'}
                  </td>
                  <td className="p-4 text-right font-mono text-slate-400">{job.leftHashes.toLocaleString()}</td>
                  <td className="p-4 text-center">
                     <a 
                       href={`https://hashes.com${job.leftList}`} 
                       target="_blank" 
                       rel="noopener noreferrer"
                       className="inline-block p-2 rounded-lg bg-slate-800 text-indigo-400 hover:text-white hover:bg-indigo-600 transition-all"
                       title="Download List"
                     >
                       <Download size={16} />
                     </a>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && !loading && !error && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                    <Search size={32} className="opacity-20" />
                    <span>No jobs loaded. Enter API key and fetch to see available escrow jobs.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {sortedJobs.length > 0 && (
          <div className="bg-slate-950 p-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-sm text-slate-400 gap-4">
            <div className="flex items-center gap-4">
              <span>
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedJobs.length)} of {sortedJobs.length} jobs
              </span>
              <select 
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
                <option value="75">75 per page</option>
                <option value="100">100 per page</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="font-mono px-2">Page {currentPage} / {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Found Hashes Submission */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="bg-slate-950/50 p-4 border-b border-slate-800 flex items-center gap-2">
          <UploadCloud size={18} className="text-emerald-400"/>
          <h3 className="text-sm font-bold text-slate-200">{t('escrow_submit_title')}</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300 block mb-2">{t('escrow_instructions_title')}</strong>
                    {t('escrow_instructions_1')}<br/>
                    {t('escrow_instructions_2')}<br/>
                    {t('escrow_instructions_3')}<br/>
                    <br/>
                    <span className="text-emerald-500">{t('escrow_tip')}</span>
                </div>
                
                {/* Algorithm Search / Selector */}
                <div className="relative" ref={algoListRef}>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t('escrow_label_algo')}</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 pr-8"
                      placeholder={t('escrow_search_placeholder')}
                      value={algoSearch}
                      onChange={(e) => {
                        setAlgoSearch(e.target.value);
                        setShowAlgoList(true);
                        if (e.target.value === '') setSubmissionAlgo('');
                      }}
                      onFocus={() => setShowAlgoList(true)}
                    />
                    {submissionAlgo && (
                      <button 
                        onClick={() => {
                          setSubmissionAlgo('');
                          setAlgoSearch('');
                        }}
                        className="absolute right-2 top-2.5 text-slate-500 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {showAlgoList && (
                    <div className="absolute z-50 w-full bg-slate-900 border border-slate-700 rounded-lg mt-1 max-h-60 overflow-y-auto shadow-xl">
                      {filteredAlgos.length > 0 ? (
                        filteredAlgos.map(a => (
                          <div 
                            key={a.id}
                            onClick={() => (function(id, name) {
                                setSubmissionAlgo(id.toString());
                                setAlgoSearch(name);
                                setShowAlgoList(false);
                            })(a.id, a.algorithmName)}
                            className="px-3 py-2 hover:bg-indigo-600 hover:text-white cursor-pointer text-sm flex justify-between group"
                          >
                            <span>{a.algorithmName}</span>
                            <span className="text-slate-500 group-hover:text-indigo-200 font-mono text-xs">#{a.id}</span>
                          </div>
                        ))
                      ) : (
                        <div className="p-3 text-slate-500 text-xs text-center">No algorithms found</div>
                      )}
                    </div>
                  )}
                  {submissionAlgo && (
                     <div className="text-[10px] text-emerald-400 mt-1 font-mono">
                        Target ID: {submissionAlgo}
                     </div>
                  )}
                </div>

                <button 
                    onClick={async () => {
                        if((!submissionContent && !submissionFile) || !submissionAlgo || !apiKey) return;
                        setSubmitting(true);
                        try {
                          const formData = new FormData();
                          formData.append('key', apiKey);
                          formData.append('algo', submissionAlgo);
                          
                          if (submissionFile) {
                              formData.append('userfile', submissionFile);
                          } else {
                              const blob = new Blob([submissionContent], { type: 'text/plain' });
                              formData.append('userfile', blob, 'founds.txt');
                          }

                          const response = await fetch('http://localhost:3001/api/escrow/proxy', {
                              method: 'POST',
                              body: formData, 
                          });

                          if (!response.ok) {
                              const text = await response.text();
                              throw new Error(`Upload failed: ${text}`);
                          }

                          const res = await response.json();
                          if (res.success === true) {
                              alert(`Submission Successful!\nHashes.com Response: Success`);
                              setSubmissionContent('');
                              setSubmissionFile(null);
                          } else {
                               throw new Error(res.message || "Unknown error from Hashes.com");
                          }
                        } catch (e: any) {
                          alert(`Error submitting: ${e.message}`);
                        } finally {
                          setSubmitting(false);
                        }
                    }}
                    disabled={submitting || (!submissionContent && !submissionFile) || !submissionAlgo}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg font-medium flex justify-center items-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-900/20 transition-all"
                >
                   {submitting ? <RefreshCw className="animate-spin" size={18} /> : <UploadCloud size={18} />}
                   {t('escrow_btn_upload')}
                </button>
            </div>
            
            <div className="lg:col-span-2 space-y-4">
                {/* Manual / File Upload Header */}
                <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-2 mb-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">{t('escrow_label_list')}</label>
                    <div className="flex items-center gap-3">
                        {/* File Upload Trigger */}
                        <label className="text-xs font-bold text-indigo-400 cursor-pointer hover:text-indigo-300 flex items-center gap-1">
                            <input type="file" className="hidden" onChange={(e) => {
                                if(e.target.files?.[0]) {
                                    setSubmissionFile(e.target.files[0]);
                                    setSubmissionContent(''); 
                                }
                            }} accept=".txt" />
                            <FileText size={12} /> {submissionFile ? submissionFile.name : t('escrow_load_file')}
                        </label>
                    </div>
                </div>

                <textarea
                    className="w-full h-48 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-300 focus:border-emerald-500 outline-none resize-none"
                    placeholder={'21232f297a57a5a743894a0e4a801fc3:admin\n5f4dcc3b5aa765d61d8327deb882cf99:password'}
                    value={submissionContent}
                    onChange={e => {
                        setSubmissionContent(e.target.value);
                    }}
                    disabled={!!submissionFile}
                />
                
                {submissionFile && (
                    <div className="mt-2 text-xs text-emerald-400 flex items-center gap-2">
                      <FileText size={14} /> {t('escrow_file_loaded', { name: submissionFile.name })}
                      <button onClick={() => setSubmissionFile(null)} className="text-red-400 hover:underline ml-2">{t('escrow_btn_clear')}</button>
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* --- Mass Download Modal --- */}
      {showDownloadModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center shrink-0">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        <Download size={18} className="text-emerald-500"/>
                        {t('escrow_modal_title')}
                    </h3>
                    {!downloading && (
                        <button onClick={() => setShowDownloadModal(false)} className="text-slate-500 hover:text-white">
                            <X size={20}/>
                        </button>
                    )}
                </div>
                
                <div className="p-6 space-y-5 overflow-y-auto">
                    {/* Algo Selector */}
                    <div>
                        <label className="block text-xs text-slate-400 uppercase font-bold mb-2">{t('escrow_modal_step1')}</label>
                        <select 
                            value={dlAlgo}
                            onChange={e => setDlAlgo(e.target.value)}
                            disabled={downloading}
                            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white outline-none focus:border-emerald-500"
                        >
                            <option value="">-- Select Algorithm (Required) --</option>
                            {algos.map(a => (
                                <option key={a.id} value={a.id}>{a.algorithmName}</option>
                            ))}
                        </select>
                    </div>

                    {/* Price Selector */}
                    <div>
                        <label className="block text-xs text-slate-400 uppercase font-bold mb-2">{t('escrow_modal_step2')}</label>
                        <div className="relative">
                            <DollarSign size={14} className="absolute left-3 top-3 text-slate-500"/>
                            <input 
                                type="number" 
                                placeholder="0.00" 
                                value={dlMinPrice}
                                onChange={e => setDlMinPrice(e.target.value)}
                                disabled={downloading}
                                className="w-full bg-slate-950 border border-slate-700 rounded pl-9 p-2 text-white outline-none focus:border-emerald-500"
                            />
                        </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-slate-800/50 p-3 rounded border border-slate-700 text-sm text-slate-300">
                        <div className="flex justify-between mb-1">
                            <span>{t('escrow_modal_summary')}</span>
                            <span className="font-bold text-white">{calculateDownloadableCount()}</span>
                        </div>
                        <div className="text-xs text-slate-500 leading-tight">
                            {t('escrow_modal_desc')} <br/>
                            <code>{dlAlgo ? (algos.find(a=>a.id.toString()===dlAlgo)?.algorithmName.replace(/[^a-z0-9]/gi, '_')) : 'algo'}_{new Date().toISOString().slice(0,10)}.txt</code>
                        </div>
                    </div>
                    
                    {/* Logs Area */}
                    {downloadLogs.length > 0 && (
                        <div className="bg-black/50 border border-slate-800 rounded p-2 h-32 overflow-y-auto text-[10px] font-mono text-slate-400">
                            {downloadLogs.map((log, i) => (
                                <div key={i} className="mb-1 border-b border-slate-800/50 pb-1 last:border-0">{log}</div>
                            ))}
                            <div id="log-end" />
                        </div>
                    )}

                    {/* Progress Bar */}
                    {downloading && downloadProgress && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-400">
                                <span>Progress</span>
                                <span>{Math.round((downloadProgress.current / downloadProgress.total) * 100)}%</span>
                            </div>
                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-emerald-500 transition-all duration-300"
                                    style={{ width: `${(downloadProgress.current / downloadProgress.total) * 100}%` }}
                                />
                            </div>
                            <div className="text-center text-xs text-emerald-400 animate-pulse">
                                Processing file {downloadProgress.current} of {downloadProgress.total}...
                            </div>
                        </div>
                    )}

                    <button 
                        onClick={async () => {
                            const targetJobs = jobs.filter(j => {
                                const meetsAlgo = dlAlgo ? j.algorithmId.toString() === dlAlgo : true;
                                const meetsPrice = dlMinPrice ? parseFloat(j.pricePerHashUsd) >= parseFloat(dlMinPrice) : true;
                                return meetsAlgo && meetsPrice && j.leftList;
                            });

                            if (targetJobs.length === 0) { alert("No jobs match your criteria."); return; }
                            
                            setDownloading(true);
                            setDownloadProgress({ current: 0, total: targetJobs.length, found: 0 });
                            setDownloadLogs([]); 
                            
                            let combinedContent = '';
                            
                            try {
                              const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                              // Proxy helper
                              const fetchViaProxy = async (fileUrl: string, jobId: number, attempt = 1): Promise<string | null> => {
                                  try {
                                      let cleanUrl = fileUrl;
                                      if (cleanUrl.startsWith('http:')) cleanUrl = cleanUrl.replace('http:', 'https:');
                                      else if (!cleanUrl.startsWith('http')) {
                                          if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;
                                          cleanUrl = `https://hashes.com${cleanUrl}`;
                                      }
                                      const proxyUrl = `http://localhost:3001/api/escrow/proxy?url=${encodeURIComponent(cleanUrl)}`;
                                      const response = await fetch(proxyUrl);
                                      if (!response.ok) throw new Error(`HTTP_${response.status}`);
                                      const text = await response.text();
                                      if (text.trim().toLowerCase().startsWith('<!doctype') || text.includes('<html')) {
                                         throw new Error("INVALID_CONTENT_HTML");
                                      }
                                      return text;
                                  } catch (err: any) {
                                      if (attempt < 3) {
                                          await delay(10 * attempt);
                                          return fetchViaProxy(fileUrl, jobId, attempt + 1);
                                      }
                                      throw err;
                                  }
                              };

                              for (let i = 0; i < targetJobs.length; i++) {
                                const job = targetJobs[i];
                                setDownloadProgress(prev => ({ ...prev!, current: i + 1 }));
                                setDownloadLogs(prev => [...prev, `Job #${job.id}: Fetching...`]);

                                try {
                                  await delay(10); 
                                  const text = await fetchViaProxy(job.leftList, job.id);
                                  if (text && text.trim()) {
                                    combinedContent += text.trim() + '\n';
                                    setDownloadProgress(prev => ({ ...prev!, found: prev!.found + 1 }));
                                    setDownloadLogs(prev => { const newLogs = [...prev]; newLogs[newLogs.length - 1] = `✅ Job #${job.id}: Success.`; return newLogs; });
                                  } else {
                                    setDownloadLogs(prev => { const newLogs = [...prev]; newLogs[newLogs.length - 1] = `⚠️ Job #${job.id}: File empty.`; return newLogs; });
                                  }
                                } catch (err: any) {
                                  setDownloadLogs(prev => { const newLogs = [...prev]; newLogs[newLogs.length - 1] = `❌ Job #${job.id}: Failed (${err.message}).`; return newLogs; });
                                }
                              }

                              if (!combinedContent.trim()) {
                                setDownloadLogs(prev => [...prev, `❌ Process complete. No hashes found.`]);
                                return;
                              }

                              const algoObj = algos.find(a => a.id.toString() === dlAlgo);
                              const algoName = algoObj ? algoObj.algorithmName.replace(/[^a-z0-9]/gi, '_') : 'Mixed_Algorithms';
                              const dateStr = new Date().toISOString().slice(0,10);
                              const filename = `${algoName}_${dateStr}.txt`;

                              const blob = new Blob([combinedContent], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = filename;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                              
                              setDownloadLogs(prev => [...prev, `🎉 DONE: Saved as ${filename}`]);

                            } catch (e: any) {
                              console.error("Mass download error:", e);
                              alert(`Mass download failed: ${e.message}`);
                            } finally {
                              setDownloading(false);
                            }
                        }}
                        disabled={downloading || calculateDownloadableCount() === 0 || !dlAlgo}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded transition-all flex justify-center items-center gap-2"
                    >
                        {downloading ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>}
                        {downloading ? t('escrow_modal_btn_dling') : t('escrow_modal_btn_dl')}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default EscrowDashboard;