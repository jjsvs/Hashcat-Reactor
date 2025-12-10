import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Microscope, Layers, History, Download, FileDown, FileText, 
  Loader2, ShieldCheck, ChevronUp, ChevronDown, PlayCircle, 
  GitBranch, ArrowLeftRight, Database, Clock, Copy, BarChart3, 
  PieChart, Calculator, X, Sparkles, Info, Zap, Eye, Camera,
  TrendingUp, BarChart2, Cpu, Activity, Timer
} from 'lucide-react';
import { 
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, LabelList 
} from 'recharts';
import { SessionStats, LogEntry, HashcatConfig, RecoveredHash } from '../types';
import { HASH_TYPES } from '../constants';
import { useTranslation } from 'react-i18next';

// --- Types & Interfaces ---

export interface PastSession {
    id: string;
    date: Date;
    duration: number; 
    mode: string;
    algorithmId: string;
    attackType: string;
    attackMode: number; 
    recovered: number;
    totalHashes: number;
    avgHashrate: number;
    powerUsage: number; 
    analysis?: InsightsData; 
}

interface MaskData {
    mask: string;
    count: number;
    complexity: number;
    timeToCrack: number;
}

interface InsightsData {
    sortedMasks: MaskData[];
    lengthCounts: Record<number, number>;
    charsets: Record<string, number>;
    topPasswords: [string, number][];
    topBaseWords: [string, number][];
    topPrefixes: [string, number][];
    topSuffixes: [string, number][];
    avgEntropy: number;
    total: number;
}

interface InsightsProps {
    globalPotfile: RecoveredHash[];
    sessionHashes: RecoveredHash[];
    session: SessionStats;
    pastSessions: PastSession[];
    config: HashcatConfig;
    setConfig: React.Dispatch<React.SetStateAction<HashcatConfig>>;
    setActiveTab: (tab: any) => void;
    addLog: (sessionId: string, message: string, level: LogEntry['level']) => void;
}

const INITIAL_INSIGHTS: InsightsData = {
    sortedMasks: [], lengthCounts: {}, charsets: {}, topPasswords: [], topBaseWords: [], topPrefixes: [], topSuffixes: [], avgEntropy: 0, total: 0
};

// --- Helper Functions ---

const formatKeyspace = (num: number) => {
    if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
};

const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
    return `${(seconds / 86400).toFixed(1)}d`;
};

const formatEnergy = (avgWatts: number, durationSeconds: number) => {
    if (!avgWatts || avgWatts <= 0) return '0 Wh';
    const hours = durationSeconds / 3600;
    const wattHours = avgWatts * hours;

    if (wattHours >= 1000) {
        return `${(wattHours / 1000).toFixed(3)} kWh`;
    }
    return `${wattHours.toFixed(1)} Wh`;
};

const generateRuleContent = (prefixes: [string, number][], suffixes: [string, number][]) => {
  let content = "# Reactor Generated Rules (PACK Hybrid)\n:\n"; 
  (suffixes || []).forEach(([suffix]) => {
    if (!suffix) return;
    let rule = "";
    for (const char of suffix) { rule += `$${char} `; }
    content += `${rule.trim()} # Appends ${suffix}\n`;
  });
  (prefixes || []).forEach(([prefix]) => {
    if (!prefix) return;
    let rule = "";
    const reversed = prefix.split('').reverse().join('');
    for (const char of reversed) { rule += `^${char} `; }
    content += `${rule.trim()} # Prepends ${prefix}\n`;
  });
  content += "\n# Common Transformations\nc # Capitalize first\nTN # Toggle Case\nr # Reverse\n";
  return content;
};

