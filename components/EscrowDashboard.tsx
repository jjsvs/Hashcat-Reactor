import React, { useState, useEffect, useRef } from 'react';
import { EscrowJob, EscrowAlgo } from '../types';
import { getEscrowJobs, getAlgorithms, submitFoundHash } from '../services/geminiService';
import { RefreshCw, Download, Search, UploadCloud, AlertTriangle, DollarSign, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Calendar, FileText, Filter, X, Loader2, Settings } from 'lucide-react';

interface EscrowDashboardProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  initialSubmissionData?: string; 
  initialAlgoId?: string; 
}

const EscrowDashboard: React.FC<EscrowDashboardProps> = ({ apiKey, setApiKey, initialSubmissionData, initialAlgoId }) => {
  const [jobs, setJobs] = useState<EscrowJob[]>([]);
  const [algos, setAlgos] = useState<EscrowAlgo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filters & Pagination (View Only)
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
  const [dlAlgo, setDlAlgo] = useState(''); // Algorithm ID for download filter
  const [dlMinPrice, setDlMinPrice] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number, total: number, found: number } | null>(null);
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);

  // Searchable Algo Dropdown State
  const [algoSearch, setAlgoSearch] = useState('');
  const [showAlgoList, setShowAlgoList] = useState(false);
  const algoListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (algoListRef.current && !algoListRef.current.contains(event.target as Node)) {
        setShowAlgoList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (initialSubmissionData) {
      setSubmissionContent(initialSubmissionData);
    }
  }, [initialSubmissionData]);

  useEffect(() => {
    const loadAlgos = async () => {
      const list = await getAlgorithms();
      setAlgos(list);
    };
    loadAlgos();
  }, []);

  useEffect(() => {
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
  }, [initialAlgoId, algos]);

  const fetchJobs = async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getEscrowJobs(apiKey);
      setJobs(data);
      setCurrentPage(1);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to fetch jobs. Check API Key or Network.");
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: string) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const filteredJobs = jobs.filter(j => {
    const jobPrice = parseFloat(j.pricePerHashUsd);
    const filterPriceVal = parseFloat(minPrice);
    const meetsPrice = !isNaN(filterPriceVal) ? jobPrice >= filterPriceVal : true;
    
    const meetsAlgo = filterAlgo 
      ? (j.algorithmName.toLowerCase().includes(filterAlgo.toLowerCase()) || j.algorithmId.toString() === filterAlgo)
      : true;
    return meetsPrice && meetsAlgo;
  });

  const sortedJobs = [...filteredJobs].sort((a, b) => {
    const { key, direction } = sortConfig;
    let comparison = 0;

    if (key === 'pricePerHashUsd') {
      comparison = parseFloat(a.pricePerHashUsd) - parseFloat(b.pricePerHashUsd);
    } else if (key === 'leftHashes') {
      comparison = a.leftHashes - b.leftHashes;
    } else if (key === 'createdAt') {
       comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }

    return direction === 'asc' ? comparison : -comparison;
  });

  const totalPages = Math.ceil(sortedJobs.length / itemsPerPage);
  const paginatedJobs = sortedJobs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const calculateDownloadableCount = () => {
    return jobs.filter(j => {
        const meetsAlgo = dlAlgo ? j.algorithmId.toString() === dlAlgo : true;
        const meetsPrice = dlMinPrice ? parseFloat(j.pricePerHashUsd) >= parseFloat(dlMinPrice) : true;
        return meetsAlgo && meetsPrice && j.leftList;
    }).length;
  };

  // --- Helper: Delay ---
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // --- Helper: Robust Fetch with Retry & Backoff ---
  const fetchWithRetry = async (fileUrl: string, jobId: number, attempt = 1): Promise<string | null> => {
      const maxAttempts = 3;
      
      try {
          // Use 'allorigins' as primary proxy
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(fileUrl)}&disableCache=${Date.now()}`;
          
          const response = await fetch(proxyUrl);
          
          // Handle Rate Limiting specifically
          if (response.status === 429) {
              throw new Error("RATE_LIMIT");
          }

          if (!response.ok) {
              throw new Error(`HTTP_${response.status}`);
          }

          const text = await response.text();
          
          // Validation: Check for HTML (Proxy error pages usually return HTML)
          if (text.trim().toLowerCase().startsWith('<!doctype') || text.includes('<html')) {
             throw new Error("INVALID_CONTENT_HTML");
          }
          
          return text;

      } catch (err: any) {
          if (attempt < maxAttempts) {
              let waitTime = 2000 * attempt; // Linear backoff: 2s, 4s, 6s
              
              if (err.message === "RATE_LIMIT") {
                  waitTime = 5000 * attempt; // Aggressive backoff for 429s: 5s, 10s
              }

              console.warn(`Job #${jobId} failed (Attempt ${attempt}). Retrying in ${waitTime}ms... Error: ${err.message}`);
              await delay(waitTime);
              return fetchWithRetry(fileUrl, jobId, attempt + 1);
          }
          throw err; // Throw final error after max attempts
      }
  };

  // --- REVISED MASS DOWNLOAD LOGIC ---
  const startMassDownload = async () => {
    // 1. Filter Jobs based on Modal Inputs
    const targetJobs = jobs.filter(j => {
        const meetsAlgo = dlAlgo ? j.algorithmId.toString() === dlAlgo : true;
        const meetsPrice = dlMinPrice ? parseFloat(j.pricePerHashUsd) >= parseFloat(dlMinPrice) : true;
        return meetsAlgo && meetsPrice && j.leftList;
    });

    if (targetJobs.length === 0) {
        alert("No jobs match your criteria.");
        return;
    }
    
    setDownloading(true);
    setDownloadProgress({ current: 0, total: targetJobs.length, found: 0 });
    setDownloadLogs([]); 
    
    let combinedContent = '';
    
    try {
      for (let i = 0; i < targetJobs.length; i++) {
        const job = targetJobs[i];
        setDownloadProgress(prev => ({ ...prev!, current: i + 1 }));
        
        // Prepare URL
        let fileUrl = job.leftList;
        if (!fileUrl.startsWith('http')) {
             if (!fileUrl.startsWith('/')) fileUrl = '/' + fileUrl;
             fileUrl = `https://hashes.com${fileUrl}`;
        }

        setDownloadLogs(prev => [...prev, `Job #${job.id}: Fetching...`]);

        try {
          // Throttling: Wait 1.5 seconds between EVERY file to prevent 429s
          await delay(1500); 

          const text = await fetchWithRetry(fileUrl, job.id);

          if (text && text.trim()) {
            combinedContent += text.trim() + '\n';
            setDownloadProgress(prev => ({ ...prev!, found: prev!.found + 1 }));
            setDownloadLogs(prev => {
                const newLogs = [...prev];
                newLogs[newLogs.length - 1] = `✅ Job #${job.id}: Success.`;
                return newLogs;
            });
          } else {
            setDownloadLogs(prev => {
                const newLogs = [...prev];
                newLogs[newLogs.length - 1] = `⚠️ Job #${job.id}: File empty.`;
                return newLogs;
            });
          }
        } catch (err: any) {
          setDownloadLogs(prev => {
              const newLogs = [...prev];
              newLogs[newLogs.length - 1] = `❌ Job #${job.id}: Failed after 3 retries (${err.message}).`;
              return newLogs;
          });
        }
      }

      if (!combinedContent.trim()) {
        setDownloadLogs(prev => [...prev, `❌ Process complete. No hashes found.`]);
        return;
      }

      // 2. Construct Filename: Algorithm_Date.txt
      const algoObj = algos.find(a => a.id.toString() === dlAlgo);
      const algoName = algoObj ? algoObj.algorithmName.replace(/[^a-z0-9]/gi, '_') : 'Mixed_Algorithms';
      const dateStr = new Date().toISOString().slice(0,10);
      const filename = `${algoName}_${dateStr}.txt`;

      // 3. Download Blob
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
  };

  const handleSubmit = async () => {
    if((!submissionContent && !submissionFile) || !submissionAlgo || !apiKey) return;
    
    setSubmitting(true);
    try {
      const content = submissionFile || submissionContent;
      const res = await submitFoundHash(apiKey, parseInt(submissionAlgo), content);
      alert(`Submission Successful!\nSuccess: ${res.success}`);
      setSubmissionContent('');
      setSubmissionFile(null);
    } catch (e: any) {
      alert(`Error submitting: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredAlgos = algos.filter(a => 
    a.algorithmName.toLowerCase().includes(algoSearch.toLowerCase()) || 
    a.id.toString().includes(algoSearch)
  );

  const selectAlgo = (id: number, name: string) => {
    setSubmissionAlgo(id.toString());
    setAlgoSearch(name);
    setShowAlgoList(false);
  };

  return (
    <div className="space-y-6 pb-10 relative">
      {/* Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 items-end md:items-center justify-between shadow-sm">
        <div className="flex-1 w-full md:w-auto">
          <label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Hashes.com API Key</label>
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
              Load Jobs
            </button>
          </div>
        </div>
        
        <div className="flex gap-3 flex-wrap items-end">
           {/* View Filters */}
           <div>
              <label className="text-xs text-slate-500 uppercase font-bold">View Min USD</label>
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
              <label className="text-xs text-slate-500 uppercase font-bold">View Algo Filter</label>
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
             Mass Download
           </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3 animate-pulse">
          <AlertTriangle size={20} />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Jobs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-950 text-slate-400 uppercase text-xs font-semibold tracking-wider select-none">
                <th className="p-4 cursor-pointer hover:text-slate-200" onClick={() => handleSort('createdAt')}>
                   Created {sortConfig.key === 'createdAt' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-4">Algorithm</th>
                <th className="p-4 text-right">Total</th>
                <th className="p-4 text-right cursor-pointer hover:text-emerald-400 transition-colors" onClick={() => handleSort('pricePerHashUsd')}>
                  <div className="flex items-center justify-end gap-1">
                     Price {sortConfig.key === 'pricePerHashUsd' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                  </div>
                </th>
                <th className="p-4 text-right">Progress</th>
                <th className="p-4 text-right cursor-pointer hover:text-slate-200 transition-colors" onClick={() => handleSort('leftHashes')}>
                  <div className="flex items-center justify-end gap-1">
                    Remaining {sortConfig.key === 'leftHashes' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                  </div>
                </th>
                <th className="p-4 text-center">Files</th>
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
                  <td colSpan={7} className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
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
          <h3 className="text-sm font-bold text-slate-200">Submit Found Hashes</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300 block mb-2">Instructions:</strong>
                    1. Select the algorithm of the hashes.<br/>
                    2. Paste hashes in <code className="text-indigo-400">hash:plain</code> format OR upload a .txt file.<br/>
                    3. Click Upload to submit to Hashes.com Escrow.<br/>
                    <br/>
                    <span className="text-emerald-500">Tip:</span> You can automatically populate this from the Dashboard "Recovered" tab.
                </div>
                
                <div className="relative" ref={algoListRef}>
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Algorithm</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 pr-8"
                      placeholder="Search Algorithm..."
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
                            onClick={() => selectAlgo(a.id, a.algorithmName)}
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
                        Selected ID: {submissionAlgo}
                     </div>
                  )}
                </div>

                <button 
                    onClick={handleSubmit}
                    disabled={submitting || (!submissionContent && !submissionFile) || !submissionAlgo}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-lg font-medium flex justify-center items-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-900/20 transition-all"
                >
                   {submitting ? <RefreshCw className="animate-spin" size={18} /> : <UploadCloud size={18} />}
                   Upload to Escrow
                </button>
            </div>
            
            <div className="lg:col-span-2 space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Hash List (Text)</label>
                    <label className="text-xs font-bold text-indigo-400 cursor-pointer hover:text-indigo-300 flex items-center gap-1">
                      <input type="file" className="hidden" onChange={(e) => {
                        if(e.target.files?.[0]) setSubmissionFile(e.target.files[0]);
                      }} accept=".txt" />
                      <FileText size={12} /> {submissionFile ? submissionFile.name : 'Load from .txt file'}
                    </label>
                  </div>
                  <textarea
                      className="w-full h-48 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-300 focus:border-emerald-500 outline-none resize-none"
                      placeholder={'21232f297a57a5a743894a0e4a801fc3:admin\n5f4dcc3b5aa765d61d8327deb882cf99:password'}
                      value={submissionContent}
                      onChange={e => setSubmissionContent(e.target.value)}
                      disabled={!!submissionFile}
                  />
                  {submissionFile && (
                    <div className="mt-2 text-xs text-emerald-400 flex items-center gap-2">
                      <FileText size={14} /> File loaded: {submissionFile.name} (Textarea disabled)
                      <button onClick={() => setSubmissionFile(null)} className="text-red-400 hover:underline ml-2">Clear</button>
                    </div>
                  )}
                </div>
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
                        Mass Download Wizard
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
                        <label className="block text-xs text-slate-400 uppercase font-bold mb-2">1. Select Algorithm Type</label>
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
                        <label className="block text-xs text-slate-400 uppercase font-bold mb-2">2. Minimum Price (USD)</label>
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
                            <span>Files to fetch:</span>
                            <span className="font-bold text-white">{calculateDownloadableCount()}</span>
                        </div>
                        <div className="text-xs text-slate-500 leading-tight">
                            This will combine all matching files into a single <span className="font-mono text-emerald-400">.txt</span> file: <br/>
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
                        onClick={startMassDownload}
                        disabled={downloading || calculateDownloadableCount() === 0 || !dlAlgo}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded transition-all flex justify-center items-center gap-2"
                    >
                        {downloading ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>}
                        {downloading ? 'Downloading & Combining...' : 'Download & Combine'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default EscrowDashboard;