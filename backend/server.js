const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { spawn, exec } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const readline = require('readline');
const { Readable } = require('stream');

let pty;
try {
    pty = require('node-pty');
} catch (e) {
    console.warn("node-pty not found. Interactive terminal and Pause/Resume will not work.");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const IS_ELECTRON = process.env.IS_ELECTRON === 'true';
const USER_DATA_PATH = process.env.USER_DATA_PATH;
const RESOURCES_PATH = process.env.RESOURCES_PATH;

// Handle uploads directory
const uploadDir = IS_ELECTRON && USER_DATA_PATH 
    ? path.join(USER_DATA_PATH, 'uploads')
    : path.join(__dirname, '../uploads'); 

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const POTFILE_PATH = path.join(uploadDir, 'reactor.potfile');
const SESSIONS_PATH = path.join(uploadDir, 'sessions.json');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
});
const upload = multer({ storage });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = 3001;

const getJohnPath = () => {
    const platform = process.platform === 'win32' ? 'win32'
                   : process.platform === 'darwin' ? 'darwin'
                   : 'linux';
    if (IS_ELECTRON && RESOURCES_PATH) {
        return path.join(RESOURCES_PATH, 'backend', 'john', platform);
    }
    return path.join(__dirname, 'john', platform);
};

// Python/Perl interpreters used to run JtR's script-based *2john tools on
// Linux/macOS (Windows ships PyInstaller .exe wrappers instead).
const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';

// File2john tool registry. JtR's *2john extractors come in three flavours:
//   native — a compiled C binary: <name>.exe on Windows, bare <name> on *nix
//   python — a .py script: shipped as a PyInstaller .exe (in a same-named
//            subfolder) on Windows, run via python3 on Linux/macOS
//   perl   — a .pl script: shipped as a .exe on Windows, run via perl on *nix
// Keys match the `type` values the frontend sends.
const JOHN_TOOLS = {
    zip:        { kind: 'native', name: 'zip2john' },
    '7z':       { kind: 'perl',   name: '7z2john' },
    rar:        { kind: 'native', name: 'rar2john' },
    // dmg/ssh/android ship a .py alongside the C binary — use the script on
    // *nix so they need no compiled binary (Windows still prefers the .exe).
    dmg:        { kind: 'python', name: 'dmg2john' },
    office:     { kind: 'python', name: 'office2john' },
    pdf:        { kind: 'perl',   name: 'pdf2john' },
    libreoffice:{ kind: 'python', name: 'libreoffice2john' },
    staroffice: { kind: 'python', name: 'staroffice2john' },
    putty:      { kind: 'native', name: 'putty2john' },
    pfx:        { kind: 'python', name: 'pfx2john' },
    gpg:        { kind: 'native', name: 'gpg2john' },
    keepass:    { kind: 'native', name: 'keepass2john' },
    ssh:        { kind: 'python', name: 'ssh2john' },
    keychain:   { kind: 'python', name: 'keychain2john' },
    keyring:    { kind: 'python', name: 'keyring2john' },
    keystore:   { kind: 'python', name: 'keystore2john' },
    ethereum:   { kind: 'python', name: 'ethereum2john' },
    monero:     { kind: 'python', name: 'monero2john' },
    electrum:   { kind: 'python', name: 'electrum2john' },
    bitlocker:  { kind: 'native', name: 'bitlocker2john' },
    telegram:   { kind: 'python', name: 'telegram2john' },
    android:    { kind: 'python', name: 'androidbackup2john' },
    mozilla:    { kind: 'python', name: 'mozilla2john' },
    itunes:     { kind: 'perl',   name: 'itunes_backup2john' },
    filezilla:  { kind: 'python', name: 'filezilla2john' },
    apex:       { kind: 'python', name: 'apex2john' },
    applenotes: { kind: 'python', name: 'applenotes2john' },
    aruba:      { kind: 'python', name: 'aruba2john' },
    money:      { kind: 'python', name: 'money2john' },
    neo:        { kind: 'python', name: 'neo2john' },
    padlock:    { kind: 'python', name: 'padlock2john' },
};

// Resolve how to invoke a john tool on the current platform.
// Returns { command, args } where args precede the input file path, or
// { error } describing what's missing.
const resolveJohnTool = (toolKey) => {
    const tool = JOHN_TOOLS[toolKey];
    if (!tool) return { error: 'Unsupported file type.' };
    const johnDir = getJohnPath();
    const tryScript = (interp, ext) => {
        const script = path.join(johnDir, `${tool.name}${ext}`);
        if (fs.existsSync(script)) return { command: interp, args: [script] };
        return null;
    };

    if (process.platform === 'win32') {
        // Prefer the shipped .exe: native tools sit at the run-dir root,
        // python/perl tools are packaged as <name>/<name>.exe.
        const rootExe = path.join(johnDir, `${tool.name}.exe`);
        if (fs.existsSync(rootExe)) return { command: rootExe, args: [] };
        const subExe = path.join(johnDir, tool.name, `${tool.name}.exe`);
        if (fs.existsSync(subExe)) return { command: subExe, args: [] };
        // Fall back to the raw script if no .exe was bundled.
        const fb = tool.kind === 'perl' ? tryScript('perl', '.pl')
                 : tool.kind === 'python' ? tryScript(PYTHON_BIN, '.py')
                 : null;
        if (fb) return fb;
        return { error: `Binary not found for "${toolKey}".`, details: rootExe };
    }

    // Linux / macOS
    if (tool.kind === 'native') {
        const bin = path.join(johnDir, tool.name);
        if (fs.existsSync(bin)) return { command: bin, args: [] };
        // No bundled binary (e.g. macOS, where we don't ship compiled C tools):
        // fall back to the tool on PATH, i.e. a Homebrew `john-jumbo` install.
        if (process.platform === 'darwin') return { command: tool.name, args: [] };
        return { error: `Binary "${tool.name}" not found — add it to backend/john/linux.`, details: bin };
    }
    const res = tool.kind === 'perl' ? tryScript('perl', '.pl') : tryScript(PYTHON_BIN, '.py');
    if (res) return res;
    const ext = tool.kind === 'perl' ? '.pl' : '.py';
    return { error: `Script "${tool.name}${ext}" not found — add it to backend/john/${process.platform === 'darwin' ? 'darwin' : 'linux'}.`, details: path.join(johnDir, `${tool.name}${ext}`) };
};

// --- PRINCE PROCESSOR PATH ---
const getPrincePath = () => {
    const plat = process.platform;
    // Windows ships pp64.exe, Linux ships pp64.bin. macOS has no bundled binary
    // (it can't run the Linux ELF) — prefer a bundled mac `pp64` if present,
    // otherwise fall back to `pp64` on PATH (e.g. a Homebrew install).
    const candidates = plat === 'win32' ? ['pp64.exe']
                     : plat === 'darwin' ? ['pp64']
                     : ['pp64.bin', 'pp64'];
    const dirs = [];
    if (IS_ELECTRON && RESOURCES_PATH) dirs.push(path.join(RESOURCES_PATH, 'backend', 'princeprocessor'));
    dirs.push(path.join(__dirname, 'princeprocessor'));
    for (const dir of dirs) {
        for (const name of candidates) {
            const p = path.join(dir, name);
            if (fs.existsSync(p)) return p;
        }
    }
    return 'pp64'; // resolve via PATH
};

// --- HELPER: HASH CLEANER ---
const cleanHash = (line) => {
    line = line.trim();
    if (!line) return null;

    const formats = [
        { start: '$zip2$', end: '$/zip2$' },
        { start: '$pkzip2$', end: '$/pkzip2$' },
        { start: '$winzip$', end: '$/winzip$' },
        { start: '$zip3$', end: '$/zip3$' },
        { start: '$7z$', end: null },
        { start: '$rar5$', end: null },
        { start: '$rar3$', end: null },
        { start: '$pdf$', end: null },
        { start: '$kdbx$', end: null },
        { start: '$sshng$', end: null },
        { start: '$bitcoin$', end: null },
        { start: '$monero$', end: null },
        { start: '$itunes_backup$', end: null },
        { start: '$ethereum$', end: null },
        { start: '$dcc2$', end: null },
        { start: '$office$', end: null }, 
        { start: '$dmg$', end: null },
        { start: '$pfx$', end: null },
        { start: '$telegram$', end: null },
        { start: '$mozilla$', end: null },
        { start: '$ab$', end: null },
        { start: '$electrum$', end: null },
        { start: '$filezilla$', end: null },
        { start: '$odf$', end: null },
        { start: '$sxc$', end: null },
        { start: '$keychain$', end: null },
        { start: '$keyring$', end: null },
        { start: '$keystore$', end: null },
        { start: '$apex$', end: null },
        { start: '$applenotes$', end: null },
        { start: '$aruba$', end: null },
        { start: '$money$', end: null },
        { start: '$neo$', end: null },
        { start: '$neo2$', end: null },
        { start: '$padlock$', end: null }
    ];

    for (const fmt of formats) {
        const startIdx = line.indexOf(fmt.start);
        if (startIdx !== -1) {
            let dirtyHash = line.substring(startIdx);
            if (fmt.end) {
                const endIdx = dirtyHash.indexOf(fmt.end);
                if (endIdx !== -1) {
                    return dirtyHash.substring(0, endIdx + fmt.end.length);
                }
            }
            const parts = dirtyHash.split(':');
            return parts[0]; 
        }
    }
    const parts = line.split(':');
    if (parts.length > 1) {
        const dollarPart = parts.find(p => p.startsWith('$'));
        if (dollarPart) return dollarPart;
        let candidate = parts[1];
        if (parts[0].length === 1) candidate = parts[2] || parts[1]; 
        return candidate;
    }
    return line; 
};

app.post('/api/tools/file2john', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const type = req.body.type || 'auto';
    const filename = req.file.originalname.toLowerCase();
    let toolKey = '';

    if (type === 'zip' || (type === 'auto' && filename.endsWith('.zip'))) toolKey = 'zip';
    else if (type === '7z' || (type === 'auto' && filename.endsWith('.7z'))) toolKey = '7z';
    else if (type === 'rar' || (type === 'auto' && filename.endsWith('.rar'))) toolKey = 'rar';
    else if (type === 'dmg' || (type === 'auto' && filename.endsWith('.dmg'))) toolKey = 'dmg';
    else if (type === 'office' || (type === 'auto' && (filename.endsWith('.docx') || filename.endsWith('.xlsx') || filename.endsWith('.doc') || filename.endsWith('.xls') || filename.endsWith('.ppt') || filename.endsWith('.pptx')))) toolKey = 'office';
    else if (type === 'pdf' || (type === 'auto' && filename.endsWith('.pdf'))) toolKey = 'pdf';
    else if (type === 'libreoffice' || (type === 'auto' && (filename.endsWith('.odt') || filename.endsWith('.ods') || filename.endsWith('.odp') || filename.endsWith('.odg')))) toolKey = 'libreoffice';
    else if (type === 'staroffice' || (type === 'auto' && (filename.endsWith('.sdc') || filename.endsWith('.sdw') || filename.endsWith('.sda') || filename.endsWith('.sdd')))) toolKey = 'staroffice';
    else if (type === 'putty' || (type === 'auto' && filename.endsWith('.ppk'))) toolKey = 'putty';
    else if (type === 'pfx' || (type === 'auto' && filename.endsWith('.pfx'))) toolKey = 'pfx';
    else if (type === 'gpg' || (type === 'auto' && filename.endsWith('.gpg'))) toolKey = 'gpg';
    else if (type === 'keepass' || (type === 'auto' && filename.endsWith('.kdbx'))) toolKey = 'keepass';
    else if (type === 'ssh' || (type === 'auto' && filename.includes('id_rsa'))) toolKey = 'ssh';
    else if (type === 'keychain' || (type === 'auto' && (filename.endsWith('.keychain') || filename.endsWith('.keychain-db')))) toolKey = 'keychain';
    else if (type === 'keyring' || (type === 'auto' && filename.endsWith('.keyring'))) toolKey = 'keyring';
    else if (type === 'keystore' || (type === 'auto' && (filename.endsWith('.jks') || filename.endsWith('.keystore')))) toolKey = 'keystore';
    else if (type === 'ethereum') toolKey = 'ethereum';
    else if (type === 'monero' || (type === 'auto' && filename.endsWith('.keys'))) toolKey = 'monero';
    else if (type === 'electrum' || (type === 'auto' && (filename.includes('electrum') || filename === 'default_wallet'))) toolKey = 'electrum';
    else if (type === 'bitlocker') toolKey = 'bitlocker';
    else if (type === 'telegram' || (type === 'auto' && (filename.includes('map') || filename.includes('telegram')))) toolKey = 'telegram';
    else if (type === 'android' || (type === 'auto' && filename.endsWith('.ab'))) toolKey = 'android';
    else if (type === 'mozilla' || (type === 'auto' && filename === 'key4.db')) toolKey = 'mozilla';
    else if (type === 'itunes' || (type === 'auto' && filename === 'manifest.plist')) toolKey = 'itunes';
    else if (type === 'filezilla' || (type === 'auto' && (filename.includes('filezilla') || (filename.endsWith('.xml') && filename.includes('server'))))) toolKey = 'filezilla';
    else if (type === 'apex' || (type === 'auto' && filename.includes('apex'))) toolKey = 'apex';
    else if (type === 'applenotes' || (type === 'auto' && (filename.includes('notestore') || filename.endsWith('.sqlite')))) toolKey = 'applenotes';
    else if (type === 'aruba' || (type === 'auto' && (filename.includes('aruba') || filename.endsWith('.cfg')))) toolKey = 'aruba';
    else if (type === 'money' || (type === 'auto' && filename.endsWith('.mny'))) toolKey = 'money';
    else if (type === 'neo' || (type === 'auto' && (filename.endsWith('.wlt') || filename.endsWith('.db3')))) toolKey = 'neo';
    else if (type === 'padlock' || (type === 'auto' && filename.endsWith('.padlock'))) toolKey = 'padlock';

    if (!toolKey) return res.status(400).json({ message: 'Unsupported file type.' });

    const resolved = resolveJohnTool(toolKey);
    if (resolved.error) return res.status(500).json({ message: resolved.error, details: resolved.details });

    const proc = spawn(resolved.command, [...resolved.args, req.file.path]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', (code) => {
        setTimeout(() => { try { fs.unlinkSync(req.file.path); } catch(e) {} }, 500);
        if (!stdout && stderr) {
            if (stdout.length < 5) return res.status(500).json({ message: 'Extraction failed', details: stderr });
        }
        const lines = stdout.split(/\r?\n/).filter(line => line.trim().length > 0);
        const extractedHashes = [];
        lines.forEach(line => {
            const cleaned = cleanHash(line);
            if (cleaned && cleaned.length > 10) extractedHashes.push(cleaned);
        });
        const uniqueHashes = [...new Set(extractedHashes)];
        res.json({ success: true, hashes: uniqueHashes, raw: stdout });
    });
    
    proc.on('error', (err) => res.status(500).json({ message: 'Spawn error', error: err.message }));
});

let zrokProcess = null;
let remoteConfig = { active: false, url: null, username: '', password: '' };
let staticPath = process.env.FRONTEND_BUILD_PATH;
if (!staticPath || !fs.existsSync(staticPath)) {
    const parentTry = path.join(__dirname, '../../dist'); 
    if (fs.existsSync(parentTry)) staticPath = parentTry;
    else {
        const currentTry = path.join(__dirname, '../dist');
        if (fs.existsSync(currentTry)) staticPath = currentTry;
    }
}
if (staticPath && fs.existsSync(staticPath)) app.use(express.static(staticPath));

// Stores session objects. 
const activeSessions = {}; 
let sessionCounter = 0; 
let currentGlobalPower = 0;
let currentMaxTemp = 0;
let currentGpus = [];   // [{ index, name, watts, temp }] from the latest poll

// Per-session live stats the Pebble companion polls. These are populated
// alongside the Socket.IO emissions so the watchapp can show the same
// numbers without needing a Socket.IO connection.
const liveStats = {}; // sessionId -> { timeEstimatedSec, hashrate, progressPercent, lastUpdated }

function setLiveStat(sessionId, key, value) {
    if (!sessionId) return;
    if (!liveStats[sessionId]) liveStats[sessionId] = { timeEstimatedSec: 0, hashrate: 0, progressPercent: 0, lastUpdated: Date.now() };
    liveStats[sessionId][key] = value;
    liveStats[sessionId].lastUpdated = Date.now();
}

// Convert hashcat's "Time.Estimated" string into seconds.
// Examples: "5d 12h", "1h 23m", "30 mins, 45 secs", "0 secs", "2 days, 3 hours".
function parseHashcatTimeToSec(s) {
    if (!s) return 0;
    s = String(s).toLowerCase();
    if (s.includes('remaining') || s === '0 secs' || s === '0 sec' || s === '0s') return 0;
    let total = 0;
    const re = /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
    let m;
    let matched = false;
    while ((m = re.exec(s)) !== null) {
        matched = true;
        const v = parseInt(m[1], 10);
        const u = m[2];
        if (u.startsWith('d')) total += v * 86400;
        else if (u.startsWith('h')) total += v * 3600;
        else if (u.startsWith('m')) total += v * 60;
        else if (u.startsWith('s')) total += v;
    }
    return matched ? total : 0;
}

const uuid = () => Math.random().toString(36).substring(2, 9);

const getHashcatConfig = () => {
  const plat = process.platform;
  // Candidate bundled binary names by platform. Windows: hashcat.exe; Linux:
  // hashcat.bin (or a self-compiled bare `hashcat`). macOS deliberately does
  // NOT consider hashcat.bin — that's a Linux ELF and can't exec on macOS — so
  // it only uses a bundled mac `hashcat` if present, else the PATH fallback
  // below (a Homebrew `brew install hashcat`).
  const candidates = plat === 'win32' ? ['hashcat.exe']
                   : plat === 'darwin' ? ['hashcat']
                   : ['hashcat.bin', 'hashcat'];
  const dirs = [];
  if (IS_ELECTRON && RESOURCES_PATH) dirs.push(path.join(RESOURCES_PATH, 'backend', 'hashcat'));
  dirs.push(path.join(__dirname, 'hashcat'));
  for (const dir of dirs) {
      for (const name of candidates) {
          const exe = path.join(dir, name);
          if (fs.existsSync(exe)) return { executable: exe, cwd: dir };
      }
  }
  return { executable: 'hashcat', cwd: uploadDir };
};

const parseArgs = (cmd) => {
  const args = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (char === '"' || char === "'") inQuote = !inQuote;
    else if (char === ' ' && !inQuote) {
      if (current) args.push(current);
      current = '';
    } else current += char;
  }
  if (current) args.push(current);
  return args;
};

const parsePotfileLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const separatorIndex = trimmed.lastIndexOf(':');
    if (separatorIndex !== -1) {
        return {
            hash: trimmed.substring(0, separatorIndex),
            plain: trimmed.substring(separatorIndex + 1),
            full: trimmed
        };
    }
    return null;
};

const getFullPotfile = () => {
    if (!fs.existsSync(POTFILE_PATH)) return [];
    try {
        const content = fs.readFileSync(POTFILE_PATH, 'utf-8');
        return content.split('\n').map(line => {
            const parsed = parsePotfileLine(line);
            if (parsed) {
                return {
                    id: uuid(),
                    hash: parsed.hash,
                    plain: parsed.plain,
                    algorithmId: '0', 
                    timestamp: Date.now(),
                    sentToEscrow: false
                };
            }
            return null;
        }).filter(item => item !== null);
    } catch (e) { return []; }
};

// Rolling buffer of the most recently cracked plaintexts, surfaced to the
// Pebble watch's RECOVERED card and crack feed. Each entry records when the
// crack landed. Newest is pushed last; capped small.
const recentPlains = [];
function pushRecentPlain(plain) {
    if (plain === undefined || plain === null || plain === '') return;
    recentPlains.push({ plain: String(plain), at: Date.now() });
    while (recentPlains.length > 8) recentPlains.shift();
}

// Recent plaintexts are per-run; once no session is active, clear them so the
// Pebble RECOVERED card stops showing cracks from a finished session.
function clearRecentPlainsIfIdle() {
    if (Object.keys(activeSessions).length === 0) recentPlains.length = 0;
}

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    res.json({ path: req.file.path });
});

app.post('/api/target', (req, res) => {
    const { content, filename } = req.body;
    if (!content) return res.status(400).json({ message: 'No content' });
    const fname = filename || `target_${Date.now()}.txt`;
    const filePath = path.join(uploadDir, fname);
    try {
        fs.writeFileSync(filePath, content);
        res.json({ path: filePath });
    } catch (e) { res.status(500).json({ message: 'Write failed' }); }
});

app.get('/api/remote/status', (req, res) => res.json(remoteConfig));

// === PEBBLE WATCHAPP BRIDGE ===
//
// A read-only state endpoint polled by the Pebble companion (PebbleKit JS).
// The watch itself is too constrained to subscribe to Socket.IO, and we want
// to expose the same numbers the React UI sees, in a single JSON response.

// hashcat mode -> algorithm name. Parsed once from the frontend's HASH_TYPES
// list (the single source of truth) so the Pebble companion can show a real
// algorithm name (e.g. "SHA2-256") instead of a bare mode number ("mode 1400")
// when a session has no algorithmName set.
const HASH_NAME_BY_ID = (() => {
    // hash_names.json sits next to server.js and is shipped (extraResources copies
    // the whole backend/ dir), so it resolves in packaged builds where the source
    // constants.ts is not present. Regenerate it from constants.ts if hash modes
    // change: node -e "...parse constants.ts -> backend/hash_names.json".
    try {
        const jsonPath = path.join(__dirname, 'hash_names.json');
        if (fs.existsSync(jsonPath)) {
            const map = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            if (map && Object.keys(map).length > 0) {
                console.log(`[PEBBLE] Loaded ${Object.keys(map).length} hash-type names from hash_names.json`);
                return map;
            }
        }
    } catch (e) { /* fall back to parsing constants.ts */ }

    // Dev fallback: parse the source-of-truth constants.ts directly.
    const candidates = [
        path.join(__dirname, '..', 'constants.ts'),
        path.join(process.cwd(), 'constants.ts'),
        RESOURCES_PATH ? path.join(RESOURCES_PATH, 'constants.ts') : null,
    ].filter(Boolean);
    for (const file of candidates) {
        try {
            if (!fs.existsSync(file)) continue;
            const txt = fs.readFileSync(file, 'utf-8');
            const map = {};
            const re = /id:\s*'([^']+)'\s*,\s*name:\s*'([^']*)'/g;
            let m;
            while ((m = re.exec(txt)) !== null) map[m[1]] = m[2];
            if (Object.keys(map).length > 0) {
                console.log(`[PEBBLE] Loaded ${Object.keys(map).length} hash-type names from ${path.basename(file)}`);
                return map;
            }
        } catch (e) { /* try next candidate */ }
    }
    console.warn('[PEBBLE] Could not load HASH_TYPES names; Pebble will show mode numbers.');
    return {};
})();

function resolveAlgoName(s) {
    if (s.algorithmName) return s.algorithmName;
    if (s.hashType == null) return null;
    return HASH_NAME_BY_ID[String(s.hashType)] || ('mode ' + s.hashType);
}

