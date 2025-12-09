import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  FileKey, Upload, Copy, CheckCircle, 
  AlertTriangle, Loader2, FileArchive, 
  FileText, Shield, Terminal, Settings, ChevronRight
} from 'lucide-react';

// Refactored TOOLS to use translation keys for categories
const TOOLS = [
  { id: 'auto', name: 'extractor_auto_detect', isTranslatable: true },
  { categoryKey: 'extractor_grp_archives', options: [
    { id: 'zip', name: 'ZIP Archive (.zip)' },
    { id: '7z', name: '7-Zip Archive (.7z)' },
    { id: 'rar', name: 'RAR Archive (.rar)' },
    { id: 'dmg', name: 'macOS Disk Image (.dmg)' },
  ]},
  { categoryKey: 'extractor_grp_docs', options: [
    { id: 'office', name: 'Microsoft Office (.docx, .doc, .xlsx, .xls, .pptx, .ppt)' },
    { id: 'libreoffice', name: 'LibreOffice (.odt, .ods, .odp, .odg)' },
    { id: 'staroffice', name: 'StarOffice (.sdc, .sdw, .sda, .sdd)' },
    { id: 'pdf', name: 'PDF Document (.pdf)' },
    { id: 'applenotes', name: 'Apple Notes (.sqlite, .wal)' },
  ]},
  { categoryKey: 'extractor_grp_keys', options: [
    { id: 'ssh', name: 'SSH Private Key (id_rsa)' },
    { id: 'putty', name: 'Putty Key (.ppk)' },
    { id: 'gpg', name: 'GPG Private Key (.gpg, .asc)' },
    { id: 'pfx', name: 'PFX/P12 Certificate (.pfx)' },
    { id: 'keychain', name: 'macOS Keychain (.keychain)' },
    { id: 'keyring', name: 'GNOME Keyring (.keyring)' },
    { id: 'keystore', name: 'Java Keystore (.jks, .keystore)' },
  ]},
  { categoryKey: 'extractor_grp_wallets', options: [
    { id: 'keepass', name: 'KeePass DB (.kdbx)' },
    { id: 'money', name: 'Microsoft Money (.mny)' },
    { id: 'padlock', name: 'Padlock Password Manager (.padlock)' },
    { id: 'electrum', name: 'Electrum Wallet' },
    { id: 'monero', name: 'Monero Wallet (.keys)' },
    { id: 'ethereum', name: 'Ethereum Keystore (JSON)' },
    { id: 'neo', name: 'NEO Wallet (.wlt, .json)' },
    { id: 'bitlocker', name: 'BitLocker Recovery Key' },
  ]},
  { categoryKey: 'extractor_grp_system', options: [
    { id: 'aruba', name: 'ArubaOS Config (.cfg)' },
    { id: 'apex', name: 'Oracle Apex (.sql)' },
    { id: 'filezilla', name: 'FileZilla Server (XML)' },
    { id: 'itunes', name: 'iTunes Backup (Manifest.plist)' },
    { id: 'telegram', name: 'Telegram Desktop (map/config)' },
    { id: 'android', name: 'Android Backup (.ab)' },
    { id: 'mozilla', name: 'Mozilla/Firefox (key4.db)' },
  ]}
];

interface File2JohnProps {
  onSetTarget: (hash: string) => void;
  onNavigate: (tab: 'dashboard') => void;
}

// --- API URL HELPER ---
const getApiUrl = (endpoint: string) => {
    const host = window.location.hostname;
    const baseUrl = (host.includes('zrok.io') || window.location.port === '3001')
        ? window.location.origin
        : 'http://localhost:3001';
    return `${baseUrl}${endpoint}`;
};

