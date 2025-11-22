import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, RotateCcw, Terminal, LayoutDashboard, 
  Globe, Zap, ShieldCheck, Hash, Settings, 
  Link, Unlink, Loader2, Activity, FileUp, 
  Microscope, PieChart, BarChart3, Copy, Download, FileDown,
  Square, RefreshCw, ChevronDown, ChevronUp, 
  PlayCircle, GitBranch, ArrowLeftRight, FileText, Layers, History, FileType
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { SessionStats, SessionStatus, LogEntry, HistoryPoint, HashcatConfig, RecoveredHash } from './types';
import { INITIAL_SESSION, DEFAULT_CONFIG, HASH_TYPES } from './constants';
import LogTerminal from './components/LogTerminal';
import InteractiveTerminal from './components/InteractiveTerminal';
import CpuChart from './components/CpuChart';
import ConfigPanel from './components/ConfigPanel';
import EscrowDashboard from './components/EscrowDashboard';
import RecoveredHashList from './components/RecoveredHashList';

const uuid = () => Math.random().toString(36).substring(2, 9);

// --- WORKER CODE: Hybrid Analysis ---
const WORKER_CODE = `
self.onmessage = function(e) {
    const { hashes } = e.data;
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
        'Numeric (?d)': 0,
        'Lower Alpha (?l)': 0,
        'Mixed Alpha (?l?u)': 0,
        'Alpha-Numeric (?l?d)': 0,
        'Complex (?a)': 0
    };

    let validCount = 0;

    // --- Helpers inside Worker ---
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
        
        // 1. Mask
        const mask = generateMask(p);
        maskCounts[mask] = (maskCounts[mask] || 0) + 1;
        
        // 2. Hybrid Analysis (Prefix / Root / Suffix)
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

        // 3. Length
        lengthCounts[p.length] = (lengthCounts[p.length] || 0) + 1;
        
        // 4. Frequencies
        passwordFrequency[p] = (passwordFrequency[p] || 0) + 1;
        totalEntropy += calculateEntropy(p);
        
        // 5. Complexity
        if (/^\\d+$/.test(p)) charsets['Numeric (?d)']++;
        else if (/^[a-z]+$/.test(p)) charsets['Lower Alpha (?l)']++;
        else if (/^[a-zA-Z]+$/.test(p)) charsets['Mixed Alpha (?l?u)']++;
        else if (/^[a-zA-Z0-9]+$/.test(p)) charsets['Alpha-Numeric (?l?d)']++;
        else charsets['Complex (?a)']++;
    });

    // Sorting
    const sortedMasks = Object.entries(maskCounts).sort(([, a], [, b]) => b - a).slice(0, 1000);
    const topPasswords = Object.entries(passwordFrequency).sort(([, a], [, b]) => b - a).slice(0, 50);
    const topBaseWords = Object.entries(baseWordFrequency).sort(([, a], [, b]) => b - a).slice(0, 50);
    const topPrefixes = Object.entries(prefixCounts).sort(([, a], [, b]) => b - a).slice(0, 20);
    const topSuffixes = Object.entries(suffixCounts).sort(([, a], [, b]) => b - a).slice(0, 20);
    const avgEntropy = validCount > 0 ? totalEntropy / validCount : 0;

    self.postMessage({ sortedMasks, lengthCounts, charsets, topPasswords, topBaseWords, topPrefixes, topSuffixes, avgEntropy, total: validCount });
};
`;

// --- Helper Functions ---
const getMaskKeyspace = (mask: string) => {
    if (!mask) return 0;
    let keyspace = 1;
    for (let i = 0; i < mask.length; i += 2) {
        const char = mask.substring(i, i+2);
        switch(char) {
            case '?l': keyspace *= 26; break; 
            case '?u': keyspace *= 26; break; 
            case '?d': keyspace *= 10; break; 
            case '?s': keyspace *= 33; break; 
            case '?a': keyspace *= 95; break; 
            case '?b': keyspace *= 256; break; 
            default: keyspace *= 1; break;
        }
    }
    return keyspace;
};

const formatKeyspace = (num: number) => {
    if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
};