// Cumulative session-history series for the Pebble INSIGHTS card. Mirrors the
// web Insights "cumulativeGrowthData": walk completed sessions oldest->newest
// accumulating recovered count and energy (Wh = powerUsage W * hours). Cost is
// rate-dependent so it's derived on the phone (PKJS) from energyWh; here we
// only emit the rate-free series. Capped to the most recent points.
function getPebbleGrowth() {
    let sessions = [];
    if (fs.existsSync(SESSIONS_PATH)) {
        try { sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8')); } catch (e) {}
    }
    sessions = (sessions || [])
        .filter(s => s && s.date)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let rec = 0, wh = 0;
    const recovered = [], energyWh = [];
    sessions.forEach(s => {
        rec += s.recovered || 0;
        wh  += (s.powerUsage || 0) * ((s.duration || 0) / 3600);
        recovered.push(rec);
        energyWh.push(Math.round(wh));
    });
    const N = 48;
    return { recovered: recovered.slice(-N), energyWh: energyWh.slice(-N) };
}

app.get('/api/pebble/state', (req, res) => {
    const sessions = Object.entries(activeSessions).map(([id, s]) => {
        const live = liveStats[id] || {};
        const st = s.stats || {};
        const speeds = st.latestSpeeds || {};
        // Aggregate H/s: prefer the "*" device line if present, else sum numeric devices.
        let aggregateHs = speeds['*'] || 0;
        if (!aggregateHs) {
            aggregateHs = Object.entries(speeds)
                .filter(([k]) => !isNaN(parseInt(k)))
                .reduce((acc, [, v]) => acc + v, 0);
        }
        const avgHs = st.hashrateCount > 0 ? (st.hashrateSum / st.hashrateCount) : 0;
        const avgPwr = st.powerReadings > 0 ? (st.powerSum / st.powerReadings) : 0;
        const out = {
            id,
            name: s.name,
            type: s.type,
            isWorkflow: !!s.isWorkflow,
            startTime: s.startTime,
            uptimeSec: s.startTime ? Math.floor((Date.now() - s.startTime) / 1000) : 0,
            hashType: s.hashType || null,
            attackMode: s.attackMode || null,
            algorithmName: resolveAlgoName(s),
            status: s.status || 'RUNNING',
            stats: {
                recovered: st.recovered || 0,
                recoveredCount: st.recoveredCount || 0,
                total: st.total || 0,
            },
            hashrate: aggregateHs,                       // H/s
            avgHashrate: avgHs,                          // H/s
            avgPower: avgPwr,                            // W
            progressPercent: live.progressPercent || 0,  // 0-100 keyspace progress
            timeEstimatedSec: live.timeEstimatedSec || 0,
            lastUpdated: live.lastUpdated || 0,
        };
        // Smart-workflow timeline pins: the watch should not pin every mask's
        // live estimate. Instead expose two absolute finish times - the
        // dictionary phase (phase 1, from hashcat's live estimate) and the
        // complete mask attack (phase 3, anchored to its start + the
        // precomputed all-masks runtime). Each is non-null only while its
        // phase is active, so the watch pins exactly one phase at a time and
        // retires the previous pin as the workflow advances.
        if (s.isWorkflow) {
            const wf = activeWorkflows[id] || {};
            const nowMs = Date.now();
            out.workflow = {
                phase: wf.phase || 0,
                dictFinishAt: (wf.phase === 1 && (live.timeEstimatedSec || 0) > 0)
                    ? nowMs + live.timeEstimatedSec * 1000 : null,
                maskFinishAt: (wf.phase === 3 && wf.phase3StartTime && (wf.maskEtaSec || 0) > 0)
                    ? wf.phase3StartTime + wf.maskEtaSec * 1000 : null,
            };
        }
        return out;
    });

    res.json({
        now: Date.now(),
        sessions,
        escrow: getEscrowStats(),
        globalPower: currentGlobalPower,
        maxTemp: currentMaxTemp,
        gpus: currentGpus.map(g => ({ index: g.index, temp: Math.round(g.temp || 0) })),
        recentPlains: recentPlains.slice(-3).reverse().map(c => c.plain), // newest first, up to 3
        recentCracks: recentPlains.slice(-8).reverse()
            .map(c => ({ plain: c.plain, at: c.at })),  // timestamped feed, newest first
        growth: getPebbleGrowth(),                      // cumulative history series
    });
});

// Per-session escrow counters. Updated by the React UI via the
// /api/pebble/escrow/record endpoint so the watchapp can show "submitted"
// and running BTC totals without a second trip to hashes.com.
const escrowStats = {}; // sessionId -> { submitted, btc, usd, lastSubmittedAt }

function getEscrowStats() {
    // Return a flat map plus a grand total.
    let totalSubmitted = 0, totalBtc = 0, totalUsd = 0;
    Object.values(escrowStats).forEach(e => {
        totalSubmitted += e.submitted || 0;
        totalBtc += e.btc || 0;
        totalUsd += e.usd || 0;
    });
    return {
        perSession: escrowStats,
        totals: { submitted: totalSubmitted, btc: totalBtc, usd: totalUsd },
    };
}

app.post('/api/pebble/escrow/record', (req, res) => {
    const { sessionId, submitted, btc, usd } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (!escrowStats[sessionId]) escrowStats[sessionId] = { submitted: 0, btc: 0, usd: 0, lastSubmittedAt: 0 };
    if (typeof submitted === 'number') escrowStats[sessionId].submitted += submitted;
    if (typeof btc === 'number') escrowStats[sessionId].btc += btc;
    if (typeof usd === 'number') escrowStats[sessionId].usd += usd;
    escrowStats[sessionId].lastSubmittedAt = Date.now();
    res.json({ ok: true, escrow: escrowStats[sessionId] });
});

app.post('/api/pebble/escrow/clear', (req, res) => {
    const { sessionId } = req.body || {};
    if (sessionId) {
        delete escrowStats[sessionId];
    } else {
        for (const k of Object.keys(escrowStats)) delete escrowStats[k];
    }
    res.json({ ok: true });
});
app.post('/api/remote/start', (req, res) => {
    const { username, password } = req.body;
    if (zrokProcess) return res.status(400).json({ message: 'Remote access already active' });
    remoteConfig.username = username || '';
    remoteConfig.password = password || '';
    const args = ['share', 'public', `http://localhost:${PORT}`, '--headless'];
    if (username && password) args.push('--basic-auth', `${username}:${password}`);
    try {
        zrokProcess = spawn('zrok', args);
        remoteConfig.active = true;
        const parseZrokOutput = (data) => {
            const output = data.toString();
            console.log(`[ZROK LOG] ${output}`);
            const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.share\.zrok\.io/);
            if (urlMatch && (!remoteConfig.url || remoteConfig.url !== urlMatch[0])) {
                console.log(`[ZROK] Captured URL: ${urlMatch[0]}`);
                remoteConfig.url = urlMatch[0];
                io.emit('remote_status_update', remoteConfig);
            }
        };
        zrokProcess.stdout.on('data', parseZrokOutput);
        zrokProcess.stderr.on('data', parseZrokOutput); 
        zrokProcess.on('close', (code) => {
            console.log(`[ZROK] Process exited with code ${code}`);
            remoteConfig.active = false;
            remoteConfig.url = null;
            zrokProcess = null;
            io.emit('remote_status_update', remoteConfig);
        });
        zrokProcess.on('error', (err) => {
            console.error(`[ZROK FAIL] ${err.message}`);
            remoteConfig.active = false;
            io.emit('remote_status_update', remoteConfig);
        });
        res.json({ success: true, message: 'Initiating remote access...' });
    } catch (e) {
        console.error("Failed to spawn zrok", e);
        res.status(500).json({ message: 'Failed to start zrok. Is it installed and in PATH?' });
    }
});

app.post('/api/remote/stop', (req, res) => {
    if (zrokProcess) { zrokProcess.kill(); zrokProcess = null; }
    remoteConfig.active = false;
    remoteConfig.url = null;
    io.emit('remote_status_update', remoteConfig);
    res.json({ success: true });
});

// --- PROXY HELPER FUNCTION ---
const handleProxyRequest = (targetUrl, res, attempt = 1) => {
    if (attempt > 5) return res.status(500).json({ error: "Too many redirects" });
    let parsed;
    try {
        parsed = new URL(targetUrl);
        if (!parsed.hostname.endsWith('hashes.com')) {
             return res.status(403).json({ error: "Only hashes.com allowed" });
        }
    } catch (e) { return res.status(400).json({ error: "Invalid URL" }); }

    const adapter = parsed.protocol === 'https:' ? https : http;
    const reqOptions = { 
        headers: { 
            'User-Agent': 'python-requests/2.28.1', 
            'Accept': '*/*',
            'Accept-Encoding': 'identity', 
            'Connection': 'keep-alive',
            'Host': parsed.hostname 
        } 
    };

    const proxyReq = adapter.get(targetUrl, reqOptions, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            let redirectUrl = proxyRes.headers.location;
            if (!redirectUrl.startsWith('http')) {
                const origin = `${parsed.protocol}//${parsed.hostname}`;
                redirectUrl = redirectUrl.startsWith('/') ? `${origin}${redirectUrl}` : `${origin}/${redirectUrl}`;
            }
            return handleProxyRequest(redirectUrl, res, attempt + 1);
        }
        res.status(proxyRes.statusCode);
        const headersToForward = ['content-type', 'content-length', 'content-disposition', 'last-modified', 'etag'];
        headersToForward.forEach(h => { if(proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]); });
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => { 
        console.error('Proxy Get Error:', e); 
        if (!res.headersSent) res.status(500).json({ error: e.message }); 
    });
};

app.get('/api/escrow/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing url parameter" });
    handleProxyRequest(targetUrl, res);
});

// --- POST PROXY ---
app.post('/api/escrow/proxy', (req, res) => {

    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        const { key, algo, fileContent } = req.body;
        
        if (!key || !algo || !fileContent) {
             return res.status(400).json({ success: false, message: "Missing fields in JSON proxy request" });
        }

        const boundary = '----ReactBoundary' + Math.random().toString(36).slice(2);
        
        // Manually construct multipart body matching hashes.py: key, algo, userfile
        let payload = '';
        payload += `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${key}\r\n`;
        payload += `--${boundary}\r\nContent-Disposition: form-data; name="algo"\r\n\r\n${algo}\r\n`;
        payload += `--${boundary}\r\nContent-Disposition: form-data; name="userfile"; filename="founds.txt"\r\nContent-Type: text/plain\r\n\r\n${fileContent}\r\n`;
        payload += `--${boundary}--\r\n`;

        const options = {
            hostname: 'hashes.com',
            path: '/en/api/founds',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(payload),
                'User-Agent': 'python-requests/2.28.1',
                'Accept': '*/*',
                'Connection': 'close'
            }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => data += chunk);
            proxyRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    res.json(json);
                } catch(e) {
                    res.status(proxyRes.statusCode).send(data);
                }
            });
        });
        
        proxyReq.on('error', e => {
            console.error("Proxy JSON Error:", e);
            res.status(500).json({ error: e.message });
        });
        
        proxyReq.write(payload);
        proxyReq.end();
        return;
    }

    // FALLBACK METHOD: Standard buffering for direct File/Blob uploads
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const options = { 
            hostname: 'hashes.com', 
            path: '/en/api/founds', 
            method: 'POST', 
            headers: { 
                'Content-Type': req.headers['content-type'],
                'Content-Length': bodyBuffer.length, 
                'Host': 'hashes.com',
                'User-Agent': 'python-requests/2.28.1',
                'Origin': 'https://hashes.com',
                'Referer': 'https://hashes.com/',
                'Accept': '*/*',
                'Connection': 'close'
            } 
        };

        const proxyReq = https.request(options, (proxyRes) => {
            res.status(proxyRes.statusCode);
            if(proxyRes.headers['content-type']) res.set('content-type', proxyRes.headers['content-type']);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (e) => { 
            console.error('Proxy Post Error:', e); 
            res.status(500).json({ error: e.message }); 
        });

        proxyReq.write(bodyBuffer);
        proxyReq.end();
    });
});

