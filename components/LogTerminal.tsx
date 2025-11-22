import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogTerminalProps {
  logs: LogEntry[];
}

const LogTerminal: React.FC<LogTerminalProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      // Use scrollTo with behavior smooth for better UX without moving the whole page
      scrollRef.current.scrollTo({ top: scrollHeight - clientHeight, behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden font-mono text-xs md:text-sm shadow-inner min-h-0">
      <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center gap-2 shrink-0">
        <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
        <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
        <span className="ml-2 text-slate-400">hashcat_session_01.log</span>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-1 scroll-smooth"
      >
        {logs.map((log) => (
          <div key={log.id} className="break-all opacity-90 hover:opacity-100 transition-opacity">
            <span className="text-slate-500 select-none mr-3">
              {log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
            </span>
            <span className={
              log.level === 'ERROR' ? 'text-red-400 font-bold' :
              log.level === 'WARN' ? 'text-yellow-400' :
              log.level === 'SUCCESS' ? 'text-emerald-400 font-bold' :
              'text-slate-300'
            }>
              {log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogTerminal;