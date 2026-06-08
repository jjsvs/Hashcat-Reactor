import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play, Terminal, LayoutDashboard,
  Globe, Zap, ShieldCheck, Hash, Settings,
  Link, Unlink, Loader2, Activity, FileUp,
  Microscope, Copy, Download, FileDown,
  Square, RefreshCw, FileText, History, X,
  Search, CheckCircle, List, Languages, ChevronUp, Share2, Eye,
  FileKey, Workflow, ChevronDown, CheckCircle2, SkipForward, Clock
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { SessionStats, SessionStatus, LogEntry, HistoryPoint, HashcatConfig, RecoveredHash, QueueItem, EscrowAlgo, SmartWorkflowOpts } from './types';
import { INITIAL_SESSION, DEFAULT_CONFIG, HASH_TYPES } from './constants';
import LogTerminal from './components/LogTerminal';
import InteractiveTerminal from './components/InteractiveTerminal';
import CpuChart from './components/CpuChart';
import ConfigPanel from './components/ConfigPanel';
import EscrowDashboard, { AutoUploadSettings } from './components/EscrowDashboard';
import RecoveredHashList from './components/RecoveredHashList';
import QueueManager from './components/QueueManager';
import Insights, { PastSession } from './components/Insights';
import PowerGraph from './components/PowerGraph';
import RemoteAccess from './components/RemoteAccess';
import File2John from './components/File2John';
import SessionControls from './components/SessionControls';

const uuid = () => Math.random().toString(36).substring(2, 9);

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

const getCharMask = (char: string) => {
    if (/[a-z]/.test(char)) return '?l';
    if (/[A-Z]/.test(char)) return '?u';
    if (/[0-9]/.test(char)) return '?d';
    if (/\s/.test(char)) return '?b'; 
    return '?s'; 
};