app.post('/api/tools/prince', (req, res) => {
    const { source, pwMin, pwMax, elemMin, elemMax, limit, casePermute, outputName, wordlistContent } = req.body;
    const princeBin = getPrincePath();
    // A bare command name (no path separator) means "resolve via PATH" — skip the
    // file check and let spawn surface a clear error if it isn't installed.
    const princeIsPathCmd = !princeBin.includes('/') && !princeBin.includes('\\');
    if (!princeIsPathCmd && !fs.existsSync(princeBin)) return res.status(500).json({ message: 'PRINCE binary not found on server.' });

    const jobUuid = uuid();
    const finalOutputName = outputName ?
        (outputName.endsWith('.txt') ? outputName : `${outputName}.txt`) :
        `prince_${jobUuid}.txt`;
    const outputPath = path.join(uploadDir, finalOutputName);

    let inputPath = '';
    let tempInputCreated = false;

    try {
        if (source === 'upload' && wordlistContent) {
            inputPath = path.join(uploadDir, `prince_in_${jobUuid}.txt`);
            fs.writeFileSync(inputPath, wordlistContent, 'utf-8');
            tempInputCreated = true;
        } else if (source === 'upload' && !wordlistContent) {
            return res.status(400).json({ message: 'No wordlist content received. Please select a file and try again.' });
        } else if (source === 'potfile' || source === 'session') {
            const sourcePot = source === 'potfile' ? POTFILE_PATH : path.join(uploadDir, 'reactor.potfile');
            if (!fs.existsSync(sourcePot)) return res.status(400).json({ message: 'Selected potfile source is empty or missing.' });
            const potContent = fs.readFileSync(sourcePot, 'utf-8');
            const lines = potContent.split('\n');
            const plaintexts = new Set();
            lines.forEach(line => {
                const parsed = parsePotfileLine(line); 
                if (parsed && parsed.plain) plaintexts.add(parsed.plain);
            });
            if (plaintexts.size === 0) return res.status(400).json({ message: 'No plaintexts found in potfile to process.' });
            inputPath = path.join(uploadDir, `prince_in_${jobUuid}.txt`);
            fs.writeFileSync(inputPath, Array.from(plaintexts).join('\n'));
            tempInputCreated = true;
        } else {
             return res.status(400).json({ message: 'Invalid input source.' });
        }

        const args = [];
        if (pwMin) args.push(`--pw-min=${pwMin}`);
        if (pwMax) args.push(`--pw-max=${pwMax}`);
        if (elemMin) args.push(`--elem-cnt-min=${elemMin}`);
        if (elemMax) args.push(`--elem-cnt-max=${elemMax}`);
        if (limit) args.push(`--limit=${limit}`);
        if (casePermute === true || casePermute === 'true') args.push('--case-permute');
        
        args.push('-o', outputPath);
        args.push(inputPath);

        const proc = spawn(princeBin, args);
        let errorOut = '';
        proc.stderr.on('data', (d) => errorOut += d.toString());
        
        proc.on('close', (code) => {
            if (tempInputCreated && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (code === 0 && fs.existsSync(outputPath)) {
                res.json({ 
                    success: true, 
                    message: 'Wordlist generated successfully.', 
                    downloadUrl: `/api/download/check-result/${finalOutputName}`, 
                    filename: finalOutputName
                });
            } else {
                res.status(500).json({ message: 'PRINCE process failed.', details: errorOut || `Exit code ${code}` });
            }
        });
    } catch (e) {
        if (tempInputCreated && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/session/action', (req, res) => {
    const { sessionId, action } = req.body;
    if (!sessionId || !action) return res.status(400).json({ message: 'Missing sessionId or action' });
    
    const session = activeSessions[sessionId];
    if (!session || !session.process) return res.status(404).json({ message: 'Session not active' });
    
    try {
        if (session.type === 'pty') {
            session.process.write(action);
        } else {
            session.process.stdin.write(action + '\n');
            if (action === 'p' || action === 'r') {
                io.emit('log', { sessionId, level: 'WARN', message: 'Interactive command sent via pipe. If Hashcat ignores this, node-pty is required.' });
            }
        }
        io.emit('log', { sessionId, level: 'CMD', message: `Sent interactive command: ${action}` });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: 'Failed to send command to process', error: e.message });
    }
});

app.post('/api/system/devices', (req, res) => {
    const { executable, cwd } = getHashcatConfig();
    const args = ['-I'];
    try {
        const proc = spawn(executable, args, { cwd });
        let output = '';
        let errorOutput = '';
        proc.stdout.on('data', (d) => output += d.toString());
        proc.stderr.on('data', (d) => errorOutput += d.toString());
        proc.on('close', () => {
            const devices = [];
            const fullOutput = output + '\n' + errorOutput;
            const lines = fullOutput.split('\n');
            let currentBackend = 'OpenCL';
            let currentDevice = null;
            lines.forEach(line => {
                const clean = line.trim();
                if (!clean) return;
                if (clean.includes('CUDA Info')) currentBackend = 'CUDA';
                else if (clean.includes('OpenCL Info')) currentBackend = 'OpenCL';
                else if (clean.includes('HIP Info')) currentBackend = 'HIP';
                const idMatch = clean.match(/Backend Device ID #(\d+)/i);
                if (idMatch) {
                    if (currentDevice) { if(!devices.some(d => d.id === currentDevice.id)) devices.push(currentDevice); }
                    currentDevice = { id: idMatch[1], name: 'Unknown Device', type: currentBackend };
                }
                const nameMatch = clean.match(/Name\.+:\s+(.+)/i);
                if (nameMatch && currentDevice) currentDevice.name = nameMatch[1].trim();
            });
            if (currentDevice) { if(!devices.some(d => d.id === currentDevice.id)) devices.push(currentDevice); }
            res.json({ devices, raw: fullOutput });
        });
        proc.on('error', (err) => res.status(500).json({ devices: [], raw: `Spawn Error: ${err.message}` }));
    } catch (e) { res.status(500).json({ devices: [], raw: `Execution Error: ${e.message}` }); }
});

app.post('/api/fs/scan', (req, res) => {
    const { dirPath } = req.body;
    if (!dirPath || !fs.existsSync(dirPath)) return res.json({ wordlists: [], rules: [], masks: [] });
    const results = { wordlists: [], rules: [], masks: [] };
    const scanDir = (currentPath, depth = 0) => {
        if (depth > 3) return;
        try {
            const files = fs.readdirSync(currentPath);
            files.forEach(file => {
                const fullPath = path.join(currentPath, file);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    scanDir(fullPath, depth + 1);
                } else {
                    if (file.endsWith('.txt') || file.endsWith('.dic') || file.endsWith('.found')) results.wordlists.push({ name: file, path: fullPath });
                    else if (file.endsWith('.rule') || file.endsWith('.txt')) results.rules.push({ name: file, path: fullPath });
                    else if (file.endsWith('.hcmask')) results.masks.push({ name: file, path: fullPath });
                }
            });
        } catch (e) {}
    };
    scanDir(dirPath);
    res.json(results);
});

app.post('/api/identify', (req, res) => {
  const { targetPath } = req.body;
  if (!targetPath) return res.status(400).json({ message: 'Target path required' });
  const { executable, cwd } = getHashcatConfig();
  const args = [targetPath, '--identify'];
  const proc = spawn(executable, args, { cwd });
  let output = '';
  proc.stdout.on('data', (d) => output += d.toString());
  proc.stderr.on('data', (d) => output += d.toString());
  proc.on('close', () => {
    const modes = [];
    const lines = output.split('\n');
    const modeRegex = /^\s*(\d+)\s+\|\s+([^|]+)/;
    lines.forEach(line => {
        const match = line.match(modeRegex);
        if (match) modes.push({ id: parseInt(match[1]), name: match[2].trim() });
    });
    res.json({ modes, raw: output });
  });
});

app.post('/api/session/start', (req, res) => {
  const { customCommand, targetPath, restore, sessionId: reqSessionId, ...config } = req.body;
  const { executable, cwd } = getHashcatConfig(); 
  let sessionId = reqSessionId;

  if (restore) {
      if (!sessionId) {
          try {
              if (fs.existsSync(cwd)) {
                  const files = fs.readdirSync(cwd).filter(f => f.endsWith('.restore'));
                  if (files.length > 0) {
                      files.sort((a, b) => fs.statSync(path.join(cwd, b)).mtimeMs - fs.statSync(path.join(cwd, a)).mtimeMs);
                      sessionId = files[0].replace(/\.restore$/, '');
                  }
              }
          } catch (e) {}
      }
      if (!sessionId) return res.status(400).json({ message: 'No restore file found.' });
  } else {
      if (!sessionId) {
          sessionCounter++;
          sessionId = `s_${Date.now()}_${uuid()}`;
      }
  }

  const friendlyName = `Session #${sessionCounter} (${config.hashType || 'Restore'})`;
  const sessionPotFile = path.join(uploadDir, `${sessionId}.potfile`);
  // Sidecar log of cracks attributable to THIS session. Survives session exit
  // (unlike sessionPotFile) so restore can re-emit the previously recovered
  // hashes. The frontend's session_crack handler is already idempotent on
  // hash value, so replaying is safe.
  const sessionCrackFile = path.join(uploadDir, `${sessionId}.cracks`);
  let initialSize = 0;
  try {
      if (fs.existsSync(POTFILE_PATH)) {
          fs.copyFileSync(POTFILE_PATH, sessionPotFile);
          initialSize = fs.statSync(sessionPotFile).size;
      } else { fs.writeFileSync(sessionPotFile, ''); }
  } catch (e) {}

  // On restore, prepare a replay of the sidecar so the frontend's recovered-
  // hash list is repopulated from the previous run before any new cracks come
  // in. The actual emit must happen AFTER session_started fires (the frontend
  // drops session_crack events for a sessionId it doesn't have in state yet).
  let replayCracksFn = null;
  if (restore && fs.existsSync(sessionCrackFile)) {
      replayCracksFn = () => {
          try {
              const lines = fs.readFileSync(sessionCrackFile, 'utf-8').split(/\r?\n/);
              let replayed = 0;
              lines.forEach(line => {
                  const parsed = parsePotfileLine(line);
                  if (parsed) {
                      io.emit('session_crack', { sessionId, hash: parsed.hash, plain: parsed.plain });
                      replayed++;
                  }
              });
              if (replayed > 0) {
                  io.emit('log', { sessionId, level: 'INFO', message: `[Restore] Replayed ${replayed} previously recovered hash${replayed === 1 ? '' : 'es'}.` });
              }
          } catch (e) { console.error(`Error replaying cracks for ${sessionId}`, e); }
      };
  }


  let args = [];
  if (restore) {
    args.push('--restore', '--status', '--status-timer', (config.statusTimer || 3).toString());
    args.push('--potfile-path', sessionPotFile);
    args.push('--session', sessionId); 
    if (config.hwmonDisable) args.push('--hwmon-disable');
    if (config.backendDisableOpenCL) args.push('--backend-ignore-opencl'); 
    if (config.backendIgnoreCuda) args.push('--backend-ignore-cuda');
  } else if (customCommand) {
    args = parseArgs(customCommand);
    if (args.length > 0 && args[0].toLowerCase().includes('hashcat')) args.shift();
    if (!args.includes('--potfile-path')) args.push('--potfile-path', sessionPotFile);
    args.push('--session', sessionId);
  } else {
    args.push('-m', config.hashType, '-a', config.attackMode.toString(), '-w', config.workloadProfile.toString());
    if (config.devices) args.push('-d', config.devices);
    args.push('--potfile-path', sessionPotFile);
    args.push('--status', '--status-timer', (config.statusTimer || 3).toString());
    args.push('--session', sessionId);
    if (config.optimizedKernel) args.push('-O');
    if (config.remove) args.push('--remove');
    if (config.hwmonDisable) args.push('--hwmon-disable');
    if (config.backendDisableOpenCL) args.push('--backend-ignore-opencl'); 
    if (config.backendIgnoreCuda) args.push('--backend-ignore-cuda');
    if (config.selfTestDisable) args.push('--self-test-disable');
    if (config.keepGuessing) args.push('--keep-guessing');
    if (config.logfileDisable) args.push('--logfile-disable');
    if (config.force) args.push('--force');
    if (config.bitmapMax && config.bitmapMax !== 24) args.push(`--bitmap-max=${config.bitmapMax}`);
    if (config.skip && config.skip > 0) args.push('-s', config.skip.toString());
    if (config.increment) {
        args.push('--increment');
        if (config.incrementMin) args.push(`--increment-min=${config.incrementMin}`);
        if (config.incrementMax) args.push(`--increment-max=${config.incrementMax}`);
        if (config.incrementInverse) args.push('--increment-inverse');
    }
    if (targetPath) args.push(targetPath);
    const mode = Number(config.attackMode);
    if (mode === 0) { if (config.wordlistPath) args.push(config.wordlistPath); if (config.rulePath) args.push('-r', config.rulePath); } 
    else if (mode === 1) { if (config.wordlistPath) args.push(config.wordlistPath); if (config.wordlistPath2) args.push(config.wordlistPath2); } 
    else if (mode === 3) { if (config.maskFile) args.push(config.maskFile); else if (config.mask) args.push(config.mask); } 
    else if (mode === 6 || mode === 7) {
        const w = config.wordlistPath; const m = config.maskFile || config.mask;
        if (mode === 6) { if(w) args.push(w); if(m) args.push(m); }
        if (mode === 7) { if(m) args.push(m); if(w) args.push(w); }
    }
    else if ([2, 4, 5, 8, 9].includes(mode)) { if (config.wordlistPath) args.push(config.wordlistPath); }
  }
  
  console.log(`[Spawn ${sessionId}] ${executable} ${args.join(' ')}`);
  let lastSessionPotSize = initialSize;
  const checkSessionPotfile = () => {
      try {
          if (!fs.existsSync(sessionPotFile)) return;
          const stats = fs.statSync(sessionPotFile);
          if (stats.size > lastSessionPotSize) {
              const stream = fs.createReadStream(sessionPotFile, { start: lastSessionPotSize, end: stats.size });
              let buffer = '';
              stream.on('data', c => buffer += c.toString());
              stream.on('end', () => {
                  const lines = buffer.split('\n');
                  lines.forEach(line => {
                      const parsed = parsePotfileLine(line);
                      if (parsed) {
                          io.emit('session_crack', { sessionId, hash: parsed.hash, plain: parsed.plain });
                          pushRecentPlain(parsed.plain);
                          if (activeSessions[sessionId]) activeSessions[sessionId].stats.recoveredCount++;
                          try { fs.appendFileSync(POTFILE_PATH, line + '\n'); } catch (e) { }
                          // Sidecar so restore can replay this crack later.
                          try { fs.appendFileSync(sessionCrackFile, line + '\n'); } catch (e) { }
                      }
                  });
              });
              lastSessionPotSize = stats.size;
          }
      } catch (e) { console.error(`Error watching potfile ${sessionId}`, e); }
  };
  const potWatcher = fs.watchFile(sessionPotFile, { interval: 500 }, checkSessionPotfile);
  
  let stdoutBuffer = '';
  const parseOutput = (data, isError = false) => {
        const rawStr = data.toString();
        // eslint-disable-next-line no-control-regex
        const cleanStr = rawStr.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
        stdoutBuffer += cleanStr;
        let lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop(); 
        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;
            io.emit('log', { sessionId, level: isError ? 'WARN' : 'INFO', message: trimmedLine });
            const statusRegex = /Status\.+:\s+(.*)/i;
            const statusMatch = trimmedLine.match(statusRegex);
            if (statusMatch) {
                const currentStatus = statusMatch[1].trim().toUpperCase();
                let statusEnum = 'RUNNING';
                if (currentStatus === 'PAUSED') statusEnum = 'PAUSED';
                else if (currentStatus === 'EXHAUSTED' || currentStatus === 'QUIT') statusEnum = 'COMPLETED';
                io.emit('session_status', { sessionId, status: statusEnum });
            }
            const speedRegex = /Speed\.#(\*|\d+).*?:\s+([\d\.]+)\s+([a-zA-Z]+\/s)/i;
            const speedMatch = trimmedLine.match(speedRegex);
            if (speedMatch) {
                const deviceId = speedMatch[1];
                const val = parseFloat(speedMatch[2]);
                const unit = speedMatch[3];
                let hashrate = val;
                if (unit.toLowerCase() === 'kh/s') hashrate *= 1000;
                else if (unit.toLowerCase() === 'mh/s') hashrate *= 1000000;
                else if (unit.toLowerCase() === 'gh/s') hashrate *= 1000000000;
                if (activeSessions[sessionId]) {
                    // Only record non-zero speeds so the final "0 H/s" on exhaustion
                    // doesn't erase the real speed used for avgHashrate calculation
                    if (hashrate > 0) activeSessions[sessionId].stats.latestSpeeds[deviceId] = hashrate;
                    const knownDevices = Object.keys(activeSessions[sessionId].stats.latestSpeeds);
                    const isAggregate = deviceId === '*' || (knownDevices.length === 1 && deviceId === '1');
                    io.emit('stats_update', { sessionId, type: 'hashrate', value: hashrate, isAggregate });
                    if (isAggregate && hashrate > 0) setLiveStat(sessionId, 'hashrate', hashrate);
                }
            }
            const progressRegex = /Progress.*?:\s+\d+\/\d+\s+\(([\d\.]+)%\)/i;
            const progMatch = trimmedLine.match(progressRegex);
            if (progMatch) {
                io.emit('stats_update', { sessionId, type: 'progress', value: parseFloat(progMatch[1]) });
                setLiveStat(sessionId, 'progressPercent', parseFloat(progMatch[1]));
                if (activeSessions[sessionId]) {
                    const s = activeSessions[sessionId].stats;
                    const speeds = s.latestSpeeds;
                    let currentTotal = speeds['*'];
                    if (currentTotal === undefined) {
                        currentTotal = Object.entries(speeds).filter(([k]) => !isNaN(parseInt(k))).reduce((acc, [, v]) => acc + v, 0);
                    }
                    if (currentTotal > 0) { s.hashrateSum += currentTotal; s.hashrateCount++; }
                }
            }
            const timeRegex = /Time\.Estimated.*?:\s+(.*)/i;
            const timeMatch = trimmedLine.match(timeRegex);
            if (timeMatch) {
                const fullTimeStr = timeMatch[1];
                const parenMatch = fullTimeStr.match(/\((.*?)\)/);
                const value = parenMatch ? parenMatch[1] : fullTimeStr;
                io.emit('stats_update', { sessionId, type: 'time_estimated', value: value });
                setLiveStat(sessionId, 'timeEstimatedSec', parseHashcatTimeToSec(value));
            }
            const recoveredRegex = /Recovered.*?:\s+(\d+)\/(\d+)/i;
            const recMatch = trimmedLine.match(recoveredRegex);
            if (recMatch) {
                const r = parseInt(recMatch[1]);
                const t = parseInt(recMatch[2]);
                if (activeSessions[sessionId]) { 
                    activeSessions[sessionId].stats.recovered = r; 
                    activeSessions[sessionId].stats.total = t; 
                }
                io.emit('stats_update', { sessionId, type: 'recovered', value: r });
                io.emit('stats_update', { sessionId, type: 'total', value: t });
            }
        });
  };

  const handleProcessExit = (code) => {
      let duration = 0;
      let finalStats = { recovered: 0, total: 0, avgHashrate: 0, avgPower: 0 };
      if (activeSessions[sessionId]) {
          const s = activeSessions[sessionId];
          const endTime = Date.now();
          duration = (endTime - s.startTime) / 1000;
          let avg = 0;
          if (s.stats.hashrateCount > 0) {
              avg = s.stats.hashrateSum / s.stats.hashrateCount;
          } else {
              // Fallback: use last known speed reading (covers fast attacks that complete before --status-timer fires)
              const speeds = s.stats.latestSpeeds || {};
              const agg = speeds['*'];
              avg = agg !== undefined ? agg :
                  Object.entries(speeds).filter(([k]) => !isNaN(parseInt(k))).reduce((acc, [, v]) => acc + v, 0);
          }
          const avgPwr = s.stats.powerReadings > 0 ? s.stats.powerSum / s.stats.powerReadings : 0;
          finalStats = { recovered: s.stats.recoveredCount, total: s.stats.total, avgHashrate: avg, avgPower: avgPwr };
      }
      io.emit('log', { sessionId, level: code === 0 ? 'SUCCESS' : 'WARN', message: `Session ${friendlyName} exited with code ${code}` });
      io.emit('session_finished', { sessionId, duration, ...finalStats });
      io.emit('session_status', { sessionId, status: 'IDLE' }); 
      fs.unwatchFile(sessionPotFile);
      if (fs.existsSync(sessionPotFile)) { try { fs.unlinkSync(sessionPotFile); } catch(e) {} }
      if(activeSessions[sessionId]) delete activeSessions[sessionId];
      delete liveStats[sessionId];
      clearRecentPlainsIfIdle();
  };

  try {
    let child;
    let type = 'spawn';

    if (pty) {
        try {
            console.log(`[PTY] Spawning session ${sessionId} in pseudo-terminal.`);
            child = pty.spawn(executable, args, { name: 'xterm-color', cols: 80, rows: 30, cwd: cwd, env: process.env });
            type = 'pty';
            child.onData((data) => parseOutput(data));
            child.onExit(({ exitCode }) => handleProcessExit(exitCode));
        } catch (ptyErr) {
            console.error("PTY spawn failed, falling back to standard spawn", ptyErr);
            child = null;
        }
    }

    if (!child) {
        console.log(`[SPAWN] Spawning session ${sessionId} with standard pipes.`);
        child = spawn(executable, args, { cwd, stdio: 'pipe' });
        if (child.stdin) child.stdin.setEncoding('utf-8');
        child.stdout.on('data', d => parseOutput(d, false));
        child.stderr.on('data', d => parseOutput(d, true));
        child.on('close', handleProcessExit);
    }

    activeSessions[sessionId] = {
        process: child,
        type: type,
        startTime: Date.now(),
        name: friendlyName,
        potFile: sessionPotFile,
        hashType: config.hashType,
        attackMode: config.attackMode,
        algorithmName: null,
        status: 'RUNNING',
        isWorkflow: false,
        stats: { recovered: 0, recoveredCount: 0, total: 0, hashrateSum: 0, hashrateCount: 0, latestSpeeds: {}, powerSum: 0, powerReadings: 0 }
    };

    io.emit('session_started', { sessionId, name: friendlyName, target: targetPath ? path.basename(targetPath) : 'Manual Input', hashType: config.hashType, attackMode: config.attackMode });
    io.emit('session_status', { sessionId, status: 'RUNNING' });
    io.emit('log', { sessionId, level: 'CMD', message: `[${friendlyName}] Started via ${type}` });
    // Replay previously recovered hashes for restored sessions. Must run after
    // session_started so the frontend has a sessions[sessionId] entry to merge
    // session_crack events into.
    if (replayCracksFn) replayCracksFn();
    
    if (type === 'spawn') {
        child.on('error', (err) => {
            io.emit('log', { sessionId, level: 'ERROR', message: err.message });
            io.emit('session_status', { sessionId, status: 'ERROR' });
            fs.unwatchFile(sessionPotFile);
            if(activeSessions[sessionId]) delete activeSessions[sessionId];
            delete liveStats[sessionId];
        });
    }

    res.json({ success: true, sessionId });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// === SMART WORKFLOW ===

// Shared stats parser — used by both regular sessions and smart workflow phases
const parseAndEmitStats = (line, sessionId) => {
    const statusMatch = line.match(/Status\.+:\s+(.*)/i);
    if (statusMatch) {
        const s = statusMatch[1].trim().toUpperCase();
        let e = 'RUNNING';
        if (s === 'PAUSED') e = 'PAUSED';
        else if (s === 'EXHAUSTED' || s === 'QUIT') e = 'COMPLETED';
        io.emit('session_status', { sessionId, status: e });
    }
    const speedMatch = line.match(/Speed\.#(\*|\d+).*?:\s+([\d\.]+)\s+([a-zA-Z]+\/s)/i);
    if (speedMatch) {
        const val = parseFloat(speedMatch[2]);
        const unit = speedMatch[3].toLowerCase();
        let h = val;
        if (unit === 'kh/s') h *= 1000;
        else if (unit === 'mh/s') h *= 1000000;
        else if (unit === 'gh/s') h *= 1000000000;
        io.emit('stats_update', { sessionId, type: 'hashrate', value: h, isAggregate: speedMatch[1] === '*' });
        if (speedMatch[1] === '*' && h > 0) setLiveStat(sessionId, 'hashrate', h);
        if (activeSessions[sessionId]) {
            const st = activeSessions[sessionId].stats;
            if (!st.latestSpeeds) st.latestSpeeds = {};
            // Only record non-zero speeds so the exhaustion "0 H/s" line doesn't
            // erase the real speed before the average is computed
            if (h > 0) st.latestSpeeds[speedMatch[1]] = h;
        }
    }
    const progMatch = line.match(/Progress.*?:\s+\d+\/\d+\s+\(([\d\.]+)%\)/i);
    if (progMatch) {
        io.emit('stats_update', { sessionId, type: 'progress', value: parseFloat(progMatch[1]) });
        setLiveStat(sessionId, 'progressPercent', parseFloat(progMatch[1]));
        if (activeSessions[sessionId]) {
            const st = activeSessions[sessionId].stats;
            const speeds = st.latestSpeeds || {};
            let currentTotal = speeds['*'];
            if (currentTotal === undefined) {
                currentTotal = Object.entries(speeds).filter(([k]) => !isNaN(parseInt(k))).reduce((acc, [, v]) => acc + v, 0);
            }
            if (currentTotal > 0) { st.hashrateSum += currentTotal; st.hashrateCount++; }
        }
    }
    const timeMatch = line.match(/Time\.Estimated.*?:\s+(.*)/i);
    if (timeMatch) {
        const pm = timeMatch[1].match(/\((.*?)\)/);
        const value = pm ? pm[1] : timeMatch[1];
        io.emit('stats_update', { sessionId, type: 'time_estimated', value });
        setLiveStat(sessionId, 'timeEstimatedSec', parseHashcatTimeToSec(value));
    }
    const recMatch = line.match(/Recovered.*?:\s+(\d+)\/(\d+)/i);
    if (recMatch) {
        const r = parseInt(recMatch[1]);
        const t = parseInt(recMatch[2]);
        io.emit('stats_update', { sessionId, type: 'recovered', value: r });
        io.emit('stats_update', { sessionId, type: 'total', value: t });
        if (activeSessions[sessionId]) {
            activeSessions[sessionId].stats.recovered = r;
            activeSessions[sessionId].stats.total = t;
        }
    }
};

const activeWorkflows = {};

const countPotfileEntries = (filePath) => {
    if (!fs.existsSync(filePath)) return 0;
    try {
        return fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(l => l.trim() && l.includes(':')).length;
    } catch { return 0; }
};

const getMaskFromWordNode = (word) => {
    return word.split('').map(char => {
        if (/[a-z]/.test(char)) return '?l';
        if (/[A-Z]/.test(char)) return '?u';
        if (/[0-9]/.test(char)) return '?d';
        return '?s';
    }).join('');
};

// Exact same complexity model as Insights frontend
const getMaskComplexity = (mask) => {
    let count = 1;
    for (let i = 0; i < mask.length; i += 2) {
        const token = mask.substring(i, i + 2);
        if (token === '?l' || token === '?u') count *= 26;
        else if (token === '?d') count *= 10;
        else if (token === '?s') count *= 33;
        else if (token === '?a') count *= 95;
        else if (token === '?b') count *= 256;
    }
    return count;
};

const generateSmartAssets = (outfilePath, {
    maxMasks = 20,
    maskMinLen = 0,
    maskMaxLen = 0,
    hashrateHps = 0,       // H/s — used for time-budget mask selection
    timeBudgetSeconds = 0, // 0 = use maxMasks fallback
    sortMode = 'occurrence' // 'occurrence' | 'efficiency'
} = {}) => {
    if (!fs.existsSync(outfilePath)) return null;
    const maskCounts = {};
    const prefixCounts = {};
    const suffixCounts = {};
    const leetspeakHits = {};
    const yearCounts = {};
    const plaintexts = [];
    const leetspeakMap = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };

    try {
        const lines = fs.readFileSync(outfilePath, 'utf-8').split(/\r?\n/).filter(l => l.trim());
        lines.forEach(line => {
            const plain = line.trim();
            if (!plain) return;
            plaintexts.push(plain);
            const mask = getMaskFromWordNode(plain);
            maskCounts[mask] = (maskCounts[mask] || 0) + 1;

            // Prefix/suffix extraction (non-alpha edges)
            const m = plain.match(/^([^a-zA-Z]*)([a-zA-Z]+.*[a-zA-Z]|[a-zA-Z])([^a-zA-Z]*)$/);
            if (m) {
                if (m[1]) prefixCounts[m[1]] = (prefixCounts[m[1]] || 0) + 1;
                if (m[3]) suffixCounts[m[3]] = (suffixCounts[m[3]] || 0) + 1;
            }

            // Year detection (1900–2099)
            const years = plain.match(/(?:19|20)\d{2}/g);
            if (years) years.forEach(y => { yearCounts[y] = (yearCounts[y] || 0) + 1; });

            // Leetspeak char counts
            for (const char of plain) {
                if (leetspeakMap[char]) leetspeakHits[char] = (leetspeakHits[char] || 0) + 1;
            }
        });

        if (plaintexts.length === 0) return null;

        // Build mask entries with complexity for time-budget calculation
        const maskEntries = Object.entries(maskCounts)
            .map(([mask, count]) => ({ mask, count, complexity: getMaskComplexity(mask) }))
            .filter(({ mask }) => {
                const len = mask.length / 2; // each token is exactly 2 chars
                if (maskMinLen > 0 && len < maskMinLen) return false;
                if (maskMaxLen > 0 && len > maskMaxLen) return false;
                return true;
            });

        // Sort: occurrence = most common first; efficiency = most cracks per cracking-second first
        if (sortMode === 'efficiency') {
            maskEntries.sort((a, b) => (a.complexity / a.count) - (b.complexity / b.count));
        } else {
            maskEntries.sort((a, b) => b.count - a.count);
        }

        let topMasks;
        let skippedMasks = [];
        let estimatedSeconds = 0;
        if (hashrateHps > 0 && timeBudgetSeconds > 0) {
            // Accumulate masks that fit within the time budget; collect the rest as skipped
            topMasks = [];
            for (const { mask, complexity } of maskEntries) {
                const maskTime = complexity / hashrateHps;
                if (estimatedSeconds + maskTime > timeBudgetSeconds) {
                    skippedMasks.push(mask);
                    continue;
                }
                topMasks.push(mask);
                estimatedSeconds += maskTime;
            }
            // No fallback — if nothing fits, skip phase 3 entirely and notify user
        } else {
            topMasks = maskEntries.slice(0, maxMasks).map(e => e.mask);
            skippedMasks = maskEntries.slice(maxMasks).map(e => e.mask);
            estimatedSeconds = hashrateHps > 0
                ? topMasks.reduce((s, m) => s + getMaskComplexity(m) / hashrateHps, 0)
                : 0;
        }
        const allMasks = maskEntries.map(e => e.mask);
        const budgetExhausted = hashrateHps > 0 && timeBudgetSeconds > 0 && topMasks.length === 0 && allMasks.length > 0;

        // --- Enhanced rule generation ---
        const ruleLines = [
            '# Dynamic mutations — Reactor Smart Workflow',
            ':',       // no-op (passthrough)
            'c',       // capitalize first
            'u',       // uppercase all
            'l',       // lowercase all
            'r',       // reverse
            'C',       // lowercase first, uppercase rest
            'd',       // duplicate
            'q',       // duplicate all
            '$1',      // append 1
            '$!',      // append !
            '$2$0$2$4', // append 2024
            '$2$0$2$3', // append 2023
            '$1$2$3',  // append 123
        ];

        // Observed suffixes (up to 12)
        Object.entries(suffixCounts).sort(([, a], [, b]) => b - a).slice(0, 12).forEach(([suf]) => {
            ruleLines.push(suf.split('').map(c => `$${c}`).join(''));
        });

        // Observed prefixes (up to 6)
        Object.entries(prefixCounts).sort(([, a], [, b]) => b - a).slice(0, 6).forEach(([pre]) => {
            ruleLines.push(pre.split('').reverse().map(c => `^${c}`).join(' '));
        });

        // Observed year appends (top 5)
        Object.entries(yearCounts).sort(([, a], [, b]) => b - a).slice(0, 5).forEach(([year]) => {
            ruleLines.push(year.split('').map(c => `$${c}`).join(''));
        });

        // Leetspeak substitutions (most common observed chars)
        const leetRuleMap = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '0': 'o', '$': 's', '7': 't' };
        Object.entries(leetspeakHits).sort(([, a], [, b]) => b - a).slice(0, 7).forEach(([char]) => {
            if (leetRuleMap[char]) ruleLines.push(`s${leetRuleMap[char]}${char}`);
        });

        const etaStr = estimatedSeconds > 0
            ? (estimatedSeconds < 60 ? `${estimatedSeconds.toFixed(0)}s`
                : estimatedSeconds < 3600 ? `${(estimatedSeconds / 60).toFixed(1)}m`
                : `${(estimatedSeconds / 3600).toFixed(1)}h`)
            : null;

        return {
            masks: topMasks,
            skippedMasks,
            allMasks,
            budgetExhausted,
            ruleContent: ruleLines.join('\n'),
            plaintexts,
            count: plaintexts.length,
            estimatedPhase3Seconds: estimatedSeconds,
            estimatedPhase3Eta: etaStr,
        };
    } catch (e) {
        console.error('[Smart Workflow] Asset generation error:', e.message);
        return null;
    }
};

app.post('/api/smart-workflow/start', (req, res) => {
    const {
        targetPath, hashType, wordlistPath, initialRulePath,
        // ── Global performance / hardware (mirrors regular session logic) ──
        workloadProfile = 3,
        devices,
        optimizedKernel = false,         // -O
        statusTimer = 3,                 // --status-timer
        hwmonDisable = false,            // --hwmon-disable
        backendDisableOpenCL = false,    // --backend-ignore-opencl
        backendIgnoreCuda = false,       // --backend-ignore-cuda
        selfTestDisable = false,         // --self-test-disable
        keepGuessing = false,            // --keep-guessing
        logfileDisable = false,          // --logfile-disable
        force = false,                   // --force
        bitmapMax = 24,                  // --bitmap-max
        remove = false,                  // --remove
        // ── Workflow-specific Phase 3 controls ──
        maskMinLen = 4, maskMaxLen = 12,
        phase3Runtime = 0,               // seconds hard cap via --runtime (0 = off)
        phase3Increment = false,
        maxMasks = 20,
        skipPhase3 = false,
        skipPhase4 = false,
        phase4RulePaths = [],            // user-specified rule files for phase 4 sequential passes
        phase3TimeBudgetSeconds = 0,
        phase3HashrateHps = 0,
        historicalHashrateHps = 0,
        phase3SortMode = 'occurrence',
    } = req.body;

    if (!targetPath || !hashType || !wordlistPath) {
        return res.status(400).json({ message: 'targetPath, hashType, and wordlistPath are required.' });
    }

    const { executable, cwd } = getHashcatConfig();
    const workflowId = `sw_${Date.now()}_${uuid()}`;
    const outfilePath = path.join(uploadDir, `${workflowId}_temp.out`);
    const maskfilePath = path.join(uploadDir, `${workflowId}_dynamic.hcmask`);
    const rulefilePath = path.join(uploadDir, `${workflowId}_dynamic.rule`);
    const plaintextDictPath = path.join(uploadDir, `${workflowId}_plaintexts.txt`);
    const sessionPotFile = path.join(uploadDir, `${workflowId}.potfile`);

    try {
        if (fs.existsSync(POTFILE_PATH)) fs.copyFileSync(POTFILE_PATH, sessionPotFile);
        else fs.writeFileSync(sessionPotFile, '');
    } catch (e) {}

    const emitPhase = (phase, message, extra = {}) => {
        // Record the current phase so /api/pebble/state (and the watch's
        // timeline pins) can tell the dictionary phase apart from the mask
        // phase without inspecting hashcat's per-mask live estimates.
        if (activeWorkflows[workflowId]) activeWorkflows[workflowId].phase = phase;
        io.emit('smart_workflow_phase', { workflowId, phase, message, ...extra });
        io.emit('log', { sessionId: workflowId, level: 'INFO', message: `[Smart Phase ${phase}/4] ${message}` });
    };

    // Build the shared global-flag args that mirror the regular session builder.
    // These apply to every phase so all user-configured performance / hardware
    // settings are respected exactly as they would be in a normal session.
    const globalArgs = ['-w', workloadProfile.toString()];
    if (devices) globalArgs.push('-d', devices);
    if (optimizedKernel) globalArgs.push('-O');
    if (remove) globalArgs.push('--remove');
    if (hwmonDisable) globalArgs.push('--hwmon-disable');
    if (backendDisableOpenCL) globalArgs.push('--backend-ignore-opencl');
    if (backendIgnoreCuda) globalArgs.push('--backend-ignore-cuda');
    if (selfTestDisable) globalArgs.push('--self-test-disable');
    if (keepGuessing) globalArgs.push('--keep-guessing');
    if (logfileDisable) globalArgs.push('--logfile-disable');
    if (force) globalArgs.push('--force');
    if (bitmapMax && bitmapMax !== 24) globalArgs.push(`--bitmap-max=${bitmapMax}`);

    // Potfile watcher — emits cracks across all phases
    let lastPotSize = 0;
    try { lastPotSize = fs.statSync(sessionPotFile).size; } catch(e) {}
    fs.watchFile(sessionPotFile, { interval: 500 }, () => {
        try {
            const stats = fs.statSync(sessionPotFile);
            if (stats.size > lastPotSize) {
                const stream = fs.createReadStream(sessionPotFile, { start: lastPotSize, end: stats.size - 1 });
                let buf = '';
                stream.on('data', chunk => { buf += chunk.toString(); });
                stream.on('end', () => {
                    buf.split('\n').forEach(line => {
                        const parsed = parsePotfileLine(line);
                        if (parsed) {
                            io.emit('session_crack', { sessionId: workflowId, hash: parsed.hash, plain: parsed.plain });
                            pushRecentPlain(parsed.plain);
                            if (activeSessions[workflowId]) activeSessions[workflowId].stats.recoveredCount++;
                            try { fs.appendFileSync(POTFILE_PATH, line.trim() + '\n'); } catch(e) {}
                        }
                    });
                });
                lastPotSize = stats.size;
            }
        } catch(e) {}
    });

    // Runs a hashcat phase, registers its process in activeSessions, parses live stats
    const runHashcatPhase = (args, phaseLabel) => {
        return new Promise((resolve) => {
            let exitHandled = false;

            const onData = (raw) => {
                const str = raw.toString().replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
                str.split('\n').forEach(line => {
                    const t = line.trim();
                    if (!t) return;
                    io.emit('log', { sessionId: workflowId, level: 'INFO', message: t });
                    parseAndEmitStats(t, workflowId);
                });
            };

            const onExit = (code) => {
                if (exitHandled) return;
                exitHandled = true;
                io.emit('log', { sessionId: workflowId, level: code === 0 ? 'SUCCESS' : 'WARN', message: `[Smart Workflow] ${phaseLabel} finished (exit ${code})` });
                resolve(code);
            };

            try {
                const spawnType = pty ? 'pty' : 'spawn';
                let currentChild;
                if (pty) {
                    currentChild = pty.spawn(executable, args, { name: 'xterm-color', cols: 80, rows: 30, cwd, env: process.env });
                    currentChild.onData(onData);
                    currentChild.onExit(({ exitCode }) => onExit(exitCode));
                } else {
                    currentChild = spawn(executable, args, { cwd, stdio: 'pipe' });
                    currentChild.stdout.on('data', onData);
                    currentChild.stderr.on('data', d => onData(d.toString()));
                    currentChild.on('close', onExit);
                    currentChild.on('error', (err) => { io.emit('log', { sessionId: workflowId, level: 'ERROR', message: err.message }); onExit(1); });
                }

                // Register in activeSessions so pause/resume/bypass/stop endpoints work
                const prevStats = activeSessions[workflowId]?.stats || {
                    recovered: 0, recoveredCount: 0, total: 0,
                    hashrateSum: 0, hashrateCount: 0, latestSpeeds: {},
                    powerSum: 0, powerReadings: 0
                };
                activeSessions[workflowId] = {
                    process: currentChild,
                    type: spawnType,
                    startTime: activeSessions[workflowId]?.startTime || Date.now(),
                    name: `Smart Workflow (${hashType})`,
                    potFile: sessionPotFile,
                    hashType: hashType,
                    attackMode: 0,
                    algorithmName: null,
                    status: 'RUNNING',
                    isWorkflow: true,
                    stats: prevStats,
                };
            } catch(e) {
                io.emit('log', { sessionId: workflowId, level: 'ERROR', message: `Spawn error: ${e.message}` });
                resolve(1);
            }
        });
    };

    res.json({ success: true, workflowId });
    sessionCounter++;
    activeWorkflows[workflowId] = { aborted: false };
    io.emit('session_started', { sessionId: workflowId, name: `Smart Workflow (${hashType})`, target: path.basename(targetPath), hashType, attackMode: 0 });
    io.emit('session_status', { sessionId: workflowId, status: 'RUNNING' });

    (async () => {
        const tempFiles = [outfilePath, maskfilePath, rulefilePath, plaintextDictPath, sessionPotFile];
        try {
            // Phase 1: Dictionary + optional rule
            emitPhase(1, 'Dictionary attack (quick hits)...');
            const p1StartCount = countPotfileEntries(sessionPotFile);
            const phase1Args = [
                '-m', hashType.toString(), '-a', '0',
                '--potfile-path', sessionPotFile, '--session', `${workflowId}_p1`,
                '--status', '--status-timer', statusTimer.toString(),
                '--outfile', outfilePath, '--outfile-format', '2',
                ...globalArgs,
            ];
            phase1Args.push(targetPath, wordlistPath);
            if (initialRulePath) phase1Args.push('-r', initialRulePath);
            console.log(`[Smart Workflow P1] ${executable} ${phase1Args.join(' ')}`);
            await runHashcatPhase(phase1Args, 'Phase 1');
            const p1Recovered = countPotfileEntries(sessionPotFile) - p1StartCount;
            io.emit('smart_workflow_phase', { workflowId, phase: 1, message: `Phase 1 complete — ${p1Recovered} recovered`, phaseRecovered: p1Recovered });
            if (activeWorkflows[workflowId]?.aborted) throw new Error('__ABORTED__');

            // Phase 2: Asset generation (Node.js, no subprocess)
            emitPhase(2, 'Analyzing cracked hashes & generating dynamic attack assets...');
            // Prefer the hashrate measured during Phase 1 over the frontend-supplied value.
            // The frontend value is often 0 (queue path hardcodes 0; direct start uses session.hashrate
            // which is 0 when no prior session is running).  Phase 1 always runs first and its stats
            // are accumulated into activeSessions[workflowId].stats by parseAndEmitStats.
            const p1Stats = activeSessions[workflowId]?.stats || {};
            let measuredHashrateHps = 0;
            if (p1Stats.hashrateCount > 0) {
                measuredHashrateHps = p1Stats.hashrateSum / p1Stats.hashrateCount;
            } else if (p1Stats.latestSpeeds) {
                const speeds = p1Stats.latestSpeeds;
                measuredHashrateHps = speeds['*'] !== undefined ? speeds['*'] :
                    Object.entries(speeds).filter(([k]) => !isNaN(parseInt(k))).reduce((acc, [, v]) => acc + v, 0);
            }
            // Pick the best hashrate source. A tiny Phase 1 dictionary can finish
            // before the GPU reaches steady state, leaving `measuredHashrateHps`
            // artificially low — using it as-is would make Phase 2 budget too few
            // masks. If history has a realistic rate for this hash type, trust
            // the larger of the two. Historical rate comes from pastSessions on
            // the frontend (same compensation as Insights detectHashrateForAlgo).
            let effectiveHashrateHps = 0;
            let hashrateSource = 'none';
            if (historicalHashrateHps > 0 && historicalHashrateHps > measuredHashrateHps) {
                effectiveHashrateHps = historicalHashrateHps;
                hashrateSource = measuredHashrateHps > 0 ? 'historical (Phase 1 rate too low)' : 'historical';
            } else if (measuredHashrateHps > 0) {
                effectiveHashrateHps = measuredHashrateHps;
                hashrateSource = 'measured (Phase 1)';
            } else if (phase3HashrateHps > 0) {
                effectiveHashrateHps = phase3HashrateHps;
                hashrateSource = 'live session';
            }
            const assets = generateSmartAssets(outfilePath, {
                maxMasks, maskMinLen, maskMaxLen,
                hashrateHps: effectiveHashrateHps,
                timeBudgetSeconds: phase3TimeBudgetSeconds,
                sortMode: phase3SortMode,
            });
            if (!assets || assets.count === 0) {
                emitPhase(2, 'No hashes cracked in Phase 1 — skipping adaptive phases.', { skipped: true });
                io.emit('session_status', { sessionId: workflowId, status: 'COMPLETED' });
                const swSessE = activeSessions[workflowId];
                const swDurE = swSessE ? (Date.now() - swSessE.startTime) / 1000 : 0;
                const swStatsE = swSessE?.stats || {};
                const swHrE = (swStatsE.hashrateCount || 0) > 0 ? swStatsE.hashrateSum / swStatsE.hashrateCount : 0;
                const swPwrE = (swStatsE.powerReadings || 0) > 0 ? swStatsE.powerSum / swStatsE.powerReadings : 0;
                io.emit('session_finished', { sessionId: workflowId, duration: swDurE, recovered: swStatsE.recoveredCount || 0, total: swStatsE.total || 0, avgHashrate: swHrE, avgPower: swPwrE });
                return;
            }
            fs.writeFileSync(maskfilePath, assets.masks.join('\n'));
            fs.writeFileSync(rulefilePath, assets.ruleContent);
            fs.writeFileSync(plaintextDictPath, assets.plaintexts.join('\n'));
            // Write persistent mask files (not deleted at end — kept for user
            // download from session history). Two distinct files:
            //   _used    — the masks that fit the time budget and were run in Phase 3
            //   _skipped — the masks that exceeded the time budget and were NOT run,
            //              so the user can run them later
            // _all (every extracted mask, combined) is kept for backward compatibility.
            const usedMaskfilePath = path.join(uploadDir, `${workflowId}_used.hcmask`);
            const skippedMaskfilePath = path.join(uploadDir, `${workflowId}_skipped.hcmask`);
            const allMaskfilePath = path.join(uploadDir, `${workflowId}_all.hcmask`);
            if (assets.masks.length > 0) fs.writeFileSync(usedMaskfilePath, assets.masks.join('\n'));
            if (assets.skippedMasks.length > 0) fs.writeFileSync(skippedMaskfilePath, assets.skippedMasks.join('\n'));
            if (assets.allMasks.length > 0) fs.writeFileSync(allMaskfilePath, assets.allMasks.join('\n'));

            let p2Detail;
            if (assets.budgetExhausted) {
                p2Detail = `Learned ${assets.count} passwords. Time budget too short for all ${assets.allMasks.length} extracted masks — skipping to Phase 4. Full mask file saved for download.`;
                io.emit('log', { sessionId: workflowId, level: 'WARN', message: `[Smart Workflow] Time budget (${phase3TimeBudgetSeconds}s) is shorter than every extracted mask individually. Phase 3 skipped — ${assets.allMasks.length} masks saved for download.` });
            } else if (assets.estimatedPhase3Eta) {
                const skippedNote = assets.skippedMasks.length > 0 ? ` ${assets.skippedMasks.length} masks exceed budget and saved for download.` : '';
                p2Detail = `Learned ${assets.count} passwords. ${assets.masks.length} masks fit within budget (est. ~${assets.estimatedPhase3Eta}).${skippedNote}`;
            } else {
                p2Detail = `Learned ${assets.count} passwords. Generated ${assets.masks.length} mask patterns + mutation rules.`;
            }
            emitPhase(2, p2Detail, {
                learned: assets.count,
                masks: assets.masks.length,
                usedMasks: assets.masks.length,
                skippedMasks: assets.skippedMasks.length,
                budgetExhausted: assets.budgetExhausted,
                maskFileId: workflowId,
                eta: assets.estimatedPhase3Eta,
                hashrateHps: effectiveHashrateHps,
                hashrateSource,
            });
            // The full mask attack's estimated runtime (all patterns combined),
            // for the watch's single "mask attack" timeline pin.
            if (activeWorkflows[workflowId]) {
                activeWorkflows[workflowId].maskEtaSec = assets.estimatedPhase3Seconds || 0;
            }
            if (activeWorkflows[workflowId]?.aborted) throw new Error('__ABORTED__');

            // Phase 3: Targeted mask attack
            const p3StartCount = countPotfileEntries(sessionPotFile);
            if (!skipPhase3 && assets.masks.length > 0) {
                const p3Desc = assets.estimatedPhase3Eta
                    ? `Targeted mask attack — ${assets.masks.length} patterns, sort: ${phase3SortMode}, est. ~${assets.estimatedPhase3Eta}`
                    : `Targeted mask attack with ${assets.masks.length} patterns (lengths ${maskMinLen || '?'}–${maskMaxLen || '?'})`;
                emitPhase(3, p3Desc);
                // Anchor the mask-attack pin to the real phase-3 start so the
                // watch shows one stable "complete mask attack" finish time
                // rather than a pin that jumps with each per-mask estimate.
                if (activeWorkflows[workflowId]) activeWorkflows[workflowId].phase3StartTime = Date.now();
                const phase3Args = [
                    '-m', hashType.toString(), '-a', '3',
                    '--potfile-path', sessionPotFile, '--session', `${workflowId}_p3`,
                    '--status', '--status-timer', statusTimer.toString(),
                    ...globalArgs,
                ];
                if (phase3Runtime > 0) phase3Args.push('--runtime', phase3Runtime.toString());
                if (phase3Increment) {
                    phase3Args.push('--increment');
                    if (maskMinLen > 0) phase3Args.push(`--increment-min=${maskMinLen}`);
                    if (maskMaxLen > 0) phase3Args.push(`--increment-max=${maskMaxLen}`);
                }
                phase3Args.push(targetPath, maskfilePath);
                console.log(`[Smart Workflow P3] ${executable} ${phase3Args.join(' ')}`);
                await runHashcatPhase(phase3Args, 'Phase 3');
                const p3Recovered = countPotfileEntries(sessionPotFile) - p3StartCount;
                io.emit('smart_workflow_phase', { workflowId, phase: 3, message: `Phase 3 complete — ${p3Recovered} recovered`, phaseRecovered: p3Recovered });
            } else {
                let p3SkipMsg;
                if (skipPhase3) p3SkipMsg = 'Phase 3 skipped by user.';
                else if (assets.budgetExhausted) p3SkipMsg = `Time budget too short for all ${assets.allMasks.length} masks — skipped. Download mask file from session history to run later.`;
                else p3SkipMsg = 'Phase 3 skipped (no masks matched length filter).';
                emitPhase(3, p3SkipMsg, { skipped: true });
            }
            if (activeWorkflows[workflowId]?.aborted) throw new Error('__ABORTED__');

            // Phase 4: Feedback rule attack
            const p4StartCount = countPotfileEntries(sessionPotFile);
            let p4EmittedDelta = 0; // total phaseRecovered already reported for phase 4
            const emitPhase4Progress = (subLabel) => {
                const total = countPotfileEntries(sessionPotFile) - p4StartCount;
                const newDelta = total - p4EmittedDelta;
                if (newDelta > 0) {
                    io.emit('smart_workflow_phase', { workflowId, phase: 4, message: `${subLabel} — +${newDelta} recovered`, phaseRecovered: newDelta });
                    p4EmittedDelta = total;
                }
            };
            if (!skipPhase4) {
                // Expand plaintext dict with any hashes cracked in Phase 3 (from potfile)
                try {
                    const potLines = fs.readFileSync(sessionPotFile, 'utf-8').split(/\r?\n/).filter(l => l.trim());
                    const existingSet = new Set(assets.plaintexts);
                    const allPlaintexts = [...assets.plaintexts];
                    potLines.forEach(line => {
                        const parsed = parsePotfileLine(line);
                        if (parsed && !existingSet.has(parsed.plain)) {
                            allPlaintexts.push(parsed.plain);
                            existingSet.add(parsed.plain);
                        }
                    });
                    fs.writeFileSync(plaintextDictPath, allPlaintexts.join('\n'));
                    emitPhase(4, `Feedback rule attack (${allPlaintexts.length} plaintexts × dynamic mutations)...`);
                } catch(e) {
                    emitPhase(4, `Feedback rule attack (${assets.count} learned plaintexts × dynamic mutations)...`);
                }

                // 4a: dynamic rule (always)
                const phase4aArgs = [
                    '-m', hashType.toString(), '-a', '0',
                    '--potfile-path', sessionPotFile, '--session', `${workflowId}_p4a`,
                    '--status', '--status-timer', statusTimer.toString(),
                    '-r', rulefilePath,
                    ...globalArgs,
                ];
                phase4aArgs.push(targetPath, plaintextDictPath);
                console.log(`[Smart Workflow P4a] ${executable} ${phase4aArgs.join(' ')}`);
                await runHashcatPhase(phase4aArgs, 'Phase 4 (dynamic rules)');
                emitPhase4Progress('Phase 4a (dynamic rules)');
                if (activeWorkflows[workflowId]?.aborted) throw new Error('__ABORTED__');

                // 4b: global rule from Config tab (if provided)
                if (initialRulePath) {
                    emitPhase(4, `Phase 4 — global rule pass: ${initialRulePath.split(/[\\/]/).pop()}...`);
                    const phase4bArgs = [
                        '-m', hashType.toString(), '-a', '0',
                        '--potfile-path', sessionPotFile, '--session', `${workflowId}_p4b`,
                        '--status', '--status-timer', statusTimer.toString(),
                        '-r', initialRulePath,
                        ...globalArgs,
                    ];
                    phase4bArgs.push(targetPath, plaintextDictPath);
                    console.log(`[Smart Workflow P4b] ${executable} ${phase4bArgs.join(' ')}`);
                    await runHashcatPhase(phase4bArgs, 'Phase 4b (global rule)');
                    emitPhase4Progress('Phase 4b (global rule)');
                    if (activeWorkflows[workflowId]?.aborted) throw new Error('__ABORTED__');
                }

                // 4c+: user-specified custom rule files (sequential)
                const validPhase4Rules = (phase4RulePaths || []).filter(p => p && p.trim() && fs.existsSync(p.trim()));
                for (let i = 0; i < validPhase4Rules.length; i++) {
                    const rulePath = validPhase4Rules[i].trim();
                    emitPhase(4, `Phase 4 — custom rule ${i + 1}/${validPhase4Rules.length}: ${rulePath.split(/[\\/]/).pop()}...`);
                    const phase4xArgs = [
                        '-m', hashType.toString(), '-a', '0',
                        '--potfile-path', sessionPotFile, '--session', `${workflowId}_p4c${i}`,
                        '--status', '--status-timer', statusTimer.toString(),
                        '-r', rulePath,
                        ...globalArgs,
                    ];
                    phase4xArgs.push(targetPath, plaintextDictPath);
                    console.log(`[Smart Workflow P4c${i}] ${executable} ${phase4xArgs.join(' ')}`);
                    await runHashcatPhase(phase4xArgs, `Phase 4 custom rule ${i + 1}`);
                    emitPhase4Progress(`Phase 4 custom rule ${i + 1}`);
                    if (activeWorkflows[workflowId]?.aborted) throw new Error('__ABORTED__');
                }

                const p4Recovered = countPotfileEntries(sessionPotFile) - p4StartCount;
                const p4FinalDelta = p4Recovered - p4EmittedDelta;
                io.emit('smart_workflow_phase', { workflowId, phase: 4, message: `Phase 4 complete — ${p4Recovered} recovered`, phaseRecovered: p4FinalDelta > 0 ? p4FinalDelta : undefined });
            } else {
                emitPhase(4, 'Phase 4 skipped by user.', { skipped: true });
            }

            emitPhase(4, 'Smart Workflow complete!', { complete: true, maskFileId: workflowId });
            io.emit('session_status', { sessionId: workflowId, status: 'COMPLETED' });
            {
                const swSess = activeSessions[workflowId];
                const swDuration = swSess ? (Date.now() - swSess.startTime) / 1000 : 0;
                const swStats = swSess?.stats || {};
                const swAvgHashrate = (swStats.hashrateCount || 0) > 0 ? swStats.hashrateSum / swStats.hashrateCount : 0;
                const swAvgPower = (swStats.powerReadings || 0) > 0 ? swStats.powerSum / swStats.powerReadings : 0;
                io.emit('session_finished', { sessionId: workflowId, duration: swDuration, recovered: swStats.recoveredCount || 0, total: swStats.total || 0, avgHashrate: swAvgHashrate, avgPower: swAvgPower });
            }
        } catch (e) {
            const isAbort = e.message === '__ABORTED__';
            io.emit('log', { sessionId: workflowId, level: isAbort ? 'WARN' : 'ERROR', message: isAbort ? '[Smart Workflow] Stopped by user.' : `Smart Workflow Error: ${e.message}` });
            io.emit('session_status', { sessionId: workflowId, status: isAbort ? 'STOPPED' : 'ERROR' });
            {
                const swSess = activeSessions[workflowId];
                const swDuration = swSess ? (Date.now() - swSess.startTime) / 1000 : 0;
                const swStats = swSess?.stats || {};
                const swAvgHashrate = (swStats.hashrateCount || 0) > 0 ? swStats.hashrateSum / swStats.hashrateCount : 0;
                const swAvgPower = (swStats.powerReadings || 0) > 0 ? swStats.powerSum / swStats.powerReadings : 0;
                io.emit('session_finished', { sessionId: workflowId, duration: swDuration, recovered: swStats.recoveredCount || 0, total: swStats.total || 0, avgHashrate: swAvgHashrate, avgPower: swAvgPower });
            }
        } finally {
            fs.unwatchFile(sessionPotFile);
            if (activeSessions[workflowId]) delete activeSessions[workflowId];
            delete liveStats[workflowId];
            if (activeWorkflows[workflowId]) delete activeWorkflows[workflowId];
            clearRecentPlainsIfIdle();
            tempFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {} });
        }
    })();
});