// --- WORKER CODE: PACK Enhanced Analysis ---
const WORKER_CODE = `
self.onmessage = function(e) {
    const { hashes, targetPps = 10000000000 } = e.data; 
    if (!hashes || hashes.length === 0) {
        self.postMessage({ sortedMasks: [], lengthCounts: {}, charsets: {}, topPasswords: [], topBaseWords: [], topPrefixes: [], topSuffixes: [], avgEntropy: 0, total: 0 });
        return;
    }

    const maskCounts = {};
    const lengthCounts = {};
    const passwordFrequency = {};
    const baseWordFrequency = {};
    const prefixCounts = {};
    const suffixCounts = {};
    let totalEntropy = 0;

    const charsets = {
        'Numeric': 0,
        'Lower Alpha': 0,
        'Mixed Alpha': 0,
        'Mixed Alpha-Num': 0,
        'Full Complex': 0
    };

    let validCount = 0;

    const getMaskComplexity = (mask) => {
        let count = 1;
        for (let i = 0; i < mask.length; i+=2) {
            const char = mask.substring(i, i+2);
            if (char === '?l') count *= 26;
            else if (char === '?u') count *= 26;
            else if (char === '?d') count *= 10;
            else if (char === '?s') count *= 33;
            else if (char === '?a') count *= 95;
            else if (char === '?b') count *= 256;
        }
        return count;
    };

    const parseHashcatHex = (str) => {
        if (!str || !str.startsWith('$HEX[')) return str;
        const match = str.match(/^\\$HEX\\[([a-fA-F0-9]+)\\]$/);
        if (!match) return str; 
        const hex = match[1];
        let strOut = '';
        try {
            for (let i = 0; i < hex.length; i += 2) {
                strOut += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
            }
        } catch (e) { return str; } 
        return strOut;
    };

    const getCharMask = (char) => {
        if (/[a-z]/.test(char)) return '?l';
        if (/[A-Z]/.test(char)) return '?u';
        if (/[0-9]/.test(char)) return '?d';
        if (/\\s/.test(char)) return '?b'; 
        return '?s'; 
    };

    const generateMask = (password) => {
        if (!password) return '';
        return password.split('').map(getCharMask).join('');
    };

    const calculateEntropy = (password) => {
        if (!password) return 0;
        let pool = 0;
        if (/[a-z]/.test(password)) pool += 26;
        if (/[A-Z]/.test(password)) pool += 26;
        if (/[0-9]/.test(password)) pool += 10;
        if (/[^a-zA-Z0-9]/.test(password)) pool += 32; 
        if (pool === 0) return 0;
        return Math.log2(pool) * password.length;
    };

    hashes.forEach(h => {
        let p = h.plain;
        if (!p) return;
        p = parseHashcatHex(p);
        validCount++;
        
        const mask = generateMask(p);
        maskCounts[mask] = (maskCounts[mask] || 0) + 1;
        
        const match = p.match(/^([^a-zA-Z]*)([a-zA-Z]+.*[a-zA-Z]|[a-zA-Z])([^a-zA-Z]*)$/);
        
        if (match) {
            const prefix = match[1];
            const root = match[2];
            const suffix = match[3];

            if (prefix) prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
            if (suffix) suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
            if (root.length > 3) baseWordFrequency[root] = (baseWordFrequency[root] || 0) + 1;
        } else {
             if (/^[a-zA-Z]+$/.test(p)) {
                baseWordFrequency[p] = (baseWordFrequency[p] || 0) + 1;
             }
        }

        lengthCounts[p.length] = (lengthCounts[p.length] || 0) + 1;
        passwordFrequency[p] = (passwordFrequency[p] || 0) + 1;
        totalEntropy += calculateEntropy(p);
        
        const hasDigit = /[0-9]/.test(p);
        const hasLower = /[a-z]/.test(p);
        const hasUpper = /[A-Z]/.test(p);
        const hasSpecial = /[^a-zA-Z0-9]/.test(p);

        if (hasDigit && !hasLower && !hasUpper && !hasSpecial) charsets['Numeric']++;
        else if (!hasDigit && hasLower && !hasUpper && !hasSpecial) charsets['Lower Alpha']++;
        else if (!hasDigit && hasLower && hasUpper && !hasSpecial) charsets['Mixed Alpha']++;
        else if (hasDigit && (hasLower || hasUpper) && !hasSpecial) charsets['Mixed Alpha-Num']++;
        else charsets['Full Complex']++;
    });

    const sortedMasks = Object.entries(maskCounts)
        .map(([mask, count]) => {
            const complexity = getMaskComplexity(mask);
            const timeToCrack = complexity / targetPps; 
            return { mask, count, complexity, timeToCrack };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 1000);

    const topPasswords = Object.entries(passwordFrequency).sort(([, a], [, b]) => b - a).slice(0, 50);
    const topBaseWords = Object.entries(baseWordFrequency).sort(([, a], [, b]) => b - a).slice(0, 50);
    const topPrefixes = Object.entries(prefixCounts).sort(([, a], [, b]) => b - a).slice(0, 20);
    const topSuffixes = Object.entries(suffixCounts).sort(([, a], [, b]) => b - a).slice(0, 20);
    const avgEntropy = validCount > 0 ? totalEntropy / validCount : 0;

    self.postMessage({ sortedMasks, lengthCounts, charsets, topPasswords, topBaseWords, topPrefixes, topSuffixes, avgEntropy, total: validCount });
};
`;

