import React, { useState } from 'react';
import { 
  Play, Pause, Save, Activity, FastForward, Loader2 
} from 'lucide-react';
import { SessionStatus } from '../types';

interface SessionControlsProps {
    sessionId: string | null;
    status: SessionStatus;
    onOptimisticUpdate: (newStatus: SessionStatus) => void;
}

const SessionControls: React.FC<SessionControlsProps> = ({ sessionId, status, onOptimisticUpdate }) => {
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    const handleAction = async (action: string, label: string) => {
        if (!sessionId) return;
        setLoadingAction(label);
        
        // 1. Optimistic UI Update
        if (action === 'p') onOptimisticUpdate(SessionStatus.PAUSED);
        if (action === 'r') onOptimisticUpdate(SessionStatus.RUNNING);
        // Note: 'b' (Bypass) keeps the session running, so no status change needed here.

        try {
            await fetch('http://localhost:3001/api/session/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, action })
            });
        } catch (e) {
            console.error("Action failed", e);
        } finally {
            setTimeout(() => setLoadingAction(null), 500);
        }
    };

    if (status !== SessionStatus.RUNNING && status !== SessionStatus.PAUSED) {
        return null;
    }

    return (
        <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-lg border border-slate-800 shadow-lg animate-in fade-in slide-in-from-bottom-2">
            
            {status === SessionStatus.RUNNING ? (
                <button 
                    onClick={() => handleAction('p', 'pause')}
                    disabled={!!loadingAction}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/50 rounded text-xs font-bold transition-all"
                    title="Pause Session [p]"
                >
                    {loadingAction === 'pause' ? <Loader2 className="animate-spin" size={14} /> : <Pause size={14} fill="currentColor" />}
                    PAUSE
                </button>
            ) : (
                <button 
                    onClick={() => handleAction('r', 'resume')}
                    disabled={!!loadingAction}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 rounded text-xs font-bold transition-all"
                    title="Resume Session [r]"
                >
                    {loadingAction === 'resume' ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} fill="currentColor" />}
                    RESUME
                </button>
            )}

            <button 
                onClick={() => handleAction('s', 'status')}
                disabled={!!loadingAction}
                className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded transition-colors"
                title="Force Status Update [s]"
            >
                <Activity size={16} />
            </button>

            <button 
                onClick={() => handleAction('c', 'checkpoint')}
                disabled={!!loadingAction}
                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                title="Save Checkpoint [c]"
            >
                <Save size={16} />
            </button>

            <div className="w-px h-4 bg-slate-800 mx-1"></div>
            
            <button 
                onClick={() => handleAction('b', 'bypass')}
                disabled={!!loadingAction}
                className="p-1.5 text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 rounded transition-colors"
                title="Bypass/Next (Skip current attack block) [b]"
            >
                <FastForward size={16} />
            </button>
        </div>
    );
};

export default SessionControls;