app.post('/api/session/stop', (req, res) => {
  const { sessionId } = req.body;
  const stopSession = (id) => {
      if(activeSessions[id]) {
          const s = activeSessions[id];
          // Signal smart workflow to abort between phases
          if (s.isWorkflow && activeWorkflows[id]) activeWorkflows[id].aborted = true;
          // Kill the process.  For regular (non-workflow) sessions we intentionally leave
          // activeSessions[id] intact so that handleProcessExit fires with the full stats
          // and emits session_finished with the real duration, hashrate and recovered count.
          // Deleting activeSessions here before the process exits causes handleProcessExit
          // to see a missing entry and emit all-zero stats, which the frontend then drops.
          try {
              if (s.type === 'pty') s.process.kill();
              else s.process.kill('SIGKILL');
          } catch(e) {}
          io.emit('log', { sessionId: id, level: 'WARN', message: `Session ${s.name} stopped manually.` });
          io.emit('session_status', { sessionId: id, status: 'STOPPED' });
          return s.name;
      }
      return null;
  }
  if (sessionId) {
      const name = stopSession(sessionId);
      if(name) return res.json({ success: true, message: `Stopped ${name}` });
      io.emit('session_status', { sessionId, status: 'IDLE' });
      return res.json({ success: true, message: 'Session stopped (was not active)' });
  } 
  else if (Object.keys(activeSessions).length === 1) {
      const id = Object.keys(activeSessions)[0];
      stopSession(id);
      return res.json({ success: true, message: `Stopped session` });
  }
  res.status(400).json({ message: 'Session not found or no ID provided' });
});

