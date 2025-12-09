import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Globe, Shield, Lock, Unlock, Copy, ExternalLink, 
  Power, AlertTriangle, CheckCircle 
} from 'lucide-react';

interface RemoteConfig {
    active: boolean;
    url: string | null;
    username: string;
    password: string;
}

interface RemoteAccessProps {
    socket: any;
}

// --- DYNAMIC URL HELPER REPLICATED HERE FOR INDEPENDENT COMPONENT SAFETY ---
const getApiUrl = (endpoint: string) => {
    const host = window.location.hostname;
    const baseUrl = (host.includes('zrok.io') || window.location.port === '3001')
        ? window.location.origin
        : 'http://localhost:3001';
    return `${baseUrl}${endpoint}`;
};

const RemoteAccess: React.FC<RemoteAccessProps> = ({ socket }) => {
    const { t } = useTranslation();
    const [config, setConfig] = useState<RemoteConfig>({
        active: false,
        url: null,
        username: '',
        password: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Sync status from backend socket
    useEffect(() => {
        if (!socket) return;
        
        socket.on('remote_status_update', (data: RemoteConfig) => {
            setConfig(prev => ({ ...prev, ...data }));
            setLoading(false);
        });

        // Initial fetch using dynamic URL
        fetch(getApiUrl('/api/remote/status'))
            .then(res => res.json())
            .then(data => setConfig(prev => ({ ...prev, ...data })))
            .catch(() => {});

        return () => {
            socket.off('remote_status_update');
        };
    }, [socket]);

    const handleStart = async () => {
        setError(null);
        setLoading(true);

        if (!config.username || !config.password) {
            setError(t('remote_err_creds'));
        }

        try {
            const res = await fetch(getApiUrl('/api/remote/start'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username: config.username, 
                    password: config.password 
                })
            });
            const data = await res.json();
            if (!data.success && data.message) {
                setError(data.message);
                setLoading(false);
            }
        } catch (e: any) {
            setError(e.message);
            setLoading(false);
        }
    };

    const handleStop = async () => {
        setLoading(true);
        try {
            await fetch(getApiUrl('/api/remote/stop'), { method: 'POST' });
        } catch (e: any) {
            setError(e.message);
            setLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-indigo-600/10 rounded-lg">
                    <Globe className="text-indigo-400" size={24} />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-white">{t('remote_title')}</h2>
                    <p className="text-slate-400">{t('remote_desc')}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Configuration Panel */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                        <Shield size={18} className="text-emerald-400" />
                        {t('remote_sec_config')}
                    </h3>
                    
                    <div className="space-y-4">
                        <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50 text-sm text-slate-400 flex gap-3">
                            <AlertTriangle className="shrink-0 text-amber-400" size={20} />
                            <p>
                                <span dangerouslySetInnerHTML={{__html: t('remote_cred_warn')}} />
                                <br/><span className="text-slate-500 text-xs mt-1 block">{t('remote_enforced')}</span>
                            </p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{t('remote_user')}</label>
                            <input 
                                type="text" 
                                value={config.username}
                                onChange={(e) => setConfig({ ...config, username: e.target.value })}
                                disabled={config.active || loading}
                                placeholder={t('remote_user_ph')}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{t('remote_pass')}</label>
                            <div className="relative">
                                <input 
                                    type="password" 
                                    value={config.password}
                                    onChange={(e) => setConfig({ ...config, password: e.target.value })}
                                    disabled={config.active || loading}
                                    placeholder={t('remote_pass_ph')}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                                />
                                {config.password && (
                                    <div className="absolute right-3 top-3 text-emerald-500">
                                        <Lock size={16} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-800">
                            {!config.active ? (
                                <button 
                                    onClick={handleStart}
                                    disabled={loading}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    {loading ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span> : <Power size={18} />}
                                    {t('remote_btn_start')}
                                </button>
                            ) : (
                                <button 
                                    onClick={handleStop}
                                    disabled={loading}
                                    className="w-full py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    {loading ? <span className="animate-spin rounded-full h-4 w-4 border-2 border-red-400 border-t-transparent"></span> : <Power size={18} />}
                                    {t('remote_btn_stop')}
                                </button>
                            )}
                        </div>
                        {error && <p className="text-red-400 text-sm text-center mt-2">{error}</p>}
                    </div>
                </div>

                {/* Status Panel */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
                    <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                        <Globe size={18} className="text-indigo-400" />
                        {t('remote_conn_status')}
                    </h3>

                    <div className="flex-1 flex flex-col items-center justify-center min-h-[200px] text-center space-y-4">
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${config.active ? 'bg-emerald-500/10 text-emerald-400 animate-pulse' : 'bg-slate-800 text-slate-600'}`}>
                            {config.active ? <Globe size={40} /> : <Unlock size={40} />}
                        </div>

                        <div>
                            <h4 className={`text-xl font-bold ${config.active ? 'text-white' : 'text-slate-500'}`}>
                                {config.active ? t('remote_online') : t('remote_offline')}
                            </h4>
                            <p className="text-slate-500 text-sm">
                                {config.active 
                                    ? t('remote_online_desc')
                                    : t('remote_offline_desc')}
                            </p>
                        </div>

                        {config.active && config.url && (
                            <div className="w-full bg-slate-950 p-4 rounded-lg border border-slate-800 mt-4 animate-in slide-in-from-bottom-2 fade-in">
                                <label className="text-xs text-slate-500 uppercase font-bold block mb-2 text-left">{t('remote_public_ep')}</label>
                                <div className="flex gap-2">
                                    <input 
                                        readOnly 
                                        value={config.url} 
                                        onClick={(e) => e.currentTarget.select()}
                                        className="flex-1 bg-transparent text-emerald-400 font-mono text-sm outline-none cursor-pointer" 
                                    />
                                    <button 
                                        onClick={() => copyToClipboard(config.url!)}
                                        className="text-slate-400 hover:text-white transition-colors" 
                                        title="Copy URL"
                                    >
                                        <Copy size={16} />
                                    </button>
                                    <a 
                                        href={config.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-slate-400 hover:text-white transition-colors"
                                        title="Open"
                                    >
                                        <ExternalLink size={16} />
                                    </a>
                                </div>
                            </div>
                        )}
                        
                         {config.active && !config.url && (
                             <div className="text-sm text-indigo-400 flex items-center gap-2">
                                 <span className="animate-spin rounded-full h-3 w-3 border-2 border-indigo-400 border-t-transparent"></span>
                                 {t('remote_allocating')}
                             </div>
                         )}
                    </div>
                </div>
            </div>
            
             <div className="bg-indigo-900/20 border border-indigo-500/20 p-4 rounded-xl flex gap-4 items-start">
                 <div className="p-2 bg-indigo-500/20 rounded-lg shrink-0">
                     <CheckCircle className="text-indigo-400" size={20} />
                 </div>
                 <div>
                     <h4 className="font-bold text-slate-200">{t('remote_prereq_title')}</h4>
                     <p className="text-sm text-slate-400 mt-1" dangerouslySetInnerHTML={{__html: t('remote_prereq_desc')}} />
                 </div>
             </div>
        </div>
    );
};

export default RemoteAccess;