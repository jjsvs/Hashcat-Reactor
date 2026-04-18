import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LogEntry, SessionStats, SessionStatus } from '../types';
import { Terminal, Plus, Activity, Power, Trash2 } from 'lucide-react';
import { HASH_TYPES } from '../constants';

const HASH_TYPE_MAP = new Map(HASH_TYPES.map(h => [h.id, h.name]));

interface LogTerminalProps {
  logs: LogEntry[];
  sessions: Record<string, SessionStats>;
  activeSessionId: string | null;
  onSelectSession: (id: string | null) => void;
  onDeleteSession: (id: string) => void;
}

const LogTerminal = React.memo<LogTerminalProps>(({ logs, sessions, activeSessionId, onSelectSession, onDeleteSession }) => {
  const { t } = useTranslation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs, activeSessionId]);

  return (
    <div className="flex h-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-inner min-h-0">
      {/* Session Sidebar */}
      <div className="w-44 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>{t('log_sessions_title')}</span>
            <button
                onClick={() => onSelectSession(null)}
                className="p-1 hover:bg-indigo-600 hover:text-white rounded transition-colors text-slate-500"
                title={t('log_new_session')}
            >
                <Plus size={14} />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <button
                onClick={() => onSelectSession(null)}
                className={`w-full text-left px-3 py-2 rounded text-xs font-medium transition-colors flex items-center gap-2 ${!activeSessionId ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800'}`}
            >
                <Terminal size={14} />
                <span>{t('log_new_session')}</span>
            </button>

            {Object.values(sessions).map((sess) => {
                const isRunning = sess.status === SessionStatus.RUNNING;
                const sid = sess.sessionId || 'unknown';
                const isSelected = activeSessionId === sid;
                const algoName = HASH_TYPE_MAP.get(sess.hashType) ?? (sess.hashType || 'Unknown');
                const displayName = `Session ${sid.slice(-4)}: ${algoName}`;

                return (
                    <div
                        key={sid}
                        className={`group flex items-center justify-between w-full px-2 py-2 rounded text-xs transition-colors border ${isSelected ? 'bg-indigo-600/10 text-indigo-300 border-indigo-500/30' : 'text-slate-400 border-transparent hover:bg-slate-800'}`}
                    >
                        <button
                            onClick={() => onSelectSession(sid)}
                            className="flex-1 flex items-center gap-2 truncate text-left min-w-0"
                        >
                           {isRunning
                             ? <Activity size={12} className="text-emerald-400 animate-pulse shrink-0" />
                             : <Power size={12} className={sess.status === SessionStatus.IDLE ? 'text-slate-600 shrink-0' : 'text-red-400 shrink-0'} />}
                           <span className="truncate font-mono">{displayName}</span>
                        </button>

                        {!isRunning && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDeleteSession(sid); }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-opacity ml-1 shrink-0"
                                title="Delete from list"
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
      </div>

      {/* Terminal Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center gap-2 shrink-0">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="ml-2 text-slate-400 font-mono text-xs truncate">
                {activeSessionId ? (sessions[activeSessionId]?.name || `Session ${activeSessionId}`) : t('log_ready')}
            </span>
        </div>

        <div className="flex-1 p-4 overflow-y-auto space-y-1 font-mono text-xs md:text-sm">
            {(!logs || logs.length === 0) ? (
                <div className="text-slate-600 italic">{t('log_waiting')}</div>
            ) : (
                logs.map((log) => (
                  <div key={log.id} className="break-all opacity-90 hover:opacity-100 transition-opacity">
                    <span className="text-slate-500 select-none mr-3">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={
                      log.level === 'ERROR'   ? 'text-red-400 font-bold'    :
                      log.level === 'WARN'    ? 'text-yellow-400'           :
                      log.level === 'SUCCESS' ? 'text-emerald-400 font-bold':
                      'text-slate-300'
                    }>
                      {log.message}
                    </span>
                  </div>
                ))
            )}
            <div ref={endRef} />
        </div>
      </div>
    </div>
  );
});

export default LogTerminal;