app.post('/api/session/delete', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    // Kill active process if running
    if (activeSessions[sessionId]) {
       const s = activeSessions[sessionId];
       // For workflow sessions, signal abort so the async loop stops between phases
       if (s.isWorkflow && activeWorkflows[sessionId]) activeWorkflows[sessionId].aborted = true;
       try {
           if (s.type === 'pty') s.process.kill();
           else s.process.kill('SIGKILL');
        } catch(e) {}
        if (!s.isWorkflow) delete activeSessions[sessionId];
        delete liveStats[sessionId];
    }

    // Delete session potfile and the cracks-replay sidecar (the latter survives
    // session exit so /api/session/start --restore can replay it; explicit
    // deletion is the only path that should remove it).
    const sessionPot = path.join(uploadDir, `${sessionId}.potfile`);
    if (fs.existsSync(sessionPot)) { try { fs.unlinkSync(sessionPot); } catch(e) {} }
    const sessionCracks = path.join(uploadDir, `${sessionId}.cracks`);
    if (fs.existsSync(sessionCracks)) { try { fs.unlinkSync(sessionCracks); } catch(e) {} }

    // Delete workflow temp files (covers orphans from crashes or sessions already completed)
    const workflowTempFiles = [
        path.join(uploadDir, `${sessionId}_temp.out`),
        path.join(uploadDir, `${sessionId}_dynamic.hcmask`),
        path.join(uploadDir, `${sessionId}_dynamic.rule`),
        path.join(uploadDir, `${sessionId}_plaintexts.txt`),
        path.join(uploadDir, `${sessionId}_used.hcmask`),
        path.join(uploadDir, `${sessionId}_skipped.hcmask`),
        path.join(uploadDir, `${sessionId}_all.hcmask`),
    ];
    workflowTempFiles.forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {} });

    if (fs.existsSync(SESSIONS_PATH)) {
        try {
            let sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'));
            const initialLength = sessions.length;
            sessions = sessions.filter(s => s.id !== sessionId);
            if (sessions.length !== initialLength) {
                fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
            }
        } catch (e) {}
    }
    io.emit('session_deleted', { sessionId });
    res.json({ success: true });
});

