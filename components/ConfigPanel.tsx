import React, { useMemo, useState, useEffect, useRef } from 'react';
import { HashcatConfig as IConfig, SmartWorkflowOpts } from '../types';
import { ATTACK_MODES, HASH_TYPES } from '../constants';
import {
  Copy, Terminal, Settings, Play, FolderOpen, ChevronDown, ChevronRight,
  Zap, Layers, Edit3, Lock, Wand2, Loader2, ListPlus, Cpu, HardDrive,
  RefreshCw, ToggleLeft, ToggleRight, ArrowUpRight, ArrowLeftRight, Search, X,
  User, Divide, AlertTriangle, Workflow, Gauge, AlertOctagon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Hash types known to be extremely slow (< ~1K H/s typical GPU)
const VERY_SLOW_HASH_IDS = new Set([
  '3200','25600','25800','30600','30601','28400', // bcrypt variants
  '34000','70000',                                // Argon2
  '8900','70100','70200',                         // scrypt
]);
// Hash types known to be slow (< ~100K H/s typical GPU)
const SLOW_HASH_IDS = new Set([
  '1800','7400','500','15100','35100',            // Unix crypt variants
  '2100','1100','31500','31600',                  // DCC/MS-Cache
  '400',                                          // phpass
  '7100',                                         // macOS PBKDF2
  '10900','12000','12100','11900','12800','32900', // PBKDF2 variants
  '2500','22000','22001','16800','16801',          // WPA
  '9200','9300',                                  // Cisco PBKDF2/scrypt
]);

const getHashSpeedTier = (id: string): 'very_slow' | 'slow' | 'fast' => {
  if (VERY_SLOW_HASH_IDS.has(id)) return 'very_slow';
  if (SLOW_HASH_IDS.has(id)) return 'slow';
  const ht = HASH_TYPES.find(h => h.id === id);
  if (ht?.category === 'Generic KDF') return 'very_slow';
  return 'fast';
};

const SW_STORAGE_KEY = 'hashcat_sw_opts_v1';

interface ExtendedConfig extends IConfig {
  username?: boolean;
  separator?: string;
  hexSalt?: boolean;
  hexCharset?: boolean;
  markovThreshold?: number;
  ruleLeft?: string;
  ruleRight?: string;
}

interface ConfigPanelProps {
  config: IConfig;
  setConfig: (config: IConfig) => void;
  onStart: (customCommand?: string) => void;
  onQueue: () => void;
  onStartWorkflow?: (opts: SmartWorkflowOpts) => void;
  onQueueWorkflow?: (opts: SmartWorkflowOpts) => void;
  sessionHashrate?: number; // live hashrate from current session, used for speed warnings
}

interface ResourceFile {
  name: string;
  path: string;
}

interface Resources {
  wordlists: ResourceFile[];
  rules: ResourceFile[];
  masks: ResourceFile[];
}

const getSocketUrl = () => {
    const host = window.location.hostname;
    if (host.includes('zrok.io') || window.location.port === '3001') {
        return window.location.origin;
    }
    return 'http://localhost:3001';
};

const ConfigPanel: React.FC<ConfigPanelProps> = ({ config: propConfig, setConfig: propSetConfig, onStart, onQueue, onStartWorkflow, onQueueWorkflow, sessionHashrate }) => {
  const { t } = useTranslation();
  
  // Cast to ExtendedConfig to support new fields locally
  const config = propConfig as ExtendedConfig;
  const setConfig = propSetConfig as (config: ExtendedConfig) => void;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualCommand, setManualCommand] = useState('');
  const [detecting, setDetecting] = useState(false);
  
  const [availableDevices, setAvailableDevices] = useState<{id: string, name: string, type: string}[]>([]);
  const [scanningDevices, setScanningDevices] = useState(false);

  const [resources, setResources] = useState<Resources>({ wordlists: [], rules: [], masks: [] });
  const [scanningResources, setScanningResources] = useState(false);
  
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [isHashSearchOpen, setIsHashSearchOpen] = useState(false);
  const [hashSearchQuery, setHashSearchQuery] = useState('');
  const hashDropdownRef = useRef<HTMLDivElement>(null);

  const [inputModes, setInputModes] = useState({
    wordlist: 'file',
    wordlist2: 'file',
    rule: 'file',
    mask: 'file'
  });

  const SW_DEFAULTS: SmartWorkflowOpts = {
    rulePath: '', maskMinLen: 4, maskMaxLen: 12, phase3Runtime: 0,
    phase3Increment: false, optimizedKernel: false, maxMasks: 20,
    skipPhase3: false, skipPhase4: false,
    phase3TimeBudget: 1, phase3TimeUnit: 'hours', phase3SortMode: 'occurrence',
    phase4RulePaths: [],
  };
  const [swAdvanced, setSwAdvanced] = useState(false);
  const [swOpts, setSwOpts] = useState<SmartWorkflowOpts>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SW_STORAGE_KEY) || '{}');
      return { ...SW_DEFAULTS, ...saved };
    } catch { return SW_DEFAULTS; }
  });

  // Persist swOpts to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(SW_STORAGE_KEY, JSON.stringify({ ...swOpts }));
    } catch {}
  }, [swOpts]);

  const fetchDevices = async () => {
    setScanningDevices(true);
    try {
      const res = await fetch(`${getSocketUrl()}/api/system/devices`, { method: 'POST' });
      const data = await res.json();
      if (data.devices) setAvailableDevices(data.devices);
    } catch (e) { console.error("Failed to fetch devices", e); }
    setScanningDevices(false);
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (hashDropdownRef.current && !hashDropdownRef.current.contains(event.target as Node)) {
        setIsHashSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleScanResources = async () => {
    if (!config.resourcesPath) return;
    setScanningResources(true);
    try {
      const res = await fetch(`${getSocketUrl()}/api/fs/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: config.resourcesPath })
      });
      const data = await res.json();
      setResources(data);
    } catch (e) {
      console.error("Failed to scan resources", e);
    }
    setScanningResources(false);
  };

  const toggleInputMode = (key: keyof typeof inputModes) => {
    setInputModes(prev => ({
      ...prev,
      [key]: prev[key] === 'file' ? 'library' : 'file'
    }));
  };

  const toggleDevice = (id: string) => {
    let current = config.devices ? config.devices.split(',') : [];
    if (current.includes(id)) {
      current = current.filter(d => d !== id);
    } else {
      current.push(id);
    }
    setConfig({ ...config, devices: current.join(',') });
  };

  const handleAutoDetect = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        setDetecting(true);
        try {
          let targetPath = (file as any).path;
          if (!targetPath) {
             const formData = new FormData();
             formData.append('file', file);
             const upRes = await fetch(`${getSocketUrl()}/api/upload`, { method: 'POST', body: formData });
             const upData = await upRes.json();
             targetPath = upData.path;
          }

          const res = await fetch(`${getSocketUrl()}/api/identify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPath })
          });
          const data = await res.json();
          if (data.modes && data.modes.length > 0) {
            const bestMode = data.modes[0].id;
            setConfig({ ...config, hashType: bestMode.toString() });
            alert(`Detected: ${data.modes[0].name} (Mode ${bestMode})`);
          } else {
            alert('Could not identify hash type.');
          }
        } catch (err) {
          alert('Failed to run detection.');
        } finally {
          setDetecting(false);
        }
      }
    };
    input.click();
  };

  const commandString = useMemo(() => {
    const parts = ['hashcat'];
    parts.push(`-m ${config.hashType}`);
    parts.push(`-a ${config.attackMode}`);
    parts.push(`-w ${config.workloadProfile}`);
    
    // Username
    if (config.username) parts.push('--username');
    // Separator
    if (config.separator) parts.push(`--separator='${config.separator}'`);    
    if (config.devices) parts.push(`-d ${config.devices}`);
    if (config.optimizedKernel) parts.push('-O');
    if (config.remove) parts.push('--remove');
    if (config.potfileDisable) parts.push('--potfile-disable');
    if (config.hwmonDisable) parts.push('--hwmon-disable');
    if (config.hexSalt) parts.push('--hex-salt');
    if (config.hexCharset) parts.push('--hex-charset');
    if (config.markovThreshold && config.markovThreshold > 0) parts.push(`--markov-threshold=${config.markovThreshold}`);

    parts.push('--status-timer', config.statusTimer.toString());
    
    if (config.backendDisableOpenCL) parts.push('--backend-ignore-opencl'); 
    if (config.backendIgnoreCuda) parts.push('--backend-ignore-cuda');
    if (config.selfTestDisable) parts.push('--self-test-disable');
    if (config.keepGuessing) parts.push('--keep-guessing');
    if (config.logfileDisable) parts.push('--logfile-disable');
    if (config.force) parts.push('--force');
	
    if (config.skip > 0) parts.push(`-s ${config.skip}`);
    if (config.bitmapMax !== 24) parts.push(`--bitmap-max=${config.bitmapMax}`);
    if (config.spinDamp !== 100) parts.push(`--spin-damp=${config.spinDamp}`);
    if (config.scryptTmto !== 0) parts.push(`--scrypt-tmto=${config.scryptTmto}`);
    if (config.segmentSize !== 0) parts.push(`--segment-size=${config.segmentSize}`);

    if (config.increment) {
        parts.push('--increment');
        if (config.incrementMin) parts.push(`--increment-min=${config.incrementMin}`);
        if (config.incrementMax) parts.push(`--increment-max=${config.incrementMax}`);
        if (config.incrementInverse) parts.push('--increment-inverse');
    }

    // Rule Injection (Left/Right)
    if (config.ruleLeft) parts.push(`-j '${config.ruleLeft}'`);
    if (config.ruleRight) parts.push(`-k '${config.ruleRight}'`);

    parts.push(config.targetPath || '[target]');

    const mode = config.attackMode;
    const dict = config.wordlistPath || '[wordlist_path]';
    const mask = config.maskFile || config.mask; 

    if (mode === 0) {
      parts.push(dict);
      if (config.rulePath) parts.push('-r', config.rulePath);
    } 
    else if (mode === 1) {
      parts.push(config.wordlistPath || '[left_list_path]');
      parts.push(config.wordlistPath2 || '[right_list_path]'); 
    }
    else if ([2, 4, 5, 8, 9].includes(mode)) {
      parts.push(dict);
    }
    else if (mode === 3) {
      if (mask) parts.push(mask);
    } 
    else if (mode === 6) {
      parts.push(dict);
      if (mask) parts.push(mask);
    } 
    else if (mode === 7) {
      if (mask) parts.push(mask);
      parts.push(dict);
    }
    
    return parts.join(' ');
  }, [config]);

  useEffect(() => {
    if (!isManualMode) {
      setManualCommand(commandString);
    }
  }, [commandString, isManualMode]);

  const filteredHashTypes = useMemo(() => {
      if (!hashSearchQuery) return HASH_TYPES;
      const q = hashSearchQuery.toLowerCase();
      return HASH_TYPES.filter(h => 
        h.name.toLowerCase().includes(q) || 
        h.id.toString().includes(q)
      );
  }, [hashSearchQuery]);

  const selectedHashObject = useMemo(() => {
      return HASH_TYPES.find(h => h.id.toString() === config.hashType) || { id: config.hashType, name: 'Unknown' };
  }, [config.hashType]);

  const handleCopy = () => {
    navigator.clipboard.writeText(isManualMode ? manualCommand : commandString);
  };

  const handleRun = () => {
    if (isManualMode) onStart(manualCommand);
    else onStart();
  };

  const handleFilePick = (field: keyof ExtendedConfig, accept?: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const directPath = (file as any).path;
        if (directPath) {
          setConfig({ ...config, [field]: directPath });
        } else {
          setUploadingField(field as string);
          try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${getSocketUrl()}/api/upload`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error("Upload failed");
            const data = await res.json();
            setConfig({ ...config, [field]: data.path });
          } catch (err) {
            console.error("Auto-upload failed", err);
            alert("Failed to upload file to remote server.");
          } finally {
            setUploadingField(null);
          }
        }
      }
    };
    input.click();
  };

  const handleFolderPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const fullPath = (file as any).path;
        if (fullPath) {
            const dirPath = fullPath.substring(0, fullPath.lastIndexOf((window.navigator.userAgent.includes('Win') ? '\\' : '/')));
            setConfig({ ...config, resourcesPath: dirPath || fullPath });
        } else {
            alert("Folder selection is only supported in the Desktop application.");
        }
      }
    };
    input.click();
  };

  const showWordlistInput = [0, 1, 2, 4, 5, 6, 7, 8, 9].includes(config.attackMode);
  const showMaskInput = [3, 6, 7].includes(config.attackMode);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      <div className="lg:col-span-2 space-y-6 overflow-y-auto pr-2 pb-10">
        
        {/* 1. GENERAL CONFIGURATION */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-sm">
           <h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-bold">
             <Settings size={14} /> {t('config_general_title')}
           </h3>
           
           <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800 mb-6">
              <div className="flex items-center justify-between mb-2">
                 <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><HardDrive size={12}/> {t('config_library_path')}</h4>
                 <button 
                    onClick={handleScanResources}
                    disabled={scanningResources || !config.resourcesPath}
                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                  >
                    {scanningResources ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                    {t('config_scan_btn')}
                  </button>
              </div>
              <div className="flex gap-2">
                   <input 
                      type="text" 
                      value={config.resourcesPath || ''} 
                      onChange={(e) => setConfig({...config, resourcesPath: e.target.value})}
                      placeholder="Select folder containing wordlists/rules..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none"
                   />
                   <button onClick={handleFolderPick} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                      <FolderOpen size={14} />
                   </button>
                </div>
           </div>

           <div className="grid grid-cols-1 gap-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t('config_attack_mode')}</label>
                  <select 
                    value={config.attackMode}
                    onChange={e => setConfig({...config, attackMode: parseInt(e.target.value)})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:border-indigo-500 outline-none transition-colors"
                  >
                    {ATTACK_MODES.map(m => <option key={m.id} value={m.id}>{m.id} - {m.name}</option>)}
                  </select>
                </div>
                
                {/* SEARCHABLE HASH TYPE DROPDOWN */}
                <div className="relative" ref={hashDropdownRef}>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">{t('config_hash_type')}</label>
                  <div className="flex gap-2">
                    <button 
                        onClick={() => { setIsHashSearchOpen(!isHashSearchOpen); setHashSearchQuery(''); }}
                        className="flex-1 flex items-center justify-between bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm hover:border-indigo-500 transition-colors"
                    >
                        <span className="font-mono truncate mr-2">
                            {selectedHashObject.id.padEnd(6)} | {selectedHashObject.name}
                        </span>
                        <ChevronDown size={14} className="text-slate-500" />
                    </button>
                    
                    <button 
                      onClick={handleAutoDetect}
                      disabled={detecting}
                      className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/30 rounded-lg px-3 hover:bg-indigo-600/20 transition-colors"
                      title={t('config_auto_detect')}
                    >
                      {detecting ? <Loader2 className="animate-spin" size={16}/> : <Wand2 size={16} />}
                    </button>
                  </div>

                  {isHashSearchOpen && (
                      <div className="absolute top-full left-0 w-full mt-2 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col max-h-[300px] animate-in slide-in-from-top-2 fade-in duration-200">
                          <div className="p-2 border-b border-slate-700 flex items-center gap-2 bg-slate-950 sticky top-0">
                              <Search size={14} className="text-slate-500" />
                              <input 
                                  autoFocus
                                  type="text" 
                                  placeholder="Search ID or Name (e.g. 1000, NTLM)..." 
                                  value={hashSearchQuery}
                                  onChange={(e) => setHashSearchQuery(e.target.value)}
                                  className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-slate-600 font-mono"
                              />
                              {hashSearchQuery && (
                                  <button onClick={() => setHashSearchQuery('')} className="text-slate-500 hover:text-white"><X size={14}/></button>
                              )}
                          </div>
                          <div className="overflow-y-auto flex-1 custom-scrollbar">
                              {filteredHashTypes.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-slate-500 italic">No matching hash types found.</div>
                              ) : (
                                  filteredHashTypes.map(h => (
                                      <button 
                                          key={h.id}
                                          onClick={() => {
                                              setConfig({ ...config, hashType: h.id });
                                              setIsHashSearchOpen(false);
                                              setHashSearchQuery('');
                                          }}
                                          className={`w-full text-left px-3 py-2 text-xs font-mono hover:bg-indigo-600 hover:text-white transition-colors border-b border-slate-800/50 flex items-center gap-3 ${config.hashType === h.id ? 'bg-indigo-900/30 text-indigo-300' : 'text-slate-300'}`}
                                      >
                                          <span className="opacity-50 w-12 shrink-0">{h.id}</span>
                                          <span className="truncate">{h.name}</span>
                                      </button>
                                  ))
                              )}
                          </div>
                      </div>
                  )}
                </div>
             </div>

             {/* USERNAME & SEPARATOR */}
             <div className="grid grid-cols-2 gap-4 pt-2">
                 <label className="flex items-center gap-2 p-2 bg-slate-950 border border-slate-800 rounded-lg cursor-pointer hover:border-indigo-500/50 transition-colors">
                     <div className="p-1.5 bg-slate-900 rounded-md text-slate-400"><User size={14} /></div>
                     <div className="flex-1">
                         <div className="flex items-center gap-2">
                            <input type="checkbox" checked={!!config.username} onChange={(e) => setConfig({...config, username: e.target.checked})} className="w-4 h-4 rounded border-slate-700 bg-slate-900 checked:bg-indigo-600 focus:ring-indigo-500/20" />
                            <span className="text-xs font-bold text-slate-300">Hashes have Usernames</span>
                         </div>
                     </div>
                 </label>
                 
                 <div className="flex items-center gap-2 p-2 bg-slate-950 border border-slate-800 rounded-lg">
                     <div className="p-1.5 bg-slate-900 rounded-md text-slate-400"><Divide size={14} /></div>
                     <div className="flex-1">
                         <span className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Separator Char</span>
                         <input 
                            type="text" 
                            maxLength={1}
                            placeholder="default: :"
                            value={config.separator || ''} 
                            onChange={(e) => setConfig({...config, separator: e.target.value})} 
                            className="w-full bg-transparent border-none text-xs font-mono text-white placeholder-slate-600 focus:ring-0 p-0 h-4" 
                         />
                     </div>
                 </div>
             </div>

             <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800 space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">{t('config_selected_resources')}</h4>
                
                {showWordlistInput && (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-bold text-slate-500">
                          {config.attackMode === 1 ? t('config_wordlist_left') : t('config_wordlist')}
                        </label>
                        <button onClick={() => toggleInputMode('wordlist')} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-white">
                           {inputModes.wordlist === 'library' ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                           {inputModes.wordlist === 'library' ? t('config_use_library') : t('config_use_file')}
                        </button>
                      </div>

                      {inputModes.wordlist === 'library' ? (
                          <div className="relative">
                            <select 
                                onChange={(e) => setConfig({...config, wordlistPath: e.target.value})}
                                value={config.wordlistPath}
                                disabled={resources.wordlists.length === 0}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 text-xs focus:border-indigo-500 outline-none appearance-none disabled:opacity-50"
                            >
                                <option value="">-- Select from Library --</option>
                                {resources.wordlists.map((f, i) => <option key={i} value={f.path}>{f.name}</option>)}
                            </select>
                            <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown size={12} /></div>
                          </div>
                      ) : (
                          <div className="flex gap-2">
                            <input type="text" value={config.wordlistPath} onChange={e => setConfig({...config, wordlistPath: e.target.value})} placeholder="Path to wordlist..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none" />
                            <button onClick={() => handleFilePick('wordlistPath', '.txt')} disabled={uploadingField === 'wordlistPath'} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                              {uploadingField === 'wordlistPath' ? <Loader2 size={14} className="animate-spin text-indigo-400" /> : <FolderOpen size={14} />}
                            </button>
                          </div>
                      )}
                      
                      {/* Rule Injection -j */}
                      <div className="flex items-center gap-2 pl-2 border-l-2 border-slate-800">
                          <span className="text-[10px] font-mono text-indigo-400 whitespace-nowrap">-j</span>
                          <input type="text" value={config.ruleLeft || ''} onChange={(e) => setConfig({...config, ruleLeft: e.target.value})} placeholder="Inject rule for this wordlist (e.g. '$!')" className="w-full bg-slate-950/50 border-b border-slate-800 text-[10px] text-slate-300 px-2 py-1 focus:border-indigo-500 outline-none font-mono" />
                      </div>
                    </div>

                    {config.attackMode === 1 && (
                      <div className="space-y-2 mt-4">
                         <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-slate-500">{t('config_wordlist_right')}</label>
                            <button onClick={() => toggleInputMode('wordlist2')} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-white">
                               {inputModes.wordlist2 === 'library' ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                               {inputModes.wordlist2 === 'library' ? t('config_use_library') : t('config_use_file')}
                            </button>
                         </div>
                         {inputModes.wordlist2 === 'library' ? (
                            <div className="relative">
                                <select onChange={(e) => setConfig({...config, wordlistPath2: e.target.value})} value={config.wordlistPath2 || ''} disabled={resources.wordlists.length === 0} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 text-xs focus:border-indigo-500 outline-none appearance-none disabled:opacity-50">
                                    <option value="">-- Select from Library --</option>
                                    {resources.wordlists.map((f, i) => <option key={i} value={f.path}>{f.name}</option>)}
                                </select>
                                <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown size={12} /></div>
                            </div>
                         ) : (
                             <div className="flex gap-2">
                               <input type="text" value={config.wordlistPath2 || ''} onChange={e => setConfig({...config, wordlistPath2: e.target.value})} placeholder="Path to second wordlist..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none" />
                               <button onClick={() => handleFilePick('wordlistPath2', '.txt')} disabled={uploadingField === 'wordlistPath2'} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                                 {uploadingField === 'wordlistPath2' ? <Loader2 size={14} className="animate-spin text-indigo-400" /> : <FolderOpen size={14} />}
                               </button>
                             </div>
                         )}
                         {/* Rule Injection -k */}
                         <div className="flex items-center gap-2 pl-2 border-l-2 border-slate-800">
                              <span className="text-[10px] font-mono text-indigo-400 whitespace-nowrap">-k</span>
                              <input type="text" value={config.ruleRight || ''} onChange={(e) => setConfig({...config, ruleRight: e.target.value})} placeholder="Inject rule for right wordlist" className="w-full bg-slate-950/50 border-b border-slate-800 text-[10px] text-slate-300 px-2 py-1 focus:border-indigo-500 outline-none font-mono" />
                          </div>
                      </div>
                    )}
                    
                    {config.attackMode === 0 && (
                      <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-slate-500">{t('config_rule_file')}</label>
                            <button onClick={() => toggleInputMode('rule')} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-white">
                               {inputModes.rule === 'library' ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                               {inputModes.rule === 'library' ? t('config_use_library') : t('config_use_file')}
                            </button>
                        </div>
                        {inputModes.rule === 'library' ? (
                            <div className="relative">
                                <select onChange={(e) => setConfig({...config, rulePath: e.target.value})} value={config.rulePath} disabled={resources.rules.length === 0} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 text-xs focus:border-indigo-500 outline-none appearance-none disabled:opacity-50">
                                    <option value="">-- Select from Library --</option>
                                    {resources.rules.map((f, i) => <option key={i} value={f.path}>{f.name}</option>)}
                                </select>
                                <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown size={12} /></div>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                              <input type="text" value={config.rulePath} onChange={e => setConfig({...config, rulePath: e.target.value})} placeholder="Path to rule file..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none" />
                              <button onClick={() => handleFilePick('rulePath', '.rule')} disabled={uploadingField === 'rulePath'} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                                {uploadingField === 'rulePath' ? <Loader2 size={14} className="animate-spin text-indigo-400" /> : <FolderOpen size={14} />}
                              </button>
                            </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                
                {showMaskInput && (
                   <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 mb-2">{t('config_mask_pattern')}</label>
                          <input type="text" value={config.mask} onChange={e => setConfig({...config, mask: e.target.value})} placeholder="Leave empty for Hashcat default or if using mask file" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-sm focus:border-indigo-500 outline-none" />
                      </div>
                       <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-slate-500">{t('config_mask_file')}</label>
                            <button onClick={() => toggleInputMode('mask')} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-white">
                               {inputModes.mask === 'library' ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                               {inputModes.mask === 'library' ? t('config_use_library') : t('config_use_file')}
                            </button>
                          </div>
                          
                          {inputModes.mask === 'library' ? (
                                <div className="relative">
                                    <select onChange={(e) => setConfig({...config, maskFile: e.target.value})} value={config.maskFile} disabled={resources.masks.length === 0} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 text-xs focus:border-indigo-500 outline-none appearance-none disabled:opacity-50">
                                        <option value="">-- Select from Library --</option>
                                        {resources.masks.map((f, i) => <option key={i} value={f.path}>{f.name}</option>)}
                                    </select>
                                    <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500"><ChevronDown size={12} /></div>
                                </div>
                          ) : (
                                <div className="flex gap-2">
                                    <input type="text" value={config.maskFile} onChange={e => setConfig({...config, maskFile: e.target.value})} placeholder="Path to .hcmask file..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none" />
                                    <button onClick={() => handleFilePick('maskFile', '.hcmask')} disabled={uploadingField === 'maskFile'} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                                      {uploadingField === 'maskFile' ? <Loader2 size={14} className="animate-spin text-indigo-400" /> : <FolderOpen size={14} />}
                                    </button>
                                </div>
                          )}
                      </div>

                      <div className="pt-2 border-t border-slate-800 mt-2">
                        <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={!!config.increment} onChange={(e) => setConfig({...config, increment: e.target.checked})} className="w-4 h-4 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600 focus:ring-indigo-500/20" />
                                <span className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1"><ArrowUpRight size={12}/> {t('config_increment_enable')}</span>
                            </label>
                            {config.increment && (
                                <label className="flex items-center gap-2 cursor-pointer animate-in fade-in">
                                    <input type="checkbox" checked={!!config.incrementInverse} onChange={(e) => setConfig({...config, incrementInverse: e.target.checked})} className="w-4 h-4 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600 focus:ring-indigo-500/20" />
                                    <span className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1" title="Increment from Right-to-Left"><ArrowLeftRight size={12}/> {t('config_increment_inverse')}</span>
                                </label>
                            )}
                        </div>
                        {config.increment && (
                             <div className="grid grid-cols-2 gap-4 pl-6 animate-in fade-in slide-in-from-top-1">
                                <div><label className="block text-[10px] font-bold text-slate-500 mb-1">{t('config_increment_min')}</label><input type="number" min="1" value={config.incrementMin} onChange={(e) => setConfig({...config, incrementMin: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500 outline-none" placeholder="1" /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 mb-1">{t('config_increment_max')}</label><input type="number" min="1" value={config.incrementMax} onChange={(e) => setConfig({...config, incrementMax: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:border-indigo-500 outline-none" placeholder="8" /></div>
                             </div>
                        )}
                      </div>
                   </div>
                )}
             </div>
           </div>
        </div>

        {/* 2. PERFORMANCE */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-sm">
           <h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-bold"><Zap size={14} /> {t('config_perf_title')}</h3>
           <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">{t('config_workload')}</label>
                <div className="flex gap-2">{[1,2,3,4].map(w => (<button key={w} onClick={() => setConfig({...config, workloadProfile: w})} className={`flex-1 py-1.5 text-xs font-bold rounded border transition-all ${config.workloadProfile === w ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'}`}>{w}</button>))}</div>
              </div>
              <div><label className="block text-xs font-bold text-slate-500 mb-2">{t('config_status_timer')}</label><input type="number" value={config.statusTimer} onChange={e => setConfig({...config, statusTimer: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" placeholder="3" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  {[{ label: t('config_opt_optimized'), key: 'optimizedKernel' }, { label: t('config_opt_remove'), key: 'remove' }, { label: t('config_opt_potfile'), key: 'potfileDisable' }, { label: t('config_opt_hwmon'), key: 'hwmonDisable' }].map((opt: any) => (<label key={opt.key} className="flex items-center gap-3 cursor-pointer group p-2 rounded hover:bg-slate-800/50"><input type="checkbox" checked={(config as any)[opt.key]} onChange={e => setConfig({...config, [opt.key]: e.target.checked})} className="w-4 h-4 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600 focus:ring-indigo-500/20" /><span className="text-sm text-slate-300 group-hover:text-white font-medium">{opt.label}</span></label>))}
               </div>
           </div>
        </div>

        {/* 3. HARDWARE */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-sm">
           <div className="flex items-center justify-between mb-4"><h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider flex items-center gap-2 font-bold"><Cpu size={14} /> {t('config_hardware_title')}</h3><button onClick={fetchDevices} className="text-xs text-slate-500 hover:text-white flex items-center gap-1 transition-colors">{scanningDevices ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {t('config_refresh')}</button></div>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableDevices.length === 0 ? (<div className="col-span-2 text-center text-xs text-slate-500 py-4 border border-dashed border-slate-800 rounded">{scanningDevices ? t('config_scanning_devices') : t('config_no_devices')}</div>) : (availableDevices.map(device => { const isSelected = (config.devices || '').split(',').includes(device.id); return (<div key={device.id} onClick={() => toggleDevice(device.id)} className={`cursor-pointer p-3 rounded-lg border transition-all flex items-center justify-between ${isSelected ? 'bg-indigo-600/10 border-indigo-500/50' : 'bg-slate-950 border-slate-800 hover:border-slate-600'}`}><div className="flex items-center gap-3"><div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-600'}`}>{isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}</div><div><div className={`text-xs font-bold ${isSelected ? 'text-indigo-300' : 'text-slate-300'}`}>{device.name}</div><div className="text-[10px] text-slate-500">{device.type} ID #{device.id}</div></div></div></div>); }))}
           </div>
        </div>

        {/* 4. ADVANCED */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm overflow-hidden">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="w-full p-4 flex items-center justify-between bg-slate-800/50 hover:bg-slate-800 transition-colors"><h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider flex items-center gap-2 font-bold"><Layers size={14} /> {t('config_advanced_title')}</h3>{showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          {showAdvanced && (
            <div className="p-6 space-y-6 border-t border-slate-800">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div><label className="block text-xs font-bold text-slate-500 mb-2">{t('config_skip')}</label><input type="number" value={config.skip} onChange={e => setConfig({...config, skip: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" placeholder="0" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-2">{t('config_bitmap')}</label><input type="number" value={config.bitmapMax} onChange={e => setConfig({...config, bitmapMax: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-2">{t('config_spin')}</label><input type="number" value={config.spinDamp} onChange={e => setConfig({...config, spinDamp: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" /></div>
               </div>
               
               {/* Hex/Markov */}
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
                  <div className="space-y-3">
                     <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!config.hexSalt} onChange={e => setConfig({...config, hexSalt: e.target.checked})} className="w-4 h-4 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600" /><span className="text-xs text-slate-300 font-bold">Assume Hex Salts (--hex-salt)</span></label>
                     <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!config.hexCharset} onChange={e => setConfig({...config, hexCharset: e.target.checked})} className="w-4 h-4 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600" /><span className="text-xs text-slate-300 font-bold">Assume Hex Charset (--hex-charset)</span></label>
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-500 mb-2">Markov Threshold</label>
                      <div className="flex gap-2 items-center">
                          <input type="number" min="0" value={config.markovThreshold || 0} onChange={e => setConfig({...config, markovThreshold: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-600" placeholder="0 (Disabled)" />
                          <div title="Higher values use more memory">
                              <AlertTriangle size={16} className="text-amber-500/50" />
                          </div>
                      </div>
                  </div>
               </div>

               <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-slate-800">{[{ label: 'Ignore OpenCL', key: 'backendDisableOpenCL' }, { label: 'Ignore CUDA', key: 'backendIgnoreCuda' }, { label: 'Keep Guessing', key: 'keepGuessing' }, { label: 'Disable Self-Test', key: 'selfTestDisable' }, { label: 'Disable Logfile', key: 'logfileDisable' }, { label: 'Force', key: 'force' }].map((opt: any) => (<label key={opt.key} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={(config as any)[opt.key]} onChange={e => setConfig({...config, [opt.key]: e.target.checked})} className="w-3 h-3 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600" /><span className="text-xs text-slate-400 hover:text-white">{opt.label}</span></label>))}</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl flex flex-col overflow-hidden h-fit sticky top-6 shadow-lg">
        <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2"><Terminal size={16} className="text-slate-400" /><span className="font-mono text-xs text-slate-300 font-bold">{t('config_cmd_preview')}</span></div>
          <button onClick={() => setIsManualMode(!isManualMode)} className={`text-[10px] uppercase font-bold px-2 py-1 rounded border transition-colors flex items-center gap-1 ${isManualMode ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{isManualMode ? <Edit3 size={10} /> : <Lock size={10} />}{isManualMode ? t('config_manual_mode') : t('config_auto_gen')}</button>
        </div>
        <div className="relative bg-black/40 min-h-[150px]"><textarea className={`w-full h-full min-h-[150px] p-4 font-mono text-xs bg-transparent resize-y outline-none ${isManualMode ? 'text-yellow-400 focus:ring-1 focus:ring-yellow-500/50' : 'text-emerald-400 select-text'}`} value={isManualMode ? manualCommand : commandString} onChange={(e) => setManualCommand(e.target.value)} readOnly={!isManualMode} spellCheck={false} /></div>
        <div className="bg-slate-900 p-4 border-t border-slate-800 flex flex-col gap-3">
           <div className="flex gap-3"><button onClick={handleCopy} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"><Copy size={16} /> {t('config_btn_copy')}</button><button onClick={handleRun} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"><Play size={16} /> {isManualMode ? t('config_btn_run_custom') : t('config_btn_run_auto')}</button></div>
           {!isManualMode && (<button onClick={onQueue} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:text-white text-slate-300 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"><ListPlus size={16} /> {t('config_btn_queue')}</button>)}
        </div>

        {/* SMART WORKFLOW */}
        <div className="border-t border-indigo-900/50 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider flex items-center gap-2 font-bold">
              <Workflow size={13} /> Smart Workflow
            </h3>
          </div>

          {/* Hash speed warning / recommendation */}
          {(() => {
            const tier = getHashSpeedTier(config.hashType || '0');
            const measured = sessionHashrate && sessionHashrate > 0
              ? (sessionHashrate < 1000
                  ? `${sessionHashrate.toFixed(0)} H/s`
                  : sessionHashrate < 1e6
                    ? `${(sessionHashrate / 1000).toFixed(1)} KH/s`
                    : `${(sessionHashrate / 1e6).toFixed(1)} MH/s`)
              : null;
            const suggestedRuntime = tier === 'very_slow' ? 10 : tier === 'slow' ? 30 : null;

            if (tier === 'very_slow') return (
              <div className="rounded-lg border border-red-800/40 bg-red-950/20 p-2.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-bold">
                  <AlertOctagon size={12} /> Not recommended for this hash type
                </div>
                <p className="text-[10px] text-red-300/70 leading-relaxed">
                  Smart Workflow runs multiple dictionary + mask phases. With very slow hashes
                  {measured ? ` (measured: ${measured})` : ' (bcrypt / Argon2 / scrypt)'},
                  Phase 3 could run for days. Set a time cap below.
                </p>
                {swOpts.phase3Runtime === 0 && (
                  <button
                    onClick={() => setSwOpts(o => ({ ...o, phase3Runtime: suggestedRuntime! }))}
                    className="self-start text-[10px] font-bold text-red-300 bg-red-900/30 hover:bg-red-900/60 border border-red-700/40 rounded px-2 py-0.5 transition-colors"
                  >
                    Auto-set Phase 3 cap → {suggestedRuntime} min
                  </button>
                )}
              </div>
            );

            if (tier === 'slow') return (
              <div className="rounded-lg border border-amber-800/30 bg-amber-950/20 p-2.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-amber-400 text-[11px] font-bold">
                  <AlertTriangle size={12} /> Slow hash type — use with caution
                </div>
                <p className="text-[10px] text-amber-300/60 leading-relaxed">
                  This hash type is moderately slow
                  {measured ? ` (${measured})` : ' (WPA / sha512crypt / PBKDF2)'}.
                  Phase 3 mask attacks benefit from a runtime cap.
                </p>
                {swOpts.phase3Runtime === 0 && (
                  <button
                    onClick={() => setSwOpts(o => ({ ...o, phase3Runtime: suggestedRuntime! }))}
                    className="self-start text-[10px] font-bold text-amber-300 bg-amber-900/20 hover:bg-amber-900/40 border border-amber-700/30 rounded px-2 py-0.5 transition-colors"
                  >
                    Auto-set Phase 3 cap → {suggestedRuntime} min
                  </button>
                )}
              </div>
            );

            // Fast hash — show a positive tip
            return (
              <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/10 p-2 flex items-center gap-2">
                <Gauge size={12} className="text-indigo-400 shrink-0" />
                <p className="text-[10px] text-indigo-300/60">
                  Fast hash type{measured ? ` · ${measured}` : ''} — Smart Workflow is most effective here.
                </p>
              </div>
            );
          })()}

          {/* Phase 1 Rule — inherited from global config */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 flex items-start gap-2">
            <Gauge size={11} className="text-indigo-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] text-slate-400 leading-relaxed font-bold uppercase tracking-wider mb-0.5">Phase 1 Rule</p>
              <p className="text-[9px] text-slate-500 leading-relaxed">
                {config.rulePath
                  ? <><span className="text-indigo-300 font-mono">{config.rulePath.split(/[\\/]/).pop()}</span> — from Config tab</>
                  : <span className="text-slate-600">No rule set — configure in the <span className="text-slate-400 font-bold">Config</span> tab (Rule File field).</span>
                }
              </p>
            </div>
          </div>

          {/* Phase steps */}
          <div className="bg-slate-950/60 rounded-lg px-3 py-2 border border-slate-800 space-y-1.5">
            {[
              { n: 1, label: 'Dictionary attack', detail: config.wordlistPath ? `${config.wordlistPath.split(/[\\/]/).pop()}${config.rulePath ? ' + rule' : ''}` : 'No wordlist selected' },
              { n: 2, label: 'Generate dynamic assets', detail: 'Masks + rules from cracked hashes' },
              { n: 3, label: 'Targeted mask attack', detail: swOpts.skipPhase3 ? 'SKIPPED' : `Dynamic .hcmask${swOpts.phase3Runtime > 0 ? ` · ${swOpts.phase3Runtime}m cap` : ''}` },
              { n: 4, label: 'Feedback rule attack', detail: swOpts.skipPhase4 ? 'SKIPPED' : `Dynamic rules${config.rulePath ? ' + global rule' : ''}${swOpts.phase4RulePaths?.length ? ` + ${swOpts.phase4RulePaths.length} custom rule(s)` : ''}` },
            ].map(step => (
              <div key={step.n} className="flex items-center gap-2">
                <span className={`text-[9px] font-bold rounded px-1 py-0.5 shrink-0 ${(step.n === 3 && swOpts.skipPhase3) || (step.n === 4 && swOpts.skipPhase4) ? 'text-slate-600 bg-slate-800' : 'text-indigo-500 bg-indigo-500/10'}`}>P{step.n}</span>
                <div className="min-w-0">
                  <span className={`text-[11px] font-medium ${(step.n === 3 && swOpts.skipPhase3) || (step.n === 4 && swOpts.skipPhase4) ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{step.label}</span>
                  <span className="text-[10px] text-slate-600 ml-1 truncate">· {step.detail}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Phase 4 custom rule files */}
          {!swOpts.skipPhase4 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Phase 4 — Custom Rule Files</p>
                <button
                  onClick={() => setSwOpts(o => ({ ...o, phase4RulePaths: [...(o.phase4RulePaths || []), ''] }))}
                  className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded px-1.5 py-0.5 transition-colors"
                >+ Add Rule</button>
              </div>
              {(!swOpts.phase4RulePaths || swOpts.phase4RulePaths.length === 0) && (
                <p className="text-[9px] text-slate-600">No custom rules — only dynamic rule will run. Add rule files to run sequentially as extra passes.</p>
              )}
              {(swOpts.phase4RulePaths || []).map((rp, idx) => (
                <div key={idx} className="flex gap-1.5 items-center">
                  <span className="text-[9px] text-slate-600 font-mono shrink-0">#{idx + 1}</span>
                  <input
                    type="text"
                    value={rp}
                    onChange={e => setSwOpts(o => { const arr = [...(o.phase4RulePaths || [])]; arr[idx] = e.target.value; return { ...o, phase4RulePaths: arr }; })}
                    placeholder="Path to .rule file..."
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 font-mono text-[10px] focus:border-indigo-500 outline-none min-w-0"
                  />
                  <button
                    onClick={() => {
                      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.rule';
                      inp.onchange = async (e: any) => {
                        const f = e.target.files?.[0]; if (!f) return;
                        const direct = (f as any).path;
                        if (direct) { setSwOpts(o => { const arr = [...(o.phase4RulePaths || [])]; arr[idx] = direct; return { ...o, phase4RulePaths: arr }; }); return; }
                        try {
                          const fd = new FormData(); fd.append('file', f);
                          const res = await fetch(`${getSocketUrl()}/api/upload`, { method: 'POST', body: fd });
                          const d = await res.json();
                          setSwOpts(o => { const arr = [...(o.phase4RulePaths || [])]; arr[idx] = d.path; return { ...o, phase4RulePaths: arr }; });
                        } catch { alert('Failed to upload rule file.'); }
                      };
                      inp.click();
                    }}
                    className="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded p-1 transition-colors"
                    title="Browse"
                  ><FolderOpen size={12} /></button>
                  <button
                    onClick={() => setSwOpts(o => { const arr = (o.phase4RulePaths || []).filter((_, i) => i !== idx); return { ...o, phase4RulePaths: arr }; })}
                    className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                    title="Remove"
                  ><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Global settings inherited notice */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 flex items-start gap-2">
            <Gauge size={11} className="text-slate-500 mt-0.5 shrink-0" />
            <p className="text-[9px] text-slate-500 leading-relaxed">
              Global settings (workload, devices, -O, --hwmon-disable, --force, --status-timer, etc.)
              are inherited from the <span className="text-slate-400 font-bold">Config</span> tab automatically.
            </p>
          </div>

          {/* Phase 3 settings toggle */}
          <button
            onClick={() => setSwAdvanced(v => !v)}
            className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-indigo-400 transition-colors px-1"
          >
            <span className="uppercase font-bold tracking-wider">Phase 3 Settings</span>
            {swAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {swAdvanced && (
            <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 space-y-3">

              {/* ── Time-budget mask selection (insights-style) ── */}
              <div>
                <label className="block text-[10px] font-bold text-indigo-400 uppercase mb-1.5 tracking-wider">
                  Mask Time Budget
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0} step={0.5}
                    value={swOpts.phase3TimeBudget}
                    onChange={e => setSwOpts(o => ({ ...o, phase3TimeBudget: +e.target.value }))}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 outline-none"
                    placeholder="0"
                  />
                  <select
                    value={swOpts.phase3TimeUnit}
                    onChange={e => setSwOpts(o => ({ ...o, phase3TimeUnit: e.target.value as 'minutes'|'hours'|'days' }))}
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 outline-none"
                  >
                    <option value="minutes">min</option>
                    <option value="hours">hr</option>
                    <option value="days">day</option>
                  </select>
                </div>
                {/* Hashrate source info */}
                {(() => {
                  const hr = sessionHashrate && sessionHashrate > 0 ? sessionHashrate : null;
                  const budget = swOpts.phase3TimeBudget;
                  const unit = swOpts.phase3TimeUnit;
                  if (!hr && budget === 0) return (
                    <p className="text-[9px] text-slate-600 mt-1">
                      Set a time budget + run a session first to auto-detect hashrate. Falls back to max masks count.
                    </p>
                  );
                  if (!hr) return (
                    <p className="text-[9px] text-amber-600 mt-1">
                      No live hashrate — budget will apply once a session provides speed data.
                    </p>
                  );
                  const hrStr = hr < 1e3 ? `${hr.toFixed(0)} H/s` : hr < 1e6 ? `${(hr/1e3).toFixed(1)} KH/s` : `${(hr/1e6).toFixed(1)} MH/s`;
                  return (
                    <p className="text-[9px] text-indigo-400/70 mt-1 flex items-center gap-1">
                      <Gauge size={9} />
                      Auto-detected: {hrStr} — masks are pre-selected to fit within {budget} {unit}
                    </p>
                  );
                })()}
              </div>

              {/* ── Sort strategy ── */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Mask Priority</label>
                <div className="flex gap-1.5">
                  {(['occurrence', 'efficiency'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setSwOpts(o => ({ ...o, phase3SortMode: mode }))}
                      className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border ${
                        swOpts.phase3SortMode === mode
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      {mode === 'occurrence' ? '# Occurrence' : '⚡ Efficiency'}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-600 mt-1">
                  {swOpts.phase3SortMode === 'occurrence'
                    ? 'Most common cracked patterns first — maximize hit rate early.'
                    : 'Highest cracks-per-second-of-cracking first — maximize value per GPU cycle.'}
                </p>
              </div>

              {/* ── Mask length bounds ── */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Mask Length Filter</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="text-[9px] text-slate-600 mb-1">Min len</div>
                    <input type="number" min={1} max={32} value={swOpts.maskMinLen}
                      onChange={e => setSwOpts(o => ({ ...o, maskMinLen: +e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 outline-none" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[9px] text-slate-600 mb-1">Max len</div>
                    <input type="number" min={1} max={32} value={swOpts.maskMaxLen}
                      onChange={e => setSwOpts(o => ({ ...o, maskMaxLen: +e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 outline-none" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[9px] text-slate-600 mb-1">Max masks</div>
                    <input type="number" min={5} max={500} value={swOpts.maxMasks}
                      onChange={e => setSwOpts(o => ({ ...o, maxMasks: +e.target.value }))}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 outline-none" />
                  </div>
                </div>
                <p className="text-[9px] text-slate-600 mt-1">Max masks is used when no hashrate is available for time estimation.</p>
              </div>

              {/* ── Safety runtime cap ── */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">
                  Hard Runtime Cap <span className="normal-case font-normal">(--runtime, 0 = off)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={1440} value={swOpts.phase3Runtime}
                    onChange={e => setSwOpts(o => ({ ...o, phase3Runtime: +e.target.value }))}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 outline-none" />
                  <span className="text-[10px] text-slate-500 shrink-0">min</span>
                </div>
              </div>

              {/* ── Toggles ── */}
              <div className="space-y-2 pt-1 border-t border-slate-800">
                {([
                  { key: 'phase3Increment', label: 'Increment mode (Phase 3)', desc: '--increment: try all lengths from min to max' },
                  { key: 'skipPhase3', label: 'Skip Phase 3 (mask attack)', desc: 'Useful when Phase 1 cracks very few passwords' },
                  { key: 'skipPhase4', label: 'Skip Phase 4 (feedback rules)', desc: 'Skip mutation attack on cracked plaintexts' },
                ] as { key: keyof SmartWorkflowOpts; label: string; desc: string }[]).map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-300">{label}</div>
                      <div className="text-[9px] text-slate-600">{desc}</div>
                    </div>
                    <button onClick={() => setSwOpts(o => ({ ...o, [key]: !o[key] }))} className="shrink-0 transition-colors">
                      {swOpts[key]
                        ? <ToggleRight size={20} className="text-indigo-400" />
                        : <ToggleLeft size={20} className="text-slate-600" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => onStartWorkflow && onStartWorkflow({ ...swOpts, rulePath: config.rulePath || '' })}
              disabled={!onStartWorkflow || !config.wordlistPath}
              className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-indigo-500/20"
            >
              <Workflow size={15} />
              Start
            </button>
            <button
              onClick={() => onQueueWorkflow && onQueueWorkflow({ ...swOpts, rulePath: config.rulePath || '' })}
              disabled={!onQueueWorkflow || !config.wordlistPath}
              className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-slate-300 border border-slate-700 px-3 py-2.5 rounded-lg text-xs font-bold transition-colors"
              title="Add Smart Workflow to queue"
            >
              <ListPlus size={14} />
              Queue
            </button>
          </div>
          {!config.wordlistPath && (
            <p className="text-[10px] text-amber-500/70 text-center -mt-1">Select a wordlist in the General section first.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;