import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Microscope, Layers, History, Download, FileDown, FileText, 
  Loader2, ShieldCheck, ChevronUp, ChevronDown, PlayCircle, 
  GitBranch, ArrowLeftRight, Database, Clock, Copy, BarChart3, 
  PieChart, Calculator, X, Sparkles, Info, Zap, Eye, Camera,
  TrendingUp, BarChart2, Cpu, Activity, Timer, AlertTriangle,
  Scale, Trash2, FileCheck, Printer, FileCode, DollarSign,
  Calendar, Hash, Sun, Minus, AlignCenter,
  LayoutGrid, Disc 
} from 'lucide-react';
import { 
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, LabelList, ScatterChart, 
  Scatter, ZAxis, AreaChart, Area, Radar, RadarChart, 
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend
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
    yearPatterns: [string, number][];
    datePatterns: [string, number][];
    delimiters: [string, number][];
    leetspeak: [string, number][];
    positionCounts: {
        lower: number[];
        upper: number[];
        digit: number[];
        special: number[];
    };
    avgEntropy: number;
    total: number;
}

interface PrinceConfig {
    source: 'potfile' | 'upload';
    file: File | null;
    pwMin: number;
    pwMax: number;
    elemMin: number;
    elemMax: number;
    limit: number;
    casePermute: boolean;
    outputName: string;
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
    sortedMasks: [], lengthCounts: {}, charsets: {}, topPasswords: [], 
    topBaseWords: [], topPrefixes: [], topSuffixes: [], yearPatterns: [], 
    datePatterns: [], delimiters: [], leetspeak: [], 
    positionCounts: { lower: [], upper: [], digit: [], special: [] },
    avgEntropy: 0, total: 0
};

// --- Currency Constants ---
const CURRENCIES = [
    { code: 'USD', symbol: '$', name: 'USD ($)' },
    { code: 'EUR', symbol: '€', name: 'EUR (€)' },
    { code: 'GBP', symbol: '£', name: 'GBP (£)' },
    { code: 'RUB', symbol: '₽', name: 'RUB (₽)' },
    { code: 'CNY', symbol: '¥', name: 'CNY (¥)' },
    { code: 'INR', symbol: '₹', name: 'INR (₹)' },
    { code: 'JPY', symbol: '¥', name: 'JPY (¥)' },
    { code: 'KRW', symbol: '₩', name: 'KRW (₩)' },
    { code: 'BRL', symbol: 'R$', name: 'BRL (R$)' },
    { code: 'CAD', symbol: 'C$', name: 'CAD (C$)' },
    { code: 'AUD', symbol: 'A$', name: 'AUD (A$)' },
    { code: 'CHF', symbol: 'Fr', name: 'CHF (Fr)' },
    { code: 'BTC', symbol: '₿', name: 'BTC (₿)' },
];

// --- Helper Functions ---

const formatKeyspace = (num: number) => {
    if (!num) return '0';
    if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
};

