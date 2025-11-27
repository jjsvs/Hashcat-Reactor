import React, { useRef } from 'react'; // Removed useEffect
import { RecoveredHash } from '../types';
import { ShieldCheck, Copy, Globe, CheckCircle } from 'lucide-react';

interface Props {
  hashes: RecoveredHash[];
  onSendToEscrow?: (hashes: RecoveredHash[]) => void;
}

const RecoveredHashList: React.FC<Props> = ({ hashes, onSendToEscrow }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // DELETED: The useEffect that forced scrolling to the bottom is removed.
  // The list naturally renders new items at the top.

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const newHashes = hashes.filter(h => !h.sentToEscrow);
  const newCount = newHashes.length;

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner min-h-0">
      <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400" />
            <span className="text-slate-200 font-bold text-sm">Recovered Hashes</span>
            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2 py-0.5 rounded-full font-mono border border-emerald-500/20">
                {hashes.length}
            </span>
        </div>
        {onSendToEscrow && (
            <button 
                onClick={() => onSendToEscrow(hashes)}
                disabled={newCount === 0}
                className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded transition-all font-medium border ${
                  newCount > 0 
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' 
                    : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed opacity-50'
                }`}
            >
                <Globe size={14} /> 
                {newCount > 0 ? 'Send New' : 'All Sent'}
            </button>
        )}
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-0 scroll-smooth"
      >
        {hashes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2 opacity-50">
                <ShieldCheck size={32} />
                <span className="text-xs">No hashes recovered yet</span>
            </div>
        ) : (
            <div className="divide-y divide-slate-800/50">
                {hashes.map((item) => (
                    <div 
                      key={item.id} 
                      className={`p-3 transition-colors flex items-center justify-between group ${
                        item.sentToEscrow ? 'bg-slate-900/30 hover:bg-slate-900/50' : 'hover:bg-slate-900/50'
                      }`}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            {item.sentToEscrow && (
                              <div title="Sent to Escrow">
                                <CheckCircle size={14} className="text-emerald-500/50" />
                              </div>
                            )}
                            <div className={`flex flex-col gap-0.5 overflow-hidden ${item.sentToEscrow ? 'opacity-50' : ''}`}>
                                <span className="text-emerald-400 font-mono text-sm font-bold truncate">{item.plain}</span>
                                <span className="text-slate-500 font-mono text-[10px] truncate">{item.hash}</span>
                            </div>
                        </div>
                        <button 
                            onClick={() => copyToClipboard(`${item.hash}:${item.plain}`)}
                            className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded opacity-0 group-hover:opacity-100 transition-all"
                            title="Copy hash:plain"
                        >
                            <Copy size={14} />
                        </button>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};

export default RecoveredHashList;