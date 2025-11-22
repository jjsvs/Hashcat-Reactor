import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { HistoryPoint } from '../types';

interface CpuChartProps {
  data: HistoryPoint[];
  color: string;
  title: string;
  dataKey: string;
  unit?: string;
}

const CpuChart: React.FC<CpuChartProps> = ({ data, color, title, dataKey, unit = '' }) => {
  return (
    <div className="w-full h-full min-h-[16rem] bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
      <h3 className="text-slate-400 text-sm font-medium mb-4 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`color${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={color} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis 
              dataKey="timestamp" 
              tick={false} 
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${value}${unit}`}
              domain={['auto', 'auto']}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
              itemStyle={{ color: color }}
              labelStyle={{ display: 'none' }}
              formatter={(value: number) => [`${value.toLocaleString()} ${unit}`, title]}
            />
            <Area 
              type="monotone" 
              dataKey={dataKey} 
              stroke={color} 
              strokeWidth={2}
              fillOpacity={1} 
              fill={`url(#color${dataKey})`} 
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default CpuChart;