const File2John: React.FC<File2JohnProps> = ({ onSetTarget, onNavigate }) => {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState('auto');
  const [extractedHashes, setExtractedHashes] = useState<string[]>([]);
  const [activeHashIndex, setActiveHashIndex] = useState(0); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      setFile(f);
      setError(null);
      setExtractedHashes([]);
      setActiveHashIndex(0);
      
      const name = f.name.toLowerCase();
      // Archives
      if (name.endsWith('.zip')) setFileType('zip');
      else if (name.endsWith('.7z')) setFileType('7z');
      else if (name.endsWith('.rar')) setFileType('rar');
      else if (name.endsWith('.dmg')) setFileType('dmg');
      
      // Documents
      else if (name.endsWith('.pdf')) setFileType('pdf');
      else if (name.includes('notestore') || name.endsWith('.sqlite')) setFileType('applenotes');
      else if (
          name.endsWith('.docx') || name.endsWith('.doc') || 
          name.endsWith('.xlsx') || name.endsWith('.xls') || 
          name.endsWith('.pptx') || name.endsWith('.ppt')
      ) setFileType('office');
      else if (name.endsWith('.odt') || name.endsWith('.ods') || name.endsWith('.odp') || name.endsWith('.odg')) setFileType('libreoffice');
      else if (name.endsWith('.sdc') || name.endsWith('.sdw') || name.endsWith('.sda') || name.endsWith('.sdd')) setFileType('staroffice');
      
      // Managers & Wallets
      else if (name.endsWith('.kdbx')) setFileType('keepass');
      else if (name.endsWith('.mny')) setFileType('money');
      else if (name.endsWith('.padlock')) setFileType('padlock');
      else if (name.endsWith('.ppk')) setFileType('putty');
      else if (name.endsWith('.pfx')) setFileType('pfx');
      else if (name.endsWith('.gpg') || name.endsWith('.asc')) setFileType('gpg');
      else if (name.endsWith('.json') && name.includes('utc')) setFileType('ethereum');
      else if (name.includes('electrum') || name === 'default_wallet') setFileType('electrum');
      else if (name.endsWith('.keys')) setFileType('monero');
      else if (name.endsWith('.wlt') || name.endsWith('.db3')) setFileType('neo');
      
      // System & Net
      else if (name.includes('id_rsa')) setFileType('ssh');
      else if (name.endsWith('.ab')) setFileType('android');
      else if (name === 'key4.db') setFileType('mozilla');
      else if (name === 'manifest.plist') setFileType('itunes');
      else if (name.includes('filezilla') || (name.endsWith('.xml') && name.includes('server'))) setFileType('filezilla');
      else if (name.endsWith('map') || name.includes('telegram')) setFileType('telegram');
      else if (name.includes('aruba') || name.endsWith('.cfg')) setFileType('aruba');
      else if (name.includes('apex') && name.endsWith('.sql')) setFileType('apex');
      
      // Keys
      else if (name.endsWith('.keychain') || name.endsWith('.keychain-db')) setFileType('keychain');
      else if (name.endsWith('.keyring')) setFileType('keyring');
      else if (name.endsWith('.jks') || name.endsWith('.keystore')) setFileType('keystore');
    }
  };

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setExtractedHashes([]);
    setActiveHashIndex(0);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', fileType);

      const response = await fetch(getApiUrl('/api/tools/file2john'), {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.message || t('extractor_err_failed'));
      
      if (data.hashes && Array.isArray(data.hashes) && data.hashes.length > 0) {
          setExtractedHashes(data.hashes);
      } else if (data.hash) {
          setExtractedHashes([data.hash]);
      } else {
          setExtractedHashes([]);
          setError(t('extractor_err_no_hash'));
      }

    } catch (err: any) {
      setError(err.message || t('extractor_err_failed'));
    } finally {
      setLoading(false);
    }
  };

  const activeHash = extractedHashes[activeHashIndex] || '';

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
      {/* LEFT PANEL: Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6 h-full">
        <div>
           <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
             <FileKey className="text-indigo-500" /> {t('extractor_title')}
           </h2>
           <p className="text-slate-500 text-sm mt-2 leading-relaxed">
             {t('extractor_desc')}
           </p>
        </div>

        <div className="bg-slate-950 border-2 border-dashed border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:border-indigo-500/50 transition-colors relative group">
           <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleFileChange} />
           {file ? (
             <div className="flex flex-col items-center gap-2 animate-in zoom-in-50">
                <FileArchive size={48} className="text-emerald-500" />
                <div className="font-mono text-slate-200 font-bold truncate max-w-[200px]">{file.name}</div>
                <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</div>
             </div>
           ) : (
             <div className="flex flex-col items-center gap-2 text-slate-500 group-hover:text-slate-400">
                <Upload size={32} />
                <span className="text-sm font-medium">{t('extractor_drag_drop')}</span>
             </div>
           )}
        </div>

        <div className="space-y-4">
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{t('extractor_target_format')}</label>
             <div className="relative">
               <select 
                 value={fileType} 
                 onChange={(e) => setFileType(e.target.value)}
                 className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 appearance-none"
               >
                 {TOOLS.map((group: any) => (
                   group.options ? (
                     <optgroup key={group.categoryKey} label={t(group.categoryKey)}>
                       {group.options.map((opt: any) => <option key={opt.id} value={opt.id}>{opt.name}</option>)}
                     </optgroup>
                   ) : (
                     <option key={group.id} value={group.id}>{group.isTranslatable ? t(group.name) : group.name}</option>
                   )
                 ))}
               </select>
               <Settings size={14} className="absolute right-3 top-3 text-slate-500 pointer-events-none"/>
             </div>
           </div>
           
           <button onClick={handleExtract} disabled={!file || loading} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-bold flex justify-center items-center gap-2 shadow-lg shadow-indigo-900/20">
             {loading ? <Loader2 className="animate-spin" size={16} /> : <Terminal size={16} />}
             {t('extractor_btn_extract')}
           </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle size={16} /> {error}
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Results */}
      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl flex flex-col relative overflow-hidden h-full">
         <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0 bg-slate-950/50">
            <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
                {t('extractor_output_label')} 
                {extractedHashes.length > 0 && <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full text-[10px]">{t('extractor_found_count', { count: extractedHashes.length })}</span>}
            </label>
            <div className="flex gap-2">
               {extractedHashes.length > 0 && (
                 <>
                   <button onClick={() => navigator.clipboard.writeText(activeHash)} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition-colors flex items-center gap-2">
                      <Copy size={12} /> {t('extractor_btn_copy')}
                   </button>
                   <button onClick={() => { onSetTarget(activeHash); onNavigate('dashboard'); }} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition-colors flex items-center gap-2">
                      <Shield size={12} /> {t('extractor_btn_use')}
                   </button>
                 </>
               )}
            </div>
         </div>
         
         {/* Variant Selector Tabs */}
         {extractedHashes.length > 1 && (
            <div className="flex overflow-x-auto border-b border-slate-800 bg-slate-950 custom-scrollbar">
               {extractedHashes.map((_, idx) => (
                  <button 
                    key={idx}
                    onClick={() => setActiveHashIndex(idx)}
                    className={`px-4 py-2 text-xs font-medium border-r border-slate-800 transition-colors whitespace-nowrap hover:bg-slate-900 focus:outline-none ${activeHashIndex === idx ? 'bg-indigo-600 text-white border-indigo-600' : 'text-slate-500 hover:text-slate-200'}`}
                  >
                    {t('extractor_variant', { count: idx + 1 })}
                  </button>
               ))}
            </div>
         )}

         <div className="flex-1 overflow-hidden relative bg-black/40">
            {extractedHashes.length > 0 ? (
                <textarea 
                    readOnly 
                    value={activeHash} 
                    className="w-full h-full bg-transparent p-4 font-mono text-xs text-emerald-400 resize-none outline-none custom-scrollbar"
                />
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600">
                    <FileText size={48} className="opacity-20 mb-4"/>
                    <span className="text-sm italic">{t('extractor_placeholder')}</span>
                </div>
            )}
         </div>
      </div>
    </div>
  );
};
export default File2John;