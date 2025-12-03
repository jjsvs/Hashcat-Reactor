import React from 'react';
import { QueueItem } from '../types';
import { Play, Trash2, Clock, List, AlertCircle, PauseCircle, PlayCircle } from 'lucide-react';
import { ATTACK_MODES, HASH_TYPES } from '../constants';
import { useTranslation } from 'react-i18next';

interface QueueManagerProps {
  queue: QueueItem[];
  removeFromQueue: (id: string) => void;
  isQueueProcessing: boolean;
  setIsQueueProcessing: (active: boolean) => void;
  clearQueue: () => void;
}

const QueueManager: React.FC<QueueManagerProps> = ({ 
  queue, 
  removeFromQueue, 
  isQueueProcessing, 
  setIsQueueProcessing,
  clearQueue
}) => {
  const { t } = useTranslation();
  
  const getAttackModeName = (id: number) => {
    const mode = ATTACK_MODES.find(m => m.id === id);
    return mode ? mode.name : `Mode ${id}`;
  };

  const getHashName = (id: string) => {
    const hash = HASH_TYPES.find(h => h.id === id);
    return hash ? hash.name : `Type ${id}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <List className="text-indigo-500" /> {t('queue_title')}
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            {t('queue_desc')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
           <button 
             onClick={() => setIsQueueProcessing(!isQueueProcessing)}
             className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all border ${isQueueProcessing ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'}`}
           >
             {isQueueProcessing ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
             {isQueueProcessing ? t('queue_btn_active') : t('queue_btn_paused')}
           </button>
           
           {queue.length > 0 && (
             <button 
               onClick={clearQueue}
               className="flex items-center gap-2 px-4 py-2 bg-red-900/20 border border-red-900/50 text-red-400 hover:bg-red-900/40 rounded-lg font-bold text-sm transition-colors"
             >
               <Trash2 size={16} /> {t('queue_btn_clear')}
             </button>
           )}
        </div>
      </div>

      {queue.length === 0 ? (
         <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center">
             <List size={48} className="text-slate-700 mb-4" />
             <h3 className="text-slate-300 font-bold">{t('queue_empty_title')}</h3>
             <p className="text-slate-500 mt-2">
                 {t('queue_empty_desc')}
             </p>
         </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-950/50 border-b border-slate-800">
              <tr>
                <th className="p-4 pl-6">{t('queue_col_status')}</th>
                <th className="p-4">{t('queue_col_algo')}</th>
                <th className="p-4">{t('queue_col_mode')}</th>
                <th className="p-4">{t('queue_col_target')}</th>
                <th className="p-4">{t('queue_col_added')}</th>
                <th className="p-4 text-right">{t('queue_col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {queue.map((job, index) => (
                <tr key={job.id} className="hover:bg-slate-800/30 transition-colors group">
                  <td className="p-4 pl-6">
                    <div className="flex items-center gap-2">
                       <span className="text-slate-500 font-mono text-xs">#{index + 1}</span>
                       <span className="px-2 py-1 rounded-full text-[10px] uppercase font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                         {t('queue_status_pending')}
                       </span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-300 text-sm">{getHashName(job.config.hashType)}</div>
                    <div className="text-xs text-slate-500 font-mono">{t('queue_label_mode')} {job.config.hashType}</div>
                  </td>
                  <td className="p-4">
                     <span className="text-sm text-slate-300">{getAttackModeName(job.config.attackMode)}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
                         <span className="text-slate-600">{t('queue_label_target')}</span> {job.targetSummary}
                      </div>
                      <div className="text-xs text-slate-400 font-mono flex items-center gap-1">
                         <span className="text-slate-600">{t('queue_label_input')}</span> {job.config.mask || job.config.wordlistPath ? (job.config.attackMode === 3 ? `Mask: ${job.config.mask}` : `Wordlist: ...${job.config.wordlistPath.slice(-20)}`) : 'N/A'}
                      </div>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-slate-500 font-mono">
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(job.addedAt).toLocaleTimeString()}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <button 
                      onClick={() => removeFromQueue(job.id)}
                      className="p-2 bg-slate-800 hover:bg-red-500 hover:text-white text-slate-400 rounded-lg transition-colors border border-slate-700"
                      title={t('queue_col_actions')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {!isQueueProcessing && queue.length > 0 && (
         <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 text-sm">
            <AlertCircle size={18} />
            <span>{t('queue_paused_alert')}</span>
         </div>
      )}
    </div>
  );
};

export default QueueManager;