const Insights: React.FC<InsightsProps> = ({ 
    globalPotfile, 
    sessionHashes, 
    session, 
    pastSessions, 
    config, 
    setConfig, 
    setActiveTab, 
    addLog 
}) => {
    const { t } = useTranslation();

    // --- Local State ---
    const [insightScope, setInsightScope] = useState<'all' | 'session' | 'historical_snapshot'>('all');
    const [insights, setInsights] = useState<InsightsData>(INITIAL_INSIGHTS);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [viewAllMasks, setViewAllMasks] = useState(false);
    const [showMaskModal, setShowMaskModal] = useState(false);
    
    // Tracks which session row is expanded to show the graph
    const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
    const activeGraphRef = useRef<HTMLTableRowElement>(null);
    
    // Grouping State
    const [openHistoryGroups, setOpenHistoryGroups] = useState<Record<string, boolean>>({});

    const [maskGenConfig, setMaskGenConfig] = useState({
        timeLimit: 1, 
        timeUnit: 'hours',
        hashrate: 10, 
        sortMode: 'occurrence', 
        targetAlgo: '0', 
        minLength: 1,
        isAutoDetected: false,
        detectionSource: 'manual' as 'manual' | 'bruteforce' | 'compensated'
    });

    const workerRef = useRef<Worker | null>(null);
    
    
    const scopeRef = useRef(insightScope);

    useEffect(() => {
        scopeRef.current = insightScope;
    }, [insightScope]);

    // --- Computed Data ---
    const hashesToAnalyze = useMemo(() => {
        if (insightScope === 'session') return sessionHashes;
        if (insightScope === 'all') return globalPotfile;
        return []; 
    }, [insightScope, sessionHashes, globalPotfile]);

    // Grouped History
    const groupedHistory = useMemo(() => {
        const groups: Record<string, PastSession[]> = {};
        pastSessions.forEach(s => {
            const algoName = HASH_TYPES.find(h => h.id === s.algorithmId)?.name || `Mode ${s.algorithmId}`;
            if (!groups[algoName]) groups[algoName] = [];
            groups[algoName].push(s);
        });
        return groups;
    }, [pastSessions]);

    // --- Effects ---
    useEffect(() => {
        const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
        workerRef.current = new Worker(URL.createObjectURL(blob));
        workerRef.current.onmessage = (e) => {
            // CRITICAL FIX: Ignore worker results if we are currently viewing a snapshot
            if (scopeRef.current === 'historical_snapshot') return;
            
            setInsights(e.data);
            setIsAnalyzing(false);
        };
        return () => { workerRef.current?.terminate(); };
    }, []);

    useEffect(() => {
        if (workerRef.current && (insightScope === 'all' || insightScope === 'session')) {
            setIsAnalyzing(true);
            workerRef.current.postMessage({ 
                hashes: hashesToAnalyze,
                targetPps: session.hashrate > 0 ? session.hashrate : 1000000000 
            });
        }
    }, [hashesToAnalyze, session.hashrate, insightScope]);

    useEffect(() => {
        if (showMaskModal) {
            detectHashrateForAlgo(config.hashType);
        }
    }, [showMaskModal, config.hashType]);

    // Auto-scroll to graph when opened
    useEffect(() => {
        if (expandedSessionId && activeGraphRef.current) {
            activeGraphRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [expandedSessionId]);

    // --- Handlers ---
    const detectHashrateForAlgo = (algoId: string) => {
        const matchingSessions = pastSessions.filter(s => s.algorithmId === algoId && s.avgHashrate > 0);
        let suggestedRate = 10;
        let detected = false;
        let source: 'manual' | 'bruteforce' | 'compensated' = 'manual';

        if (matchingSessions.length > 0) {
            const bfSessions = matchingSessions.filter(s => s.attackMode === 3);
            if (bfSessions.length > 0) {
                const total = bfSessions.reduce((acc, s) => acc + s.avgHashrate, 0);
                const avg = total / bfSessions.length;
                suggestedRate = avg / 1000000000;
                detected = true;
                source = 'bruteforce';
            } else {
                const maxRate = Math.max(...matchingSessions.map(s => s.avgHashrate));
                const COMPENSATION_FACTOR = 1.4; 
                suggestedRate = (maxRate * COMPENSATION_FACTOR) / 1000000000;
                detected = true;
                source = 'compensated';
            }
        } else if (config.hashType === algoId && session.hashrate > 0) {
            suggestedRate = session.hashrate / 1000000000;
            detected = true;
            source = 'manual';
        }

        setMaskGenConfig(prev => ({
            ...prev,
            targetAlgo: algoId,
            hashrate: parseFloat(suggestedRate.toFixed(3)),
            isAutoDetected: detected,
            detectionSource: source
        }));
    };

    const handleGenerateMasks = () => {
        if (insights.sortedMasks.length === 0) {
            addLog('general', "No masks available to generate.", "WARN");
            return;
        }
        let targetSeconds = 0;
        if (maskGenConfig.timeUnit === 'minutes') targetSeconds = maskGenConfig.timeLimit * 60;
        else if (maskGenConfig.timeUnit === 'hours') targetSeconds = maskGenConfig.timeLimit * 3600;
        else if (maskGenConfig.timeUnit === 'days') targetSeconds = maskGenConfig.timeLimit * 86400;

        const pps = maskGenConfig.hashrate * 1000000000; 
        let masksToProcess = [...insights.sortedMasks];
        
        if (maskGenConfig.sortMode === 'optindex') {
            masksToProcess.sort((a, b) => (a.complexity / a.count) - (b.complexity / b.count));
        } else {
            masksToProcess.sort((a, b) => b.count - a.count);
        }

        const selectedMasks = [];
        let accumulatedTime = 0;
        let accumulatedCoverage = 0;

        for (const m of masksToProcess) {
            if ((m.mask.length / 2) < maskGenConfig.minLength) continue; 
            const maskTime = m.complexity / pps;
            if (accumulatedTime + maskTime > targetSeconds) continue; 
            selectedMasks.push(m.mask);
            accumulatedTime += maskTime;
            accumulatedCoverage += m.count;
        }

        const content = selectedMasks.join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pack_optimized_${maskGenConfig.timeLimit}${maskGenConfig.timeUnit}_${Date.now()}.hcmask`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const coveragePct = ((accumulatedCoverage / insights.total) * 100).toFixed(2);
        addLog('general', `Generated ${selectedMasks.length} masks (${coveragePct}% coverage) for ${formatTime(accumulatedTime)} runtime.`, 'SUCCESS');
        setShowMaskModal(false);
    };

    const handleDownloadRules = () => {
        const content = generateRuleContent(insights.topPrefixes || [], insights.topSuffixes || []);
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reactor_hybrid_${Date.now()}.rule`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('general', 'Downloaded generated .rule file', 'SUCCESS');
    };

    const handleExportWordlist = () => {
        if (!hashesToAnalyze || hashesToAnalyze.length === 0) {
            addLog('general', 'No hashes to export', 'WARN');
            return;
        }
        const uniquePlains = new Set(hashesToAnalyze.map(h => h.plain).filter(p => p));
        const content = Array.from(uniquePlains).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wordlist_${insightScope}_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('general', `Exported ${uniquePlains.size} unique passwords as wordlist`, 'SUCCESS');
    };

    const handleExportList = (filename: string, list: [string, number][]) => {
        if (list.length === 0) { addLog('general', `No data to export for ${filename}`, 'WARN'); return; }
        const content = list.map(([item]) => item).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('general', `Exported ${list.length} items to ${filename}.txt`, 'SUCCESS');
    };

    const handleRunMaskAttack = (mask: string) => {
        setConfig(prev => ({
          ...prev,
          attackMode: 3, 
          mask: mask,
          maskFile: '',
          wordlistPath: '',
          wordlistPath2: ''
        }));
        setActiveTab('dashboard');
        addLog('general', `Configured Brute Force attack with mask: ${mask}`, 'CMD');
    };

    const handleCopyPattern = (text: string, type: 'Prefix' | 'Suffix') => {
        navigator.clipboard.writeText(text);
        addLog('general', `Copied ${type}: ${text}`, 'INFO');
    };

    const toggleGroup = (algo: string) => {
        setOpenHistoryGroups(prev => ({...prev, [algo]: !prev[algo]}));
    };

    const loadSessionSnapshot = (session: PastSession) => {
        if (!session.analysis) {
            addLog('general', 'No snapshot data available for this session.', 'WARN');
            return;
        }
        
       
        setIsAnalyzing(false);
        
       
        setInsightScope('historical_snapshot');
        setInsights({ ...INITIAL_INSIGHTS, ...session.analysis });
        
        addLog('general', `Loaded snapshot for session: ${session.date}`, 'INFO');
        
        // Scroll to top to see the data
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const toggleSessionGraph = (sessionId: string) => {
        if (expandedSessionId === sessionId) {
            setExpandedSessionId(null);
        } else {
            setExpandedSessionId(sessionId);
        }
    };

    
    const getSessionChartData = (s: PastSession) => {
        const hours = s.duration / 3600;
        const wattHours = s.powerUsage * hours;
        const hashrateMh = s.avgHashrate / 1000000;
        
        return [
            {
                name: 'Hashrate (MH/s)',
                value: hashrateMh > 0 ? hashrateMh : 0.1, // Avoid log(0)
                displayValue: `${hashrateMh.toFixed(2)} MH/s`,
                fill: '#6366f1', // Indigo
                unit: 'MH/s'
            },
            {
                name: 'Energy (Wh)',
                value: wattHours > 0 ? parseFloat(wattHours.toFixed(2)) : 0.1,
                displayValue: `${wattHours.toFixed(2)} Wh`,
                fill: '#f59e0b', // Amber
                unit: 'Wh'
            },
            {
                name: 'Recovered',
                value: s.recovered > 0 ? s.recovered : 0.1,
                displayValue: s.recovered.toString(),
                fill: '#10b981', // Emerald
                unit: 'Hashes'
            }
        ];
    };

    // Helper to extract session specific stats for the header
    const getSessionStats = (s: PastSession) => {
        const hours = s.duration / 3600;
        const wattHours = s.powerUsage * hours;
        const efficiency = wattHours > 0 ? (s.recovered / wattHours) : 0;
        const algoName = HASH_TYPES.find(h => h.id === s.algorithmId)?.name || s.algorithmId;
        
        return {
            algo: algoName,
            mode: s.attackType,
            duration: formatTime(s.duration),
            efficiency: efficiency.toFixed(2)
        };
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs z-50">
                    <div className="font-bold text-slate-200 mb-1 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: data.fill }}></div>
                        {data.name}
                    </div>
                    <div className="text-slate-400">
                        Value: <span className="text-white font-mono font-bold ml-1">{data.displayValue}</span>
                    </div>
                </div>
            );
        }
        return null;
    };

    const getScopeText = () => {
        if (insightScope === 'session') return t('insights_scope_session');
        if (insightScope === 'historical_snapshot') return t('insights_scope_snapshot');
        return t('insights_scope_total');
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300 relative">
            {/* Mask Generator Modal */}
            {showMaskModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                            <h3 className="font-bold text-slate-200 flex items-center gap-2"><Calculator size={18} className="text-indigo-400" /> {t('insights_mask_modal_title')}</h3>
                            <button onClick={() => setShowMaskModal(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">{t('insights_mask_runtime')}</label>
                                <div className="flex gap-2">
                                    <input type="number" value={maskGenConfig.timeLimit} onChange={(e) => setMaskGenConfig({...maskGenConfig, timeLimit: parseInt(e.target.value) || 1})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" min="1" />
                                    <select value={maskGenConfig.timeUnit} onChange={(e) => setMaskGenConfig({...maskGenConfig, timeUnit: e.target.value})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none">
                                        <option value="minutes">Minutes</option>
                                        <option value="hours">Hours</option>
                                        <option value="days">Days</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">{t('insights_mask_algo')}</label>
                                <select value={maskGenConfig.targetAlgo} onChange={(e) => detectHashrateForAlgo(e.target.value)} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none">
                                    {HASH_TYPES.map(h => (<option key={h.id} value={h.id}>{h.name} (Mode {h.id})</option>))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs uppercase font-bold text-slate-500">{t('insights_mask_hashrate')}</label>
                                    {maskGenConfig.isAutoDetected ? (
                                        <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${maskGenConfig.detectionSource === 'bruteforce' ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-400 bg-amber-400/10'}`}><Sparkles size={10} /> {maskGenConfig.detectionSource === 'bruteforce' ? 'Matched Brute Force History' : 'Compensated Wordlist History'}</span>
                                    ) : (<span className="flex items-center gap-1 text-[10px] text-slate-500 font-bold bg-slate-800 px-1.5 py-0.5 rounded"><Info size={10} /> No history for this type</span>)}
                                </div>
                                <input type="number" value={maskGenConfig.hashrate} onChange={(e) => setMaskGenConfig({...maskGenConfig, hashrate: parseFloat(e.target.value) || 1, isAutoDetected: false, detectionSource: 'manual'})} className={`bg-slate-950 border rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none ${maskGenConfig.isAutoDetected ? 'border-indigo-500/50' : 'border-slate-800'}`} min="0.1" step="0.1" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">{t('insights_mask_min_len')}</label>
                                <input type="number" value={maskGenConfig.minLength} onChange={(e) => setMaskGenConfig({...maskGenConfig, minLength: parseInt(e.target.value) || 1})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" min="1" max="16" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">{t('insights_mask_sorting')}</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setMaskGenConfig({...maskGenConfig, sortMode: 'occurrence'})} className={`p-2 rounded text-xs font-bold border transition-all ${maskGenConfig.sortMode === 'occurrence' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}>Occurrence</button>
                                    <button onClick={() => setMaskGenConfig({...maskGenConfig, sortMode: 'optindex'})} className={`p-2 rounded text-xs font-bold border transition-all ${maskGenConfig.sortMode === 'optindex' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}>Efficiency</button>
                                </div>
                            </div>
                            <button onClick={handleGenerateMasks} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"><Download size={18} /> {t('insights_mask_btn_gen')}</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Microscope className="text-indigo-500" /> {t('insights_title')}
                        {isAnalyzing && <Loader2 className="animate-spin text-slate-500" size={18} />}
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">
                        {t('insights_desc', { count: insights.total, scope: getScopeText() })}
                    </p>
                </div>
                
                <div className="flex items-center gap-6">
                    <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center">
                        <button onClick={() => setInsightScope('all')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><Layers size={14} /> {t('insights_btn_all')}</button>
                        <button onClick={() => setInsightScope('session')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'session' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><History size={14} /> {t('insights_btn_session')}</button>
                        {insightScope === 'historical_snapshot' && <button disabled className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold bg-amber-600 text-white shadow ml-1"><Camera size={14} /> {t('insights_btn_snapshot')}</button>}
                    </div>
                    <div className="flex gap-2">
                        {insights.total > 0 && (<button onClick={() => setShowMaskModal(true)} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Configure & Download .hcmask"><Download size={14} /> {t('insights_btn_masks')}</button>)}
                        {insights.total > 0 && (<button onClick={handleDownloadRules} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-pink-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download .rule"><FileDown size={14} /> {t('insights_btn_rules')}</button>)}
                        {insights.total > 0 && (<button onClick={handleExportWordlist} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download Plaintext Wordlist"><FileText size={14} /> {t('insights_btn_wordlist')}</button>)}
                    </div>
                    <div className="text-right border-l border-slate-800 pl-4 hidden xl:block">
                        <div className="text-3xl font-mono font-bold text-amber-400">{insights.avgEntropy.toFixed(1)}</div>
                        <div className="text-xs text-slate-500 uppercase font-bold">{t('insights_entropy')}</div>
                    </div>
                </div>
            </div>

            {insights.total === 0 && !isAnalyzing ? (
                <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center">
                    <Microscope size={48} className="text-slate-700 mb-4" />
                    <h3 className="text-slate-300 font-bold">{t('insights_no_data')}</h3>
                    <p className="text-slate-500 mt-2">
                        {insightScope === 'session' ? t('insights_no_data_session') : t('insights_no_data_potfile')}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 flex flex-col gap-6">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-auto max-h-[500px]">
                            <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between shrink-0">
                                <h3 className="font-bold text-slate-200 flex items-center gap-2"><ShieldCheck size={16} className="text-indigo-400" /> {t('insights_smart_mask')}</h3>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{viewAllMasks ? t('insights_showing_all', { count: insights.sortedMasks.length }) : t('insights_showing_top')}</span>
                                    <button onClick={() => setViewAllMasks(!viewAllMasks)} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700 transition-colors">{viewAllMasks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{viewAllMasks ? 'Show Less' : 'View All'}</button>
                                </div>
                            </div>
                            <div className="overflow-y-auto flex-1 custom-scrollbar">
                                <table className="w-full text-left">
                                    <thead className="text-xs text-slate-500 uppercase bg-slate-950/50 border-b border-slate-800 sticky top-0 backdrop-blur-sm">
                                        <tr>
                                            <th className="p-3 pl-6">{t('insights_col_rank')}</th>
                                            <th className="p-3">{t('insights_col_pattern')}</th>
                                            <th className="p-3 text-right">{t('insights_col_complexity')}</th>
                                            <th className="p-3 text-right">{t('insights_col_time')} ({session.hashrate > 0 ? (session.hashrate/1e6).toFixed(0) + 'MH/s' : '1GH/s'})</th>
                                            <th className="p-3 text-right">{t('insights_col_occurrence')}</th>
                                            <th className="p-3 text-right">{t('insights_col_action')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {(insights.sortedMasks || []).slice(0, viewAllMasks ? undefined : 10).map((data, idx) => {
                                            return (
                                            <tr key={data.mask} className="hover:bg-slate-800/30 transition-colors text-sm group">
                                                <td className="p-3 pl-6 font-mono text-slate-500">#{idx+1}</td>
                                                <td className="p-3 font-mono text-indigo-300">{data.mask}</td>
                                                <td className="p-3 text-right font-mono text-slate-400 text-xs">{formatKeyspace(data.complexity)}</td>
                                                <td className="p-3 text-right font-mono text-slate-400 text-xs">{formatTime(data.timeToCrack)}</td>
                                                <td className="p-3 text-right font-bold text-slate-200">{data.count}</td>
                                                <td className="p-3 text-right">
                                                    <button onClick={() => handleRunMaskAttack(data.mask)} className="p-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded transition-colors opacity-0 group-hover:opacity-100" title="Run Attack with this mask"><PlayCircle size={16} /></button>
                                                </td>
                                            </tr>
                                        )})}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                                <div className="flex items-center gap-2 mb-4 shrink-0"><GitBranch size={18} className="text-pink-400"/><h3 className="font-bold text-slate-200">{t('insights_top_prefixes')}</h3></div>
                                <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar"><div className="space-y-2">{(insights.topPrefixes || []).map(([prefix, count], idx) => (<div key={idx} className="relative group flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800/50"><div className="flex items-center gap-2"><span className="font-mono text-pink-300">{prefix}</span><span className="text-slate-500">({count})</span></div><button onClick={() => handleCopyPattern(prefix, 'Prefix')} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-pink-400"><Copy size={12}/></button></div>))}</div></div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                                <div className="flex items-center gap-2 mb-4 shrink-0"><ArrowLeftRight size={18} className="text-cyan-400"/><h3 className="font-bold text-slate-200">{t('insights_top_suffixes')}</h3></div>
                                <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar"><div className="space-y-2">{(insights.topSuffixes || []).map(([suffix, count], idx) => (<div key={idx} className="relative group flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800/50"><div className="flex items-center gap-2"><span className="font-mono text-cyan-300">{suffix}</span><span className="text-slate-500">({count})</span></div><button onClick={() => handleCopyPattern(suffix, 'Suffix')} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-cyan-400"><Copy size={12}/></button></div>))}</div></div>
                            </div>
                        </div>

                        {/* --- SESSION HISTORY SECTION --- */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-0 flex flex-col h-auto">
                            <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between shrink-0">
                                <h3 className="font-bold text-slate-200 flex items-center gap-2"><Database size={16} className="text-slate-400" /> {t('insights_history_title')}</h3>
                                <span className="text-xs text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{t('insights_history_total', { count: pastSessions.length })}</span>
                            </div>
                            
                            {pastSessions.length === 0 ? (
                                <div className="p-8 text-center text-slate-500 text-sm italic">{t('insights_history_none')}</div>
                            ) : (
                                <div className="flex-1 custom-scrollbar max-h-[600px] overflow-y-auto">
                                    {Object.entries(groupedHistory).map(([algoName, sessions]) => {
                                        const isGraphOpenInGroup = sessions.some(s => s.id === expandedSessionId);
                                        return (
                                            <div key={algoName} className="border-b border-slate-800 last:border-0">
                                                <button 
                                                    onClick={() => toggleGroup(algoName)}
                                                    className="w-full flex items-center justify-between p-3 bg-slate-900 hover:bg-slate-800/80 transition-colors text-left"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {openHistoryGroups[algoName] ? <ChevronUp size={14} className="text-slate-500"/> : <ChevronDown size={14} className="text-slate-500"/>}
                                                        <span className="font-bold text-sm text-slate-200">{algoName}</span>
                                                        <span className="text-xs text-slate-500 px-1.5 py-0.5 bg-slate-800 rounded-full">{sessions.length}</span>
                                                    </div>
                                                </button>
                                                
                                                {openHistoryGroups[algoName] && (
                                                    <div className={`bg-slate-950/30 overflow-y-auto custom-scrollbar transition-all duration-300 ${isGraphOpenInGroup ? 'max-h-[600px]' : 'max-h-[240px]'}`}>
                                                        <table className="w-full text-left">
                                                            <thead className="text-[10px] text-slate-600 uppercase bg-slate-950/20 border-b border-slate-800/50">
                                                                <tr>
                                                                    <th className="p-2 pl-8">{t('insights_hist_col_date')}</th>
                                                                    <th className="p-2">{t('insights_hist_col_attack')}</th>
                                                                    <th className="p-2 text-right">{t('insights_hist_col_hashrate')}</th>
                                                                    <th className="p-2 text-right">{t('insights_hist_col_energy')}</th>
                                                                    <th className="p-2 text-right">{t('insights_hist_col_recovered')}</th>
                                                                    <th className="p-2 text-right">{t('insights_hist_col_duration')}</th>
                                                                    <th className="p-2 text-center">{t('insights_hist_col_actions')}</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-800/30 text-xs">
                                                                {sessions.map((s) => {
                                                                    const stats = getSessionStats(s);
                                                                    return (
                                                                    <React.Fragment key={s.id}>
                                                                        <tr className={`transition-colors ${expandedSessionId === s.id ? 'bg-indigo-900/20 border-l-2 border-indigo-500' : 'hover:bg-slate-800/30'}`}>
                                                                            <td className="p-2 pl-8 text-slate-400">{new Date(s.date).toLocaleString()}</td>
                                                                            <td className="p-2 text-indigo-300 font-mono truncate max-w-[150px]" title={s.attackType}>{s.attackType}</td>
                                                                            <td className="p-2 text-right font-mono text-slate-400">{(s.avgHashrate / 1000000).toFixed(2)} MH/s</td>
                                                                            <td className="p-2 text-right font-mono text-amber-500 flex items-center justify-end gap-1">
                                                                                {formatEnergy(s.powerUsage, s.duration)} <Zap size={10} />
                                                                            </td>
                                                                            <td className="p-2 text-right text-emerald-400 font-bold">{s.recovered} / {s.totalHashes}</td>
                                                                            <td className="p-2 text-right text-slate-400"><Clock size={10} className="inline mr-1" />{formatTime(s.duration)}</td>
                                                                            <td className="p-2 text-center flex items-center justify-center gap-1">
                                                                                <button 
                                                                                    onClick={() => toggleSessionGraph(s.id)}
                                                                                    className={`p-1.5 rounded transition-colors ${expandedSessionId === s.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-700 text-slate-500 hover:text-indigo-400'}`}
                                                                                    title="View Efficiency Graph"
                                                                                >
                                                                                    <BarChart2 size={14} />
                                                                                </button>
                                                                                {s.analysis && (
                                                                                    <button 
                                                                                        onClick={() => loadSessionSnapshot(s)} 
                                                                                        className="p-1.5 hover:bg-slate-700 text-slate-500 hover:text-white rounded transition-colors"
                                                                                        title="Load Full Snapshot"
                                                                                    >
                                                                                        <Eye size={14} />
                                                                                    </button>
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                        {expandedSessionId === s.id && (
                                                                            <tr ref={activeGraphRef} className="bg-slate-900/80 border-b border-slate-800/50 animate-in fade-in slide-in-from-top-2 duration-200">
                                                                                <td colSpan={7} className="p-4">
                                                                                    <div className="flex flex-col md:flex-row gap-4 h-[260px]">
                                                                                        {/* Metadata Sidebar */}
                                                                                        <div className="md:w-1/3 flex flex-col gap-2 h-full">
                                                                                            <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50 flex items-center justify-between flex-1">
                                                                                                <div className="flex items-center gap-2 text-slate-500">
                                                                                                    <Cpu size={14} /> <span className="text-xs uppercase font-bold">Algorithm</span>
                                                                                                </div>
                                                                                                <span className="text-slate-200 font-mono text-xs">{stats.algo}</span>
                                                                                            </div>
                                                                                            <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50 flex items-center justify-between flex-1">
                                                                                                <div className="flex items-center gap-2 text-slate-500">
                                                                                                    <Sparkles size={14} /> <span className="text-xs uppercase font-bold">Mode</span>
                                                                                                </div>
                                                                                                <span className="text-slate-200 font-mono text-xs">{stats.mode}</span>
                                                                                            </div>
                                                                                            <div className="bg-slate-950/50 p-3 rounded border border-slate-800/50 flex items-center justify-between flex-1">
                                                                                                <div className="flex items-center gap-2 text-slate-500">
                                                                                                    <Timer size={14} /> <span className="text-xs uppercase font-bold">Duration</span>
                                                                                                </div>
                                                                                                <span className="text-slate-200 font-mono text-xs">{stats.duration}</span>
                                                                                            </div>
                                                                                            
                                                                                            {/* Efficiency KPI Card */}
                                                                                            <div className="bg-indigo-900/10 p-3 rounded border border-indigo-500/30 flex items-center justify-between flex-1">
                                                                                                <div className="flex items-center gap-2 text-indigo-400">
                                                                                                    <TrendingUp size={14} /> <span className="text-xs uppercase font-bold">Efficiency</span>
                                                                                                </div>
                                                                                                <div className="text-right">
                                                                                                    <span className="text-white font-mono font-bold text-sm block">{stats.efficiency}</span>
                                                                                                    <span className="text-[10px] text-indigo-300 block">Hashes / Wh</span>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                        
                                                                                        {/* Log Chart Container */}
                                                                                        <div className="md:w-2/3 h-full relative bg-slate-950/50 rounded border border-slate-800/50 p-2">
                                                                                            <div className="absolute top-2 left-3 text-xs font-bold text-slate-500 flex items-center gap-1 z-10">
                                                                                                <BarChart2 size={12}/> Magnitude Comparison (Log Scale)
                                                                                            </div>
                                                                                            <ResponsiveContainer width="100%" height="100%">
                                                                                                <BarChart 
                                                                                                    layout="vertical" 
                                                                                                    data={getSessionChartData(s)} 
                                                                                                    margin={{ top: 30, right: 120, bottom: 20, left: 20 }}
                                                                                                >
                                                                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                                                                                                    <XAxis type="number" scale="log" domain={['dataMin', 'auto']} hide />
                                                                                                    <YAxis 
                                                                                                        type="category" 
                                                                                                        dataKey="name" 
                                                                                                        width={100} 
                                                                                                        tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} 
                                                                                                        tickLine={false} 
                                                                                                        axisLine={false}
                                                                                                    />
                                                                                                    <Tooltip cursor={{ fill: '#334155', opacity: 0.1 }} content={<CustomTooltip />} />
                                                                                                    <Bar dataKey="value" barSize={24} radius={[0, 4, 4, 0]}>
                                                                                                        {getSessionChartData(s).map((entry, index) => (
                                                                                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                                                                                        ))}
                                                                                                        <LabelList dataKey="displayValue" position="right" fill="#cbd5e1" fontSize={12} fontWeight="bold" />
                                                                                                    </Bar>
                                                                                                </BarChart>
                                                                                            </ResponsiveContainer>
                                                                                        </div>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        )}
                                                                    </React.Fragment>
                                                                );})}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Copy size={18} className="text-emerald-400"/><h3 className="font-bold text-slate-200">{t('insights_top_plaintexts')}</h3></div><button onClick={() => handleExportList('top_plaintexts', insights.topPasswords)} className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors"><Download size={14} /></button></div>
                            <div className="space-y-2">{(insights.topPasswords || []).slice(0, 10).map(([pwd, count], i) => (<div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={pwd}>{pwd}</span><span className="text-slate-500">{count}</span></div>))}</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><FileText size={18} className="text-amber-400"/><h3 className="font-bold text-slate-200">{t('insights_top_basewords')}</h3></div><button onClick={() => handleExportList('top_base_words', insights.topBaseWords)} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded transition-colors"><Download size={14} /></button></div>
                            <div className="space-y-2">{(insights.topBaseWords && insights.topBaseWords.length > 0) ? (insights.topBaseWords.slice(0, 10).map(([word, count], i) => (<div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={word}>{word}</span><span className="text-slate-500">{count}</span></div>))) : <div className="text-xs text-slate-600 italic">No base words detected.</div>}</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                            <div className="flex items-center gap-2 mb-4 shrink-0"><BarChart3 size={18} className="text-blue-400"/><h3 className="font-bold text-slate-200">{t('insights_length_dist')}</h3></div>
                            <div className="relative w-full min-w-full overflow-x-auto pb-6 pt-12 px-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent flex-1">
                                <div className="h-full flex items-end gap-1 min-w-full">
                                    {Object.keys(insights.lengthCounts || {}).length > 0 ? (() => {
                                        const lens = Object.keys(insights.lengthCounts).map(Number);
                                        const min = Math.min(...lens);
                                        const max = Math.max(...lens);
                                        const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);
                                        const counts = Object.values(insights.lengthCounts);
                                        const maxCount = Math.max(...counts, 1);
                                        return range.map((len) => {
                                            const count = insights.lengthCounts[len] || 0;
                                            const h = count > 0 ? Math.max((count / maxCount) * 100, 10) : 2;
                                            return (<div key={len} className="flex flex-col items-center group relative h-full justify-end flex-shrink-0 w-3"><div className={`w-full rounded-t transition-all ${count > 0 ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800/50'}`} style={{ height: `${h}%`, minHeight: count > 0 ? `${h}%` : '4px' }}></div><span className={`text-[9px] mt-1 ${count > 0 ? 'text-slate-400 font-bold' : 'text-slate-700'}`}>{len}</span>{count > 0 && (<div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-[10px] px-2 py-1 rounded border border-slate-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl font-mono">Len {len}: <span className="text-white font-bold">{count}</span></div>)}</div>);
                                        });
                                    })() : <div className="w-full h-full flex items-center justify-center text-xs text-slate-600 absolute left-0">No data</div>}
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex items-center gap-2 mb-6"><PieChart size={18} className="text-purple-400"/><h3 className="font-bold text-slate-200">{t('insights_complexity_dist')}</h3></div>
                            <div className="space-y-4">{Object.entries(insights.charsets || {}).map(([label, count]) => { const pct = insights.total > 0 ? (count / insights.total) * 100 : 0; if (count === 0) return null; return (<div key={label}><div className="flex justify-between text-xs mb-1.5"><span className="text-slate-400">{label}</span><span className="text-slate-200 font-mono">{pct.toFixed(1)}%</span></div><div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${pct}%` }}></div></div></div>); })}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Insights;