app.post('/api/target/check', async (req, res) => {
    const { targetPath, content } = req.body;
    const potfileMap = new Map(); 
    if (fs.existsSync(POTFILE_PATH)) {
        try {
            const potStream = fs.createReadStream(POTFILE_PATH);
            const potRl = readline.createInterface({ input: potStream, crlfDelay: Infinity });
            for await (const line of potRl) {
                const parsed = parsePotfileLine(line);
                if (parsed) potfileMap.set(parsed.hash, parsed.plain);
            }
        } catch (e) {}
    }
    const resultFilename = `check_result_${Date.now()}.txt`;
    const resultPath = path.join(uploadDir, resultFilename);
    const writeStream = fs.createWriteStream(resultPath);
    const found = [];
    let foundCount = 0;
    let totalProcessed = 0;
    try {
        let inputStream;
        if (content) inputStream = Readable.from(content.split('\n'));
        else if (targetPath && fs.existsSync(targetPath)) inputStream = fs.createReadStream(targetPath);
        else return res.status(400).json({ message: 'No valid target found' });
        const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
        for await (const line of rl) {
            const hash = line.trim();
            if (!hash) continue;
            totalProcessed++;
            if (potfileMap.has(hash)) {
                const plain = potfileMap.get(hash);
                const entry = `${hash}:${plain}\n`;
                if (writeStream.write(entry) === false) await new Promise(resolve => writeStream.once('drain', resolve));
                found.push({ hash, plain });
                foundCount++;
            }
        }
        writeStream.end();
        writeStream.on('finish', () => {
            potfileMap.clear();
            res.json({ totalTarget: totalProcessed, foundCount, preview: found, downloadToken: resultFilename });
        });
    } catch (err) { if (!res.headersSent) res.status(500).json({ message: 'Failed to process large file' }); }
});

