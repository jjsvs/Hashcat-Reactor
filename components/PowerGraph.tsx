import React, { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { Zap, Thermometer, Cpu } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';

interface PowerGraphProps {
  socket: Socket | null;
  compact?: boolean; 
}

interface GPUStat {
    index: number;
    name: string;
    watts: number;
    temp: number;
}

const PowerGraph: React.FC<PowerGraphProps> = ({ socket, compact = false }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<{ time: string; watts: number }[]>([]);
  const [details, setDetails] = useState<{ totalWatts: number; maxTemp: number; gpus: GPUStat[] } | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handler = (msg: any) => {
      // NEW: Listen for detailed stats object
      if (msg.type === 'gpu_detailed') {
        const val = msg.value;
        setDetails(val);
        
        setData(prev => {
          const newData = [...prev, { time: new Date().toLocaleTimeString(), watts: parseFloat(val.totalWatts.toFixed(1)) }];
          const limit = compact ? 20 : 60;
          return newData.slice(-limit); 
        });
      }
    };

    socket.on('stats_update', handler);
    return () => { socket.off('stats_update', handler); };
  }, [socket, compact]);

  const currentWatts = details ? details.totalWatts.toFixed(1) : "0.0";
  const currentTemp = details ? details.maxTemp : 0;

  // Helper to shorten long GPU names for sidebar
  const formatName = (name: string) => name.replace('NVIDIA GeForce', '').replace('RTX', '').trim();

  // --- COMPACT MODE (SIDEBAR) ---
  if (compact) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-800 w-full flex flex-col gap-3">
        {/* Header: Totals */}
        <div className="flex justify-between items-end px-1">
          <div className="flex flex-col gap-1">
             <div className="flex items-center gap-1.5 text-slate-500">
                <Zap size={14} className={Number(currentWatts) > 0 ? "text-yellow-400 fill-yellow-400/20" : ""} />
                <span className="text-[10px] uppercase font-bold tracking-wider">{t('pwr_total')}</span>
             </div>
          </div>
          <div className="flex flex-col items-end gap-1">
             <span className="font-mono text-sm font-bold text-slate-200">{currentWatts} W</span>
          </div>
        </div>

        {/* GPU List (Compact) */}
        {details && details.gpus.length > 0 && (
            <div className="flex flex-col gap-1 px-1">
                {details.gpus.map((gpu) => (
                    <div key={gpu.index} className="flex justify-between items-center text-[10px] text-slate-400 border-t border-slate-800/50 pt-1">
                        <span className="truncate max-w-[80px]" title={gpu.name}>{formatName(gpu.name)}</span>
                        <div className="flex gap-2 font-mono">
                            <span className="text-yellow-400/80">{gpu.watts.toFixed(0)}W</span>
                            <span className={gpu.temp > 75 ? "text-red-400" : "text-slate-500"}>{gpu.temp}°C</span>
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* Graph (Total Power) */}
        <div className="h-10 w-full opacity-60 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <YAxis domain={['dataMin - 10', 'dataMax + 10']} hide={true} />
              <Line 
                type="monotone" 
                dataKey="watts" 
                stroke="#facc15" 
                strokeWidth={2} 
                dot={false} 
                isAnimationActive={false} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // --- FULL DASHBOARD MODE ---
  return (
    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl backdrop-blur-sm min-h-[300px] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
                <Zap className="text-yellow-400" size={20} />
                <h3 className="text-slate-200 font-bold">{t('pwr_system')}</h3>
            </div>
            <div className="flex items-center gap-2 pl-4 border-l border-slate-700">
                <Thermometer className="text-red-400" size={20} />
                <h3 className="text-slate-200 font-bold">{t('pwr_max_temp')}</h3>
            </div>
        </div>
        
        <div className="flex items-center gap-4">
            <span className="font-mono text-2xl font-bold text-yellow-400">{currentWatts} W</span>
            <span className="font-mono text-2xl font-bold text-red-400">{currentTemp}°C</span>
        </div>
      </div>

       {/* GPU Detailed List (Full Mode) */}
       {details && details.gpus.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                {details.gpus.map((gpu) => (
                    <div key={gpu.index} className="bg-slate-950/50 border border-slate-800 rounded p-2 flex justify-between items-center text-xs">
                        <div className="flex items-center gap-2">
                            <Cpu size={14} className="text-indigo-400" />
                            <span className="font-bold text-slate-300">{gpu.name}</span>
                        </div>
                        <div className="flex gap-4 font-mono">
                            <span className="text-yellow-400">{gpu.watts.toFixed(1)} W</span>
                            <span className={gpu.temp > 75 ? "text-red-400" : "text-emerald-400"}>{gpu.temp}°C</span>
                        </div>
                    </div>
                ))}
            </div>
        )}
      
      <div className="flex-1 w-full min-h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
             <YAxis domain={[0, 'auto']} stroke="#475569" fontSize={10} tickFormatter={(val) => `${val}W`} />
             <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
              itemStyle={{ color: '#facc15' }}
              labelStyle={{ color: '#94a3b8' }}
             />
            <Line 
              type="monotone" 
              dataKey="watts" 
              stroke="#facc15" 
              strokeWidth={2} 
              dot={false} 
              isAnimationActive={false} 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PowerGraph;