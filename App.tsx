import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, RotateCcw, Terminal, LayoutDashboard, 
  Globe, Zap, ShieldCheck, Hash, Settings, 
  Link, Unlink, Loader2, Activity, FileUp, 
  Microscope, PieChart, BarChart3, Copy, Download, FileDown,
  Square, RefreshCw, ChevronDown, ChevronUp, 
  PlayCircle, GitBranch, ArrowLeftRight, FileText, Layers, History, Clock, Database, X, Calculator, Sparkles, Info, Gauge,
  Search, CheckCircle, List
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { SessionStats, SessionStatus, LogEntry, HistoryPoint, HashcatConfig, RecoveredHash, QueueItem } from './types';
import { INITIAL_SESSION, DEFAULT_CONFIG, HASH_TYPES } from './constants';
import LogTerminal from './components/LogTerminal';
import InteractiveTerminal from './components/InteractiveTerminal';
import CpuChart from './components/CpuChart';
import ConfigPanel from './components/ConfigPanel';
import EscrowDashboard from './components/EscrowDashboard';
import RecoveredHashList from './components/RecoveredHashList';
import QueueManager from './components/QueueManager';

const uuid = () => Math.random().toString(36).substring(2, 9);

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

// --- Helper Functions ---
const formatKeyspace = (num: number) => {
    if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
};

const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)} secs`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} mins`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
    if (seconds < 31536000) return `${(seconds / 86400).toFixed(1)} days`;
    return '> 1 year';
};