const getMaskComplexity = (mask: string) => {
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

const calculateEntropy = (password: string) => {
    if (!password) return 0;
    let pool = 0;
    if (/[a-z]/.test(password)) pool += 26;
    if (/[A-Z]/.test(password)) pool += 26;
    if (/[0-9]/.test(password)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(password)) pool += 32; 
    if (pool === 0) return 0;
    return Math.log2(pool) * password.length;
};

const generateSnapshot = (hashes: RecoveredHash[], hashrate: number) => {
    if (!hashes || hashes.length === 0) {
        return { 
            sortedMasks: [], lengthCounts: {}, charsets: {}, 
            topPasswords: [], topBaseWords: [], topPrefixes: [], topSuffixes: [], 
            yearPatterns: [], datePatterns: [], delimiters: [], leetspeak: [],
            positionCounts: { lower: [], upper: [], digit: [], special: [] }, 
            avgEntropy: 0, total: 0 
        };
    }

    const maskCounts: Record<string, number> = {};
    const lengthCounts: Record<number, number> = {};
    const passwordFrequency: Record<string, number> = {};
    const baseWordFrequency: Record<string, number> = {};
    const prefixCounts: Record<string, number> = {};
    const suffixCounts: Record<string, number> = {};
    
    // Semantic Counters
    const yearCounts: Record<string, number> = {};
    const dateCounts: Record<string, number> = {};
    const delimiterCounts: Record<string, number> = {};
    const subCounts: Record<string, number> = {};

    // Position Analysis Arrays (Max length 16)
    const posLower = new Array(16).fill(0);
    const posUpper = new Array(16).fill(0);
    const posDigit = new Array(16).fill(0);
    const posSpecial = new Array(16).fill(0);

    const charsets: Record<string, number> = {
        'Numeric': 0, 'Lower Alpha': 0, 'Mixed Alpha': 0, 'Mixed Alpha-Num': 0, 'Full Complex': 0
    };
    let totalEntropy = 0;
    let validCount = 0;

    // Semantic Regex Patterns
    const regexYMD = /\b(19|20)\d{2}([-/.:_])\d{1,2}\2\d{1,2}\b/g;
    const regexDMY = /\b\d{1,2}([-/.:_])\d{1,2}\1(19|20)\d{2}\b/g;
    const regexShort = /\b\d{1,2}([-/.:_])\d{1,2}\1\d{2}\b/g;
    const regexCompactYMD = /\b(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/g;
    const regexCompactShort = /\b(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{2}\b/g;
    
    const leetspeakMap: Record<string, string> = { 
        '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', 
        '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't', '(': 'c' 
    };

    hashes.forEach(h => {
        const p = h.plain;
        if (!p) return;
        validCount++;

        const mask = p.split('').map(getCharMask).join('');
        maskCounts[mask] = (maskCounts[mask] || 0) + 1;

        // Base Word / Structure
        const match = p.match(/^([^a-zA-Z]*)([a-zA-Z]+.*[a-zA-Z]|[a-zA-Z])([^a-zA-Z]*)$/);
        if (match) {
            const prefix = match[1];
            const suffix = match[3];
            if (prefix) prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
            if (suffix) suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
        }

        // Base Word Extraction (Generalized)
        const wordMatch = p.match(/[a-zA-Z]{3,}/g);
        if (wordMatch) {
            const longestWord = wordMatch.reduce((a, b) => a.length >= b.length ? a : b);
            const key = longestWord.charAt(0).toUpperCase() + longestWord.slice(1).toLowerCase();
            baseWordFrequency[key] = (baseWordFrequency[key] || 0) + 1;
        }

        // --- Position Analysis ---
        for(let i = 0; i < Math.min(p.length, 16); i++) {
            const char = p[i];
            if (/[a-z]/.test(char)) posLower[i]++;
            else if (/[A-Z]/.test(char)) posUpper[i]++;
            else if (/[0-9]/.test(char)) posDigit[i]++;
            else posSpecial[i]++;
        }

        // --- Date Analysis ---
        const matchedDates: string[] = [];
        const matches = [
            ...Array.from(p.matchAll(regexYMD)),
            ...Array.from(p.matchAll(regexDMY)),
            ...Array.from(p.matchAll(regexShort)),
            ...Array.from(p.matchAll(regexCompactYMD)),
            ...Array.from(p.matchAll(regexCompactShort))
        ];
        
        matches.forEach(m => matchedDates.push(m[0]));
        matchedDates.forEach(d => dateCounts[d] = (dateCounts[d] || 0) + 1);

        // Simple Year Fallback
        if (matchedDates.length === 0) {
            const years = p.match(/(?:19|20)\d{2}/g);
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

    const targetPps = hashrate > 0 ? hashrate : 1000000;

    const sortedMasks = Object.entries(maskCounts)
        .map(([mask, count]) => {
            const complexity = getMaskComplexity(mask);
            return { mask, count, complexity, timeToCrack: complexity / targetPps };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 100); 

    const topPasswords = Object.entries(passwordFrequency).sort(([, a], [, b]) => b - a).slice(0, 50) as [string, number][];
    const topBaseWords = Object.entries(baseWordFrequency).sort(([, a], [, b]) => b - a).slice(0, 50) as [string, number][];
    const topPrefixes = Object.entries(prefixCounts).sort(([, a], [, b]) => b - a).slice(0, 20) as [string, number][];
    const topSuffixes = Object.entries(suffixCounts).sort(([, a], [, b]) => b - a).slice(0, 20) as [string, number][];
    
    // Process new lists
    const yearPatterns = Object.entries(yearCounts).sort(([, a], [, b]) => b - a).slice(0, 15) as [string, number][];
    const datePatterns = Object.entries(dateCounts).sort(([, a], [, b]) => b - a).slice(0, 15) as [string, number][];
    const delimiters = Object.entries(delimiterCounts).sort(([, a], [, b]) => b - a).slice(0, 10) as [string, number][];
    const leetspeak = Object.entries(subCounts).sort(([, a], [, b]) => b - a).slice(0, 15) as [string, number][];

    return {
        sortedMasks,
        lengthCounts,
        charsets,
        topPasswords,
        topBaseWords,
        topPrefixes,
        topSuffixes,
        yearPatterns,
        datePatterns,
        delimiters,
        leetspeak,
        positionCounts: { lower: posLower, upper: posUpper, digit: posDigit, special: posSpecial }, 
        avgEntropy: validCount > 0 ? totalEntropy / validCount : 0,
        total: validCount
    };
};

// --- HELPER: FORMAT HASHRATE DYNAMICALLY ---
const formatHashrate = (rate: number) => {
    if (rate === 0) return '0 H/s';
    if (rate >= 1000000000) return `${(rate / 1000000000).toFixed(2)} GH/s`;
    if (rate >= 1000000) return `${(rate / 1000000).toFixed(2)} MH/s`;
    if (rate >= 1000) return `${(rate / 1000).toFixed(2)} kH/s`;
    return `${rate.toFixed(0)} H/s`;
};

const getSocketUrl = () => {
    const host = window.location.hostname;
    if (host.includes('zrok.io') || window.location.port === '3001') {
        return window.location.origin;
    }
    return 'http://localhost:3001';
};

function App() {
  const { t, i18n } = useTranslation(); 
  const [activeTab, setActiveTab] = useState<'dashboard' | 'insights' | 'terminal' | 'escrow' | 'config' | 'queue' | 'remote' | 'file2john'>('dashboard');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('hashes_apikey') || '');
  
  const isRemoteSession = useMemo(() => window.location.hostname.includes('zrok.io') || !window.process, []);

  useEffect(() => {
    if (isRemoteSession && (activeTab === 'terminal' || activeTab === 'remote')) {
        setActiveTab('dashboard');
    }
  }, [activeTab, isRemoteSession]);

  const [config, setConfig] = useState<HashcatConfig>(() => {
      const saved = localStorage.getItem('reactor_config');
      return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });

  const [autoUploadSettings, setAutoUploadSettings] = useState<AutoUploadSettings>(() => {
      const saved = localStorage.getItem('reactor_auto_upload');
      return saved ? JSON.parse(saved) : { enabled: false, threshold: 10 };
  });

  const [escrowAlgorithms, setEscrowAlgorithms] = useState<EscrowAlgo[]>([]);

  useEffect(() => {
      localStorage.setItem('reactor_auto_upload', JSON.stringify(autoUploadSettings));
  }, [autoUploadSettings]);

  useEffect(() => {
    const fetchAlgos = async () => {
        try {
            const proxyUrl = getSocketUrl() + '/api/escrow/proxy?url=' + encodeURIComponent('https://hashes.com/en/api/algorithms');
            const response = await fetch(proxyUrl);
            const data = await response.json();
            
            if (Array.isArray(data)) {
                setEscrowAlgorithms(data);
            } else if (data.list && Array.isArray(data.list)) {
                setEscrowAlgorithms(data.list);
            } else if (data.success && Array.isArray(data.list)) {
                setEscrowAlgorithms(data.list);
            }
        } catch (e) {
            console.error("Failed to load escrow algorithms", e);
        }
    };
    fetchAlgos();
  }, []);

  const [backendConnected, setBackendConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const [sessions, setSessions] = useState<Record<string, SessionStats>>(() => {
    const savedSessions = localStorage.getItem('reactor_sessions');
    return savedSessions ? JSON.parse(savedSessions) : {};
  });

  useEffect(() => {
    localStorage.setItem('reactor_sessions', JSON.stringify(sessions));
  }, [sessions]);

  const sessionsRef = useRef(sessions);
  const [sessionLogs, setSessionLogs] = useState<Record<string, LogEntry[]>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  
  const [globalPotfile, setGlobalPotfile] = useState<RecoveredHash[]>([]);
  const [jobQueue, setJobQueue] = useState<QueueItem[]>([]);
  const [isQueueProcessing, setIsQueueProcessing] = useState(true);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const session = useMemo(() => {
    if (activeSessionId && sessions[activeSessionId]) {
        return sessions[activeSessionId];
    }
    return { 
      ...INITIAL_SESSION, 
      hashType: config.hashType, 
      recoveredHashes: [] 
    }; 
  }, [activeSessionId, sessions, config.hashType]);

  const logs = useMemo(() => {
    if (activeSessionId) return sessionLogs[activeSessionId] || [];
    return sessionLogs['general'] || [];
  }, [activeSessionId, sessionLogs]);

  const status = session.status;
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  
  const [escrowSubmissionData, setEscrowSubmissionData] = useState<string>('');
  const [escrowSubmissionAlgo, setEscrowSubmissionAlgo] = useState<string>('');
  
  const [manualTargetInput, setManualTargetInput] = useState('');
  const [manualTargetFile, setManualTargetFile] = useState<File | null>(null);
  
  const [isStarting, setIsStarting] = useState(false);
  const isStartingRef = useRef(isStarting); 
  const sessionRunningRef = useRef(false);

  const [restoreMode, setRestoreMode] = useState(false); 
  
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  
  const sessionStartTimes = useRef<Record<string, number>>({});
  const runningConfigs = useRef<Record<string, HashcatConfig>>({});

  const [showPreCrackedModal, setShowPreCrackedModal] = useState(false);
  const [preCrackedResults, setPreCrackedResults] = useState<{ total: number, found: number, list: any[], downloadToken?: string } | null>(null);
  const [isCheckingPotfile, setIsCheckingPotfile] = useState(false);

  const [smartPhase, setSmartPhase] = useState<{ phase: number; message: string } | null>(null);

  interface SmartPhaseEntry { n: number; status: 'pending' | 'running' | 'done' | 'skipped' | 'aborted'; message: string; learned?: number; masks?: number; skippedMasks?: number; phaseRecovered?: number; hashrateHps?: number; hashrateSource?: string; }
  interface SmartWorkflowState { workflowId: string; currentPhase: number; phases: SmartPhaseEntry[]; complete: boolean; maskFileId?: string; skippedMasks?: number; }
  const [smartWorkflowState, setSmartWorkflowState] = useState<SmartWorkflowState | null>(null);
  const smartWorkflowStateRef = useRef<SmartWorkflowState | null>(null);
  const [swHeaderOpen, setSwHeaderOpen] = useState(false);
  const swHeaderRef = useRef<HTMLDivElement>(null);

  const uploadingSessionIds = useRef<Set<string>>(new Set());

  const autoUploadSettingsRef = useRef(autoUploadSettings);
  const apiKeyRef = useRef(apiKey);
  const escrowAlgorithmsRef = useRef(escrowAlgorithms);

  useEffect(() => { autoUploadSettingsRef.current = autoUploadSettings; }, [autoUploadSettings]);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { escrowAlgorithmsRef.current = escrowAlgorithms; }, [escrowAlgorithms]);

  useEffect(() => {
      isStartingRef.current = isStarting;
  }, [isStarting]);

  useEffect(() => {
      sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
      smartWorkflowStateRef.current = smartWorkflowState;
  }, [smartWorkflowState]);

  const currentDisplayedCracks = useMemo(() => {
      return activeSessionId ? (session.recoveredHashes || []) : [];
  }, [activeSessionId, session.recoveredHashes]);

  const newHashesCount = useMemo(() => currentDisplayedCracks.filter(h => !h.sentToEscrow).length, [currentDisplayedCracks]);

  // --- INTELLIGENT MULTI-SESSION AUTO UPLOAD ---
  useEffect(() => {
    // Only set up the interval if API key is present and auto-upload is enabled
    if (!apiKey || !autoUploadSettings.enabled) return;

    const checkAndUploadAll = async () => {
        const currentSessions = sessionsRef.current;
        const sessionKeys = Object.keys(currentSessions);

        for (const sessId of sessionKeys) {
            if (uploadingSessionIds.current.has(sessId)) continue;

            const sess = currentSessions[sessId];
            if (!sess || !sess.recoveredHashes) continue;

            const unsentHashes = sess.recoveredHashes.filter(h => !h.sentToEscrow);
            const threshold = Number(autoUploadSettings.threshold) || 10;
            
            // Check threshold logic
            if (unsentHashes.length >= threshold) {
                uploadingSessionIds.current.add(sessId);
                
                // Algo Detection Logic - Default strictly to the hashcat mode ID
                let targetAlgoId = sess.hashType;
                
                // If it's not a number (e.g. they typed a string), attempt to parse from known types
                if (!targetAlgoId || isNaN(Number(targetAlgoId))) {
                    const hashTypeObj = HASH_TYPES?.find(ht => ht.id === sess.hashType);
                    if (hashTypeObj && escrowAlgorithms.length > 0) {
                         const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g, '');
                         const sessionAlgoName = normalize(hashTypeObj.name.split(' ')[0]);
                         const matchedAlgo = escrowAlgorithms.find(ea => normalize(ea.algorithmName) === sessionAlgoName);
                         if (matchedAlgo) targetAlgoId = matchedAlgo.id.toString();
                    }
                }

                if (!targetAlgoId || isNaN(Number(targetAlgoId))) {
                    addLog(sessId, `[AUTO-UPLOAD] Skipped: Target algorithm ID "${sess.hashType}" is invalid or unknown.`, 'WARN');
                    uploadingSessionIds.current.delete(sessId);
                    continue;
                }

                addLog(sessId, `[AUTO-UPLOAD] Threshold reached (${unsentHashes.length}/${threshold}). Sending to Algo ID ${targetAlgoId}...`, 'INFO');

                try {
                    const content = unsentHashes.map(h => `${h.hash}:${h.plain}`).join('\n');
                    const apiUrl = getSocketUrl() + '/api/escrow/proxy';
                    
                    const response = await fetch(apiUrl, { 
                        method: 'POST', 
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            key: apiKey,
                            algo: targetAlgoId,
                            fileContent: content
                        })
                    });
                    
                    const res = await response.json();

                    if (res.success === true) {
                        addLog(sessId, `[AUTO-UPLOAD] Success! Uploaded ${unsentHashes.length} hashes.`, 'SUCCESS');
                        
                        // Mark these specific hashes as sent
                        setSessions(prev => {
                            const existingSess = prev[sessId];
                            if (!existingSess) return prev;
                            return {
                                ...prev,
                                [sessId]: {
                                    ...existingSess,
                                    recoveredHashes: existingSess.recoveredHashes.map(h => 
                                        unsentHashes.some(uh => uh.id === h.id) ? { ...h, sentToEscrow: true } : h
                                    )
                                }
                            };
                        });
                    } else {
                        addLog(sessId, `[AUTO-UPLOAD] Failed: ${res.message || 'Unknown API error'}`, 'WARN');
                    }
                } catch (e: any) {
                    addLog(sessId, `[AUTO-UPLOAD] Proxy Error: ${e.message}`, 'ERROR');
                } finally {
                    setTimeout(() => { uploadingSessionIds.current.delete(sessId); }, 2000);
                }
            }
        }
    };

    const interval = setInterval(checkAndUploadAll, 8000);
    return () => clearInterval(interval);

  }, [autoUploadSettings.enabled, autoUploadSettings.threshold, apiKey, escrowAlgorithms]);

  // --- SESSION-END FLUSH: Upload remaining unsent hashes when a session finishes ---
  const flushSessionHashes = async (sessionId: string) => {
    const settings = autoUploadSettingsRef.current;
    const key = apiKeyRef.current;
    if (!settings.enabled || !key) return;

    const currentSessions = sessionsRef.current;
    const sess = currentSessions[sessionId];
    if (!sess || !sess.recoveredHashes) return;

    const unsentHashes = sess.recoveredHashes.filter(h => !h.sentToEscrow);
    if (unsentHashes.length === 0) return;

    // Skip if already being uploaded by the interval
    if (uploadingSessionIds.current.has(sessionId)) {
      // Wait for the interval upload to finish, then re-check for leftovers
      await new Promise(resolve => setTimeout(resolve, 5000));
      const recheckSess = sessionsRef.current[sessionId];
      if (!recheckSess) return;
      const stillUnsent = recheckSess.recoveredHashes.filter(h => !h.sentToEscrow);
      if (stillUnsent.length === 0) return;
      // Fall through to flush the remaining
    }

    uploadingSessionIds.current.add(sessionId);

    // Resolve the algo ID (same logic as the interval auto-upload)
    let targetAlgoId = sess.hashType;
    if (!targetAlgoId || isNaN(Number(targetAlgoId))) {
      const hashTypeObj = HASH_TYPES?.find(ht => ht.id === sess.hashType);
      if (hashTypeObj && escrowAlgorithmsRef.current.length > 0) {
        const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sessionAlgoName = normalize(hashTypeObj.name.split(' ')[0]);
        const matchedAlgo = escrowAlgorithmsRef.current.find(ea => normalize(ea.algorithmName) === sessionAlgoName);
        if (matchedAlgo) targetAlgoId = matchedAlgo.id.toString();
      }
    }

    if (!targetAlgoId || isNaN(Number(targetAlgoId))) {
      addLog(sessionId, `[SESSION-END FLUSH] Skipped: Cannot resolve algorithm ID for "${sess.hashType}".`, 'WARN');
      uploadingSessionIds.current.delete(sessionId);
      return;
    }

    // Re-fetch unsent in case interval uploaded some while we resolved the algo
    const finalSess = sessionsRef.current[sessionId];
    const finalUnsent = finalSess ? finalSess.recoveredHashes.filter(h => !h.sentToEscrow) : [];
    if (finalUnsent.length === 0) {
      uploadingSessionIds.current.delete(sessionId);
      return;
    }

    addLog(sessionId, `[SESSION-END FLUSH] Session ended with ${finalUnsent.length} unsent hashes (below threshold of ${settings.threshold}). Flushing...`, 'INFO');

    try {
      const content = finalUnsent.map(h => `${h.hash}:${h.plain}`).join('\n');
      const apiUrl = getSocketUrl() + '/api/escrow/proxy';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          algo: targetAlgoId,
          fileContent: content
        })
      });

      const res = await response.json();

      if (res.success === true) {
        addLog(sessionId, `[SESSION-END FLUSH] Success! Uploaded ${finalUnsent.length} remaining hashes.`, 'SUCCESS');
        setSessions(prev => {
          const existingSess = prev[sessionId];
          if (!existingSess) return prev;
          return {
            ...prev,
            [sessionId]: {
              ...existingSess,
              recoveredHashes: existingSess.recoveredHashes.map(h =>
                finalUnsent.some(uh => uh.id === h.id) ? { ...h, sentToEscrow: true } : h
              )
            }
          };
        });
      } else {
        addLog(sessionId, `[SESSION-END FLUSH] Failed: ${res.message || 'Unknown API error'}`, 'WARN');
      }
    } catch (e: any) {
      addLog(sessionId, `[SESSION-END FLUSH] Error: ${e.message}`, 'ERROR');
    } finally {
      uploadingSessionIds.current.delete(sessionId);
    }
  };


  useEffect(() => {
      if (activeSessionId) {
          setManualTargetInput('');
          setManualTargetFile(null);
      }
  }, [activeSessionId]);

  useEffect(() => {
    const fetchHistory = async () => {
        try {
            const res = await fetch(getSocketUrl() + '/api/history/sessions');
            if (res.ok) {
                const data = await res.json();
                const parsed = data.map((s: any) => ({ ...s, date: new Date(s.date) }));
                setPastSessions(parsed);
            }
        } catch (e) { console.error("Failed to load history", e); }
    };
    if (activeTab === 'insights' || pastSessions.length === 0) fetchHistory();
  }, [activeTab]);

  useEffect(() => { localStorage.setItem('hashes_apikey', apiKey); }, [apiKey]);

  useEffect(() => { localStorage.setItem('reactor_config', JSON.stringify(config)); }, [config]);

  // --- QUEUE PROCESSOR EFFECT ---  
  useEffect(() => {
      const processQueue = async () => {
          if (!backendConnected || !isQueueProcessing || jobQueue.length === 0 || isStarting) return;
          if (sessionRunningRef.current) return;

          const anyRunning = Object.values(sessions).some(s => 
            s.status === SessionStatus.RUNNING || s.status === SessionStatus.PAUSED
          );
          
          if (anyRunning) { sessionRunningRef.current = true; return; }

          sessionRunningRef.current = true;
          const nextJob = jobQueue[0];
          addLog('general', `[QUEUE] Auto-starting next job: ${nextJob.id}${nextJob.workflowOpts ? ' [Smart Workflow]' : ''}`, 'INFO');
          setIsStarting(true);
          // Keep the ref in sync immediately. The useEffect that mirrors
          // isStarting → isStartingRef runs after this tick, but the
          // session_started socket event for the queued job can fire during
          // the await below; without this, isStartingRef.current is still
          // false and setActiveSessionId(...) in the session_started handler
          // never runs — which is why the Smart Workflow widget stayed hidden
          // for queued runs.
          isStartingRef.current = true;

          try {
              if (nextJob.workflowOpts) {
                  // Smart Workflow queue job — use the config snapshot saved at queue-add time
                  // Clear any prior workflow state up-front so phase events that arrive during
                  // the fetch await aren't wiped after the response comes back.
                  setSmartWorkflowState(null);
                  smartWorkflowStateRef.current = null;
                  const wOpts = nextJob.workflowOpts;
                  const qCfg = nextJob.config;
                  const unitToSec = wOpts.phase3TimeUnit === 'minutes' ? 60 : wOpts.phase3TimeUnit === 'hours' ? 3600 : 86400;
                  const payload = {
                      targetPath: qCfg.targetPath,
                      hashType: qCfg.hashType,
                      wordlistPath: qCfg.wordlistPath,
                      initialRulePath: wOpts.rulePath || undefined,
                      // Global performance / hardware flags (snapshotted from config at queue time)
                      workloadProfile: qCfg.workloadProfile,
                      devices: qCfg.devices || undefined,
                      optimizedKernel: qCfg.optimizedKernel,
                      statusTimer: qCfg.statusTimer || 3,
                      hwmonDisable: qCfg.hwmonDisable,
                      backendDisableOpenCL: qCfg.backendDisableOpenCL,
                      backendIgnoreCuda: qCfg.backendIgnoreCuda,
                      selfTestDisable: qCfg.selfTestDisable,
                      keepGuessing: qCfg.keepGuessing,
                      logfileDisable: qCfg.logfileDisable,
                      force: qCfg.force,
                      bitmapMax: qCfg.bitmapMax,
                      remove: qCfg.remove,
                      // Workflow-specific
                      maskMinLen: wOpts.maskMinLen,
                      maskMaxLen: wOpts.maskMaxLen,
                      phase3Runtime: wOpts.phase3Runtime * 60,
                      phase3Increment: wOpts.phase3Increment,
                      maxMasks: wOpts.maxMasks,
                      skipPhase3: wOpts.skipPhase3,
                      skipPhase4: wOpts.skipPhase4,
                      phase3TimeBudgetSeconds: wOpts.phase3TimeBudget > 0 ? Math.round(wOpts.phase3TimeBudget * unitToSec) : 0,
                      phase3HashrateHps: 0,
                      historicalHashrateHps: historicalHashrateForAlgo(qCfg.hashType),
                      phase3SortMode: wOpts.phase3SortMode,
                  };
                  const res = await fetch(getSocketUrl() + '/api/smart-workflow/start', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                  });
                  const data = await res.json();
                  if (data.workflowId) {
                      runningConfigs.current[data.workflowId] = nextJob.config;
                      // Force-select the new workflow so the Smart Workflow widget
                      // gates on the right activeSessionId. The session_started
                      // handler also tries to do this, but only when isStartingRef
                      // is already true — which races with React state updates.
                      setActiveSessionId(data.workflowId);
                      updateSession(data.workflowId, { hashType: nextJob.config.hashType });
                      setJobQueue(prev => prev.slice(1));
                      setActiveTab('dashboard');
                  } else {
                      sessionRunningRef.current = false;
                  }
              } else {
                  // Regular session queue job — clear workflow state before the
                  // request so any late phase events from a prior workflow can't
                  // bleed in after the response returns.
                  setSmartWorkflowState(null);
                  smartWorkflowStateRef.current = null;
                  setSmartPhase(null);
                  const payload = { ...nextJob.config };
                  const res = await fetch(getSocketUrl() + '/api/session/start', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                  });
                  const data = await res.json();
                  if (data.sessionId) {
                      runningConfigs.current[data.sessionId] = nextJob.config;
                      setActiveSessionId(data.sessionId);
                      setJobQueue(prev => prev.slice(1));
                      setActiveTab('dashboard');
                  } else {
                      sessionRunningRef.current = false;
                  }
              }
          } catch (e: any) {
              addLog('general', `[QUEUE] Failed to start job: ${e.message}`, 'ERROR');
              setJobQueue(prev => prev.slice(1));
              sessionRunningRef.current = false;
          } finally {
              setIsStarting(false);
          }
      };

      const timer = setTimeout(processQueue, 2500);
      return () => clearTimeout(timer);
  }, [backendConnected, isQueueProcessing, jobQueue, sessions, isStarting]);


  // --- Socket Handling ---
  useEffect(() => {
    try {
      const socket = io(getSocketUrl(), { reconnection: true });
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
      socket.on('potfile_sync', (data: RecoveredHash[]) => {
          setGlobalPotfile(data);
          addLog('general', `[SYSTEM] Loaded ${data.length} historical hashes.`, 'INFO');
      });
      socket.on('session_started', ({ sessionId, name, target, recoveredHashes, hashType, attackMode }: any) => {
          sessionRunningRef.current = true;
          setSessions(prev => {
              const existing = prev[sessionId];
              const realHashType = hashType || (existing ? existing.hashType : INITIAL_SESSION.hashType);
              
              return {
                ...prev,
                [sessionId]: { 
                    ...INITIAL_SESSION, 
                    ...existing,
                    sessionId, 
                    name,
                    target,
                    hashType: realHashType,
                    recoveredHashes: recoveredHashes || (existing ? existing.recoveredHashes : [])
                }
            };
          });
          if (!sessionStartTimes.current[sessionId]) sessionStartTimes.current[sessionId] = Date.now();
          if (isStartingRef.current) setActiveSessionId(sessionId);
      });
      socket.on('session_status', (data: { sessionId: string, status: string }) => {
         const { sessionId, status: rawStatus } = data;
         let newStatus = SessionStatus.IDLE;
         if (rawStatus === 'RUNNING') newStatus = SessionStatus.RUNNING;
         else if (rawStatus === 'PAUSED') newStatus = SessionStatus.PAUSED;
         else if (rawStatus === 'COMPLETED') newStatus = SessionStatus.COMPLETED;
         else if (rawStatus === 'ERROR') newStatus = SessionStatus.ERROR;
         else if (rawStatus === 'STOPPED') newStatus = SessionStatus.STOPPED;
         updateSession(sessionId, { status: newStatus });
      });
      socket.on('session_finished', (data: any) => {
          sessionRunningRef.current = false;
          // Finalize SW state BEFORE saveSessionHistory so the saved phaseBreakdown
          // reflects any abort markers we add below (saveSessionHistory reads
          // smartWorkflowStateRef.current).
          const prev = smartWorkflowStateRef.current;
          if (prev?.workflowId === data.sessionId && !prev.complete) {
              // Workflow is wrapping up without a natural P4 completion — treat
              // any phase still 'running' or 'pending' as interrupted.
              const phases = prev.phases.map(p =>
                  (p.status === 'running' || p.status === 'pending')
                      ? { ...p, status: 'aborted' as const, message: p.status === 'running' ? `${p.message || ''}${p.message ? ' · ' : ''}interrupted` : 'aborted before start' }
                      : p
              );
              const finalized: SmartWorkflowState = { ...prev, phases, complete: true };
              smartWorkflowStateRef.current = finalized;
              setSmartWorkflowState(finalized);
              setSmartPhase(null);
          } else if (prev?.workflowId === data.sessionId) {
              setSmartPhase(null);
              const finalized: SmartWorkflowState = { ...prev, complete: true };
              smartWorkflowStateRef.current = finalized;
              setSmartWorkflowState(finalized);
          }
          saveSessionHistory(data.sessionId, data.duration, data.recovered, data.total, data.avgHashrate, data.avgPower);
          flushSessionHashes(data.sessionId);
      });
      socket.on('session_deleted', (data: { sessionId: string }) => {
          sessionRunningRef.current = false;
          setSessions(prev => { const next = { ...prev }; delete next[data.sessionId]; return next; });
          if (activeSessionId === data.sessionId) setActiveSessionId(null);
      });
      socket.on('stats_update', (data: any) => {
        const { sessionId, type, value, isAggregate } = data;
        if (type === 'hashrate') updateSession(sessionId, { hashrate: value });
        else if (type === 'progress') updateSession(sessionId, { progress: value });
        else if (type === 'recovered') updateSession(sessionId, { recovered: value });
        else if (type === 'total') updateSession(sessionId, { total: value });
        else if (type === 'time_estimated') updateSession(sessionId, { estimatedTimeRemaining: value });
      });
      socket.on('smart_workflow_phase', (data: { workflowId: string; phase: number; message: string; complete?: boolean; skipped?: boolean; learned?: number; masks?: number; skippedMasks?: number; maskFileId?: string; phaseRecovered?: number; hashrateHps?: number; hashrateSource?: string }) => {
          const isDone = data.complete || data.skipped;
          setSmartPhase(data.complete ? null : { phase: data.phase, message: data.message });
          addLog(data.workflowId, `[Smart Phase ${data.phase}/4] ${data.message}`, 'INFO');
          if (data.learned !== undefined) addLog(data.workflowId, `  ↳ Learned ${data.learned} passwords, generated ${data.masks} mask patterns${data.skippedMasks ? ` (${data.skippedMasks} exceed time budget — saved for download)` : ''}`, 'SUCCESS');
          if (data.hashrateHps && data.hashrateHps > 0) addLog(data.workflowId, `  ↳ Assets budgeted against ${(data.hashrateHps / 1e6).toFixed(2)} MH/s (${data.hashrateSource || 'unknown'})`, 'INFO');

          // Compute next state from the ref (always current) so smartWorkflowStateRef is
          // updated synchronously. This guarantees a follow-up session_finished event in
          // the same socket batch sees the just-committed phaseRecovered when it reads
          // smartWorkflowStateRef.current in saveSessionHistory.
          const prev = smartWorkflowStateRef.current;
          const base = prev?.workflowId === data.workflowId ? prev : {
              workflowId: data.workflowId,
              currentPhase: data.phase,
              phases: [1, 2, 3, 4].map(n => ({ n, status: 'pending' as const, message: '' })),
              complete: false,
              maskFileId: undefined as string | undefined,
              skippedMasks: undefined as number | undefined,
          };
          const phases = base.phases.map(p => {
              if (p.n < data.phase) return { ...p, status: 'done' as const };
              if (p.n === data.phase) return {
                  ...p,
                  status: (data.skipped ? 'skipped' : isDone && data.phase === 4 ? 'done' : data.complete ? 'done' : 'running') as SmartPhaseEntry['status'],
                  message: data.message,
                  learned: data.learned,
                  masks: data.masks,
                  skippedMasks: data.skippedMasks,
                  phaseRecovered: data.phaseRecovered !== undefined ? (p.phaseRecovered || 0) + data.phaseRecovered : p.phaseRecovered,
                  hashrateHps: data.hashrateHps !== undefined ? data.hashrateHps : p.hashrateHps,
                  hashrateSource: data.hashrateSource !== undefined ? data.hashrateSource : p.hashrateSource,
              };
              return p;
          });
          const nextState: SmartWorkflowState = {
              workflowId: data.workflowId,
              currentPhase: data.phase,
              phases,
              complete: !!data.complete,
              maskFileId: data.maskFileId || base.maskFileId,
              skippedMasks: data.skippedMasks !== undefined ? data.skippedMasks : base.skippedMasks,
          };
          smartWorkflowStateRef.current = nextState;
          setSmartWorkflowState(nextState);
      });
      socket.on('session_crack', (data: any) => {
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
              return { ...prev, [data.sessionId]: { ...sess, recoveredHashes: [newCrack, ...sess.recoveredHashes] } };
          });
          setGlobalPotfile(prev => {
             if (prev.some(h => h.hash === data.hash)) return prev;
             return [{ id: uuid(), hash: data.hash, plain: data.plain, algorithmId: '0', timestamp: Date.now(), sentToEscrow: false }, ...prev];
          });
      });
      socketRef.current = socket;
      return () => { socket.disconnect(); };
    } catch (e) { console.warn("Socket connection failed", e); }
  }, []); 

  const updateSession = (sessionId: string, updates: Partial<SessionStats>) => {
      setSessions(prev => {
          const existing = prev[sessionId] || { ...INITIAL_SESSION, sessionId, recoveredHashes: [] };
          return { ...prev, [sessionId]: { ...existing, ...updates } };
      });
  };

  const deleteSession = async (sessionId: string) => {
      try {
          await fetch(getSocketUrl() + '/api/session/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId })
          });
      } catch(e) { console.error("Failed to delete session", e); }
  };

  // Rolling log window. Sessions can run for days; keeping every line would balloon
  // memory and slow rendering. Drop entries older than LOG_RETENTION_MS on every
  // append, with a hard cap as a safety net for bursts inside the retention window.
  const LOG_RETENTION_MS = 3 * 60 * 1000; // ~3 minutes
  const LOG_HARD_CAP = 1000;
  const addLog = (sessionId: string, message: string, level: LogEntry['level'] = 'INFO') => {
    const entry = { id: uuid(), sessionId, timestamp: new Date(), level, message };
    setSessionLogs(prev => {
        const sessionLog = prev[sessionId] || [];
        const cutoff = Date.now() - LOG_RETENTION_MS;
        const pruned = sessionLog.filter(l => {
            const t = l.timestamp instanceof Date ? l.timestamp.getTime() : new Date(l.timestamp).getTime();
            return t >= cutoff;
        });
        const capped = pruned.length > LOG_HARD_CAP ? pruned.slice(-LOG_HARD_CAP) : pruned;
        return { ...prev, [sessionId]: [...capped, entry] };
    });
  };

  // Periodic cleanup so stale logs drop out of view even while the session is idle
  // (no new appends triggering the in-addLog prune).
  useEffect(() => {
    const interval = setInterval(() => {
        setSessionLogs(prev => {
            const cutoff = Date.now() - LOG_RETENTION_MS;
            let changed = false;
            const next: Record<string, LogEntry[]> = {};
            for (const sid of Object.keys(prev)) {
                const entries = prev[sid];
                const filtered = entries.filter(l => {
                    const t = l.timestamp instanceof Date ? l.timestamp.getTime() : new Date(l.timestamp).getTime();
                    return t >= cutoff;
                });
                if (filtered.length !== entries.length) changed = true;
                next[sid] = filtered;
            }
            return changed ? next : prev;
        });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const saveSessionHistory = (sessionId: string, duration: number, recovered: number, total: number, avgHashrate: number, avgPower: number) => {
      const currentSessionData = sessionsRef.current[sessionId];
      const recoveredHashes = currentSessionData ? currentSessionData.recoveredHashes : [];

      // Skip only sessions that clearly never ran: sub-3-second duration, zero hashrate,
      // and nothing recovered.  Any session that ran for ≥ 3 s is always saved so that
      // legitimate wordlist/brute-force attacks aren't silently dropped when they crack
      // nothing (e.g. wrong password list) or exit at exhaustion with a 0 H/s status line.
      const isDegenerate = (duration < 3) && (avgHashrate <= 0) && (recoveredHashes.length === 0) && (recovered <= 0);
      if (isDegenerate) {
          delete runningConfigs.current[sessionId];
          delete sessionStartTimes.current[sessionId];
          return;
      }
      const usedConfig = runningConfigs.current[sessionId] || config;
      const date = sessionStartTimes.current[sessionId] ? new Date(sessionStartTimes.current[sessionId]) : new Date();

      // Detect smart workflow sessions by name or workflow state
      const sessionName = currentSessionData?.name || '';
      const swState = smartWorkflowStateRef.current;
      const isWorkflow = sessionName.startsWith('Smart Workflow') || swState?.workflowId === sessionId;

      // Capture phase breakdown for smart workflow sessions
      const phaseLabels = ['Dictionary Attack', 'Generate Assets', 'Mask Attack', 'Feedback Rules'];
      const phaseBreakdown = isWorkflow && swState?.workflowId === sessionId
          ? swState.phases.map(p => ({
              phase: p.n,
              label: phaseLabels[p.n - 1] || `Phase ${p.n}`,
              recovered: p.phaseRecovered || 0,
              status: p.status,
              learned: p.learned,
              masks: p.masks,
              hashrateHps: p.hashrateHps,
              hashrateSource: p.hashrateSource,
          }))
          : undefined;

      // Generate actual snapshot data
      const analysisSnapshot = generateSnapshot(recoveredHashes, avgHashrate);

      // Use recovered hashes count from session if backend reported 0
      const finalRecovered = recovered > 0 ? recovered : recoveredHashes.length;

      const pastSession: PastSession = {
          id: uuid(),
          date: date,
          duration: duration || 0,
          mode: HASH_TYPES.find(h => h.id === usedConfig.hashType)?.name || usedConfig.hashType,
          algorithmId: usedConfig.hashType,
          attackType: isWorkflow ? 'Smart Workflow' : getAttackModeName(usedConfig.attackMode),
          attackMode: isWorkflow ? 0 : usedConfig.attackMode,
          recovered: finalRecovered,
          totalHashes: total,
          avgHashrate: avgHashrate || 0,
          powerUsage: avgPower || 0,
          analysis: analysisSnapshot,
          phaseBreakdown,
          maskFileId: isWorkflow && swState?.workflowId === sessionId ? swState.maskFileId : undefined,
          skippedMasks: isWorkflow && swState?.workflowId === sessionId ? swState.skippedMasks : undefined,
          sessionId: sessionId,
      };
      
      delete runningConfigs.current[sessionId];
      delete sessionStartTimes.current[sessionId];
      
      setPastSessions(prev => [pastSession, ...prev]);
      fetch(getSocketUrl() + '/api/history/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pastSession)
      }).catch(console.error);
  };

  // Close SW header dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (swHeaderRef.current && !swHeaderRef.current.contains(e.target as Node)) {
        setSwHeaderOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (backendConnected && status === SessionStatus.RUNNING) {
       const interval = setInterval(() => {
          setHistory(h => [...h.slice(-59), { timestamp: Date.now(), hashrate: session.hashrate / 1000000, temp: 0 }]);
       }, 2000);
       return () => clearInterval(interval);
    }
  }, [backendConnected, status, session.hashrate]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setManualTargetFile(file);
      setManualTargetInput(''); 
    }
    // RESET INPUT VALUE TO ALLOW RE-SELECTION OF SAME FILE
    e.target.value = '';
  };

  const handleManualTargetLoad = async () => {
    if (manualTargetFile) addLog(activeSessionId || 'general', `Target Set: ${manualTargetFile.name}`, 'CMD');
    else if (manualTargetInput) addLog(activeSessionId || 'general', `Target Set: Manual Input`, 'CMD');
  };

  // --- PREPARE TARGET ---
  const prepareTarget = async (): Promise<string> => {
      if (manualTargetFile) {
          if ((manualTargetFile as any).path) return (manualTargetFile as any).path;
          addLog('general', `[REMOTE] Auto-uploading target file...`, 'INFO');
          try {
              const formData = new FormData();
              formData.append('file', manualTargetFile);
              const res = await fetch(getSocketUrl() + '/api/upload', { method: 'POST', body: formData });
              if (!res.ok) throw new Error("Upload failed");
              const data = await res.json();
              addLog('general', `[REMOTE] Target uploaded to: ${data.path}`, 'SUCCESS');
              return data.path;
          } catch (e: any) {
              addLog('general', `[REMOTE] Target Upload Failed: ${e.message}`, 'ERROR');
              return '';
          }
      } 
      else if (manualTargetInput) {
          const res = await fetch(getSocketUrl() + '/api/target', {
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
          // Prefer the user's current manual selection (uploads fresh) over any
          // stale config.targetPath left over from a prior Escrow / library pick.
          // Otherwise the queue snapshots the old path and the run fails on a
          // multer-named upload that no longer matches what the user picked.
          let targetPath = '';
          let targetSummary = '';
          const manualPath = await prepareTarget();
          if (manualPath) {
              targetPath = manualPath;
              targetSummary = manualTargetFile ? manualTargetFile.name : 'Manual Input Buffer';
          } else if (config.targetPath) {
              targetPath = config.targetPath;
              targetSummary = config.targetPath.split(/[\\/]/).pop() || config.targetPath;
          } else {
              addLog('general', 'Cannot queue: No target selected.', 'ERROR');
              return;
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
      } catch (e: any) { addLog('general', `Queue Error: ${e.message}`, 'ERROR'); }
  };

  // --- SMART WORKFLOW ---
  // Historical hashrate lookup for a given algorithm, mirroring the Insights
  // compensation logic. Preferred over a live measurement when the live rate is
  // artificially depressed (e.g. Phase 1 finishing a tiny dictionary before the
  // GPU reaches steady state).
  const historicalHashrateForAlgo = (algoId: string): number => {
    const matching = (pastSessions || []).filter(s => s.algorithmId === algoId && s.avgHashrate > 0);
    if (matching.length === 0) return 0;
    const bf = matching.filter(s => s.attackMode === 3);
    if (bf.length > 0) return bf.reduce((acc, s) => acc + s.avgHashrate, 0) / bf.length;
    const maxRate = Math.max(...matching.map(s => s.avgHashrate));
    return maxRate * 1.4; // same compensation as Insights.detectHashrateForAlgo
  };

  // Effective smart-workflow state for the currently selected session. The
  // widget is only shown when the selected session IS a smart workflow — either
  // a live run whose workflowId matches, or a past session whose phaseBreakdown
  // was recorded. Selecting any non-SW session hides the widget entirely.
  const effectiveSwState = useMemo<SmartWorkflowState | null>(() => {
    // No session selected: fall through to the live workflow state if one is running.
    if (!activeSessionId) return smartWorkflowState;
    // Live workflow that matches the selected session.
    if (smartWorkflowState && smartWorkflowState.workflowId === activeSessionId) {
      return smartWorkflowState;
    }
    // Past smart workflow session — rehydrate a frozen snapshot. Match on the
    // saved sessionId first, then fall back to maskFileId (older sessions that
    // pre-date the sessionId field still carry the workflowId there).
    const candidates = (pastSessions || []).filter(p => p.phaseBreakdown && p.phaseBreakdown.length > 0);
    const past = candidates.find(p => p.sessionId === activeSessionId)
              || candidates.find(p => p.maskFileId === activeSessionId);
    if (!past || !past.phaseBreakdown) return null;
    const phases: SmartPhaseEntry[] = past.phaseBreakdown.map(p => ({
      n: p.phase,
      status: p.status,
      message: '',
      learned: p.learned,
      masks: p.masks,
      phaseRecovered: p.recovered,
      hashrateHps: p.hashrateHps,
      hashrateSource: p.hashrateSource,
    }));
    return {
      workflowId: past.sessionId || past.maskFileId || past.id,
      currentPhase: phases.length,
      phases,
      complete: true,
      maskFileId: past.maskFileId,
      skippedMasks: past.skippedMasks,
    };
  }, [smartWorkflowState, activeSessionId, pastSessions]);

  const buildWorkflowPayload = (targetPath: string, opts: SmartWorkflowOpts) => {
    const unitToSec = opts.phase3TimeUnit === 'minutes' ? 60 : opts.phase3TimeUnit === 'hours' ? 3600 : 86400;
    const phase3TimeBudgetSeconds = opts.phase3TimeBudget > 0 ? Math.round(opts.phase3TimeBudget * unitToSec) : 0;
    const historicalHashrateHps = historicalHashrateForAlgo(config.hashType);
    return {
      // Target & attack config
      targetPath,
      hashType: config.hashType,
      wordlistPath: config.wordlistPath,
      initialRulePath: opts.rulePath || undefined,
      // ── Global performance / hardware flags (from Config menu) ──
      workloadProfile: config.workloadProfile,
      devices: config.devices || undefined,
      optimizedKernel: config.optimizedKernel,   // -O from global config
      statusTimer: config.statusTimer || 3,        // --status-timer
      hwmonDisable: config.hwmonDisable,           // --hwmon-disable
      backendDisableOpenCL: config.backendDisableOpenCL, // --backend-ignore-opencl
      backendIgnoreCuda: config.backendIgnoreCuda, // --backend-ignore-cuda
      selfTestDisable: config.selfTestDisable,     // --self-test-disable
      keepGuessing: config.keepGuessing,           // --keep-guessing
      logfileDisable: config.logfileDisable,       // --logfile-disable
      force: config.force,                         // --force
      bitmapMax: config.bitmapMax,                 // --bitmap-max
      remove: config.remove,                       // --remove
      // ── Workflow-specific Phase 3 controls ──
      maskMinLen: opts.maskMinLen,
      maskMaxLen: opts.maskMaxLen,
      phase3Runtime: opts.phase3Runtime * 60,      // minutes → seconds for --runtime
      phase3Increment: opts.phase3Increment,
      maxMasks: opts.maxMasks,
      skipPhase3: opts.skipPhase3,
      skipPhase4: opts.skipPhase4,
      phase4RulePaths: opts.phase4RulePaths || [],
      phase3TimeBudgetSeconds,
      phase3HashrateHps: session.hashrate > 0 ? session.hashrate : 0,
      historicalHashrateHps,
      phase3SortMode: opts.phase3SortMode,
    };
  };

  const handleStartSmartWorkflow = async (opts: SmartWorkflowOpts) => {
    if (!backendConnected) { addLog('general', 'Smart Workflow: Backend disconnected.', 'ERROR'); return; }

    setIsStarting(true);
    sessionRunningRef.current = true;
    setSmartWorkflowState(null);
    setActiveTab('dashboard');

    try {
      let targetPath = await prepareTarget();
      if (!targetPath) {
        addLog('general', 'Smart Workflow aborted: No target file selected.', 'ERROR');
        sessionRunningRef.current = false;
        setIsStarting(false);
        return;
      }

      const payload = buildWorkflowPayload(targetPath, opts);

      const res = await fetch(getSocketUrl() + '/api/smart-workflow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.workflowId) {
        runningConfigs.current[data.workflowId] = config;
        updateSession(data.workflowId, { hashType: config.hashType });
        setActiveSessionId(data.workflowId);
      } else {
        sessionRunningRef.current = false;
      }
    } catch (e: any) {
      addLog('general', `Smart Workflow Error: ${e.message}`, 'ERROR');
      sessionRunningRef.current = false;
    } finally {
      setIsStarting(false);
    }
  };

  const handleQueueSmartWorkflow = async (opts: SmartWorkflowOpts) => {
    try {
      // Mirror handleAddToQueue: prefer the live manual selection so a stale
      // config.targetPath can't override the file the user just picked.
      let targetPath = '';
      let targetSummary = '';
      const manualPath = await prepareTarget();
      if (manualPath) {
        targetPath = manualPath;
        targetSummary = manualTargetFile ? manualTargetFile.name : 'Manual Input Buffer';
      } else if (config.targetPath) {
        targetPath = config.targetPath;
        targetSummary = config.targetPath.split(/[\\/]/).pop() || config.targetPath;
      } else {
        addLog('general', 'Cannot queue workflow: No target selected.', 'ERROR');
        return;
      }
      const queueConfig = { ...config, targetPath };
      const newJob: QueueItem = {
        id: uuid(),
        config: queueConfig,
        status: 'PENDING',
        addedAt: Date.now(),
        targetSummary: targetSummary || 'Unknown',
        workflowOpts: opts,
      };
      setJobQueue(prev => [...prev, newJob]);
      addLog('general', `Added Smart Workflow to queue. Position: ${jobQueue.length + 1}`, 'SUCCESS');
      setActiveTab('queue');
    } catch (e: any) { addLog('general', `Queue Error: ${e.message}`, 'ERROR'); }
  };

  // --- MANUAL START ---
  const toggleSession = async (overrideCommand?: string) => {
    if (activeSessionId && (session.status === SessionStatus.RUNNING || session.status === SessionStatus.PAUSED)) {
      await fetch(getSocketUrl() + '/api/session/stop', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: activeSessionId })
      });
    } else {
      if (!backendConnected) { addLog('general', "Backend disconnected.", "ERROR"); return; }
      
      sessionRunningRef.current = true;
      setIsStarting(true);
      setActiveTab('dashboard');
      
      try {
        let targetPath = await prepareTarget();
        if (!targetPath && !restoreMode && !overrideCommand) {
            addLog('general', `Start Aborted: No target.`, 'ERROR');
            sessionRunningRef.current = false;
            setIsStarting(false);
            return;
        }

        let payload = {};
        if (restoreMode) {
            payload = { restore: true };
            addLog('general', `Attempting restore from previous session...`, 'CMD');
        } else {
            payload = overrideCommand ? { customCommand: overrideCommand } : { ...config, targetPath };
        }
        
        const res = await fetch(getSocketUrl() + '/api/session/start', { 
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.sessionId) {
            runningConfigs.current[data.sessionId] = config;
            updateSession(data.sessionId, { hashType: config.hashType });
            // Clear any active workflow card — this is a regular session
            setSmartWorkflowState(null);
            setSmartPhase(null);
        } else {
             sessionRunningRef.current = false;
        }
      } catch (e: any) {
        addLog('general', `Start Error: ${e.message}`, 'ERROR');
        sessionRunningRef.current = false;
      } finally {
        setIsStarting(false);
      }
    }
  };

  const handleSendToEscrow = (hashes: RecoveredHash[]) => {
      const newHashes = hashes.filter(h => !h.sentToEscrow);
      if (newHashes.length === 0) { addLog("general", "No new hashes to send to escrow.", "WARN"); return; }
      const content = newHashes.map(h => `${h.hash}:${h.plain}`).join('\n');
      setEscrowSubmissionData(content);
      setEscrowSubmissionAlgo(activeSessionId ? session.hashType : config.hashType); 
      if (activeSessionId) {
          setSessions(prev => ({ ...prev, [activeSessionId]: { ...prev[activeSessionId], recoveredHashes: prev[activeSessionId].recoveredHashes.map(h => newHashes.some(nh => nh.id === h.id) ? { ...h, sentToEscrow: true } : h) } }));
      }
      setActiveTab('escrow');
      addLog("general", `Prepared ${newHashes.length} new hashes for escrow.`, 'INFO');
  };

  const handleExportSessionCracks = () => {
    if (currentDisplayedCracks.length === 0) { addLog('general', 'No cracks to export.', 'WARN'); return; }
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
    addLog('general', `Exported ${currentDisplayedCracks.length} cracks to .txt`, 'SUCCESS');
  };

  const handleCheckPotfile = async () => {
    if (!manualTargetFile && !manualTargetInput) { addLog("general", "No target set to check.", "WARN"); return; }
    setIsCheckingPotfile(true);
    try {
        let payload = {};
        if (manualTargetFile) {
            let path = '';
            if ((manualTargetFile as any).path) path = (manualTargetFile as any).path;
            else {
                 const formData = new FormData();
                 formData.append('file', manualTargetFile);
                 const res = await fetch(getSocketUrl() + '/api/upload', { method: 'POST', body: formData });
                 const data = await res.json();
                 path = data.path;
            }
            payload = { targetPath: path };
        } else if (manualTargetInput) {
            payload = { content: manualTargetInput };
        }
        const res = await fetch(getSocketUrl() + '/api/target/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        setPreCrackedResults({ total: data.totalTarget, found: data.foundCount, list: data.preview, downloadToken: data.downloadToken } as any);
        setShowPreCrackedModal(true);
        addLog("general", `Analysis complete: ${data.foundCount} / ${data.totalTarget} hashes found.`, 'SUCCESS');
    } catch (e) { addLog("general", "Failed to check potfile.", "ERROR"); } 
    finally { setIsCheckingPotfile(false); }
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans">
      <aside className="w-20 lg:w-64 border-r border-slate-800 flex flex-col bg-slate-950 z-50 fixed h-screen lg:h-screen lg:static">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800 shrink-0">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center"><Hash className="text-white" size={20} /></div>
          <span className="ml-3 font-bold text-lg hidden lg:block">{t('app_title')}</span>
        </div>
        
        <nav className="flex-1 overflow-y-auto no-scrollbar flex flex-col">
            <div className="p-4 flex-1">
                <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'dashboard' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><LayoutDashboard size={20} /><span className="ml-3 hidden lg:block font-medium">{t('nav_dashboard')}</span></button>
                <button onClick={() => setActiveTab('queue')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'queue' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}>
                    <List size={20} /><div className="ml-3 hidden lg:flex items-center justify-between flex-1 font-medium"><span>{t('nav_queue')}</span>{jobQueue.length > 0 && <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">{jobQueue.length}</span>}</div>
                </button>
                <button onClick={() => setActiveTab('insights')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'insights' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Microscope size={20} /><span className="ml-3 hidden lg:block font-medium">{t('nav_insights')}</span></button>
                <button onClick={() => setActiveTab('escrow')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'escrow' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Globe size={20} /><span className="ml-3 hidden lg:block font-medium">{t('nav_escrow')}</span></button>

{/* File2John Tab Button with i18n */}
                <button onClick={() => setActiveTab('file2john')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'file2john' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}>
                   <FileKey size={20} />
                   <span className="ml-3 hidden lg:block font-medium">{t('nav_extractor')}</span>
                </button>

                <button onClick={() => setActiveTab('config')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'config' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}><Settings size={20} /><span className="ml-3 hidden lg:block font-medium">{t('nav_config')}</span></button>
             
                {!isRemoteSession && (
                   <>
                     <button onClick={() => setActiveTab('remote')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'remote' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}>
                        <Share2 size={20} />
                        <span className="ml-3 hidden lg:block font-medium">{t('nav_remote')}</span> 
                     </button>
                     <button onClick={() => setActiveTab('terminal')} className={`w-full flex items-center p-3 rounded-lg transition-all mb-1 ${activeTab === 'terminal' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20' : 'text-slate-400 hover:bg-slate-900'}`}>
                        <Terminal size={20} />
                        <span className="ml-3 hidden lg:block font-medium">{t('nav_terminal')}</span>
                     </button>
                    </>
                )}
            </div>
            
            <div className="px-4 pb-4 hidden lg:block space-y-4 shrink-0 bg-slate-950 border-t border-slate-800 pt-4">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">{backendConnected ? <Link size={14} className="text-emerald-500" /> : <Unlink size={14} className="text-red-500" />}<span>{backendConnected ? t('bridge_connected') : t('bridge_offline')}</span></div>
                <PowerGraph socket={socketRef.current} compact={true} />
            </div>
        </nav>

        <div className="p-4 border-t border-slate-800 hidden lg:block shrink-0 bg-slate-950 z-50">
           <div className="relative">
              <button onClick={() => setIsLangMenuOpen(!isLangMenuOpen)} className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:border-slate-700 transition-all text-xs">
                  <div className="flex items-center gap-2"><Languages size={14} className="text-indigo-400" /><span>{i18n.language.startsWith('zh') ? '中文' : 'English'}</span></div>
                  <ChevronUp size={14} className={`transition-transform duration-200 ${isLangMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isLangMenuOpen && (
                  <div className="absolute bottom-full left-0 w-full mb-2 bg-slate-900 border border-slate-800 rounded-lg shadow-xl overflow-hidden flex flex-col z-50 animate-in slide-in-from-bottom-2 fade-in duration-200">
                      <button onClick={() => { i18n.changeLanguage('en'); setIsLangMenuOpen(false); }} className={`flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-slate-800 transition-colors ${i18n.language.startsWith('en') ? 'text-white font-bold bg-slate-800/50' : 'text-slate-400'}`}><span>English</span>{i18n.language.startsWith('en') && <CheckCircle size={12} className="text-emerald-500" />}</button>
                      <div className="h-px bg-slate-800 mx-2"></div>
                      <button onClick={() => { i18n.changeLanguage('zh'); setIsLangMenuOpen(false); }} className={`flex items-center justify-between w-full px-3 py-2 text-xs hover:bg-slate-800 transition-colors ${i18n.language.startsWith('zh') ? 'text-white font-bold bg-slate-800/50' : 'text-slate-400'}`}><span>中文</span>{i18n.language.startsWith('zh') && <CheckCircle size={12} className="text-emerald-500" />}</button>
                  </div>
              )}
           </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden ml-20 lg:ml-0 relative">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-950/80 backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-4"><div><h1 className="text-xs text-slate-400 font-bold uppercase">{t('active_target')}</h1><span className="text-slate-100 font-mono text-sm">{activeSessionId ? (session.target || t('target_na')) : t('target_configure')}</span></div></div>
          <div className="flex items-center gap-3">
             {jobQueue.length > 0 && (<div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-bold text-slate-400"><List size={14} /><span>{t('Queue pending', { count: jobQueue.length })}</span>{isQueueProcessing && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>}</div>)}

            {/* Smart Workflow header indicator + dropdown */}
            {effectiveSwState && (() => {
              const swSession = sessions[effectiveSwState.workflowId];
              const swPhaseLabels = ['Dictionary Attack', 'Generate Assets', 'Mask Attack', 'Feedback Rules'];
              const phaseIcons = [Play, Zap, SkipForward, RefreshCw];
              return (
                <div ref={swHeaderRef} className="relative">
                  <button
                    onClick={() => setSwHeaderOpen(v => !v)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                      effectiveSwState.complete && effectiveSwState.phases.some(p => p.status === 'aborted')
                        ? 'bg-red-900/20 border-red-700/30 text-red-300'
                        : effectiveSwState.complete
                        ? 'bg-emerald-900/20 border-emerald-700/30 text-emerald-300'
                        : 'bg-indigo-900/30 border-indigo-700/40 text-indigo-300 hover:bg-indigo-900/50'
                    }`}
                  >
                    <Workflow size={13} className="shrink-0" />
                    {effectiveSwState.complete && effectiveSwState.phases.some(p => p.status === 'aborted') ? (
                      <span className="flex items-center gap-1"><X size={11} /> Aborted</span>
                    ) : effectiveSwState.complete ? (
                      <span className="flex items-center gap-1"><CheckCircle2 size={11} /> Complete</span>
                    ) : smartPhase ? (
                      <>
                        <span className="bg-indigo-600 text-white rounded px-1.5 py-0.5 text-[10px]">P{smartPhase.phase}/4</span>
                        <span className="hidden sm:inline max-w-[140px] truncate">{smartPhase.message}</span>
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0"></span>
                      </>
                    ) : (
                      <span>Smart Workflow</span>
                    )}
                    <ChevronDown size={12} className={`shrink-0 transition-transform ${swHeaderOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {swHeaderOpen && (
                    <div className="absolute right-0 top-full mt-2 w-[720px] max-w-[calc(100vw-2rem)] bg-slate-900 border border-indigo-900/50 rounded-xl shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 fade-in duration-150">
                      {/* Dropdown header */}
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950/50">
                        <div className="flex items-center gap-2">
                          <Workflow size={14} className="text-indigo-400" />
                          <span className="text-xs font-bold text-indigo-300">Smart Workflow</span>
                          {effectiveSwState.complete && effectiveSwState.phases.some(p => p.status === 'aborted') ? (
                            <span className="text-[10px] font-bold bg-red-700/40 text-red-300 rounded px-1.5 py-0.5 flex items-center gap-1"><X size={9} /> Aborted</span>
                          ) : effectiveSwState.complete && (
                            <span className="text-[10px] font-bold bg-emerald-700/40 text-emerald-300 rounded px-1.5 py-0.5 flex items-center gap-1"><CheckCircle2 size={9} /> Complete</span>
                          )}
                        </div>
                        {!effectiveSwState.complete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSession(); setSwHeaderOpen(false); }}
                            className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded text-[10px] font-bold transition-colors"
                          >
                            <Square size={9} fill="currentColor" /> STOP
                          </button>
                        )}
                      </div>

                      {/* Phase grid */}
                      <div className="p-3 grid grid-cols-4 gap-2">
                        {effectiveSwState.phases.map((phase) => {
                          const Icon = phaseIcons[phase.n - 1];
                          const isRunning = phase.status === 'running';
                          const isDone = phase.status === 'done';
                          const isSkipped = phase.status === 'skipped';
                          const isAborted = phase.status === 'aborted';
                          return (
                            <div
                              key={phase.n}
                              className={`rounded-lg p-2.5 border transition-colors ${
                                isRunning ? 'bg-indigo-950/60 border-indigo-700/50' :
                                isDone ? 'bg-emerald-950/30 border-emerald-800/30' :
                                isAborted ? 'bg-red-950/30 border-red-900/40' :
                                isSkipped ? 'bg-slate-900/50 border-slate-800/50' :
                                'bg-slate-950/40 border-slate-800/30'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className={`text-[9px] font-bold uppercase ${isRunning ? 'text-indigo-400' : isDone ? 'text-emerald-400' : isAborted ? 'text-red-400' : 'text-slate-600'}`}>P{phase.n}</span>
                                <span className="shrink-0">
                                  {isRunning && <Loader2 size={11} className="text-indigo-400 animate-spin" />}
                                  {isDone && <CheckCircle2 size={11} className="text-emerald-400" />}
                                  {isSkipped && <span className="text-[8px] text-slate-600 font-bold">SKIP</span>}
                                  {isAborted && <X size={11} className="text-red-400" />}
                                  {phase.status === 'pending' && <Icon size={11} className="text-slate-700" />}
                                </span>
                              </div>
                              <div className={`text-[10px] font-medium leading-tight ${isRunning ? 'text-indigo-200' : isDone ? 'text-slate-300' : isAborted ? 'text-red-300' : 'text-slate-600'}`}>
                                {swPhaseLabels[phase.n - 1]}
                              </div>
                              {phase.message && (
                                <div className="text-[10px] text-slate-500 mt-0.5 leading-snug break-words" title={phase.message}>
                                  {phase.message}
                                </div>
                              )}
                              {phase.learned !== undefined && (
                                <div className="text-[10px] text-emerald-500 mt-1">{phase.learned} cracked · {phase.masks} masks</div>
                              )}
                              {phase.hashrateHps !== undefined && phase.hashrateHps > 0 && (
                                <div
                                  className="text-[10px] text-indigo-300 mt-0.5 leading-snug break-words"
                                  title={`Asset budget computed against ${(phase.hashrateHps / 1e6).toFixed(2)} MH/s — source: ${phase.hashrateSource || 'unknown'}`}
                                >
                                  @ {(phase.hashrateHps / 1e6).toFixed(2)} MH/s
                                  {phase.hashrateSource && (
                                    <span className="text-slate-500"> · {phase.hashrateSource}</span>
                                  )}
                                </div>
                              )}
                              {phase.phaseRecovered !== undefined && phase.phaseRecovered > 0 && (
                                <div className="text-[9px] text-emerald-400 font-bold mt-0.5">+{phase.phaseRecovered} recovered</div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Live stats row */}
                      {!effectiveSwState.complete && swSession && (
                        <div className="px-3 pb-3 grid grid-cols-4 gap-2 border-t border-slate-800 pt-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-slate-600 uppercase font-bold">Hashrate</span>
                            <span className="text-[11px] font-mono text-indigo-300">{formatHashrate(swSession.hashrate || 0)}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-slate-600 uppercase font-bold">Progress</span>
                            <span className="text-[11px] font-mono text-blue-300">{(swSession.progress || 0).toFixed(2)}%</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-slate-600 uppercase font-bold">Recovered</span>
                            <span className="text-[11px] font-mono text-emerald-300">{swSession.recovered || 0} / {swSession.total || '?'}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[9px] text-slate-600 uppercase font-bold">ETA</span>
                            <span className="text-[11px] font-mono text-slate-300 truncate">{swSession.estimatedTimeRemaining || '—'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Session Controls */}
            <SessionControls 
                sessionId={activeSessionId} 
                status={status} 
                onOptimisticUpdate={(newStatus) => {
                    if (activeSessionId) {
                        updateSession(activeSessionId, { status: newStatus });
                    }
                }}
            />

            {(!activeSessionId || session.status === SessionStatus.IDLE || session.status === SessionStatus.COMPLETED || session.status === SessionStatus.ERROR || session.status === SessionStatus.STOPPED) ? (
              <div className="flex items-center gap-3 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button onClick={() => setRestoreMode(!restoreMode)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${restoreMode ? 'bg-amber-500/20 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}><RefreshCw size={14} />{restoreMode ? t('restore_mode') : t('new_session')}</button>
                  <button onClick={() => toggleSession()} disabled={isStarting || !backendConnected} className={`flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm transition-all ${restoreMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}>{isStarting ? <Loader2 size={16} className="animate-spin"/> : <Play size={16} />}{restoreMode ? t('btn_restore') : t('btn_start')}</button>
              </div>
            ) : (<div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800"><button onClick={() => toggleSession()} className="flex items-center gap-2 px-4 py-1.5 rounded-md font-medium text-sm bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"><Square size={14} fill="currentColor" />{t('btn_stop')}</button></div>)}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-8xl mx-auto space-y-6 h-full">
            
            {/* ... (Dashboard, Insights, Escrow Tabs logic) ... */}
            
            {activeTab === 'dashboard' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* DYNAMIC HASHRATE CARD */}
                  <MetricCard label={t('card_hashrate')} value={formatHashrate(session.hashrate)} subValue={t('card_sub_speed')} icon={Zap} color="indigo" />
                  <MetricCard label={t('card_recovered')} value={`${session.recovered} / ${session.total}`} subValue={t('card_sub_recovered', { percent: session.total > 0 ? Math.min(((session.recovered / session.total) * 100), 100).toFixed(2) : 0 })} icon={ShieldCheck} color="emerald" />
                  <MetricCard label={t('card_mode')} value={HASH_TYPES.find(h => h.id === session.hashType)?.name || session.hashType || t('target_na')} subValue={session.hashType ? t('card_mode_label', { type: session.hashType }) : t('card_mode_ready')} icon={Hash} color="slate" />
                  <MetricCard label={t('card_progress')} value={`${session.progress.toFixed(2)}%`} subValue={session.estimatedTimeRemaining} icon={Activity} color="blue" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:h-80 min-h-[20rem]">
                  <div className="lg:col-span-3 h-full min-h-0 rounded-xl overflow-hidden"><CpuChart data={history} color="#6366f1" title={t('card_hashrate') + " (MH/s)"} dataKey="hashrate" unit="M" /></div>
                  <div className="lg:col-span-2 h-full min-h-0 rounded-xl overflow-hidden"><LogTerminal logs={logs} sessions={sessions} activeSessionId={activeSessionId} onSelectSession={setActiveSessionId} onDeleteSession={deleteSession}/></div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:h-[32rem]">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col h-full relative overflow-hidden">
                        {activeSessionId && (<div className="absolute inset-0 bg-slate-950/60 z-10 flex items-center justify-center backdrop-blur-[1px]"><div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-2xl text-center"><div className="flex items-center justify-center gap-2 text-indigo-400 mb-2"><Hash size={24} /><span className="font-bold text-lg">{t('target_locked')}</span></div><p className="text-slate-400 text-sm mb-1">{t('target_locked_desc')}</p><div className="font-mono text-white bg-slate-950 px-3 py-1 rounded border border-slate-800 text-xs inline-block mt-2">{session.target || t('target_manual')}</div></div></div>)}
                        <div className="flex items-center gap-2 mb-4 shrink-0"><FileUp size={18} className="text-indigo-400" /><h3 className="text-sm font-bold text-slate-200">{t('target_config_header')} {activeSessionId ? t('target_locked_status') : t('target_new_status')}</h3></div>
                        <div className="flex flex-col gap-4">
                             <div className="flex gap-4 shrink-0 h-12">
                                <label className={`flex-1 flex items-center justify-center border border-dashed rounded-lg transition-colors ${!activeSessionId ? 'cursor-pointer hover:bg-slate-800/50' : 'cursor-not-allowed opacity-50'} ${manualTargetFile ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300' : 'border-slate-700 text-slate-400'}`}>
                                    <span className="text-xs font-medium truncate px-2 flex items-center gap-2">{manualTargetFile ? <><FileUp size={14} />{manualTargetFile.name}</> : t('choose_file')}</span>
                                    <input type="file" className="hidden" onChange={handleFileChange} disabled={!!activeSessionId} />
                                </label>
                                <button onClick={handleManualTargetLoad} disabled={(!manualTargetInput && !manualTargetFile) || !!activeSessionId} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 rounded-lg text-sm font-bold transition-colors">{t('set_target')}</button>
                                <button onClick={handleCheckPotfile} disabled={(!manualTargetFile && !manualTargetInput) || isCheckingPotfile || !!activeSessionId} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 border border-slate-700 px-4 rounded-lg text-xs font-bold transition-colors flex items-center gap-2">{isCheckingPotfile ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}<span className="hidden xl:inline">{t('check_potfile')}</span></button>
                             </div>
                             <div className="relative text-center shrink-0"><div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div><div className="relative"><span className="bg-slate-900 px-2 text-xs text-slate-500 font-bold">{t('paste_hashes')}</span></div></div>
                             <div className="relative group h-60"><textarea value={manualTargetInput} onChange={(e) => { setManualTargetInput(e.target.value); if(e.target.value) setManualTargetFile(null); }} disabled={!!activeSessionId} placeholder={t('paste_placeholder')} className="w-full h-full bg-slate-950/50 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 resize-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50" /></div>
                        </div>
                    </div>
                    <div className="flex flex-col relative h-full bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden">
                        <div className="absolute top-3 right-4 z-50 flex items-center gap-2">
                             <button onClick={handleExportSessionCracks} disabled={currentDisplayedCracks.length === 0} className="flex items-center gap-2 text-xs h-8 px-3 rounded transition-colors border font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 disabled:opacity-50"><FileDown size={14} /> {t('btn_export')}</button>
                             <button onClick={() => handleSendToEscrow(currentDisplayedCracks)} disabled={newHashesCount === 0} className={`flex items-center gap-2 text-xs h-8 px-3 rounded transition-colors border font-medium shadow-sm ${newHashesCount > 0 ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-50'}`}><Globe size={14} /> {newHashesCount > 0 ? t('btn_send_new') : t('btn_all_sent')}</button>
                        </div>
                        <div className="flex-1 overflow-y-auto"><RecoveredHashList hashes={currentDisplayedCracks} /></div>
                    </div>
                </div>
                {showPreCrackedModal && preCrackedResults && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
                          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 shrink-0"><h3 className="font-bold text-slate-200 flex items-center gap-2"><CheckCircle size={18} className="text-emerald-400" />{t('modal_potfile_title')}</h3><button onClick={() => setShowPreCrackedModal(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button></div>
                          <div className="p-6 bg-slate-900 grid grid-cols-3 gap-4 shrink-0">
                              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-center"><div className="text-xs text-slate-500 uppercase font-bold">{t('modal_total')}</div><div className="text-xl font-mono text-white">{preCrackedResults.total}</div></div>
                              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-center"><div className="text-xs text-slate-500 uppercase font-bold">{t('modal_cracked')}</div><div className="text-xl font-mono text-emerald-400">{preCrackedResults.found}</div></div>
                              <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-center"><div className="text-xs text-slate-500 uppercase font-bold">{t('modal_locked')}</div><div className="text-xl font-mono text-red-400">{preCrackedResults.total - preCrackedResults.found}</div></div>
                          </div>
                          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                              {preCrackedResults.found === 0 ? (<div className="text-center text-slate-500 py-10 italic">{t('modal_no_matches')}</div>) : (<table className="w-full text-left text-sm"><thead className="text-xs text-slate-500 uppercase bg-slate-900 sticky top-0"><tr><th className="p-2">Hash</th><th className="p-2">Plaintext</th></tr></thead><tbody className="divide-y divide-slate-800">{preCrackedResults.list.map((item, idx) => (<tr key={idx} className="hover:bg-slate-800/50"><td className="p-2 font-mono text-slate-400 truncate max-w-[200px]" title={item.hash}>{item.hash}</td><td className="p-2 font-mono text-emerald-300 truncate max-w-[200px]">{item.plain}</td></tr>))}</tbody></table>)}
                          </div>
                          <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end gap-2 shrink-0"><button onClick={() => {
                              if (!preCrackedResults || preCrackedResults.found === 0) return;
                              const content = preCrackedResults.list.map((h: any) => `${h.hash}:${h.plain}`).join('\n');
                              setEscrowSubmissionData(content);
                              setEscrowSubmissionAlgo(config.hashType);
                              setShowPreCrackedModal(false);
                              setActiveTab('escrow');
                              addLog('general', `Prepared ${preCrackedResults.found} potfile cracks for escrow.`, 'INFO');
                          }} disabled={preCrackedResults.found === 0} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"><Globe size={14} /> Send to Escrow</button><button onClick={() => { if (preCrackedResults && (preCrackedResults as any).downloadToken) window.location.href = `http://localhost:3001/api/download/check-result/${(preCrackedResults as any).downloadToken}`; }} disabled={preCrackedResults.found === 0} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-2"><Download size={14} /> {t('modal_download')}</button><button onClick={() => setShowPreCrackedModal(false)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors">{t('modal_close')}</button></div>
                      </div>
                  </div>
                )}
              </>
            )}

            {activeTab === 'insights' && (<Insights globalPotfile={globalPotfile} sessionHashes={currentDisplayedCracks} session={session} pastSessions={pastSessions} config={config} setConfig={setConfig} setActiveTab={setActiveTab} addLog={addLog}/>)}
            {activeTab === 'escrow' && (<EscrowDashboard apiKey={apiKey} setApiKey={setApiKey} initialSubmissionData={escrowSubmissionData} initialAlgoId={escrowSubmissionAlgo} autoUploadSettings={autoUploadSettings} onUpdateAutoUploadSettings={setAutoUploadSettings} sessions={sessions} activeSessionId={activeSessionId} addLog={addLog} onSetTarget={async (content, algoId) => {
                addLog('general', '[ESCROW] Saving hash list as target...', 'INFO');
                try {
                    const targetRes = await fetch(`${getSocketUrl()}/api/target`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: content.trim(), filename: `escrow_target_${Date.now()}.txt` })
                    });
                    if (!targetRes.ok) throw new Error('Failed to save target file');
                    const targetData = await targetRes.json();
                    setConfig(prev => ({ ...prev, targetPath: targetData.path }));
                    setManualTargetInput(content.trim());
                    setManualTargetFile(null);
                    
                    // Auto-detect hash type from escrow job's algorithm ID
                    addLog('general', '[ESCROW] Detecting hash type from job algorithm...', 'INFO');
                    try {
                        if (algoId) {
                            // Try direct match first (hashes.com algo ID → hashcat mode ID)
                            const directMatch = HASH_TYPES.find(h => h.id === String(algoId));
                            if (directMatch) {
                                setConfig(prev => {
                                    const updated = { ...prev, hashType: directMatch.id };
                                    addLog('general', `[ESCROW] Direct match: Mode ${directMatch.id} - ${directMatch.name}`, 'SUCCESS');
                                    return updated;
                                });
                            } else {
                                // Fallback: try name-based matching
                                const algoName = escrowAlgorithms.find(a => a.id === algoId)?.algorithmName;
                                if (algoName) {
                                    const normalized = algoName.toLowerCase().replace(/[^a-z0-9]/g, '');
                                    const nameMatch = HASH_TYPES.find(h => {
                                        const hNorm = h.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                                        return hNorm === normalized || hNorm.includes(normalized) || normalized.includes(hNorm);
                                    });
                                    if (nameMatch) {
                                        setConfig(prev => {
                                            const updated = { ...prev, hashType: nameMatch.id };
                                            addLog('general', `[ESCROW] Name match: Mode ${nameMatch.id} - ${nameMatch.name}`, 'SUCCESS');
                                            return updated;
                                        });
                                    } else {
                                        addLog('general', `[ESCROW] Could not map algorithm "${algoName}" to a hash mode`, 'WARN');
                                    }
                                }
                            }
                        } else {
                            addLog('general', '[ESCROW] No algorithm ID available for detection', 'WARN');
                        }
                    } catch (detectErr: any) {
                        addLog('general', `[ESCROW] Hash type detection error: ${detectErr.message}`, 'WARN');
                    }
                    
                    setActiveTab('dashboard');
                    addLog('general', `[ESCROW] Hash list set as target: ${targetData.path}`, 'SUCCESS');
                } catch (e: any) {
                    addLog('general', `[ESCROW] Failed to set target: ${e.message}`, 'ERROR');
                    console.error('[ESCROW] Failed to set target:', e);
                }
            }}/>)}
            
            {/* File2John Component */}
            {activeTab === 'file2john' && (
                <File2John 
                    onSetTarget={(hash) => {
                        setManualTargetInput(hash);
                        setManualTargetFile(null); 
                        setActiveTab('dashboard'); 
                    }}
                    onNavigate={setActiveTab}
                />
            )}
            
            {activeTab === 'config' && (
                <ConfigPanel
                    config={config}
                    setConfig={setConfig}
                    onStart={(cmd) => { setActiveTab('dashboard'); if (status !== SessionStatus.RUNNING) toggleSession(cmd); }}
                    onQueue={handleAddToQueue}
                    onStartWorkflow={handleStartSmartWorkflow}
                    onQueueWorkflow={handleQueueSmartWorkflow}
                    sessionHashrate={session.hashrate}
                />
            )}
            
            {activeTab === 'queue' && (<QueueManager queue={jobQueue} removeFromQueue={(id) => setJobQueue(prev => prev.filter(j => j.id !== id))} isQueueProcessing={isQueueProcessing} setIsQueueProcessing={setIsQueueProcessing} clearQueue={() => setJobQueue([])} />)}
            {activeTab === 'terminal' && !isRemoteSession && (<div className="h-[80vh]"><InteractiveTerminal socket={socketRef.current} disabled={status === SessionStatus.RUNNING || status === SessionStatus.PAUSED} /></div>)}
            {activeTab === 'remote' && !isRemoteSession && (<RemoteAccess socket={socketRef.current} />)}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;