import React from 'react';
import { GpuDevice } from '../types';
import { Cpu, Thermometer, Fan, Activity } from 'lucide-react';

interface DeviceCardProps {
  device: GpuDevice;
}

const DeviceCard: React.FC<DeviceCardProps> = ({ device }) => {
  const getTempColor = (temp: number) => {
    if (temp < 60) return 'text-emerald-400';
    if (temp < 80) return 'text-yellow-400';
    return 'text-red-500';
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 backdrop-blur-sm hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-800 rounded-lg">
            <Cpu size={20} className="text-indigo-400" />
          </div>
          <div>
            <h4 className="text-slate-200 font-medium text-sm">GPU #{device.id}</h4>
            <p className="text-slate-500 text-xs truncate max-w-[160px]">{device.name}</p>
          </div>
        </div>
        <div className="text-xs font-mono text-slate-400 bg-slate-950 px-2 py-1 rounded">
          PCI-E 4.0
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Temperature */}
        <div className="bg-slate-950/50 rounded-lg p-3 flex flex-col items-center justify-center gap-1">
          <Thermometer size={16} className={getTempColor(device.temp)} />
          <span className={`text-lg font-mono font-bold ${getTempColor(device.temp)}`}>
            {device.temp}°
          </span>
          <span className="text-[10px] uppercase text-slate-600 font-semibold">Temp</span>
        </div>

        {/* Fan Speed */}
        <div className="bg-slate-950/50 rounded-lg p-3 flex flex-col items-center justify-center gap-1">
          <Fan size={16} className={device.fanSpeed > 80 ? 'text-orange-400 animate-spin' : 'text-sky-400'} />
          <span className="text-lg font-mono font-bold text-slate-200">
            {device.fanSpeed}%
          </span>
          <span className="text-[10px] uppercase text-slate-600 font-semibold">Fan</span>
        </div>

        {/* Utilization */}
        <div className="bg-slate-950/50 rounded-lg p-3 flex flex-col items-center justify-center gap-1">
          <Activity size={16} className="text-emerald-400" />
          <span className="text-lg font-mono font-bold text-slate-200">
            {device.utilization}%
          </span>
          <span className="text-[10px] uppercase text-slate-600 font-semibold">Load</span>
        </div>
      </div>

      <div className="flex justify-between items-center text-xs text-slate-500 mt-2 px-1">
        <span>Core: <span className="text-slate-300 font-mono">{device.coreClock} MHz</span></span>
        <span>Mem: <span className="text-slate-300 font-mono">{device.memoryClock} MHz</span></span>
      </div>
      
      {/* Usage Bar */}
      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
        <div 
          className="bg-indigo-500 h-full transition-all duration-500" 
          style={{ width: `${device.utilization}%` }}
        />
      </div>
    </div>
  );
};

export default DeviceCard;