app.get('/api/download/check-result/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9_.]+$/.test(filename)) return res.status(400).send("Invalid filename");
    const filePath = path.join(uploadDir, filename);
    if (fs.existsSync(filePath)) res.download(filePath);
    else res.status(404).send("File not found");
});

app.get('/api/history/sessions', (req, res) => {
    if (!fs.existsSync(SESSIONS_PATH)) return res.json([]);
    try { res.json(JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'))); } catch (e) { res.json([]); }
});

app.post('/api/history/sessions', (req, res) => {
    const newSession = req.body;
    let sessions = [];
    if (fs.existsSync(SESSIONS_PATH)) { try { sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8')); } catch (e) {} }
    if (!sessions.some(s => s.id === newSession.id)) {
        sessions.unshift(newSession);
        try { fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2)); res.json({ success: true }); } 
        catch (e) { res.status(500).json({ message: 'Failed to save session history' }); }
    } else { res.json({ success: true, message: 'Already exists' }); }
});

const pollGpuStats = () => {
    const cmd = 'nvidia-smi --query-gpu=name,power.draw,temperature.gpu --format=csv,noheader,nounits';
    exec(cmd, (err, stdout) => {
        if (err || !stdout) return;
        const lines = stdout.trim().split(/[\r\n]+/);
        let totalWatts = 0;
        let maxTemp = 0;
        const gpus = [];
        lines.forEach((line, index) => {
            const parts = line.split(', ');
            if (parts.length >= 3) {
                const name = parts[0].trim();
                const pwr = parseFloat(parts[1]);
                const temp = parseFloat(parts[2]);
                if (!isNaN(pwr)) totalWatts += pwr;
                if (!isNaN(temp)) maxTemp = Math.max(maxTemp, temp);
                gpus.push({ index, name, watts: isNaN(pwr) ? 0 : pwr, temp: isNaN(temp) ? 0 : temp });
            }
        });
        currentGlobalPower = totalWatts;
        currentMaxTemp = maxTemp;
        currentGpus = gpus;
        const activeIds = Object.keys(activeSessions);
        if (activeIds.length > 0 && totalWatts > 0) {
            activeIds.forEach(id => {
                if (activeSessions[id]) {
                    activeSessions[id].stats.powerSum += totalWatts;
                    activeSessions[id].stats.powerReadings++;
                }
            });
        }
        if (gpus.length > 0) {
            io.emit('stats_update', { sessionId: 'general', type: 'gpu_detailed', value: { totalWatts, maxTemp, gpus } });
        }
    });
};

setInterval(pollGpuStats, 2000);

io.on('connection', (socket) => {
  const history = getFullPotfile();
  socket.emit('potfile_sync', history);
  socket.emit('remote_status_update', remoteConfig);
  Object.keys(activeSessions).forEach(sessionId => {
      const s = activeSessions[sessionId];
      socket.emit('session_started', { sessionId, name: s.name });
      socket.emit('session_status', { sessionId, status: 'RUNNING' });
  });
  let ptyProcess = null;
  socket.on('term_init', () => {
    if (ptyProcess || !pty) return;
    const { executable, cwd } = getHashcatConfig();
    try {
        ptyProcess = pty.spawn(os.platform() === 'win32' ? 'powershell.exe' : 'bash', [], {
            name: 'xterm-color', cols: 80, rows: 30, cwd: cwd, env: process.env
        });
        ptyProcess.onData((data) => socket.emit('term_output', data));
        socket.emit('term_output', `\r\n*** Interactive Reactor Shell ***\r\n`);
    } catch (err) { socket.emit('term_output', `\r\nError launching shell: ${err.message}\r\n`); }
  });
  socket.on('term_input', (data) => { if (ptyProcess) ptyProcess.write(data); });
  socket.on('term_resize', ({ cols, rows }) => { if (ptyProcess) ptyProcess.resize(cols, rows); });
  socket.on('disconnect', () => { if (ptyProcess) { ptyProcess.kill(); ptyProcess = null; } });
});

app.get('/api/smart-workflow/masks/:workflowId', (req, res) => {
    const { workflowId } = req.params;
    if (!/^sw_\d+_[a-z0-9]+$/.test(workflowId)) return res.status(400).send('Invalid workflow ID');
    // type: 'used' (masks run in Phase 3), 'skipped' (exceeded time budget, not run),
    // or 'all' (every extracted mask — default, for backward compatibility).
    const type = req.query.type === 'used' ? 'used' : req.query.type === 'skipped' ? 'skipped' : 'all';
    const suffix = type === 'used' ? '_used' : type === 'skipped' ? '_skipped' : '_all';
    const filePath = path.join(uploadDir, `${workflowId}${suffix}.hcmask`);
    if (!fs.existsSync(filePath)) return res.status(404).send('Mask file not found');
    res.download(filePath, `masks_${workflowId}_${type}.hcmask`);
});

app.get('/pebble-config', (req, res) => {
    // Serve the Pebble Time 2 watchapp configuration page. Lives next to
    // the backend in dev, and is bundled with the Electron extraResources
    // in production.
    const candidates = [
        path.join(__dirname, '..', 'pebble-client', 'config', 'index.html'),
        path.join(RESOURCES_PATH || '', 'pebble-client', 'config', 'index.html'),
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return res.sendFile(p);
    }
    res.status(404).send('Pebble config page not found. Build pebble-client first.');
});

app.get('*', (req, res) => {
    if (staticPath && fs.existsSync(path.join(staticPath, 'index.html'))) {
        res.sendFile(path.join(staticPath, 'index.html'));
    } else {
        res.status(404).send('Frontend build not found. Remote UI unavailable.');
    }
});

server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));