const getAttackModeName = (mode: number) => {
    switch (mode) {
        case 0: return 'Wordlist';
        case 1: return 'Combination';
        case 3: return 'Brute Force';
        case 6: return 'Hybrid (Wordlist+Mask)';
        case 7: return 'Hybrid (Mask+Wordlist)';
        default: return `Custom (${mode})`;
    }
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

interface PastSession {
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
}

const INITIAL_INSIGHTS: InsightsData = {
    sortedMasks: [], lengthCounts: {}, charsets: {}, topPasswords: [], topBaseWords: [], topPrefixes: [], topSuffixes: [], avgEntropy: 0, total: 0
};

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'insights' | 'terminal' | 'escrow' | 'config' | 'queue'>('dashboard');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('hashes_apikey') || '');
  
  // Load config from localStorage if available
  const [config, setConfig] = useState<HashcatConfig>(() => {
      const saved = localStorage.getItem('reactor_config');
      return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  const [backendConnected, setBackendConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // --- MULTI-SESSION STATE (UPDATED) ---
  const [sessions, setSessions] = useState<Record<string, SessionStats>>({});
  const [sessionLogs, setSessionLogs] = useState<Record<string, LogEntry[]>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  
  // Historical data (Potfile)
  const [globalPotfile, setGlobalPotfile] = useState<RecoveredHash[]>([]);

  // Queue State
  const [jobQueue, setJobQueue] = useState<QueueItem[]>([]);
  const [isQueueProcessing, setIsQueueProcessing] = useState(true);

  // Derived current session data
  const session = useMemo(() => {
    if (activeSessionId && sessions[activeSessionId]) {
        return sessions[activeSessionId];
    }
    // Return empty recoveredHashes for non-active session state
    return { ...INITIAL_SESSION, recoveredHashes: [] }; 
  }, [activeSessionId, sessions]);

  // Derived current logs
  const logs = useMemo(() => {
    if (activeSessionId) return sessionLogs[activeSessionId] || [];
    return sessionLogs['general'] || [];
  }, [activeSessionId, sessionLogs]);

  const status = session.status;
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  
  // UI States
  const [viewAllMasks, setViewAllMasks] = useState(false);
  const [escrowSubmissionData, setEscrowSubmissionData] = useState<string>('');
  const [escrowSubmissionAlgo, setEscrowSubmissionAlgo] = useState<string>('');
  
  // Target Inputs
  const [manualTargetInput, setManualTargetInput] = useState('');
  const [manualTargetFile, setManualTargetFile] = useState<File | null>(null);
  
  const [isStarting, setIsStarting] = useState(false);
  const [restoreMode, setRestoreMode] = useState(false); 
  const [insights, setInsights] = useState<InsightsData>(INITIAL_INSIGHTS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  
  const sessionStartTimes = useRef<Record<string, number>>({});
  const runningConfigs = useRef<Record<string, HashcatConfig>>({});

  const [insightScope, setInsightScope] = useState<'all' | 'session'>('all');
  const [showMaskModal, setShowMaskModal] = useState(false);
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

  const [showPreCrackedModal, setShowPreCrackedModal] = useState(false);
  const [preCrackedResults, setPreCrackedResults] = useState<{ total: number, found: number, list: any[], downloadToken?: string } | null>(null);
  const [isCheckingPotfile, setIsCheckingPotfile] = useState(false);

  // --- ISOLATION LOGIC ---
  const currentDisplayedCracks = useMemo(() => {
      // If a session is active, show only its cracks. Otherwise empty (waiting for start).
      return activeSessionId ? (session.recoveredHashes || []) : [];
  }, [activeSessionId, session.recoveredHashes]);

  const newHashesCount = useMemo(() => currentDisplayedCracks.filter(h => !h.sentToEscrow).length, [currentDisplayedCracks]);

  const hashesToAnalyze = useMemo(() => {
      return insightScope === 'session' ? currentDisplayedCracks : globalPotfile;
  }, [insightScope, currentDisplayedCracks, globalPotfile]);

  // Reset inputs when switching sessions (they become read-only or empty)
  useEffect(() => {
      if (activeSessionId) {
          setManualTargetInput('');
          setManualTargetFile(null);
      }
  }, [activeSessionId]);

  useEffect(() => {
    const fetchHistory = async () => {
        try {
            const res = await fetch('http://localhost:3001/api/history/sessions');
            if (res.ok) {
                const data = await res.json();
                const parsed = data.map((s: any) => ({
                    ...s,
                    date: new Date(s.date)
                }));
                setPastSessions(parsed);
            }
        } catch (e) { console.error("Failed to load history", e); }
    };
    if (activeTab === 'insights' || pastSessions.length === 0) fetchHistory();
  }, [activeTab]);

  useEffect(() => { localStorage.setItem('hashes_apikey', apiKey); }, [apiKey]);

  // UPDATED: Save config to localStorage whenever it changes
  useEffect(() => {
      localStorage.setItem('reactor_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));
    workerRef.current.onmessage = (e) => {
        setInsights(e.data);
        setIsAnalyzing(false);
    };
    return () => { workerRef.current?.terminate(); };
  }, []);

  useEffect(() => {
    if (workerRef.current) {
        setIsAnalyzing(true);
        workerRef.current.postMessage({ 
            hashes: hashesToAnalyze,
            targetPps: session.hashrate > 0 ? session.hashrate : 1000000000 
        });
    }
  }, [hashesToAnalyze, session.hashrate]);

  // --- QUEUE PROCESSOR EFFECT ---  
  useEffect(() => {
      const processQueue = async () => {
          
          
          if (!backendConnected || !isQueueProcessing || jobQueue.length === 0 || isStarting) return;
          
          // Check ALL sessions. If ANY session is RUNNING or PAUSED, do not start the queue.
          const anySessionActive = Object.values(sessions).some(s => 
              s.status === SessionStatus.RUNNING || 
              s.status === SessionStatus.PAUSED
          );

          if (anySessionActive) {
              return; 
          }

          // Ready to start next job
          const nextJob = jobQueue[0];
          addLog('general', `[QUEUE] Auto-starting next job: ${nextJob.id}`, 'INFO');
          
          // Start the session
          setIsStarting(true);
          
          try {
              // Prepare target
              // For queued jobs, we assume the target path is already in the config object
              const payload = { ...nextJob.config };
              
              const res = await fetch('http://localhost:3001/api/session/start', { 
                  method: 'POST', 
                  headers: { 'Content-Type': 'application/json' }, 
                  body: JSON.stringify(payload)
              });
              
              const data = await res.json();
              if (data.sessionId) {
                  runningConfigs.current[data.sessionId] = nextJob.config;
                  // Remove from queue
                  setJobQueue(prev => prev.slice(1));
                  // Switch to dashboard to show progress
                  setActiveTab('dashboard');
              }
          } catch (e: any) {
              addLog('general', `[QUEUE] Failed to start job: ${e.message}`, 'ERROR');
              // Remove failed job so we don't loop forever
              setJobQueue(prev => prev.slice(1));
          } finally {
              setIsStarting(false);
          }
      };

      // Trigger processing logic
      const timer = setTimeout(processQueue, 2000); // Small delay to allow cleanup of previous session
      return () => clearTimeout(timer);
  }, [backendConnected, isQueueProcessing, jobQueue, sessions, isStarting]);


  // --- Socket Handling ---
  useEffect(() => {
    try {
      const socket = io('http://localhost:3001', { reconnection: true });
      socket.on('connect', () => { 
          setBackendConnected(true); 
          addLog('general', '[SYSTEM] Connected to Backend.', 'SUCCESS'); 
      });
      socket.on('disconnect', () => { 
          setBackendConnected(false); 
          addLog('general', '[SYSTEM] Disconnected from Backend.', 'ERROR'); 
      });
      
      socket.on('log', (data: { sessionId?: string, level: string, message: string }) => {
          const sid = data.sessionId || 'general';
          addLog(sid, data.message, data.level as LogEntry['level']);
      });
      
      // Global Potfile Sync (History)
      socket.on('potfile_sync', (data: RecoveredHash[]) => {
          setGlobalPotfile(data);
          addLog('general', `[SYSTEM] Loaded ${data.length} historical hashes.`, 'INFO');
      });

      // Session Started
      socket.on('session_started', ({ sessionId, name, target }: { sessionId: string, name: string, target: string }) => {
          let detectedHashType = undefined;
          const match = name.match(/\((.*?)\)$/);
          if (match) detectedHashType = match[1];

          setSessions(prev => ({
              ...prev,
              [sessionId]: { 
                  ...INITIAL_SESSION, 
                  sessionId, 
                  name,
                  target,
                  hashType: detectedHashType || prev[sessionId]?.hashType || INITIAL_SESSION.hashType,
                  status: SessionStatus.RUNNING, 
                  startTime: Date.now(),
                  recoveredHashes: [] // Initialize isolated list
              }
          }));
          sessionStartTimes.current[sessionId] = Date.now();
          
          if (isStarting) { 
              setActiveSessionId(sessionId);
              setIsStarting(false);
          }
      });

      // Session Status
      socket.on('session_status', (data: { sessionId: string, status: string }) => {
         const { sessionId, status: rawStatus } = data;
         let newStatus = SessionStatus.IDLE;
         
         if (rawStatus === 'RUNNING') newStatus = SessionStatus.RUNNING;
         else if (rawStatus === 'PAUSED') newStatus = SessionStatus.PAUSED;
         else if (rawStatus === 'COMPLETED') newStatus = SessionStatus.COMPLETED;
         else if (rawStatus === 'ERROR') newStatus = SessionStatus.ERROR;
         
         updateSession(sessionId, { status: newStatus });
      });
      
      // Session Finished (Authoritative Stats for History)
      socket.on('session_finished', (data: { sessionId: string, duration: number, recovered: number, total: number, avgHashrate: number }) => {
          const { sessionId, duration, recovered, total, avgHashrate } = data;
          saveSessionHistory(sessionId, duration, recovered, total, avgHashrate);
      });

      // Stats Update
      socket.on('stats_update', (data: { sessionId: string, type: string, value: any, isAggregate?: boolean }) => {
        const { sessionId, type, value, isAggregate } = data;
        
        if (type === 'hashrate') {
             if (isAggregate) {
                 updateSession(sessionId, { hashrate: value });
             } else {
                 updateSession(sessionId, { hashrate: value });
             }
        }
        else if (type === 'progress') updateSession(sessionId, { progress: value });
        else if (type === 'recovered') updateSession(sessionId, { recovered: value });
        else if (type === 'total') updateSession(sessionId, { total: value });
        else if (type === 'time_estimated') updateSession(sessionId, { estimatedTimeRemaining: value });
      });

      // ISOLATED CRACK EVENT
      socket.on('session_crack', (data: { sessionId: string, hash: string, plain: string }) => {
          setSessions(prev => {
              const sess = prev[data.sessionId];
              if (!sess) return prev; 
              
              if (sess.recoveredHashes.some(h => h.hash === data.hash)) return prev;

              const newCrack: RecoveredHash = {
                  id: uuid(),
                  hash: data.hash,
                  plain: data.plain,
                  algorithmId: sess.hashType,
                  timestamp: Date.now(),
                  sentToEscrow: false
              };

              return {
                  ...prev,
                  [data.sessionId]: {
                      ...sess,
                      recoveredHashes: [newCrack, ...sess.recoveredHashes]
                  }
              };
          });

          // Also update global potfile for history
          setGlobalPotfile(prev => {
             if (prev.some(h => h.hash === data.hash)) return prev;
             return [{
                 id: uuid(),
                 hash: data.hash,
                 plain: data.plain,
                 algorithmId: '0',
                 timestamp: Date.now(),
                 sentToEscrow: false
             }, ...prev];
          });
      });

      socketRef.current = socket;
      return () => { socket.disconnect(); };
    } catch (e) { console.warn("Socket connection failed", e); }
  }, [config.hashType, isStarting]); 

  const updateSession = (sessionId: string, updates: Partial<SessionStats>) => {
      setSessions(prev => {
          const existing = prev[sessionId] || { ...INITIAL_SESSION, sessionId, recoveredHashes: [] };
          return { ...prev, [sessionId]: { ...existing, ...updates } };
      });
  };

  const deleteSession = (sessionId: string) => {
      setSessions(prev => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
      });
      if (activeSessionId === sessionId) setActiveSessionId(null);
  };

  const addLog = (sessionId: string, message: string, level: LogEntry['level'] = 'INFO') => {
    const entry = { id: uuid(), sessionId, timestamp: new Date(), level, message };
    setSessionLogs(prev => {
        const sessionLog = prev[sessionId] || [];
        return { ...prev, [sessionId]: [...sessionLog.slice(-99), entry] };
    });
  };

  const saveSessionHistory = (sessionId: string, duration: number, recovered: number, total: number, avgHashrate: number) => {
      const usedConfig = runningConfigs.current[sessionId] || config;
      
      // Use date from start time ref or current time
      const date = sessionStartTimes.current[sessionId] 
        ? new Date(sessionStartTimes.current[sessionId]) 
        : new Date();

      const pastSession: PastSession = {
          id: uuid(),
          date: date,
          duration: duration || 0,
          mode: HASH_TYPES.find(h => h.id === usedConfig.hashType)?.name || usedConfig.hashType,
          algorithmId: usedConfig.hashType,
          attackType: getAttackModeName(usedConfig.attackMode),
          attackMode: usedConfig.attackMode,
          recovered: recovered, 
          totalHashes: total, 
          avgHashrate: avgHashrate || 0
      };

      // Cleanup refs
      delete runningConfigs.current[sessionId];
      delete sessionStartTimes.current[sessionId];

      setPastSessions(prev => [pastSession, ...prev]);

      fetch('http://localhost:3001/api/history/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pastSession)
      }).catch(console.error);
  };

  useEffect(() => {
    if (backendConnected && status === SessionStatus.RUNNING) {
       const interval = setInterval(() => {
          setHistory(h => [...h.slice(-59), { timestamp: Date.now(), hashrate: session.hashrate / 1000000, temp: 0 }]);
       }, 1000);
       return () => clearInterval(interval);
    }
  }, [backendConnected, status, session.hashrate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setManualTargetFile(file);
      setManualTargetInput(''); 
    }
  };

  const handleManualTargetLoad = async () => {
    if (manualTargetFile && (manualTargetFile as any).path) {
        addLog(activeSessionId || 'general', `Target Set: ${manualTargetFile.name}`, 'CMD');
    } else if (manualTargetInput) {
        addLog(activeSessionId || 'general', `Target Set: Manual Input`, 'CMD');
    }
  };

  // Helper to prepare target before running or queuing
  const prepareTarget = async (): Promise<string> => {
      if (manualTargetFile && (manualTargetFile as any).path) {
          return (manualTargetFile as any).path;
      } else if (manualTargetInput) {
          const res = await fetch('http://localhost:3001/api/target', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: manualTargetInput })
          });
          const data = await res.json();
          return data.path;
      }
      return '';
  };

  const handleAddToQueue = async () => {
      try {
          // If we have manual input, we must save it to a file first so the queue can use it later
          let targetPath = config.targetPath;
          let targetSummary = config.targetPath;

          if (!targetPath) {
             const manualPath = await prepareTarget();
             if (manualPath) {
                 targetPath = manualPath;
                 targetSummary = manualTargetFile ? manualTargetFile.name : 'Manual Input Buffer';
             } else {
                 addLog('general', 'Cannot queue: No target selected.', 'ERROR');
                 return;
             }
          }

          const queueConfig = { ...config, targetPath };
          
          const newJob: QueueItem = {
              id: uuid(),
              config: queueConfig,
              status: 'PENDING',
              addedAt: Date.now(),
              targetSummary: targetSummary || 'Unknown'
          };
          
          setJobQueue(prev => [...prev, newJob]);
          addLog('general', `Added job to queue. Position: ${jobQueue.length + 1}`, 'SUCCESS');
          setActiveTab('queue');

      } catch (e: any) {
          addLog('general', `Queue Error: ${e.message}`, 'ERROR');
      }
  };

  const toggleSession = async (overrideCommand?: string) => {
    
    if (activeSessionId && (session.status === SessionStatus.RUNNING || session.status === SessionStatus.PAUSED)) {
      await fetch('http://localhost:3001/api/session/stop', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: activeSessionId })
      });
    } else {
      if (!backendConnected) { addLog('general', "Backend disconnected.", "ERROR"); return; }
      
      setIsStarting(true);
      setActiveTab('dashboard');
      setTimeout(() => setIsStarting(false), 5000);

      try {
        let targetPath = '';
        let payload = {};
        
        targetPath = await prepareTarget();

        if (restoreMode) {
            payload = { restore: true };
            addLog('general', `Attempting restore from previous session...`, 'CMD');
        } else {
            payload = overrideCommand ? { customCommand: overrideCommand } : { ...config, targetPath };
        }
        
        const res = await fetch('http://localhost:3001/api/session/start', { 
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.sessionId) {
            runningConfigs.current[data.sessionId] = config;
            updateSession(data.sessionId, { hashType: config.hashType });
        }
        
      } catch (e: any) {
        addLog('general', `Start Error: ${e.message}`, 'ERROR');
        setIsStarting(false);
      }
    }
  };

  const handleSendToEscrow = (hashes: RecoveredHash[]) => {
      const newHashes = hashes.filter(h => !h.sentToEscrow);
      if (newHashes.length === 0) {
        addLog("No new hashes to send to escrow.", "WARN");
        return;
      }
      const content = newHashes.map(h => `${h.hash}:${h.plain}`).join('\n');
      setEscrowSubmissionData(content);
      const algo = activeSessionId ? session.hashType : config.hashType;
      setEscrowSubmissionAlgo(algo); 
      
      if (activeSessionId) {
          setSessions(prev => ({
              ...prev,
              [activeSessionId]: {
                  ...prev[activeSessionId],
                  recoveredHashes: prev[activeSessionId].recoveredHashes.map(h => newHashes.some(nh => nh.id === h.id) ? { ...h, sentToEscrow: true } : h)
              }
          }));
      }

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

  const handleCheckPotfile = async () => {
    if (!manualTargetFile && !manualTargetInput) {
        addLog("No target set to check.", "WARN");
        return;
    }
    
    setIsCheckingPotfile(true);
    try {
        let payload = {};
        if (manualTargetFile && (manualTargetFile as any).path) {
            payload = { targetPath: (manualTargetFile as any).path };
        } else if (manualTargetInput) {
            payload = { content: manualTargetInput };
        }

        const res = await fetch('http://localhost:3001/api/target/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        setPreCrackedResults({
            total: data.totalTarget,
            found: data.foundCount,
            list: data.preview, 
            downloadToken: data.downloadToken 
        } as any);
        
        setShowPreCrackedModal(true);
        addLog(`Analysis complete: ${data.foundCount} / ${data.totalTarget} hashes found.`, 'SUCCESS');

    } catch (e) {
        addLog("Failed to check potfile.", "ERROR");
        console.error(e);
    } finally {
        setIsCheckingPotfile(false);
    }
  };

  const handleGenerateMasks = () => {
    if (insights.sortedMasks.length === 0) {
        addLog("No masks available to generate.", "WARN");
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
    addLog(`Generated ${selectedMasks.length} masks (${coveragePct}% coverage) for ${formatTime(accumulatedTime)} runtime.`, 'SUCCESS');
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
    addLog('Downloaded generated .rule file', 'SUCCESS');
  };

  const handleExportWordlist = () => {
    if (!hashesToAnalyze || hashesToAnalyze.length === 0) {
        addLog('No hashes to export', 'WARN');
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
    addLog(`Exported ${uniquePlains.size} unique passwords as wordlist`, 'SUCCESS');
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
    addLog(`Configured Brute Force attack with mask: ${mask}`, 'CMD');
  };
  
  const handleCopyPattern = (text: string, type: 'Prefix' | 'Suffix') => {
      navigator.clipboard.writeText(text);
      addLog(`Copied ${type}: ${text}`, 'INFO');
  };

  const handleExportSessionCracks = () => {
    if (currentDisplayedCracks.length === 0) { addLog('No cracks to export.', 'WARN'); return; }
    const content = currentDisplayedCracks.map(h => `${h.hash}:${h.plain}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_cracks_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog(`Exported ${currentDisplayedCracks.length} cracks to .txt`, 'SUCCESS');
  };
  
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

  useEffect(() => {
      if (showMaskModal) {
          detectHashrateForAlgo(config.hashType);
      }
  }, [showMaskModal]);

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans">
      <aside className="w-20 lg:w-64 border-r border-slate-800 flex flex-col bg-slate-950 z-50 fixed h-full lg:relative">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center"><Hash className="text-white" size={20} /></div>
          <span className="ml-3 font-bold text-lg hidden lg:block">Reactor</span>
        </div>
        <nav className="p-4 flex-1">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'dashboard' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><LayoutDashboard size={20} /><span className="ml-3 hidden lg:block font-medium">Dashboard</span></button>
          
          <button onClick={() => setActiveTab('queue')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'queue' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}>
            <List size={20} />
            <div className="ml-3 hidden lg:flex items-center justify-between flex-1 font-medium">
                <span>Queue</span>
                {jobQueue.length > 0 && <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">{jobQueue.length}</span>}
            </div>
          </button>

          <button onClick={() => setActiveTab('insights')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'insights' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Microscope size={20} /><span className="ml-3 hidden lg:block font-medium">Insights (PACK)</span></button>
          <button onClick={() => setActiveTab('escrow')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'escrow' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Globe size={20} /><span className="ml-3 hidden lg:block font-medium">Escrow Jobs</span></button>
          <button onClick={() => setActiveTab('config')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'config' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Settings size={20} /><span className="ml-3 hidden lg:block font-medium">Configuration</span></button>
          <button onClick={() => setActiveTab('terminal')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'terminal' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Terminal size={20} /><span className="ml-3 hidden lg:block font-medium">Terminal</span></button>
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
                <span className="text-slate-100 font-mono text-sm">{activeSessionId ? (session.target || 'N/A') : 'Configure New Session'}</span>
              </div>
          </div>
          <div className="flex items-center gap-3">
             {jobQueue.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-400">
                   <List size={14} />
                   <span>Queue: {jobQueue.length} Pending</span>
                   {isQueueProcessing && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>}
                </div>
             )}

            {(!activeSessionId || session.status === SessionStatus.IDLE || session.status === SessionStatus.COMPLETED || session.status === SessionStatus.ERROR) ? (
              <div className="flex items-center gap-3 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button 
                     onClick={() => setRestoreMode(!restoreMode)}
                     className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${restoreMode ? 'bg-amber-500/20 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
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
            ) : (
               <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
                   <button 
                      onClick={() => toggleSession()}
                      className="flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                   >
                      <Square size={14} fill="currentColor" />
                      Stop Current
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
                  <MetricCard 
                    label="Mode" 
                    value={HASH_TYPES.find(h => h.id === session.hashType)?.name || session.hashType || 'N/A'} 
                    subValue={session.hashType ? `Mode -m ${session.hashType}` : 'Ready'} 
                    icon={Hash} 
                    color="slate" 
                  />
                  <MetricCard label="Progress" value={`${session.progress.toFixed(2)}%`} subValue={session.estimatedTimeRemaining} icon={Activity} color="blue" />
                </div>

                
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:h-80 min-h-[20rem]">
                  <div className="lg:col-span-3 h-full min-h-0 rounded-xl overflow-hidden">
                    <CpuChart data={history} color="#6366f1" title="Hashrate Performance (MH/s)" dataKey="hashrate" unit="M" />
                  </div>
                  <div className="lg:col-span-2 h-full min-h-0 rounded-xl overflow-hidden">
                    <LogTerminal 
                        logs={logs} 
                        sessions={sessions} 
                        activeSessionId={activeSessionId}
                        onSelectSession={setActiveSessionId}
                        onDeleteSession={deleteSession}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:h-[32rem]">
                    
                    {/* ISOLATED TARGET CONFIGURATION */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-full relative overflow-hidden">
                        {activeSessionId && (
                            <div className="absolute inset-0 bg-slate-950/60 z-10 flex items-center justify-center backdrop-blur-[1px]">
                                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-2xl text-center">
                                    <div className="flex items-center justify-center gap-2 text-indigo-400 mb-2">
                                        <Hash size={24} />
                                        <span className="font-bold text-lg">Active Session Target</span>
                                    </div>
                                    <p className="text-slate-400 text-sm mb-1">Target is locked while session is active.</p>
                                    <div className="font-mono text-white bg-slate-950 px-3 py-1 rounded border border-slate-800 text-xs inline-block mt-2">
                                        {session.target || 'Manual Input'}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center gap-2 mb-4 shrink-0">
                            <FileUp size={18} className="text-indigo-400" />
                            <h3 className="text-sm font-bold text-slate-200">Target Configuration {activeSessionId ? '(Locked)' : '(New Session)'}</h3>
                        </div>
                        <div className="flex flex-col gap-4">
                             <div className="flex gap-4 shrink-0 h-12">
                                <label className={`flex-1 flex items-center justify-center border border-dashed rounded-lg transition-colors ${!activeSessionId ? 'cursor-pointer hover:bg-slate-800/50' : 'cursor-not-allowed opacity-50'} ${manualTargetFile ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300' : 'border-slate-700 text-slate-400'}`}>
                                    <span className="text-xs font-medium truncate px-2">
                                        {manualTargetFile ? manualTargetFile.name : 'Choose File...'}
                                    </span>
                                    <input type="file" className="hidden" onChange={handleFileChange} disabled={!!activeSessionId} />
                                </label>
                                <button onClick={handleManualTargetLoad} disabled={(!manualTargetInput && !manualTargetFile) || !!activeSessionId} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 rounded-lg text-sm font-bold transition-colors">Set Target</button>
                                
                                <button 
                                    onClick={handleCheckPotfile}
                                    disabled={(!manualTargetFile && !manualTargetInput) || isCheckingPotfile || !!activeSessionId}
                                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 border border-slate-700 px-4 rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
                                >
                                    {isCheckingPotfile ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                                    <span className="hidden xl:inline">Check Potfile</span>
                                </button>
                             </div>
                             <div className="relative text-center shrink-0">
                                 <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                                 <div className="relative"><span className="bg-slate-900 px-2 text-xs text-slate-500 font-bold">OR PASTE HASHES</span></div>
                             </div>
                             <div className="relative group h-60">
                                <textarea 
                                    value={manualTargetInput} 
                                    onChange={(e) => { setManualTargetInput(e.target.value); if(e.target.value) setManualTargetFile(null); }} 
                                    disabled={!!activeSessionId}
                                    placeholder="Paste target hashes here (one per line)..." 
                                    className="w-full h-full bg-slate-950/50 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 resize-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                                />
                             </div>
                        </div>
                    </div>

                    {/* ISOLATED RECOVERED LIST */}
                    <div className="flex flex-col relative h-full bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden">
                        <div className="absolute top-3 right-4 z-50 flex items-center gap-2">
                             <button onClick={handleExportSessionCracks} disabled={currentDisplayedCracks.length === 0} className="flex items-center gap-2 text-xs h-8 px-3 rounded transition-colors border font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 disabled:opacity-50"><FileDown size={14} /> Export</button>
                             
                             <button 
                                onClick={() => handleSendToEscrow(currentDisplayedCracks)} 
                                disabled={newHashesCount === 0} 
                                className={`flex items-center gap-2 text-xs h-8 px-3 rounded transition-colors border font-medium shadow-sm ${newHashesCount > 0 ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-50'}`}
                             >
                                 <Globe size={14} /> {newHashesCount > 0 ? 'Send New' : 'All Sent'}
                             </button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                           <RecoveredHashList hashes={currentDisplayedCracks} />
                       </div>
                    </div>
                </div>

                {showPreCrackedModal && preCrackedResults && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
                          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 shrink-0">
                              <h3 className="font-bold text-slate-200 flex items-center gap-2">
                                  <CheckCircle size={18} className="text-emerald-400" />
                                  Potfile Analysis Results
                              </h3>
                              <button onClick={() => setShowPreCrackedModal(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button>
                          </div>
                          <div className="p-6 bg-slate-900 grid grid-cols-3 gap-4 shrink-0">
                              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-center">
                                  <div className="text-xs text-slate-500 uppercase font-bold">Total Target</div>
                                  <div className="text-xl font-mono text-white">{preCrackedResults.total}</div>
                              </div>
                              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-center">
                                  <div className="text-xs text-slate-500 uppercase font-bold">Already Cracked</div>
                                  <div className="text-xl font-mono text-emerald-400">{preCrackedResults.found}</div>
                              </div>
                              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-center">
                                  <div className="text-xs text-slate-500 uppercase font-bold">Still Locked</div>
                                  <div className="text-xl font-mono text-red-400">{preCrackedResults.total - preCrackedResults.found}</div>
                              </div>
                          </div>
                          {preCrackedResults.found > 100 && (
                            <div className="p-2 text-xs text-amber-500 bg-amber-500/10 text-center font-bold border-b border-slate-800 shrink-0">
                                Showing first 100 matches only. Download the full list to see all {preCrackedResults.found} items.
                            </div>
                          )}
                          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                              {preCrackedResults.found === 0 ? (
                                  <div className="text-center text-slate-500 py-10 italic">No matches found in potfile. All hashes are fresh.</div>
                              ) : (
                                  <table className="w-full text-left text-sm">
                                      <thead className="text-xs text-slate-500 uppercase bg-slate-900 sticky top-0">
                                          <tr><th className="p-2">Hash</th><th className="p-2">Plaintext</th></tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800">
                                          {preCrackedResults.list.slice(0, 100).map((item, idx) => (
                                              <tr key={idx} className="hover:bg-slate-800/50">
                                                  <td className="p-2 font-mono text-slate-400 truncate max-w-[200px]" title={item.hash}>{item.hash}</td>
                                                  <td className="p-2 font-mono text-emerald-300 truncate max-w-[200px]">{item.plain}</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              )}
                          </div>
                          <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end gap-2 shrink-0">
                               <button 
                                  onClick={() => {
                                      if (preCrackedResults && (preCrackedResults as any).downloadToken) {
                                          window.location.href = `http://localhost:3001/api/download/check-result/${(preCrackedResults as any).downloadToken}`;
                                      }
                                  }}
                                  disabled={preCrackedResults.found === 0}
                                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-2"
                               >
                                  <Download size={14} /> Download Full List
                               </button>
                               <button onClick={() => setShowPreCrackedModal(false)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors">Close</button>
                          </div>
                      </div>
                  </div>
                )}
              </>
            )}

            {activeTab === 'insights' && (
              <div className="space-y-6 animate-in fade-in duration-300 relative">
                  {/* ... [Mask Generator Modal] ... */}
                  {showMaskModal && (
                      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                                  <h3 className="font-bold text-slate-200 flex items-center gap-2"><Calculator size={18} className="text-indigo-400" /> Mask Generator (PACK)</h3>
                                  <button onClick={() => setShowMaskModal(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button>
                              </div>
                              <div className="p-6 space-y-5">
                                  <div className="space-y-2">
                                      <label className="text-xs uppercase font-bold text-slate-500">Target Runtime</label>
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
                                      <label className="text-xs uppercase font-bold text-slate-500">Hash Algorithm</label>
                                      <select value={maskGenConfig.targetAlgo} onChange={(e) => detectHashrateForAlgo(e.target.value)} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none">
                                          {HASH_TYPES.map(h => (<option key={h.id} value={h.id}>{h.name} (Mode {h.id})</option>))}
                                      </select>
                                  </div>
                                  <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                          <label className="text-xs uppercase font-bold text-slate-500">Hashrate (GH/s)</label>
                                          {maskGenConfig.isAutoDetected ? (
                                              <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${maskGenConfig.detectionSource === 'bruteforce' ? 'text-emerald-400 bg-emerald-400/10' : 'text-amber-400 bg-amber-400/10'}`}><Sparkles size={10} /> {maskGenConfig.detectionSource === 'bruteforce' ? 'Matched Brute Force History' : 'Compensated Wordlist History'}</span>
                                          ) : (<span className="flex items-center gap-1 text-[10px] text-slate-500 font-bold bg-slate-800 px-1.5 py-0.5 rounded"><Info size={10} /> No history for this type</span>)}
                                      </div>
                                      <input type="number" value={maskGenConfig.hashrate} onChange={(e) => setMaskGenConfig({...maskGenConfig, hashrate: parseFloat(e.target.value) || 1, isAutoDetected: false, detectionSource: 'manual'})} className={`bg-slate-950 border rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none ${maskGenConfig.isAutoDetected ? 'border-indigo-500/50' : 'border-slate-800'}`} min="0.1" step="0.1" />
                                  </div>
                                  <div className="space-y-2">
                                      <label className="text-xs uppercase font-bold text-slate-500">Minimum Mask Length</label>
                                      <input type="number" value={maskGenConfig.minLength} onChange={(e) => setMaskGenConfig({...maskGenConfig, minLength: parseInt(e.target.value) || 1})} className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 w-full focus:ring-1 focus:ring-indigo-500 outline-none" min="1" max="16" />
                                  </div>
                                  <div className="space-y-2">
                                      <label className="text-xs uppercase font-bold text-slate-500">Sorting Logic</label>
                                      <div className="grid grid-cols-2 gap-2">
                                          <button onClick={() => setMaskGenConfig({...maskGenConfig, sortMode: 'occurrence'})} className={`p-2 rounded text-xs font-bold border transition-all ${maskGenConfig.sortMode === 'occurrence' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}>Occurrence</button>
                                          <button onClick={() => setMaskGenConfig({...maskGenConfig, sortMode: 'optindex'})} className={`p-2 rounded text-xs font-bold border transition-all ${maskGenConfig.sortMode === 'optindex' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}>Efficiency</button>
                                      </div>
                                  </div>
                                  <button onClick={handleGenerateMasks} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"><Download size={18} /> Generate .hcmask</button>
                              </div>
                          </div>
                      </div>
                  )}

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
                    
                    <div className="flex items-center gap-6">
                        <div className="bg-slate-900 p-1 rounded-lg border border-slate-800 flex items-center">
                            <button onClick={() => setInsightScope('all')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><Layers size={14} /> All Time</button>
                            <button onClick={() => setInsightScope('session')} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all ${insightScope === 'session' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}><History size={14} /> Current Session</button>
                        </div>
                        <div className="flex gap-2">
                            {insights.total > 0 && (<button onClick={() => setShowMaskModal(true)} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Configure & Download .hcmask"><Download size={14} /> Masks</button>)}
                            {insights.total > 0 && (<button onClick={handleDownloadRules} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-pink-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download .rule"><FileDown size={14} /> Rules</button>)}
                            {insights.total > 0 && (<button onClick={handleExportWordlist} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 rounded-lg transition-colors text-xs font-bold border border-slate-700" title="Download Plaintext Wordlist"><FileText size={14} /> Wordlist</button>)}
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
                                <h3 className="font-bold text-slate-200 flex items-center gap-2"><ShieldCheck size={16} className="text-indigo-400" /> Smart Mask Analysis (PACK)</h3>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{viewAllMasks ? `Showing All (${insights.sortedMasks.length})` : 'Showing Top 15'}</span>
                                    <button onClick={() => setViewAllMasks(!viewAllMasks)} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700 transition-colors">{viewAllMasks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{viewAllMasks ? 'Show Less' : 'View All'}</button>
                                </div>
                            </div>
                            <div className="overflow-y-auto flex-1">
                                <table className="w-full text-left">
                                    <thead className="text-xs text-slate-500 uppercase bg-slate-950/50 border-b border-slate-800 sticky top-0 backdrop-blur-sm"><tr><th className="p-3 pl-6">Rank</th><th className="p-3">Mask Pattern</th><th className="p-3 text-right">Complexity</th><th className="p-3 text-right">Time ({session.hashrate > 0 ? (session.hashrate/1e6).toFixed(0) + 'MH/s' : '1GH/s'})</th><th className="p-3 text-right">Occurrence</th><th className="p-3 text-right">Action</th></tr></thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {(insights.sortedMasks || []).slice(0, viewAllMasks ? undefined : 15).map((data, idx) => {
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
                                <div className="flex items-center gap-2 mb-4 shrink-0"><GitBranch size={18} className="text-pink-400"/><h3 className="font-bold text-slate-200">Top Prefixes</h3></div>
                                <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar"><div className="space-y-2">{(insights.topPrefixes || []).map(([prefix, count], idx) => (<div key={idx} className="relative group flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800/50"><div className="flex items-center gap-2"><span className="font-mono text-pink-300">{prefix}</span><span className="text-slate-500">({count})</span></div><button onClick={() => handleCopyPattern(prefix, 'Prefix')} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-pink-400"><Copy size={12}/></button></div>))}</div></div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                               <div className="flex items-center gap-2 mb-4 shrink-0"><ArrowLeftRight size={18} className="text-cyan-400"/><h3 className="font-bold text-slate-200">Top Suffixes</h3></div>
                               <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar"><div className="space-y-2">{(insights.topSuffixes || []).map(([suffix, count], idx) => (<div key={idx} className="relative group flex items-center justify-between text-xs p-1.5 rounded hover:bg-slate-800/50"><div className="flex items-center gap-2"><span className="font-mono text-cyan-300">{suffix}</span><span className="text-slate-500">({count})</span></div><button onClick={() => handleCopyPattern(suffix, 'Suffix')} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-cyan-400"><Copy size={12}/></button></div>))}</div></div>
                            </div>
                          </div>
                          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-0 flex flex-col h-80">
                            <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between shrink-0">
                                <h3 className="font-bold text-slate-200 flex items-center gap-2"><Database size={16} className="text-slate-400" /> Historical Sessions</h3>
                                <span className="text-xs text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800">{pastSessions.length} Sessions</span>
                            </div>
                            {pastSessions.length === 0 ? (<div className="p-8 text-center text-slate-500 text-sm italic">No session history available yet.</div>) : (
                                <div className="overflow-y-auto flex-1 custom-scrollbar">
                                    <table className="w-full text-left relative">
                                        <thead className="text-xs text-slate-500 uppercase bg-slate-950/95 border-b border-slate-800 sticky top-0 z-10"><tr><th className="p-3 pl-6">Date</th><th className="p-3">Mode</th><th className="p-3">Attack Type</th><th className="p-3 text-right">Avg Hashrate</th><th className="p-3 text-right">Recovered</th><th className="p-3 text-right">Duration</th></tr></thead>
                                        <tbody className="divide-y divide-slate-800/50 text-sm">
                                            {pastSessions.map((s) => (
                                                <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                                                    <td className="p-3 pl-6 text-slate-400">{s.date.toLocaleString()}</td>
                                                    <td className="p-3 text-slate-300 font-mono">{s.mode}</td>
                                                    <td className="p-3 text-indigo-300">{s.attackType}</td>
                                                    <td className="p-3 text-right font-mono text-slate-400">{(s.avgHashrate / 1000000).toFixed(2)} MH/s</td>
                                                    <td className="p-3 text-right text-emerald-400 font-bold">{s.recovered} / {s.totalHashes}</td>
                                                    <td className="p-3 text-right text-slate-400 flex items-center justify-end gap-1"><Clock size={12} /> {formatTime(s.duration)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                      </div>
                      <div className="space-y-6">
                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                             <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Copy size={18} className="text-emerald-400"/><h3 className="font-bold text-slate-200">Top Plaintexts</h3></div><button onClick={() => handleExportList('top_plaintexts', insights.topPasswords)} className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded transition-colors"><Download size={14} /></button></div>
                             <div className="space-y-2">{(insights.topPasswords || []).slice(0, 10).map(([pwd, count], i) => (<div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={pwd}>{pwd}</span><span className="text-slate-500">{count}</span></div>))}</div>
                          </div>
                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                             <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><FileText size={18} className="text-amber-400"/><h3 className="font-bold text-slate-200">Top Base Words</h3></div><button onClick={() => handleExportList('top_base_words', insights.topBaseWords)} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded transition-colors"><Download size={14} /></button></div>
                             <div className="space-y-2">{(insights.topBaseWords && insights.topBaseWords.length > 0) ? (insights.topBaseWords.slice(0, 10).map(([word, count], i) => (<div key={i} className="flex justify-between text-xs border-b border-slate-800/50 pb-1 last:border-0"><span className="text-slate-300 font-mono truncate max-w-[150px]" title={word}>{word}</span><span className="text-slate-500">{count}</span></div>))) : <div className="text-xs text-slate-600 italic">No base words detected.</div>}</div>
                          </div>
                          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-64">
                             <div className="flex items-center gap-2 mb-4 shrink-0"><BarChart3 size={18} className="text-blue-400"/><h3 className="font-bold text-slate-200">Length Dist.</h3></div>
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
                             <div className="flex items-center gap-2 mb-6"><PieChart size={18} className="text-purple-400"/><h3 className="font-bold text-slate-200">Complexity Dist.</h3></div>
                             <div className="space-y-4">{Object.entries(insights.charsets || {}).map(([label, count]) => { const pct = insights.total > 0 ? (count / insights.total) * 100 : 0; if (count === 0) return null; return (<div key={label}><div className="flex justify-between text-xs mb-1.5"><span className="text-slate-400">{label}</span><span className="text-slate-200 font-mono">{pct.toFixed(1)}%</span></div><div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-purple-500" style={{ width: `${pct}%` }}></div></div></div>); })}</div>
                          </div>
                      </div>
                    </div>
                  )}
              </div>
            )}

            {activeTab === 'escrow' && <EscrowDashboard apiKey={apiKey} setApiKey={setApiKey} initialSubmissionData={escrowSubmissionData} initialAlgoId={escrowSubmissionAlgo} />}
            {activeTab === 'config' && (
                <ConfigPanel 
                    config={config} 
                    setConfig={setConfig} 
                    onStart={(cmd) => { setActiveTab('dashboard'); if (status !== SessionStatus.RUNNING) toggleSession(cmd); }} 
                    onQueue={handleAddToQueue}
                />
            )}
            
            {activeTab === 'queue' && (
                <QueueManager 
                    queue={jobQueue} 
                    removeFromQueue={(id) => setJobQueue(prev => prev.filter(j => j.id !== id))} 
                    isQueueProcessing={isQueueProcessing}
                    setIsQueueProcessing={setIsQueueProcessing}
                    clearQueue={() => setJobQueue([])}
                />
            )}
            
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