// --- Rule Generation Helper ---
const generateRuleContent = (prefixes: [string, number][], suffixes: [string, number][]) => {
  let content = "# Reactor Generated Rules\n:\n"; 

  // Generate Append Rules ($)
  (suffixes || []).forEach(([suffix]) => {
    if (!suffix) return;
    let rule = "";
    for (const char of suffix) {
      rule += `$${char} `;
    }
    content += `${rule.trim()} # Appends ${suffix}\n`;
  });

  // Generate Prepend Rules (^)
  (prefixes || []).forEach(([prefix]) => {
    if (!prefix) return;
    // "!" -> ^!
    // Reverse logic for prepend to maintain order when applying rules
    let rule = "";
    const reversed = prefix.split('').reverse().join('');
    for (const char of reversed) {
      rule += `^${char} `;
    }
    content += `${rule.trim()} # Prepends ${prefix}\n`;
  });

  return content;
};

interface InsightsData {
    sortedMasks: [string, number][];
    lengthCounts: Record<number, number>;
    charsets: Record<string, number>;
    topPasswords: [string, number][];
    topBaseWords: [string, number][];
    topPrefixes: [string, number][];
    topSuffixes: [string, number][];
    avgEntropy: number;
    total: number;
}

const INITIAL_INSIGHTS: InsightsData = {
    sortedMasks: [], lengthCounts: {}, charsets: {}, topPasswords: [], topBaseWords: [], topPrefixes: [], topSuffixes: [], avgEntropy: 0, total: 0
};

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'insights' | 'terminal' | 'escrow' | 'config'>('dashboard');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('hashes_apikey') || '');
  const [config, setConfig] = useState<HashcatConfig>(DEFAULT_CONFIG);
  const [backendConnected, setBackendConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [session, setSession] = useState<SessionStats>(INITIAL_SESSION);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: uuid(), timestamp: new Date(), level: 'INFO', message: '[SYSTEM] Reactor initialized. Waiting for backend...' }
  ]);
  
  const [recoveredHashes, setRecoveredHashes] = useState<(RecoveredHash & { isNew?: boolean })[]>([]);
  const [viewAllMasks, setViewAllMasks] = useState(false);
  const [escrowSubmissionData, setEscrowSubmissionData] = useState<string>('');
  const [escrowSubmissionAlgo, setEscrowSubmissionAlgo] = useState<string>('');
  const [manualTargetInput, setManualTargetInput] = useState('');
  const [manualTargetFile, setManualTargetFile] = useState<File | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [restoreMode, setRestoreMode] = useState(false); 
  const [hasSeenAggregate, setHasSeenAggregate] = useState(false);
  const [insights, setInsights] = useState<InsightsData>(INITIAL_INSIGHTS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Insight Scope State
  const [insightScope, setInsightScope] = useState<'all' | 'session'>('all');

  const sessionCracks = useMemo(() => recoveredHashes.filter(h => h.isNew), [recoveredHashes]);
  const newHashesCount = useMemo(() => sessionCracks.filter(h => !h.sentToEscrow).length, [sessionCracks]);

  const hashesToAnalyze = useMemo(() => {
      return insightScope === 'session' ? sessionCracks : recoveredHashes;
  }, [insightScope, sessionCracks, recoveredHashes]);

  useEffect(() => { localStorage.setItem('hashes_apikey', apiKey); }, [apiKey]);

  // --- Worker Initialization ---
  useEffect(() => {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));
    
    workerRef.current.onmessage = (e) => {
        setInsights(e.data);
        setIsAnalyzing(false);
    };

    return () => { workerRef.current?.terminate(); };
  }, []);

  // --- Trigger Analysis ---
  useEffect(() => {
    if (workerRef.current) {
        setIsAnalyzing(true);
        workerRef.current.postMessage({ hashes: hashesToAnalyze });
    }
  }, [hashesToAnalyze]);

  useEffect(() => {
    try {
      const socket = io('http://localhost:3001', { reconnection: true });
      socket.on('connect', () => { setBackendConnected(true); addLog('[SYSTEM] Connected to Backend.', 'SUCCESS'); });
      socket.on('disconnect', () => { setBackendConnected(false); addLog('[SYSTEM] Disconnected from Backend.', 'ERROR'); });
      
      socket.on('log', (data: { level: string, message: string }) => {
          addLog(data.message, data.level as LogEntry['level']);
          const match = data.message.match(/Recovered\.+:\s*(\d+)\/(\d+)/);
          if (match) {
             const recovered = parseInt(match[1], 10);
             const total = parseInt(match[2], 10);
             if (!isNaN(recovered) && !isNaN(total)) {
                 setSession(prev => ({ ...prev, recovered, total }));
             }
          }
      });
      
      socket.on('potfile_sync', (data: RecoveredHash[]) => {
          const historicalData = data.map(h => ({ ...h, isNew: false }));
          setRecoveredHashes(historicalData); 
          addLog(`[SYSTEM] Loaded ${data.length} hashes from potfile.`, 'INFO');
      });

      socket.on('session_status', (newStatus: string) => {
         if (newStatus === 'RUNNING') setStatus(SessionStatus.RUNNING);
         if (newStatus === 'PAUSED') setStatus(SessionStatus.PAUSED);
         if (newStatus === 'IDLE' || newStatus === 'COMPLETED') {
            setStatus(SessionStatus.IDLE);
            setHasSeenAggregate(false);
         }
      });

      socket.on('stats_update', (data: { type: string, value: any, isAggregate?: boolean }) => {
        if (data.type === 'hashrate') {
             if (data.isAggregate) {
                 setHasSeenAggregate(true);
                 setSession(prev => ({ ...prev, hashrate: data.value }));
             } else {
                 setHasSeenAggregate(prev => {
                     if (!prev) setSession(s => ({ ...s, hashrate: data.value }));
                     return prev;
                 });
             }
        }
        else if (data.type === 'progress') setSession(prev => ({ ...prev, progress: data.value }));
        else if (data.type === 'recovered') setSession(prev => ({ ...prev, recovered: data.value }));
        else if (data.type === 'total') setSession(prev => ({ ...prev, total: data.value }));
        else if (data.type === 'time_estimated') setSession(prev => ({ ...prev, estimatedTimeRemaining: data.value }));
      });

      socket.on('crack', (data: { hash: string, plain: string }) => {
          setRecoveredHashes(prev => {
              if (prev.some(h => h.hash === data.hash)) return prev;
              return [{
                  id: uuid(),
                  hash: data.hash,
                  plain: data.plain,
                  algorithmId: config.hashType,
                  timestamp: Date.now(),
                  sentToEscrow: false,
                  isNew: true 
              }, ...prev];
          });
      });

      socketRef.current = socket;
      return () => { socket.disconnect(); };
    } catch (e) { console.warn("Socket connection failed", e); }
  }, [config.hashType]);

  const addLog = (message: string, level: LogEntry['level'] = 'INFO') => {
    setLogs(prev => [...prev.slice(-99), { id: uuid(), timestamp: new Date(), level, message }]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setManualTargetFile(file);
      setSession(prev => ({ ...prev, target: file.name }));
      setManualTargetInput(''); 
    }
  };

  const handleManualTargetLoad = async () => {
    if (manualTargetFile && (manualTargetFile as any).path) {
        const name = manualTargetFile.name;
        setSession(prev => ({ ...prev, target: name, progress: 0, recovered: 0 }));
        addLog(`Target Set: ${name}`, 'CMD');
    } else if (manualTargetInput) {
        const count = manualTargetInput.split('\n').filter(l => l.trim()).length;
        setSession(prev => ({ ...prev, target: "Manual Input", total: count, progress: 0, recovered: 0 }));
        addLog(`Target Set: Manual Input (${count} lines)`, 'CMD');
    } else {
        addLog('No target provided.', 'WARN');
    }
  };

  const handleSendToEscrow = (hashes: RecoveredHash[] = sessionCracks) => {
      const newHashes = hashes.filter(h => !h.sentToEscrow);
      if (newHashes.length === 0) {
        addLog("No new hashes to send to escrow.", "WARN");
        return;
      }
      const content = newHashes.map(h => `${h.hash}:${h.plain}`).join('\n');
      setEscrowSubmissionData(content);
      setEscrowSubmissionAlgo(config.hashType); 
      setRecoveredHashes(prev => prev.map(h => newHashes.some(nh => nh.id === h.id) ? { ...h, sentToEscrow: true } : h));
      setActiveTab('escrow');
      addLog(`Prepared ${newHashes.length} new hashes for escrow.`, 'INFO');
  };

  const handleExportList = (filename: string, list: [string, number][]) => {
      if (list.length === 0) { addLog(`No data to export for ${filename}`, 'WARN'); return; }
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
      addLog(`Exported ${list.length} items to ${filename}.txt`, 'SUCCESS');
  };

  const handleDownloadMasks = () => {
    if (insights.sortedMasks.length === 0) return;
    const content = insights.sortedMasks.map(([mask]) => mask).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generated_${Date.now()}.hcmask`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog('Downloaded .hcmask file', 'SUCCESS');
  };

  // --- NEW: Download Rules ---
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
    addLog('Downloaded generated .rule file', 'SUCCESS');
  };

  // --- NEW: Download Plaintext Wordlist ---
  const handleExportWordlist = () => {
    if (!hashesToAnalyze || hashesToAnalyze.length === 0) {
        addLog('No hashes to export', 'WARN');
        return;
    }
    
    // Extract unique plaintexts
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
    addLog(`Exported ${uniquePlains.size} unique passwords as wordlist`, 'SUCCESS');
  };

  const handleRunMaskAttack = (mask: string) => {
    setConfig(prev => ({
      ...prev,
      attackMode: 3, // Brute Force
      mask: mask,
      maskFile: '',
      wordlistPath: '',
      wordlistPath2: ''
    }));
    setActiveTab('dashboard');
    addLog(`Configured Brute Force attack with mask: ${mask}`, 'CMD');
  };
  
  const handleCopyPattern = (text: string, type: 'Prefix' | 'Suffix') => {
      navigator.clipboard.writeText(text);
      addLog(`Copied ${type}: ${text}`, 'INFO');
  };

  const handleExportSessionCracks = () => {
    if (sessionCracks.length === 0) { addLog('No session cracks to export.', 'WARN'); return; }
    const content = sessionCracks.map(h => `${h.hash}:${h.plain}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_cracks_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog(`Exported ${sessionCracks.length} cracks to .txt`, 'SUCCESS');
  };

  useEffect(() => {
    if (backendConnected && status === SessionStatus.RUNNING) {
       const interval = setInterval(() => {
          setHistory(h => [...h.slice(-59), { timestamp: Date.now(), hashrate: session.hashrate / 1000000, temp: 0 }]);
       }, 1000);
       return () => clearInterval(interval);
    }
  }, [backendConnected, status, session.hashrate]);

  const toggleSession = async (overrideCommand?: string) => {
    if (status === SessionStatus.RUNNING || status === SessionStatus.PAUSED) {
      if (backendConnected) {
         await fetch('http://localhost:3001/api/session/stop', { method: 'POST' });
         setStatus(SessionStatus.IDLE); 
      }
    } else {
      if (!backendConnected) { addLog("Backend disconnected.", "ERROR"); return; }
      setIsStarting(true);
      setHasSeenAggregate(false);
      setActiveTab('dashboard');
      
      try {
        let targetPath = '';
        let payload = {};
        if (restoreMode) {
            payload = { restore: true };
            addLog(`Attempting restore from previous session...`, 'CMD');
        } else {
            if (manualTargetFile && (manualTargetFile as any).path) {
                targetPath = (manualTargetFile as any).path;
                addLog(`Using Target: ${targetPath}`, 'INFO');
            } else if (manualTargetInput) {
                const res = await fetch('http://localhost:3001/api/target', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: manualTargetInput })
                });
                const data = await res.json();
                targetPath = data.path;
            }
            payload = overrideCommand ? { customCommand: overrideCommand } : { ...config, targetPath };
        }
        const res = await fetch('http://localhost:3001/api/session/start', { 
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).message);
      } catch (e: any) {
        addLog(`Start Error: ${e.message}`, 'ERROR');
        setStatus(SessionStatus.IDLE);
      } finally {
        setIsStarting(false);
      }
    }
  };

  const resetSession = () => {
    setStatus(SessionStatus.IDLE);
    setSession({...INITIAL_SESSION, target: session.target});
    setHistory([]);
    setRecoveredHashes([]);
    setManualTargetInput('');
    setManualTargetFile(null);
    addLog("UI Reset.", 'WARN');
  };

  const MetricCard = ({ label, value, subValue, icon: Icon, color }: any) => (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl backdrop-blur-sm relative overflow-hidden group hover:border-slate-700 transition-all min-h-[120px]">
      <div className={`absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity text-${color}-500 rotate-12`}><Icon size={100} /></div>
      <div className="relative z-10">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1">{label}</p>
        <h3 className="text-2xl font-bold text-slate-100 font-mono truncate">{value}</h3>
        {subValue && <p className={`text-xs mt-2 font-medium ${color === 'emerald' ? 'text-emerald-400' : 'text-slate-400'}`}>{subValue}</p>}
      </div>
    </div>
  );

  const NavButton = ({ id, icon: Icon, label }: any) => (
    <button onClick={() => setActiveTab(id)} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === id ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}>
      <Icon size={20} /><span className="ml-3 hidden lg:block font-medium">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans">
      <aside className="w-20 lg:w-64 border-r border-slate-800 flex flex-col bg-slate-950 z-50 fixed h-full lg:relative">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center"><Hash className="text-white" size={20} /></div>
          <span className="ml-3 font-bold text-lg hidden lg:block">Reactor</span>
        </div>
        <nav className="p-4 flex-1">
          <NavButton id="dashboard" icon={LayoutDashboard} label="Dashboard" />
          <NavButton id="insights" icon={Microscope} label="Insights (PACK)" />
          <NavButton id="escrow" icon={Globe} label="Escrow Jobs" />
          <NavButton id="config" icon={Settings} label="Configuration" />
          <NavButton id="terminal" icon={Terminal} label="Terminal" />
        </nav>
        <div className="p-4 border-t border-slate-800 hidden lg:block">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {backendConnected ? <Link size={14} className="text-emerald-500" /> : <Unlink size={14} className="text-red-500" />}
            <span>{backendConnected ? 'Bridge Connected' : 'Bridge Offline'}</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden ml-20 lg:ml-0 relative">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-950/80 backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xs text-slate-400 font-bold uppercase">Active Target</h1>
                <span className="text-slate-100 font-mono text-sm">{session.target}</span>
              </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={resetSession} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg" title="Reset UI"><RotateCcw size={18} /></button>

            {status === SessionStatus.IDLE && (
              <div className="flex items-center gap-3 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button 
                     onClick={() => setRestoreMode(!restoreMode)}
                     className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${restoreMode ? 'bg-amber-500/20 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
                     title="Toggle Restore Mode"
                  >
                      <RefreshCw size={14} />
                      {restoreMode ? 'Restore Mode' : 'New Session'}
                  </button>

                  <button 
                    onClick={() => toggleSession()}
                    disabled={isStarting || !backendConnected}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm transition-all ${restoreMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                  >
                    {isStarting ? <Loader2 size={16} className="animate-spin"/> : <Play size={16} />}
                    {restoreMode ? 'Restore' : 'Start'}
                  </button>
              </div>
            )}

            {(status === SessionStatus.RUNNING || status === SessionStatus.PAUSED) && (
               <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                   <button 
                      onClick={() => toggleSession()}
                      className="flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                   >
                      <Square size={14} fill="currentColor" />
                      Stop
                   </button>
               </div>
            )}

          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-8xl mx-auto space-y-6 h-full">
            
            {activeTab === 'dashboard' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricCard label="Hashrate" value={`${(session.hashrate / 1000000).toFixed(2)} MH/s`} subValue="Total Speed" icon={Zap} color="indigo" />
                  <MetricCard label="Recovered" value={`${session.recovered} / ${session.total}`} subValue={`${session.total > 0 ? Math.min(((session.recovered / session.total) * 100), 100).toFixed(2) : 0}% of Total`} icon={ShieldCheck} color="emerald" />
                  <MetricCard label="Mode" value={HASH_TYPES.find(h => h.id === config.hashType)?.name || config.hashType} subValue={`Mode -m ${config.hashType}`} icon={Hash} color="slate" />
                  <MetricCard label="Progress" value={`${session.progress.toFixed(2)}%`} subValue={session.estimatedTimeRemaining} icon={Activity} color="blue" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-80 min-h-[20rem]">
                  <div className="lg:col-span-2 h-full min-h-0 rounded-xl overflow-hidden">
                    <CpuChart data={history} color="#6366f1" title="Hashrate Performance (MH/s)" dataKey="hashrate" unit="M" />
                  </div>
                  <div className="h-full min-h-0 rounded-xl overflow-hidden">
                    <LogTerminal logs={logs} />
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:h-[32rem]">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-full">
                        <div className="flex items-center gap-2 mb-4 shrink-0">
                            <FileUp size={18} className="text-indigo-400" />
                            <h3 className="text-sm font-bold text-slate-200">Target Configuration</h3>
                        </div>
                        <div className="flex flex-col gap-4">
                             <div className="flex gap-4 shrink-0 h-12">
                                <label className={`flex-1 flex items-center justify-center border border-dashed rounded-lg cursor-pointer transition-colors ${manualTargetFile ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300' : 'border-slate-700 hover:bg-slate-800/50 text-slate-400'}`}>
                                    <span className="text-xs font-medium truncate px-2">
                                        {manualTargetFile ? manualTargetFile.name : 'Choose File...'}
                                    </span>
                                    <input type="file" className="hidden" onChange={handleFileChange} />
                                </label>
                                <button onClick={handleManualTargetLoad} disabled={!manualTargetInput && !manualTargetFile} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 rounded-lg text-sm font-bold transition-colors">Set Target</button>
                             </div>
                             <div className="relative text-center shrink-0">
                                 <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                                 <div className="relative"><span className="bg-slate-900 px-2 text-xs text-slate-500 font-bold">OR PASTE HASHES</span></div>
                             </div>
                             <div className="relative group h-60">
                                <textarea value={manualTargetInput} onChange={(e) => { setManualTargetInput(e.target.value); if(e.target.value) setManualTargetFile(null); }} placeholder="Paste target hashes here (one per line)..." className="w-full h-full bg-slate-950/50 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 resize-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"/>
                             </div>
                        </div>
                    </div>

                    <div className="flex flex-col relative h-full bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden">
                        <div className="absolute top-3 right-4 z-50 flex items-center gap-2">
                             <button onClick={handleExportSessionCracks} disabled={sessionCracks.length === 0} className="flex items-center gap-2 text-xs h-8 px-3 rounded transition-colors border font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"><FileDown size={14} /> Export .txt</button>
                             <button onClick={() => handleSendToEscrow(sessionCracks)} disabled={newHashesCount === 0} className={`flex items-center gap-2 text-xs h-8 px-3 rounded transition-colors border font-medium shadow-sm ${newHashesCount > 0 ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-50'}`}><Globe size={14} /> {newHashesCount > 0 ? 'Send New' : 'All Sent'}</button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                           <RecoveredHashList hashes={sessionCracks} />
                       </div>
                    </div>
                </div>
              </>
            )}

            {activeTab === 'insights' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                          <Microscope className="text-indigo-500" /> PACK Analysis
                          {isAnalyzing && <Loader2 className="animate-spin text-slate-500" size={18} />}
                        </h2>
                        <p className="text-slate-500 text-sm mt-1">
                            Insights generated from <span className="text-slate-200 font-bold">{insights.total}</span> {insightScope === 'session' ? 'session' : 'total'} entries.
                        </p>
                    </div>
                    
                    {/* Insight Scope & Actions */}
                    <div className="flex items-center gap-6">
                        <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center">
                            <button 
                                onClick={() => setInsightScope('all')} 
                                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                <Layers size={14} /> All Time
                            </button>
                            <button 
                                onClick={() => setInsightScope('session')} 
                                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'session' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                <History size={14} /> Current Session
                            </button>
                        </div>
                        
                        {/* Export Toolbar */}
                        <div className="flex gap-2">
                            {insights.total > 0 && (
                                <button onClick={handleDownloadMasks} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download .hcmask">
                                    <Download size={14} /> Masks
                                </button>
                            )}
                            {insights.total > 0 && (
                                <button onClick={handleDownloadRules} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-pink-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download .rule">
                                    <FileDown size={14} /> Rules
                                </button>
                            )}
                            {insights.total > 0 && (
                                <button onClick={handleExportWordlist} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download Plaintext Wordlist">
                                    <FileText size={14} /> Wordlist
                                </button>
                            )}
                        </div>

                        <div className="text-right border-l border-slate-800 pl-4 hidden xl:block">
                            <div className="text-3xl font-mono font-bold text-amber-400">{insights.avgEntropy.toFixed(1)}</div>
                            <div className="text-xs text-slate-500 uppercase font-bold">Avg Entropy (Bits)</div>
                        </div>
                    </div>
                  </div>

                  {insights.total === 0 && !isAnalyzing ? (
                     <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center">
                         <Microscope size={48} className="text-slate-700 mb-4" />
                         <h3 className="text-slate-300 font-bold">No Data Available</h3>
                         <p className="text-slate-500 mt-2">
                             {insightScope === 'session' ? "No cracks in this session yet." : "Potfile is empty."}
                         </p>
                     </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 flex flex-col gap-6">
                          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[800px] flex-1">
                            <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between shrink-0">
                                <h3 className="font-bold text-slate-200 flex items-center gap-2"><ShieldCheck size={16} className="text-indigo-400" /> Top Masks (Hybrid)</h3>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{viewAllMasks ? `Showing All (${Object.keys(insights.sortedMasks).length})` : 'Showing Top 15'}</span>
                                    <button onClick={() => setViewAllMasks(!viewAllMasks)} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700 transition-colors">{viewAllMasks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{viewAllMasks ? 'Show Less' : 'View All'}</button>
                                </div>
                            </div>
                            <div className="overflow-y-auto flex-1">
                                <table className="w-full text-left">
                                    <thead className="text-xs text-slate-500 uppercase bg-slate-950/50 border-b border-slate-800 sticky top-0 backdrop-blur-sm"><tr><th className="p-3 pl-6">Rank</th><th className="p-3">Mask Pattern</th><th className="p-3 text-right">Keyspace</th><th className="p-3 text-right">Hit Count</th><th className="p-3 text-right">Action</th></tr></thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {(insights.sortedMasks || []).slice(0, viewAllMasks ? undefined : 15).map(([mask, count], idx) => {
                                            const keyspace = getMaskKeyspace(mask);
                                            return (
                                            <tr key={mask} className="hover:bg-slate-800/30 transition-colors text-sm group">
                                                <td className="p-3 pl-6 font-mono text-slate-500">#{idx+1}</td>
                                                <td className="p-3 font-mono text-indigo-300">{mask}</td>
                                                <td className="p-3 text-right font-mono text-slate-400 text-xs">{formatKeyspace(keyspace)}</td>
                                                <td className="p-3 text-right font-bold text-slate-200">{count}</td>
                                                <td className="p-3 text-right">
                                                  <button 
                                                    onClick={() => handleRunMaskAttack(mask)}
                                                    className="p-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded transition-colors opacity-0 group-hover:opacity-100" 
                                                    title="Run Attack with this mask"
                                                  >
                                                    <PlayCircle size={16} />
                                                  </button>
                                                </td>
                                            </tr>
                                        )})}
                                    </tbody>
                                </table>
                            </div>
                          </div>
                          
                          {/* Hybrid Pattern Analysis */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                               <div className="flex items-center gap-2 mb-4 shrink-0"><GitBranch size={18} className="text-pink-400"/><h3 className="font-bold text-slate-200">Top Prefixes</h3></div>
                               <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
                                  <div className="space-y-2">
                                      {(insights.topPrefixes || []).map(([prefix, count], idx) => {
                                          return (
                                            <div key={idx} className="relative group flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800/50">
                                              <div className="flex items-center gap-2">
                                                <span className="font-mono text-pink-300">{prefix}</span>
                                                <span className="text-slate-500">({count})</span>
                                              </div>
                                              <button onClick={() => handleCopyPattern(prefix, 'Prefix')} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-pink-400"><Copy size={12}/></button>
                                            </div>
                                          );
                                      })}
                                  </div>
                               </div>
                            </div>

                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                               <div className="flex items-center gap-2 mb-4 shrink-0"><ArrowLeftRight size={18} className="text-cyan-400"/><h3 className="font-bold text-slate-200">Top Suffixes</h3></div>
                               <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
                                  <div className="space-y-2">
                                      {(insights.topSuffixes || []).map(([suffix, count], idx) => {
                                          return (
                                            <div key={idx} className="relative group flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800/50">
                                              <div className="flex items-center gap-2">
                                                <span className="font-mono text-cyan-300">{suffix}</span>
                                                <span className="text-slate-500">({count})</span>
                                              </div>
                                              <button onClick={() => handleCopyPattern(suffix, 'Suffix')} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-cyan-400"><Copy size={12}/></button>
                                            </div>
                                          );
                                      })}
                                  </div>
                               </div>
                            </div>
                          </div>
                      </div>

                      <div className="space-y-6">
                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                             <div className="flex items-center justify-between mb-4">
                                 <div className="flex items-center gap-2"><Copy size={18} className="text-emerald-400"/><h3 className="font-bold text-slate-200">Top Plaintexts</h3></div>
                                 <button onClick={() => handleExportList('top_plaintexts', insights.topPasswords)} className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors" title="Export Top Plaintexts"><Download size={14} /></button>
                             </div>
                             <div className="space-y-2">
                                 {(insights.topPasswords || []).slice(0, 10).map(([pwd, count], i) => (
                                     <div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={pwd}>{pwd}</span><span className="text-slate-500">{count}</span></div>
                                 ))}
                             </div>
                          </div>

                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                             <div className="flex items-center justify-between mb-4">
                                 <div className="flex items-center gap-2"><FileText size={18} className="text-amber-400"/><h3 className="font-bold text-slate-200">Top Base Words</h3></div>
                                 <button onClick={() => handleExportList('top_base_words', insights.topBaseWords)} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded transition-colors" title="Export Base Words"><Download size={14} /></button>
                             </div>
                             <div className="space-y-2">
                                 {(insights.topBaseWords && insights.topBaseWords.length > 0) ? (insights.topBaseWords.slice(0, 10).map(([word, count], i) => (
                                     <div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={word}>{word}</span><span className="text-slate-500">{count}</span></div>
                                 ))) : <div className="text-xs text-slate-600 italic">No base words detected.</div>}
                             </div>
                          </div>
                          
                          {/* LENGTH DISTRIBUTION CHART - FIXED CLIPPING */}
                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                             <div className="flex items-center gap-2 mb-4 shrink-0"><BarChart3 size={18} className="text-blue-400"/><h3 className="font-bold text-slate-200">Length Dist.</h3></div>
                             {/* Added padding to prevent clipping */}
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
                                             const isPresent = count > 0;
                                             return (
                                                 <div key={len} className="flex flex-col items-center group relative h-full justify-end flex-shrink-0 w-3">
                                                     <div className={`w-full rounded-t transition-all ${isPresent ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800/50'}`} style={{ height: `${h}%`, minHeight: isPresent ? `${h}%` : '4px' }}></div>
                                                     <span className={`text-[9px] mt-1 ${isPresent ? 'text-slate-400 font-bold' : 'text-slate-700'}`}>{len}</span>
                                                     {isPresent && (
                                                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-[10px] px-2 py-1 rounded border border-slate-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl font-mono">
                                                            Len {len}: <span className="text-white font-bold">{count}</span>
                                                        </div>
                                                     )}
                                                 </div>
                                             );
                                         });
                                     })() : <div className="w-full h-full flex items-center justify-center text-xs text-slate-600 absolute left-0">No data</div>}
                                 </div>
                             </div>
                          </div>

                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                             <div className="flex items-center gap-2 mb-6"><PieChart size={18} className="text-purple-400"/><h3 className="font-bold text-slate-200">Complexity Dist.</h3></div>
                             <div className="space-y-4">
                                 {Object.entries(insights.charsets || {}).map(([label, count]) => {
                                     const pct = insights.total > 0 ? (count / insights.total) * 100 : 0;
                                     if (count === 0) return null;
                                     return (<div key={label}><div className="flex justify-between text-xs mb-1.5"><span className="text-slate-400">{label}</span><span className="text-slate-200 font-mono">{pct.toFixed(1)}%</span></div><div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${pct}%` }}></div></div></div>);
                                 })}
                             </div>
                          </div>
                      </div>
                    </div>
                  )}
              </div>
            )}

            {activeTab === 'escrow' && <EscrowDashboard apiKey={apiKey} setApiKey={setApiKey} initialSubmissionData={escrowSubmissionData} initialAlgoId={escrowSubmissionAlgo} />}
            {activeTab === 'config' && <ConfigPanel config={config} setConfig={setConfig} onStart={(cmd) => { setActiveTab('dashboard'); if (status !== SessionStatus.RUNNING) toggleSession(cmd); }} />}
            
            {activeTab === 'terminal' && (
				<div className="h-[80vh]">
					<InteractiveTerminal 
					socket={socketRef.current} 
					disabled={status === SessionStatus.RUNNING || status === SessionStatus.PAUSED}
				/>
			</div>
		)}

          </div>
        </div>
      </main>
    </div>
  );
}

export default App;