const formatTime = (seconds: number) => {
    if (!seconds) return '0s';
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

const calculateCost = (avgWatts: number, durationSeconds: number, ratePerKwh: number) => {
    if (!avgWatts || avgWatts <= 0) return 0;
    const hours = durationSeconds / 3600;
    const kwh = (avgWatts * hours) / 1000;
    return kwh * ratePerKwh;
};

const getMaskFromWord = (word: string) => {
    return word.split('').map(char => {
        if (/[a-z]/.test(char)) return '?l';
        if (/[A-Z]/.test(char)) return '?u';
        if (/[0-9]/.test(char)) return '?d';
        if (/[^a-zA-Z0-9]/.test(char)) return '?s';
        return '?b';
    }).join('');
};

// Fixed Rule Generation
const generateRuleContent = (prefixes: [string, number][], suffixes: [string, number][]) => {
  let content = "## Reactor Generated Rules (PACK Hybrid)\n:\n"; 
  
  if (suffixes && suffixes.length > 0) {
      content += "\n## Top Suffix Appends\n";
      suffixes.forEach(([suffix]) => {
        if (!suffix) return;
        let rule = "";
        for (const char of suffix) { rule += `$${char}`; }
        content += `## Append ${suffix}\n${rule.trim()}\n`;
      });
  }

  if (prefixes && prefixes.length > 0) {
      content += "\n## Top Prefix Prepends\n";
      prefixes.forEach(([prefix]) => {
        if (!prefix) return;
        let rule = "";
        const reversed = prefix.split('').reverse().join('');
        for (const char of reversed) { rule += `^${char}`; }
        content += `## Prepend ${prefix}\n${rule.trim()}\n`;
      });
  }
  
  content += "\n## Common Transformations\n## Capitalize first\nc\n## Toggle Case\nTN\n## Reverse\nr\n";
  return content;
};

// --- WORKER CODE ---
const WORKER_CODE = `
self.onmessage = function(e) {
    const { hashes, targetPps = 10000000000 } = e.data; 
    if (!hashes || hashes.length === 0) {
        self.postMessage({ sortedMasks: [], lengthCounts: {}, charsets: {}, topPasswords: [], topBaseWords: [], topPrefixes: [], topSuffixes: [], yearPatterns: [], datePatterns: [], delimiters: [], leetspeak: [], positionCounts: { lower: [], upper: [], digit: [], special: [] }, avgEntropy: 0, total: 0 });
        return;
    }

    const maskCounts = {};
    const lengthCounts = {};
    const passwordFrequency = {};
    const baseWordFrequency = {};
    const prefixCounts = {};
    const suffixCounts = {};
    const yearCounts = {};
    const dateCounts = {};
    const delimiterCounts = {};
    const subCounts = {};
    
    // Position Analysis Arrays (Max length 16)
    const posLower = new Array(16).fill(0);
    const posUpper = new Array(16).fill(0);
    const posDigit = new Array(16).fill(0);
    const posSpecial = new Array(16).fill(0);

    let totalEntropy = 0;

    const charsets = {
        'Numeric': 0,
        'Lower Alpha': 0,
        'Mixed Alpha': 0,
        'Mixed Alpha-Num': 0,
        'Full Complex': 0
    };

    const leetspeakMap = {
        '@': 'a', '4': 'a', 
        '3': 'e', 
        '1': 'i', '!': 'i', 
        '0': 'o', 
        '$': 's', '5': 's', 
        '7': 't', '+': 't',
        '(': 'c'
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

    // --- Regex Patterns for Dates ---
    const regexYMD = /\\b(19|20)\\d{2}([-/.:_])\\d{1,2}\\2\\d{1,2}\\b/g;
    const regexDMY = /\\b\\d{1,2}([-/.:_])\\d{1,2}\\1(19|20)\\d{2}\\b/g;
    const regexShort = /\\b\\d{1,2}([-/.:_])\\d{1,2}\\1\\d{2}\\b/g;
    const regexCompactYMD = /\\b(19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\b/g;
    const regexCompactShort = /\\b(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{2}\\b/g;

    hashes.forEach(h => {
        let p = h.plain;
        if (!p) return;
        p = parseHashcatHex(p);
        validCount++;
        
        const mask = generateMask(p);
        maskCounts[mask] = (maskCounts[mask] || 0) + 1;
        
        // Base Word Extraction
        const wordMatch = p.match(/[a-zA-Z]{3,}/g);
        if (wordMatch) {
            const longestWord = wordMatch.reduce((a, b) => a.length >= b.length ? a : b);
            const key = longestWord.charAt(0).toUpperCase() + longestWord.slice(1).toLowerCase();
            baseWordFrequency[key] = (baseWordFrequency[key] || 0) + 1;
        }
        
        // Structural
        const structMatch = p.match(/^([^a-zA-Z]*)([a-zA-Z]+.*[a-zA-Z]|[a-zA-Z])([^a-zA-Z]*)$/);
        if (structMatch) {
            const prefix = structMatch[1];
            const suffix = structMatch[3];
            if (prefix) prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
            if (suffix) suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
        }

        // Position Analysis
        for(let i = 0; i < Math.min(p.length, 16); i++) {
            const char = p[i];
            if (/[a-z]/.test(char)) posLower[i]++;
            else if (/[A-Z]/.test(char)) posUpper[i]++;
            else if (/[0-9]/.test(char)) posDigit[i]++;
            else posSpecial[i]++;
        }

        // --- Date Analysis ---
        const matchedDates = [];
        const matchYMD = p.match(regexYMD); if (matchYMD) matchYMD.forEach(d => matchedDates.push(d));
        const matchDMY = p.match(regexDMY); if (matchDMY) matchDMY.forEach(d => matchedDates.push(d));
        const matchShort = p.match(regexShort); if (matchShort) matchShort.forEach(d => matchedDates.push(d));
        const matchCompactYMD = p.match(regexCompactYMD); if (matchCompactYMD) matchCompactYMD.forEach(d => matchedDates.push(d));
        const matchCompactShort = p.match(regexCompactShort); if (matchCompactShort) matchCompactShort.forEach(d => matchedDates.push(d));

        matchedDates.forEach(d => dateCounts[d] = (dateCounts[d] || 0) + 1);

        // Simple Year (fallback if no full date found)
        if (matchedDates.length === 0) {
            const years = p.match(/(?:19|20)\\d{2}/g);
            if (years) years.forEach(y => yearCounts[y] = (yearCounts[y] || 0) + 1);
        }

        // --- Delimiters ---
        const delimiterMatch = p.match(/[a-zA-Z]([-/:.+_!@?])[0-9]/);
        if (delimiterMatch) {
            delimiterCounts[delimiterMatch[1]] = (delimiterCounts[delimiterMatch[1]] || 0) + 1;
        }

        // --- Leetspeak ---
        for (const char of p) {
            if (leetspeakMap[char]) {
                const key = leetspeakMap[char] + ' -> ' + char;
                subCounts[key] = (subCounts[key] || 0) + 1;
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
    
    // Process Patterns
    const yearPatterns = Object.entries(yearCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
    const datePatterns = Object.entries(dateCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
    const delimiters = Object.entries(delimiterCounts).sort(([, a], [, b]) => b - a).slice(0, 10);
    const leetspeak = Object.entries(subCounts).sort(([, a], [, b]) => b - a).slice(0, 15);

    const avgEntropy = validCount > 0 ? totalEntropy / validCount : 0;

    self.postMessage({ 
        sortedMasks, lengthCounts, charsets, topPasswords, topBaseWords, topPrefixes, topSuffixes, 
        yearPatterns, datePatterns, delimiters, leetspeak, 
        positionCounts: { lower: posLower, upper: posUpper, digit: posDigit, special: posSpecial },
        avgEntropy, total: validCount 
    });
};
`;

const Insights: React.FC<InsightsProps> = ({ 
    globalPotfile = [], 
    sessionHashes = [], 
    session, 
    pastSessions = [], 
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
    const [localPastSessions, setLocalPastSessions] = useState<PastSession[]>(pastSessions);
    
    // Export Modal State
    const [exportModal, setExportModal] = useState<{
        isOpen: boolean;
        type: 'plaintexts' | 'basewords' | null;
        data: [string, number][];
        filename: string;
        limit: number;
    }>({ isOpen: false, type: null, data: [], filename: '', limit: 10 });

    // Electricity Cost Config
    const [electricityRate, setElectricityRate] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('reactor_power_rate');
            return saved ? parseFloat(saved) : 0.12;
        } catch(e) { return 0.12; }
    });

    const [currency, setCurrency] = useState<string>(() => {
        return localStorage.getItem('reactor_currency') || 'USD';
    });

    useEffect(() => {
        localStorage.setItem('reactor_power_rate', electricityRate.toString());
    }, [electricityRate]);

    useEffect(() => {
        localStorage.setItem('reactor_currency', currency);
    }, [currency]);

    // Update local state when prop changes
    useEffect(() => {
        setLocalPastSessions(pastSessions);
    }, [pastSessions]);

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

    // --- PRINCE STATE ---
    const [showPrinceModal, setShowPrinceModal] = useState(false);
    const [isPrinceRunning, setIsPrinceRunning] = useState(false);
    const [princeConfig, setPrinceConfig] = useState<PrinceConfig>({
        source: 'potfile',
        file: null,
        pwMin: 0,
        pwMax: 0,
        elemMin: 0,
        elemMax: 0,
        limit: 10000000, 
        casePermute: false,
        outputName: ''
    });

    const workerRef = useRef<Worker | null>(null);
    const scopeRef = useRef(insightScope);

    // --- COMPUTED DATA FOR NEW CHARTS ---

    // 1. Radar Chart Data (Algorithm Efficiency)
    const algorithmRadarData = useMemo(() => {
        if (!localPastSessions || localPastSessions.length === 0) return [];

        const algoGroups: Record<string, { totalHashrate: number, totalPower: number, count: number }> = {};
        
        localPastSessions.forEach(s => {
            if (!s || s.avgHashrate <= 0 || s.powerUsage <= 0) return;
            // Identify Algo Name
            const algoName = HASH_TYPES.find(h => h.id === s.algorithmId)?.name || `Mode ${s.algorithmId}`;
            
            if (!algoGroups[algoName]) algoGroups[algoName] = { totalHashrate: 0, totalPower: 0, count: 0 };
            algoGroups[algoName].totalHashrate += s.avgHashrate;
            algoGroups[algoName].totalPower += s.powerUsage;
            algoGroups[algoName].count++;
        });

        // Calculate Average Efficiency (Hashes per Watt) per algorithm
        return Object.entries(algoGroups).map(([name, data]) => {
            const avgHashrate = data.totalHashrate / data.count;
            const avgPower = data.totalPower / data.count;
            const efficiency = avgPower > 0 ? avgHashrate / avgPower : 0;
            const logEfficiency = efficiency > 0 ? Math.log10(efficiency) : 0;
            return {
                subject: name,
                A: logEfficiency,
                fullValue: efficiency
            };
        });
    }, [localPastSessions]);

    // 2. Cumulative Growth Data (Area Chart)
    const cumulativeGrowthData = useMemo(() => {
        if (!localPastSessions || localPastSessions.length === 0) return [];
        const sorted = [...localPastSessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let runningTotal = 0;
        return sorted.map(s => {
            runningTotal += s.recovered;
            return {
                date: new Date(s.date).toLocaleDateString(),
                total: runningTotal,
                sessionValue: s.recovered
            };
        });
    }, [localPastSessions]);

    // --- PRINCE Risk Calculation ---
    const princeRisk = useMemo(() => {
        let riskLevel: 'SAFE' | 'WARN' | 'DANGER' = 'SAFE';
        let message = "Configuration looks good. Output size is controlled.";
        
        // If unlimited limit
        if (princeConfig.limit === 0) {
            // Check elements
            if (princeConfig.elemMax > 3 || princeConfig.elemMax === 0) {
                riskLevel = 'DANGER';
                message = "CRITICAL: You have no output limit and high element combination. This will likely fill your disk space completely.";
            } else {
                riskLevel = 'WARN';
                message = "Warning: No output limit set. Result file might be very large.";
            }
        } else if (princeConfig.limit > 100000000) {
            riskLevel = 'WARN';
            message = "Output limit is very high (>100M lines). Ensure you have disk space.";
        }
        
        return { level: riskLevel, message };
    }, [princeConfig]);

    useEffect(() => {
        scopeRef.current = insightScope;
    }, [insightScope]);

    // --- Computed Data ---
    const hashesToAnalyze = useMemo(() => {
        if (insightScope === 'session') return sessionHashes || [];
        if (insightScope === 'all') return globalPotfile || [];
        return []; 
    }, [insightScope, sessionHashes, globalPotfile]);

    // Grouped History
    const groupedHistory = useMemo(() => {
        const groups: Record<string, PastSession[]> = {};
        if (!localPastSessions) return groups;
        localPastSessions.forEach(s => {
            const algoName = HASH_TYPES.find(h => h.id === s.algorithmId)?.name || `Mode ${s.algorithmId}`;
            if (!groups[algoName]) groups[algoName] = [];
            groups[algoName].push(s);
        });
        return groups;
    }, [localPastSessions]);

    // --- Effects ---
    useEffect(() => {
        try {
            const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
            workerRef.current = new Worker(URL.createObjectURL(blob));
            workerRef.current.onmessage = (e) => {
                if (scopeRef.current === 'historical_snapshot') return;
                setInsights(e.data);
                setIsAnalyzing(false);
            };
        } catch (e) { console.error("Worker initialization failed", e); }
        return () => { workerRef.current?.terminate(); };
    }, []);

    useEffect(() => {
        if (workerRef.current && (insightScope === 'all' || insightScope === 'session')) {
            setIsAnalyzing(true);
            workerRef.current.postMessage({ 
                hashes: hashesToAnalyze,
                targetPps: session && session.hashrate > 0 ? session.hashrate : 1000000000 
            });
        }
    }, [hashesToAnalyze, session, insightScope]);

    useEffect(() => {
        if (showMaskModal && config) {
            detectHashrateForAlgo(config.hashType);
        }
    }, [showMaskModal, config]);

    // Auto-scroll to graph when opened
    useEffect(() => {
        if (expandedSessionId && activeGraphRef.current) {
            activeGraphRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [expandedSessionId]);

    // --- Handlers ---
    const detectHashrateForAlgo = (algoId: string) => {
        const matchingSessions = (localPastSessions || []).filter(s => s.algorithmId === algoId && s.avgHashrate > 0);
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
        } else if (config && config.hashType === algoId && session && session.hashrate > 0) {
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

    const handleGeneratePrince = async () => {
        if (princeConfig.limit === 0 && (princeConfig.elemMax > 4 || princeConfig.elemMax === 0)) {
            const confirm = window.confirm("WARNING: You have selected High Elements with NO LIMIT. This will likely crash the server or fill your disk. Are you sure?");
            if (!confirm) return;
        }

        setIsPrinceRunning(true);
        const formData = new FormData();
        
        formData.append('source', princeConfig.source);
        if (princeConfig.source === 'upload' && princeConfig.file) {
            formData.append('wordlist', princeConfig.file);
        }
        
        if (princeConfig.pwMin > 0) formData.append('pwMin', princeConfig.pwMin.toString());
        if (princeConfig.pwMax > 0) formData.append('pwMax', princeConfig.pwMax.toString());
        if (princeConfig.elemMin > 0) formData.append('elemMin', princeConfig.elemMin.toString());
        if (princeConfig.elemMax > 0) formData.append('elemMax', princeConfig.elemMax.toString());
        if (princeConfig.limit > 0) formData.append('limit', princeConfig.limit.toString());
        formData.append('casePermute', princeConfig.casePermute.toString());
        if (princeConfig.outputName) formData.append('outputName', princeConfig.outputName);

        try {
            const response = await fetch('http://localhost:3001/api/tools/prince', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                addLog('general', `PRINCE Generated: ${data.filename}`, 'SUCCESS');
                window.location.href = `http://localhost:3001${data.downloadUrl}`;
                setShowPrinceModal(false);
            } else {
                addLog('general', `PRINCE Failed: ${data.message}`, 'ERROR');
            }
        } catch (e: any) {
            addLog('general', `PRINCE Error: ${e.message}`, 'ERROR');
        } finally {
            setIsPrinceRunning(false);
        }
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

    const handleGenerateSemanticRules = () => {
        let content = "## Reactor Semantic Rules (Hybrid Pattern Based)\n\n";
        if (insights.datePatterns && insights.datePatterns.length > 0) {
            content += "## Detected Full Date Appends\n";
            insights.datePatterns.forEach(([date]) => {
                let rule = "";
                for (const char of date) { rule += `$${char}`; }
                content += `## Append ${date}\n${rule.trim()}\n`;
            });
            content += "\n";
        }
        if (insights.yearPatterns && insights.yearPatterns.length > 0) {
            content += "## Detected Year Appends\n";
            insights.yearPatterns.forEach(([year]) => {
                let rule = "";
                for (const char of year) { rule += `$${char}`; }
                content += `## Append ${year}\n${rule.trim()}\n`;
            });
            content += "\n";
        }
        if (insights.delimiters && insights.delimiters.length > 0) {
            content += "## Detected Delimiters\n";
            insights.delimiters.forEach(([delim]) => {
                content += `## Append ${delim}\n$${delim}\n`;
                content += `## Prepend ${delim}\n^${delim}\n`;
            });
            content += "\n";
        }
        if (insights.leetspeak && insights.leetspeak.length > 0) {
            content += "## Detected Leetspeak Substitutions\n";
            insights.leetspeak.forEach(([key]) => {
                const parts = key.split(' -> ');
                if (parts.length === 2) {
                    const original = parts[0];
                    const replacement = parts[1];
                    content += `## Sub ${original} for ${replacement}\ns${original}${replacement}\n`;
                }
            });
            content += "\n";
        }
        content += "## Common Cleanup\n## Capitalize\nc\n";

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `semantic_rules_${Date.now()}.rule`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('general', 'Downloaded semantic rule file', 'SUCCESS');
    };

    const handleGenerateSemanticMasks = () => {
        const masks = new Set<string>();
        const dateMasks = new Set<string>();
        
        // 1. Collect Date/Year Masks
        const dates = [...(insights.datePatterns || []), ...(insights.yearPatterns || [])];
        dates.forEach(([date]) => {
             // Simple digit replacement for semantic dates
             const mask = date.replace(/[0-9]/g, '?d'); 
             dateMasks.add(mask);
             masks.add(mask); 
        });

        // 2. Collect Base Word Masks
        const baseWordMasks = new Set<string>();
        if (insights.topBaseWords) {
            insights.topBaseWords.slice(0, 50).forEach(([word]) => {
                const mask = getMaskFromWord(word);
                baseWordMasks.add(mask);
            });
        }

        // 3. Generate Combinations: BaseWord + Date
        baseWordMasks.forEach(baseMask => {
            dateMasks.forEach(dateMask => {
                masks.add(baseMask + dateMask);
            });
        });

        if (masks.size === 0) {
            addLog('general', 'No semantic patterns found to generate masks.', 'WARN');
            return;
        }

        const content = Array.from(masks).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `semantic_hybrid_masks_${Date.now()}.hcmask`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog('general', `Downloaded ${masks.size} semantic hybrid masks`, 'SUCCESS');
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

    const handleExportList = (type: 'plaintexts' | 'basewords', list: [string, number][]) => {
        if (list.length === 0) { addLog('general', `No data to export.`, 'WARN'); return; }
        
        setExportModal({
            isOpen: true,
            type: type,
            data: list,
            filename: type === 'plaintexts' ? 'top_plaintexts' : 'top_base_words',
            limit: 10
        });
    };

    const handleConfirmExport = () => {
        if (!exportModal.data || exportModal.data.length === 0) return;
        
        const count = exportModal.limit > 0 ? exportModal.limit : exportModal.data.length;
        const slicedList = exportModal.data.slice(0, count);

        const content = slicedList.map(([item]) => item).join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${exportModal.filename}_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        addLog('general', `Exported ${slicedList.length} items to ${exportModal.filename}.txt`, 'SUCCESS');
        setExportModal({ ...exportModal, isOpen: false });
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const toggleSessionGraph = (sessionId: string) => {
        if (expandedSessionId === sessionId) {
            setExpandedSessionId(null);
        } else {
            setExpandedSessionId(sessionId);
        }
    };

    // --- Delete Session ---
    const handleDeleteSession = async (sessionId: string) => {
        if (!window.confirm("Are you sure you want to delete this session? This action cannot be undone.")) return;
        
        try {
            const response = await fetch('http://localhost:3001/api/session/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
            const data = await response.json();
            if (data.success) {
                // Instantly update local state to reflect deletion
                setLocalPastSessions(prev => prev.filter(s => s.id !== sessionId));
                addLog('general', `Session ${sessionId} deleted.`, 'SUCCESS');
            } else {
                addLog('general', `Failed to delete session: ${data.message}`, 'ERROR');
            }
        } catch (e: any) {
            addLog('general', `Error deleting session: ${e.message}`, 'ERROR');
        }
    };

    // --- Helpers for Currency ---
    const getCurrencySymbol = (currCode: string) => {
        const found = CURRENCIES.find(c => c.code === currCode);
        return found ? found.symbol : '$';
    };

    // --- Export Report ---
    const handleExportReport = (session: PastSession, format: 'html' | 'pdf') => {
        const stats = getSessionStats(session);
        const chartData = getSessionChartData(session);
        const totalCost = calculateCost(session.powerUsage, session.duration, electricityRate);
        const costPerHash = session.recovered > 0 ? (totalCost / session.recovered) : 0;
        const symbol = getCurrencySymbol(currency);
        
        // Calculate max value for log scale approximation
        const maxValue = Math.max(...chartData.map(d => d.value));
        
        // Generate CSS Chart Bars HTML
        const chartHtml = chartData.map(d => {
            const logVal = Math.log10(d.value > 0 ? d.value : 1);
            const logMax = Math.log10(maxValue > 0 ? maxValue : 1);
            let widthPct = logMax > 0 ? (logVal / logMax) * 100 : 0;
            if (widthPct < 5) widthPct = 5; 
            return `
            <div class="chart-row">
                <div class="chart-label">${d.name}</div>
                <div class="chart-bar-container">
                    <div class="chart-bar" style="width: ${widthPct}%; background-color: ${d.fill};"></div>
                    <span class="chart-value">${d.displayValue}</span>
                </div>
            </div>`;
        }).join('');

        const reportHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Reactor Session Report - ${session.id}</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #fff; color: #1e293b; line-height: 1.6; padding: 40px; max-width: 900px; margin: 0 auto; }
                    header { border-bottom: 2px solid #6366f1; padding-bottom: 20px; margin-bottom: 40px; display: flex; justify-content: space-between; align-items: flex-end; }
                    h1 { margin: 0; color: #0f172a; font-size: 28px; }
                    .meta { color: #64748b; font-size: 14px; margin-top: 5px; }
                    .section { margin-bottom: 40px; }
                    h2 { font-size: 18px; text-transform: uppercase; color: #6366f1; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; letter-spacing: 0.5px; }
                    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
                    .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
                    .stat-label { font-size: 12px; text-transform: uppercase; font-weight: bold; color: #94a3b8; margin-bottom: 5px; }
                    .stat-value { font-size: 24px; font-weight: bold; color: #0f172a; font-family: monospace; }
                    .tag { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; background: #e2e8f0; color: #475569; }
                    .tag.success { background: #dcfce7; color: #166534; }
                    table { w-full; border-collapse: collapse; margin-top: 10px; width: 100%; }
                    th { text-align: left; font-size: 12px; text-transform: uppercase; color: #64748b; padding: 10px; border-bottom: 1px solid #e2e8f0; }
                    td { padding: 10px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
                    
                    /* Chart Styles */
                    .chart-container { margin-top: 20px; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; }
                    .chart-row { display: flex; align-items: center; margin-bottom: 15px; }
                    .chart-label { width: 120px; font-size: 12px; font-weight: bold; color: #64748b; }
                    .chart-bar-container { flex: 1; display: flex; align-items: center; gap: 10px; }
                    .chart-bar { height: 24px; border-radius: 4px; min-width: 5px; }
                    .chart-value { font-size: 12px; font-family: monospace; font-weight: bold; color: #0f172a; }

                    .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
                    @media print { 
                        body { padding: 0; } 
                        .no-print { display: none; }
                        /* Ensure background colors print for chart bars */
                        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    }
                </style>
            </head>
            <body>
                <header>
                    <div>
                        <h1>Session Audit Report</h1>
                        <div class="meta">Generated by Reactor on ${new Date().toLocaleString()}</div>
                    </div>
                    <div style="text-align: right">
                        <div class="stat-label">Session ID</div>
                        <div style="font-family: monospace; font-weight: bold;">${session.id}</div>
                    </div>
                </header>

                <div class="section">
                    <h2>Configuration Details</h2>
                    <div class="grid">
                        <div class="stat-box">
                            <div class="stat-label">Target Algorithm</div>
                            <div class="stat-value" style="font-size: 18px">${stats.algo}</div>
                            <div style="margin-top: 10px"><span class="tag">Mode ${session.algorithmId}</span></div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">Attack Configuration</div>
                            <div class="stat-value" style="font-size: 18px">${stats.mode}</div>
                            <div style="margin-top: 10px"><span class="tag">Attack Mode ${session.attackMode}</span></div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>Performance Metrics</h2>
                    <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
                        <div class="stat-box">
                            <div class="stat-label">Duration</div>
                            <div class="stat-value">${stats.duration}</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">Avg Hashrate</div>
                            <div class="stat-value">${(session.avgHashrate / 1000000).toFixed(2)} MH/s</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">Total Recovered</div>
                            <div class="stat-value" style="color: #166534">${session.recovered}</div>
                        </div>
                    </div>
                    <div class="grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 20px;">
                        <div class="stat-box">
                            <div class="stat-label">Energy Used</div>
                            <div class="stat-value">${formatEnergy(session.powerUsage, session.duration)}</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">Total Cost</div>
                            <div class="stat-value" style="color: #10b981">${symbol}${totalCost.toFixed(2)}</div>
                            <div style="font-size: 10px; color: #64748b">@ ${symbol}${electricityRate}/kWh</div>
                        </div>
                        <div class="stat-box">
                            <div class="stat-label">Cost / Hash</div>
                            <div class="stat-value">${symbol}${costPerHash.toFixed(6)}</div>
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>Efficiency Analysis (Log Scale)</h2>
                    <div class="chart-container">
                        ${chartHtml}
                    </div>
                </div>

                ${session.analysis ? `
                <div class="section">
                    <h2>Cryptanalysis Snapshot</h2>
                    <div class="grid">
                         <div class="stat-box">
                             <div class="stat-label">Entropy Score</div>
                             <div class="stat-value">${session.analysis.avgEntropy.toFixed(2)} bits</div>
                         </div>
                         <div class="stat-box">
                             <div class="stat-label">Most Common Mask</div>
                             <div class="stat-value" style="font-size: 18px">${session.analysis.sortedMasks.length > 0 ? session.analysis.sortedMasks[0].mask : 'N/A'}</div>
                         </div>
                    </div>
                    <div style="margin-top: 20px">
                        <h3>Top Recovered Plaintexts</h3>
                        <table>
                            <thead><tr><th>Plaintext</th><th style="text-align: right">Count</th></tr></thead>
                            <tbody>
                                ${session.analysis.topPasswords.slice(0, 5).map(([pwd, cnt]) => `<tr><td style="font-family: monospace">${pwd}</td><td style="text-align: right">${cnt}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                ` : ''}

                <div class="footer">
                    Reactor Hashcat GUI &bull; Confidential &bull; Do Not Distribute
                </div>
                ${format === 'pdf' ? '<script>window.onload = function() { window.print(); }</script>' : ''}
            </body>
            </html>
        `;

        if (format === 'html') {
            const blob = new Blob([reportHtml], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `report_${session.id}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            addLog('general', 'Report downloaded as HTML.', 'SUCCESS');
        } else {
            // PDF Mode: Open new window and trigger print
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(reportHtml);
                printWindow.document.close();               
                addLog('general', 'Opened report for printing/PDF.', 'INFO');
            } else {
                addLog('general', 'Pop-up blocked. Could not open print window.', 'WARN');
            }
        }
    };

    const getSessionChartData = (s: PastSession) => {
        const hours = s.duration / 3600;
        const wattHours = s.powerUsage * hours;
        const hashrateMh = s.avgHashrate / 1000000;
        
        return [
            {
                name: 'Hashrate (MH/s)',
                value: hashrateMh > 0 ? hashrateMh : 0.1, 
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

            {/* Export Configuration Modal */}
            {exportModal.isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                            <h3 className="font-bold text-slate-200 flex items-center gap-2">
                                <Download size={18} className="text-indigo-400" /> Export Configuration
                            </h3>
                            <button onClick={() => setExportModal({...exportModal, isOpen: false})} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-5">
                             <div className="text-sm text-slate-400">
                                Exporting <strong>{exportModal.type === 'plaintexts' ? 'Top Plaintexts' : 'Top Base Words'}</strong>.
                                <br/>
                                <span className="text-xs text-slate-500">Total available: {exportModal.data.length} items.</span>
                             </div>

                             <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">Download Limit (Default 10)</label>
                                <input 
                                    type="number" 
                                    value={exportModal.limit} 
                                    onChange={(e) => setExportModal({...exportModal, limit: parseInt(e.target.value) || 0})} 
                                    className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" 
                                    min="1" 
                                    max={exportModal.data.length}
                                    placeholder="Enter limit..."
                                />
                                <div className="text-[10px] text-slate-500 text-right">0 = Download All ({exportModal.data.length})</div>
                             </div>

                             <div className="flex gap-2 pt-2">
                                 <button onClick={() => setExportModal({...exportModal, isOpen: false})} className="flex-1 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors">Cancel</button>
                                 <button onClick={handleConfirmExport} className="flex-1 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors">Download</button>
                             </div>
                        </div>
                    </div>
                </div>
            )}

            {/* PRINCE Generator Modal */}
            {showPrinceModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                            <h3 className="font-bold text-slate-200 flex items-center gap-2">
                                <Zap size={18} className="text-amber-400" /> PRINCE Wordlist Generator
                            </h3>
                            <button onClick={() => setShowPrinceModal(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            
                            {/* Alert / Risk Meter */}
                            {princeRisk.level !== 'SAFE' && (
                                <div className={`p-3 rounded-lg flex items-start gap-3 border ${princeRisk.level === 'DANGER' ? 'bg-red-500/10 border-red-500/50 text-red-200' : 'bg-amber-500/10 border-amber-500/50 text-amber-200'}`}>
                                    <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                                    <div className="text-xs">
                                        <div className="font-bold uppercase mb-1">{princeRisk.level === 'DANGER' ? 'Disk Usage Critical' : 'High Output Warning'}</div>
                                        {princeRisk.message}
                                    </div>
                                </div>
                            )}

                            {/* Source Selection */}
                            <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">1. Input Source (Seed)</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={() => setPrinceConfig({...princeConfig, source: 'potfile'})}
                                        className={`p-3 rounded border text-sm font-medium transition-all ${princeConfig.source === 'potfile' ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                                    >
                                        Use Potfile ({globalPotfile.length} Words)
                                    </button>
                                    <button 
                                        onClick={() => setPrinceConfig({...princeConfig, source: 'upload'})}
                                        className={`p-3 rounded border text-sm font-medium transition-all ${princeConfig.source === 'upload' ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' : 'bg-slate-950 border-slate-800 text-slate-400'}`}
                                    >
                                        Upload Wordlist
                                    </button>
                                </div>
                                {princeConfig.source === 'upload' && (
                                    <input 
                                        type="file" 
                                        onChange={(e) => setPrinceConfig({...princeConfig, file: e.target.files?.[0] || null})}
                                        className="w-full text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded p-2"
                                    />
                                )}
                            </div>

                            {/* Chain Constraints (Generator) */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-xs uppercase font-bold text-slate-500">2. Chain Configuration (Generative)</label>
                                    <div className="group relative">
                                        <Info size={12} className="text-slate-600 hover:text-slate-400 cursor-help" />
                                        <div className="absolute right-0 bottom-full mb-2 w-48 p-2 bg-slate-800 border border-slate-700 text-[10px] text-slate-300 rounded shadow-xl hidden group-hover:block z-50">
                                            Combines words from the input list. Increasing Max Elements causes exponential growth in file size.
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Min Elements</span>
                                        <input type="number" placeholder="Min (Default 1)" value={princeConfig.elemMin || ''} onChange={(e) => setPrinceConfig({...princeConfig, elemMin: parseInt(e.target.value)})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Max Elements</span>
                                        <input type="number" placeholder="Max (Default 8)" value={princeConfig.elemMax || ''} onChange={(e) => setPrinceConfig({...princeConfig, elemMax: parseInt(e.target.value)})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Filters (Restrictive) */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-xs uppercase font-bold text-slate-500">3. Output Filters (Restrictive)</label>
                                    <div className="group relative">
                                        <Info size={12} className="text-slate-600 hover:text-slate-400 cursor-help" />
                                        <div className="absolute right-0 bottom-full mb-2 w-48 p-2 bg-slate-800 border border-slate-700 text-[10px] text-slate-300 rounded shadow-xl hidden group-hover:block z-50">
                                            Only saves generated passwords that match these length rules. Helps reduce file size.
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Min Length</span>
                                        <input type="number" placeholder="0 (Any)" value={princeConfig.pwMin || ''} onChange={(e) => setPrinceConfig({...princeConfig, pwMin: parseInt(e.target.value)})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Max Length</span>
                                        <input type="number" placeholder="0 (Any)" value={princeConfig.pwMax || ''} onChange={(e) => setPrinceConfig({...princeConfig, pwMax: parseInt(e.target.value)})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Safety & Output */}
                            <div className="space-y-2">
                                <label className="text-xs uppercase font-bold text-slate-500">4. Safety & Output</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-[10px] text-slate-400">Line Limit (Safety Stop)</span>
                                            {princeConfig.limit === 0 && <span className="text-[10px] text-red-400 font-bold">UNLIMITED</span>}
                                        </div>
                                        <input type="number" placeholder="0 = Unlimited" value={princeConfig.limit || ''} onChange={(e) => setPrinceConfig({...princeConfig, limit: parseInt(e.target.value)})} className={`bg-slate-950 border rounded p-2 text-slate-200 w-full focus:ring-1 outline-none ${princeConfig.limit === 0 ? 'border-amber-500/50 focus:ring-amber-500' : 'border-slate-800 focus:ring-indigo-500'}`} />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-slate-400">Filename</span>
                                        <input type="text" placeholder="prince_output.txt" value={princeConfig.outputName} onChange={(e) => setPrinceConfig({...princeConfig, outputName: e.target.value})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Options */}
                            <div className="space-y-3 pt-2">
                                <label className="flex items-center gap-3 p-3 bg-slate-950 border border-slate-800 rounded cursor-pointer hover:border-slate-700 transition-colors">
                                    <input type="checkbox" checked={princeConfig.casePermute} onChange={(e) => setPrinceConfig({...princeConfig, casePermute: e.target.checked})} className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-indigo-500/50" />
                                    <div>
                                        <div className="text-sm font-bold text-slate-300">Case Permutation</div>
                                        <div className="text-xs text-slate-500">Permute first letter case (apple &rarr; Apple)</div>
                                    </div>
                                </label>
                            </div>

                            <button 
                                onClick={handleGeneratePrince} 
                                disabled={isPrinceRunning}
                                className={`w-full font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 mt-2 disabled:opacity-50 ${princeRisk.level === 'DANGER' ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                            >
                                {isPrinceRunning ? <Loader2 className="animate-spin" size={18} /> : <Cpu size={18} />}
                                {isPrinceRunning ? 'Running Processor...' : 'Generate Wordlist'}
                            </button>
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
                    <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 mr-4">
                        <span className="text-[10px] text-slate-500 font-bold uppercase px-2">Power Rate</span>
                        <div className="flex items-center gap-1">
                            <select 
                                value={currency} 
                                onChange={(e) => setCurrency(e.target.value)} 
                                className="bg-transparent text-xs text-slate-400 font-bold outline-none cursor-pointer border-none p-0 w-16 text-right"
                            >
                                {CURRENCIES.map(c => (
                                    <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                                ))}
                            </select>
                            <input 
                                type="number" 
                                value={electricityRate} 
                                onChange={(e) => setElectricityRate(parseFloat(e.target.value) || 0)} 
                                className="w-12 bg-transparent text-xs text-white font-mono outline-none border-b border-slate-700 focus:border-indigo-500"
                                step="0.01"
                            />
                            <span className="text-slate-500 text-[10px]">/kWh</span>
                        </div>
                    </div>

                    <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center">
                        <button onClick={() => setInsightScope('all')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><Layers size={14} /> {t('insights_btn_all')}</button>
                        <button onClick={() => setInsightScope('session')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'session' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><History size={14} /> {t('insights_btn_session')}</button>
                        {insightScope === 'historical_snapshot' && <button disabled className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold bg-amber-600 text-white shadow ml-1"><Camera size={14} /> {t('insights_btn_snapshot')}</button>}
                    </div>
                    <div className="flex gap-2">
                        {/* PRINCE Button */}
                        <button 
                            onClick={() => setShowPrinceModal(true)} 
                            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" 
                            title="Generate PRINCE Wordlist"
                        >
                            <Zap size={14} /> PRINCE
                        </button>

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
                    <div className="lg:col-span-2 flex flex-col gap-6 h-full">
                        
                        {/* LEFT COLUMN */}
                        
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
                                            <th className="p-3 text-right">{t('insights_col_time')} ({session && session.hashrate > 0 ? (session.hashrate/1e6).toFixed(0) + 'MH/s' : '1GH/s'})</th>
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
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-0 flex flex-col flex-1">
                            <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between shrink-0">
                                <h3 className="font-bold text-slate-200 flex items-center gap-2"><Database size={16} className="text-slate-400" /> {t('insights_history_title')}</h3>
                                <span className="text-xs text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{t('insights_history_total', { count: (localPastSessions || []).length })}</span>
                            </div>

                            {/* CUMULATIVE GROWTH (AREA CHART) */}
                            {localPastSessions && localPastSessions.length > 2 && (
                                <div className="h-48 w-full border-b border-slate-800 bg-slate-950/20 p-2">
                                     <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={cumulativeGrowthData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <XAxis dataKey="date" hide />
                                            <YAxis hide />
                                            <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} itemStyle={{ color: '#e2e8f0', fontSize: '12px' }} />
                                            <Area type="monotone" dataKey="total" stroke="#10b981" fillOpacity={1} fill="url(#colorTotal)" strokeWidth={2} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                    <div className="text-center text-[10px] text-emerald-500/50 uppercase font-bold -mt-4 relative z-10">Cumulative Recovered Growth</div>
                                </div>
                            )}
                            
                            {(!localPastSessions || localPastSessions.length === 0) ? (
                                <div className="p-8 text-center text-slate-500 text-sm italic">{t('insights_history_none')}</div>
                            ) : (
                                <div className="flex-1 custom-scrollbar overflow-y-auto min-h-[300px]">
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
                                                                    <th className="p-2 text-right">Cost</th>
                                                                    <th className="p-2 text-right">{t('insights_hist_col_recovered')}</th>
                                                                    <th className="p-2 text-right">{t('insights_hist_col_duration')}</th>
                                                                    <th className="p-2 text-center">{t('insights_hist_col_actions')}</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-800/30 text-xs">
                                                                {sessions.map((s) => {
                                                                    const stats = getSessionStats(s);
                                                                    const sessionCost = calculateCost(s.powerUsage, s.duration, electricityRate);
                                                                    return (
                                                                    <React.Fragment key={s.id}>
                                                                        <tr className={`transition-colors ${expandedSessionId === s.id ? 'bg-indigo-900/20 border-l-2 border-indigo-500' : 'hover:bg-slate-800/30'}`}>
                                                                            <td className="p-2 pl-8 text-slate-400">{new Date(s.date).toLocaleString()}</td>
                                                                            <td className="p-2 text-indigo-300 font-mono truncate max-w-[150px]" title={s.attackType}>{s.attackType}</td>
                                                                            <td className="p-2 text-right font-mono text-slate-400">{(s.avgHashrate / 1000000).toFixed(2)} MH/s</td>
                                                                            <td className="p-2 text-right font-mono text-amber-500 flex items-center justify-end gap-1">
                                                                                {formatEnergy(s.powerUsage, s.duration)} <Zap size={10} />
                                                                            </td>
                                                                            <td className="p-2 text-right font-mono text-emerald-400">
                                                                                {getCurrencySymbol(currency)}{sessionCost.toFixed(2)}
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
                                                                                <button 
                                                                                    onClick={() => handleExportReport(s, 'html')}
                                                                                    className="p-1.5 hover:bg-slate-700 text-slate-500 hover:text-cyan-400 rounded transition-colors"
                                                                                    title="Download HTML Report"
                                                                                >
                                                                                    <FileCode size={14} />
                                                                                </button>
                                                                                <button 
                                                                                    onClick={() => handleExportReport(s, 'pdf')}
                                                                                    className="p-1.5 hover:bg-slate-700 text-slate-500 hover:text-purple-400 rounded transition-colors"
                                                                                    title="Print / Save as PDF"
                                                                                >
                                                                                    <Printer size={14} />
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
                                                                                <button 
                                                                                    onClick={() => handleDeleteSession(s.id)}
                                                                                    className="p-1.5 hover:bg-red-900/30 text-slate-500 hover:text-red-400 rounded transition-colors ml-1"
                                                                                    title="Delete Session"
                                                                                >
                                                                                    <Trash2 size={14} />
                                                                                </button>
                                                                            </td>
                                                                        </tr>
                                                                        {expandedSessionId === s.id && (
                                                                            <tr ref={activeGraphRef} className="bg-slate-900/80 border-b border-slate-800/50 animate-in fade-in slide-in-from-top-2 duration-200">
                                                                                <td colSpan={8} className="p-4">
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
                                                                                                <div className="flex items-center gap-2 text-emerald-400">
                                                                                                    <DollarSign size={14} /> <span className="text-xs uppercase font-bold">Cost / Hash</span>
                                                                                                </div>
                                                                                                <span className="text-white font-mono font-bold text-xs">
                                                                                                    {getCurrencySymbol(currency)}{s.recovered > 0 ? (sessionCost / s.recovered).toFixed(6) : '0.00'}
                                                                                                </span>
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

                    {/* RIGHT COLUMN */}

                    <div className="space-y-6">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Copy size={18} className="text-emerald-400"/><h3 className="font-bold text-slate-200">{t('insights_top_plaintexts')}</h3></div><button onClick={() => handleExportList('plaintexts', insights.topPasswords)} className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors"><Download size={14} /></button></div>
                            <div className="space-y-2">{(insights.topPasswords || []).slice(0, 10).map(([pwd, count], i) => (<div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={pwd}>{pwd}</span><span className="text-slate-500">{count}</span></div>))}</div>
                        </div>
                        
                        {/* Semantic Patterns */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2"><Activity size={18} className="text-orange-400"/><h3 className="font-bold text-slate-200">Semantic Analysis</h3></div>
                                <div className="flex gap-1">
                                    {insights.total > 0 && (
                                        <>
                                            <button 
                                                onClick={handleGenerateSemanticMasks}
                                                className="text-[10px] flex items-center gap-1 bg-indigo-900/20 hover:bg-indigo-600 text-indigo-400 hover:text-white px-2 py-1 rounded border border-indigo-500/30 transition-colors"
                                                title="Generate Hybrid Masks (.hcmask) for detected dates/years"
                                            >
                                                <Calculator size={10} /> Generate Masks
                                            </button>
                                            <button 
                                                onClick={handleGenerateSemanticRules}
                                                className="text-[10px] flex items-center gap-1 bg-orange-900/20 hover:bg-orange-600 text-orange-400 hover:text-white px-2 py-1 rounded border border-orange-500/30 transition-colors"
                                                title="Generate Rules (.rule) for detected patterns"
                                            >
                                                <FileDown size={10} /> Generate Rules
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                {/* Date Patterns */}
                                <div className="col-span-2 md:col-span-1">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-1"><Calendar size={10} /> Full Date Patterns</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {insights.datePatterns && insights.datePatterns.length > 0 ? (
                                            insights.datePatterns.slice(0, 5).map(([date, count]) => (
                                                <span key={date} className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono" title={`${count} occurrences`}>
                                                    {date} <span className="text-slate-500 text-[10px]">({count})</span>
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-xs text-slate-600 italic">No full dates found.</span>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Year Patterns */}
                                <div className="col-span-2 md:col-span-1">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-1"><Clock size={10} /> Years Detected</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {insights.yearPatterns && insights.yearPatterns.length > 0 ? (
                                            insights.yearPatterns.slice(0, 5).map(([year, count]) => (
                                                <span key={year} className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono" title={`${count} occurrences`}>
                                                    {year} <span className="text-slate-500 text-[10px]">({count})</span>
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-xs text-slate-600 italic">No years found.</span>
                                        )}
                                    </div>
                                </div>

                                {/* Delimiters */}
                                <div className="col-span-2 md:col-span-1">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-1"><Minus size={10} /> Delimiters</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {insights.delimiters && insights.delimiters.length > 0 ? (
                                            insights.delimiters.slice(0, 5).map(([delim, count]) => (
                                                <span key={delim} className="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono font-bold" title={`${count} occurrences`}>
                                                    {delim}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-xs text-slate-600 italic">No delimiters found.</span>
                                        )}
                                    </div>
                                </div>

                                {/* Leetspeak */}
                                <div className="col-span-2 md:col-span-1">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center gap-1"><Hash size={10} /> Leetspeak Patterns</div>
                                    <div className="flex flex-wrap gap-1.5">
                                         {insights.leetspeak.slice(0, 5).map(([l,c]) => (
                                            <span key={l} className="text-[10px] bg-orange-900/20 text-orange-400 px-1.5 rounded border border-orange-800/30">{l} ({c})</span>
                                         ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><FileText size={18} className="text-amber-400"/><h3 className="font-bold text-slate-200">{t('insights_top_basewords')}</h3></div><button onClick={() => handleExportList('basewords', insights.topBaseWords)} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded transition-colors"><Download size={14} /></button></div>
                            <div className="mb-2 text-xs text-slate-500 italic px-1">Detected Recurring Words (Names, Places, Seasons, etc.)</div>
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

                        {/* CHART #5: ALGORITHM EFFICIENCY RADAR (MOVED HERE) */}
                        {algorithmRadarData.length > 2 && (
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col items-center">
                                <div className="flex items-center gap-2 mb-4 w-full">
                                    <Activity size={18} className="text-rose-400"/>
                                    <h3 className="font-bold text-slate-200">Algorithm Efficiency Comparison</h3>
                                </div>
                                <div className="h-64 w-full max-w-md">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart cx="50%" cy="50%" outerRadius="65%" data={algorithmRadarData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
                                            <PolarGrid stroke="#334155" />
                                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                            <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                                            <Radar name="Efficiency (Log Scale)" dataKey="A" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.6} />
                                            <Tooltip content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const d = payload[0].payload;
                                                    return (
                                                        <div className="bg-slate-900 border border-slate-700 p-2 rounded shadow-xl text-xs">
                                                            <div className="font-bold text-rose-400 mb-1">{d.subject}</div>
                                                            <div className="text-slate-300">Hashes/Watt: {d.fullValue.toFixed(0)}</div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }} />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-2 text-center">Comparing Hashes per Watt (Log Scale) across different algorithms</div>
                            </div>
                        )}

                    </div>
                </div>
            )}
        </div>
    );
};

export default Insights;