import React, { useMemo, useState, useEffect } from 'react';
import { HashcatConfig as IConfig } from '../types';
import { ATTACK_MODES, HASH_TYPES } from '../constants';
import { Copy, Terminal, Settings, Play, FolderOpen, ChevronDown, ChevronRight, Zap, Layers, Edit3, Lock, Wand2, Loader2 } from 'lucide-react';

interface ConfigPanelProps {
  config: IConfig;
  setConfig: (config: IConfig) => void;
  onStart: (customCommand?: string) => void;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ config, setConfig, onStart }) => {
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualCommand, setManualCommand] = useState('');
  const [detecting, setDetecting] = useState(false);

  const handleAutoDetect = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file && (file as any).path) {
        setDetecting(true);
        try {
          const res = await fetch('http://localhost:3001/api/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPath: (file as any).path })
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
      } else {
        alert('Please run in Electron to use Auto-Detect feature.');
      }
    };
    input.click();
  };

  const commandString = useMemo(() => {
    const parts = ['hashcat'];
    parts.push(`-m ${config.hashType}`);
    parts.push(`-a ${config.attackMode}`);
    parts.push(`-w ${config.workloadProfile}`);
    if (config.optimizedKernel) parts.push('-O');
    if (config.remove) parts.push('--remove');
    if (config.potfileDisable) parts.push('--potfile-disable');
    if (config.hwmonDisable) parts.push('--hwmon-disable');
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

    // Use targetPath from config if available
    parts.push(config.targetPath || '[target]');

    const mode = config.attackMode;
    const dict = config.wordlistPath || '[wordlist_path]';
    
    // UPDATE: Removed fallback '?a?a?a?a?a?a?a' to allow Hashcat default behavior
    const mask = config.maskFile || config.mask; 

    // Logic Block for Attack Modes
    if (mode === 0) {
      // Straight
      parts.push(dict);
      if (config.rulePath) parts.push('-r', config.rulePath);
    } 
    else if (mode === 1) {
      // Combination: Left + Right
      parts.push(config.wordlistPath || '[left_list_path]');
      parts.push(config.wordlistPath2 || '[right_list_path]'); 
    }
    else if ([2, 4, 5, 8, 9].includes(mode)) {
      // Single wordlist modes
      parts.push(dict);
    }
    else if (mode === 3) {
      // Brute-Force
      // Only push mask if user provided one, otherwise let hashcat use built-in default
      if (mask) parts.push(mask);
    } 
    else if (mode === 6) {
      // Hybrid Dict + Mask
      parts.push(dict);
      if (mask) parts.push(mask);
    } 
    else if (mode === 7) {
      // Hybrid Mask + Dict
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

  const handleCopy = () => {
    navigator.clipboard.writeText(isManualMode ? manualCommand : commandString);
  };

  const handleRun = () => {
    if (isManualMode) {
      onStart(manualCommand);
    } else {
      onStart();
    }
  };

  const handleFilePick = (field: keyof IConfig, accept?: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const filePath = (file as any).path;
        if (filePath) {
          setConfig({ ...config, [field]: filePath });
        } else {
          alert("Could not detect file path. Ensure you are using the Electron executable.");
        }
      }
    };
    input.click();
  };

  // Helpers for UI Rendering
  const showWordlistInput = [0, 1, 2, 4, 5, 6, 7, 8, 9].includes(config.attackMode);
  const showMaskInput = [3, 6, 7].includes(config.attackMode);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      <div className="lg:col-span-2 space-y-6 overflow-y-auto pr-2 pb-10">
        
        {/* General & Attack Mode */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-sm">
           <h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-bold">
             <Settings size={14} /> General Configuration
           </h3>
           <div className="grid grid-cols-1 gap-6">
             {/* Ident & Attack */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Attack Mode (-a)</label>
                  <select 
                    value={config.attackMode}
                    onChange={e => setConfig({...config, attackMode: parseInt(e.target.value)})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:border-indigo-500 outline-none transition-colors"
                  >
                    {ATTACK_MODES.map(m => <option key={m.id} value={m.id}>{m.id} - {m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Hash Type (-m)</label>
                  <div className="flex gap-2">
                    <select 
                      value={config.hashType}
                      onChange={e => setConfig({...config, hashType: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:border-indigo-500 outline-none font-mono transition-colors"
                    >
                      {HASH_TYPES.map(h => <option key={h.id} value={h.id}>{h.id.padEnd(6)} | {h.name}</option>)}
                    </select>
                    <button 
                      onClick={handleAutoDetect}
                      disabled={detecting}
                      className="bg-indigo-600/10 text-indigo-400 border border-indigo-600/30 rounded-lg px-3 hover:bg-indigo-600/20 transition-colors"
                      title="Auto Detect from File"
                    >
                      {detecting ? <Loader2 className="animate-spin" size={16}/> : <Wand2 size={16} />}
                    </button>
                  </div>
                </div>
             </div>

             {/* Dynamic Resources Inputs based on Attack Mode */}
             <div className="bg-slate-950/50 rounded-lg p-4 border border-slate-800 space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Attack Resources</h4>
                
                {/* Wordlist Input Logic */}
                {showWordlistInput && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-2">
                        {config.attackMode === 1 ? 'Left Wordlist Path' : 'Wordlist Path'}
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={config.wordlistPath}
                          onChange={e => setConfig({...config, wordlistPath: e.target.value})}
                          placeholder="C:\wordlists\rockyou.txt"
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none"
                        />
                        <button onClick={() => handleFilePick('wordlistPath', '.txt')} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    </div>

                    {/* MODE 1 SPECIFIC: SECOND WORDLIST */}
                    {config.attackMode === 1 && (
                      <div>
                         <label className="block text-xs font-bold text-slate-500 mb-2">
                           Right Wordlist Path
                         </label>
                         <div className="flex gap-2">
                           <input 
                             type="text"
                             value={config.wordlistPath2 || ''}
                             onChange={e => setConfig({...config, wordlistPath2: e.target.value})}
                             placeholder="C:\wordlists\another_list.txt"
                             className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none"
                           />
                           <button onClick={() => handleFilePick('wordlistPath2', '.txt')} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                             <FolderOpen size={14} />
                           </button>
                         </div>
                      </div>
                    )}
                    
                    {/* Rule path is technically specific to mode 0 usually */}
                    {config.attackMode === 0 && (
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-2">Rule Path</label>
                        <div className="flex gap-2">
                          <input 
                            type="text"
                            value={config.rulePath}
                            onChange={e => setConfig({...config, rulePath: e.target.value})}
                            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none"
                          />
                          <button onClick={() => handleFilePick('rulePath', '.rule')} className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors">
                            <FolderOpen size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                
                {/* Mask Input Logic */}
                {showMaskInput && (
                   <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 mb-2">Mask Pattern</label>
                          <input 
                            type="text"
                            value={config.mask}
                            onChange={e => setConfig({...config, mask: e.target.value})}
                            placeholder="Leave empty for Hashcat default"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-sm focus:border-indigo-500 outline-none"
                          />
                      </div>
                       <div>
                          <label className="block text-xs font-bold text-slate-500 mb-2">Or Mask File (.hcmask)</label>
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              value={config.maskFile}
                              onChange={e => setConfig({...config, maskFile: e.target.value})}
                              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs focus:border-indigo-500 outline-none"
                            />
                            <button 
                              onClick={() => handleFilePick('maskFile', '.hcmask')} 
                              className="bg-slate-800 text-slate-400 px-3 rounded-lg hover:bg-slate-700 border border-slate-700 hover:text-white transition-colors"
                            >
                              <FolderOpen size={14} />
                            </button>
                          </div>
                      </div>
                   </div>
                )}
             </div>
           </div>
        </div>

        {/* Performance */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-sm">
           <h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider mb-4 flex items-center gap-2 font-bold">
             <Zap size={14} /> Performance & Flags
           </h3>
           
           <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">Workload Profile (-w)</label>
                <div className="flex gap-2">
                  {[1,2,3,4].map(w => (
                    <button
                      key={w}
                      onClick={() => setConfig({...config, workloadProfile: w})}
                      className={`flex-1 py-1.5 text-xs font-bold rounded border transition-all ${config.workloadProfile === w ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">Status Update Frequency (seconds)</label>
                <input 
                  type="number" 
                  value={config.statusTimer}
                  onChange={e => setConfig({...config, statusTimer: parseInt(e.target.value)})}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" 
                  placeholder="30"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                  {[
                    { label: 'Optimized Kernels (-O)', key: 'optimizedKernel' },
                    { label: 'Remove Found (--remove)', key: 'remove' },
                    { label: 'Disable Potfile', key: 'potfileDisable' },
                    { label: 'Disable HW Monitor', key: 'hwmonDisable' },
                  ].map((opt: any) => (
                    <label key={opt.key} className="flex items-center gap-3 cursor-pointer group p-2 rounded hover:bg-slate-800/50">
                      <input 
                        type="checkbox" 
                        checked={(config as any)[opt.key]}
                        onChange={e => setConfig({...config, [opt.key]: e.target.checked})}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600 focus:ring-indigo-500/20"
                      />
                      <span className="text-sm text-slate-300 group-hover:text-white font-medium">{opt.label}</span>
                    </label>
                  ))}
               </div>
           </div>
        </div>

        {/* Advanced */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-sm overflow-hidden">
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full p-4 flex items-center justify-between bg-slate-800/50 hover:bg-slate-800 transition-colors"
          >
            <h3 className="text-indigo-400 font-mono text-xs uppercase tracking-wider flex items-center gap-2 font-bold">
              <Layers size={14} /> Advanced Options
            </h3>
            {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          
          {showAdvanced && (
            <div className="p-6 space-y-6 border-t border-slate-800">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">Skip Keyspace (-s)</label>
                    <input type="number" value={config.skip} onChange={e => setConfig({...config, skip: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">Bitmap Max</label>
                    <input type="number" value={config.bitmapMax} onChange={e => setConfig({...config, bitmapMax: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">Spin Damp</label>
                    <input type="number" value={config.spinDamp} onChange={e => setConfig({...config, spinDamp: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                  </div>
               </div>

               <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
                  {[
                    { label: 'Ignore OpenCL', key: 'backendDisableOpenCL' },
                    { label: 'Ignore CUDA', key: 'backendIgnoreCuda' },
                    { label: 'Keep Guessing', key: 'keepGuessing' },
                    { label: 'Disable Self-Test', key: 'selfTestDisable' },
                    { label: 'Disable Logfile', key: 'logfileDisable' },
                    { label: 'Force', key: 'force' },
                  ].map((opt: any) => (
                    <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={(config as any)[opt.key]}
                        onChange={e => setConfig({...config, [opt.key]: e.target.checked})}
                        className="w-3 h-3 rounded border-slate-700 bg-slate-950 checked:bg-indigo-600"
                      />
                      <span className="text-xs text-slate-400 hover:text-white">{opt.label}</span>
                    </label>
                  ))}
               </div>
            </div>
          )}
        </div>

      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl flex flex-col overflow-hidden h-fit sticky top-6 shadow-lg">
        <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-slate-400" />
            <span className="font-mono text-xs text-slate-300 font-bold">Command Preview</span>
          </div>
          <button 
             onClick={() => setIsManualMode(!isManualMode)}
             className={`text-[10px] uppercase font-bold px-2 py-1 rounded border transition-colors flex items-center gap-1 ${isManualMode ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
          >
            {isManualMode ? <Edit3 size={10} /> : <Lock size={10} />}
            {isManualMode ? 'Manual Mode' : 'Auto-Gen'}
          </button>
        </div>
        <div className="relative bg-black/40 min-h-[150px]">
           <textarea 
             className={`w-full h-full min-h-[150px] p-4 font-mono text-xs bg-transparent resize-y outline-none ${isManualMode ? 'text-yellow-400 focus:ring-1 focus:ring-yellow-500/50' : 'text-emerald-400 select-text'}`}
             value={isManualMode ? manualCommand : commandString}
             onChange={(e) => setManualCommand(e.target.value)}
             readOnly={!isManualMode}
             spellCheck={false}
           />
        </div>
        <div className="bg-slate-900 p-4 border-t border-slate-800 flex gap-3">
           <button onClick={handleCopy} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
             <Copy size={16} /> Copy
           </button>
           <button onClick={handleRun} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2">
             <Play size={16} /> {isManualMode ? 'Run Custom' : 'Run Auto'}
           </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;