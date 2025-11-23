const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');

// Import node-pty for pseudo-terminal support
let pty;
try {
    pty = require('node-pty');
} catch (e) {
    console.warn("node-pty not found. Interactive terminal will not work. Run 'npm install node-pty'");
}

const app = express();
app.use(cors());
app.use(express.json());

const IS_ELECTRON = process.env.IS_ELECTRON === 'true';
const USER_DATA_PATH = process.env.USER_DATA_PATH;
const RESOURCES_PATH = process.env.RESOURCES_PATH;

const uploadDir = IS_ELECTRON && USER_DATA_PATH 
    ? path.join(USER_DATA_PATH, 'uploads')
    : path.join(__dirname, 'uploads');

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

let hashcatProcess = null;
let potfileWatcher = null;
let lastPotfileSize = 0;

// --- Helper: Generate IDs ---
const uuid = () => Math.random().toString(36).substring(2, 9);

const getHashcatConfig = () => {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'hashcat.exe' : 'hashcat.bin';
  
  if (IS_ELECTRON && RESOURCES_PATH) {
      const prodExe = path.join(RESOURCES_PATH, 'backend', 'hashcat', binaryName);
      if (fs.existsSync(prodExe)) return { executable: prodExe, cwd: path.dirname(prodExe) };
  }

  const localExe = path.join(__dirname, 'hashcat', binaryName);
  if (fs.existsSync(localExe)) return { executable: localExe, cwd: path.dirname(localExe) };

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
    } catch (e) {
        console.error("Error reading full potfile:", e);
        return [];
    }
};

const processNewPotfileEntries = () => {
    if (!fs.existsSync(POTFILE_PATH)) return;
    try {
        const stats = fs.statSync(POTFILE_PATH);
        const currentSize = stats.size;
        if (currentSize > lastPotfileSize) {
            const stream = fs.createReadStream(POTFILE_PATH, { 
                start: lastPotfileSize, 
                end: currentSize 
            });
            let buffer = '';
            stream.on('data', (chunk) => { buffer += chunk.toString(); });
            stream.on('end', () => {
                const lines = buffer.split('\n');
                lines.forEach(line => {
                    const parsed = parsePotfileLine(line);
                    if (parsed) {
                        io.emit('crack', { 
                            hash: parsed.hash, 
                            plain: parsed.plain, 
                            full: parsed.full 
                        });
                    }
                });
            });
            lastPotfileSize = currentSize;
        }
    } catch (err) {
        console.error("Error reading potfile:", err);
    }
};

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
    } catch (e) {
        res.status(500).json({ message: 'Write failed' });
    }
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
  if (hashcatProcess) return res.status(400).json({ message: 'Session running' });
  const { customCommand, targetPath, restore, ...config } = req.body;
  let args = [];

  if (restore) {
    args.push('--restore', '--status', '--status-timer', (config.statusTimer || 30).toString(), '--potfile-path', POTFILE_PATH);
    if (config.hwmonDisable) args.push('--hwmon-disable');
    if (config.backendDisableOpenCL) args.push('--backend-ignore-opencl'); 
    if (config.backendIgnoreCuda) args.push('--backend-ignore-cuda');
  } else if (customCommand) {
    args = parseArgs(customCommand);
    if (args.length > 0 && args[0].toLowerCase().includes('hashcat')) args.shift();
  } else {
    args.push('-m', config.hashType, '-a', config.attackMode.toString(), '-w', config.workloadProfile.toString());
    args.push('--potfile-path', POTFILE_PATH, '--status', '--status-timer', (config.statusTimer || 30).toString());
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
    if (config.spinDamp && config.spinDamp !== 100) args.push(`--spin-damp=${config.spinDamp}`);
    if (config.skip && config.skip > 0) args.push('-s', config.skip.toString());
    
    // 1. Push Target File first
    if (targetPath) args.push(targetPath);

    // 2. Push Attack Mode specific arguments
    const mode = Number(config.attackMode);
    
    if (mode === 0) {
        // Straight
        if (config.wordlistPath) args.push(config.wordlistPath);
        if (config.rulePath) args.push('-r', config.rulePath);
    } 
    else if (mode === 1) {
        // Combination: Needs Left List + Right List
        if (config.wordlistPath) args.push(config.wordlistPath);
        if (config.wordlistPath2) args.push(config.wordlistPath2);
    } 
    else if (mode === 3) {
        // Brute Force
        if (config.maskFile) args.push(config.maskFile);
        else if (config.mask) args.push(config.mask);
    } 
    else if (mode === 6 || mode === 7) {
        // Hybrid
        const w = config.wordlistPath;
        const m = config.maskFile || config.mask;
        if (mode === 6) { if(w) args.push(w); if(m) args.push(m); }
        if (mode === 7) { if(m) args.push(m); if(w) args.push(w); }
    }
    else if ([2, 4, 5, 8, 9].includes(mode)) {
        // Other Single-Wordlist Modes
        if (config.wordlistPath) args.push(config.wordlistPath);
    }
  }

  const { executable, cwd } = getHashcatConfig();
  console.log(`[Spawn] ${executable} ${args.join(' ')}`);
  
  try {
      if (fs.existsSync(POTFILE_PATH)) lastPotfileSize = fs.statSync(POTFILE_PATH).size;
      else lastPotfileSize = 0;
      if (potfileWatcher) fs.unwatchFile(POTFILE_PATH);
      fs.watchFile(POTFILE_PATH, { interval: 1000 }, processNewPotfileEntries);
      potfileWatcher = true;
  } catch (e) { console.error("Failed to setup potfile watcher", e); }
  
  try {
    hashcatProcess = spawn(executable, args, { cwd, stdio: 'pipe' });
    if (hashcatProcess.stdin) hashcatProcess.stdin.setEncoding('utf-8');
    io.emit('session_status', 'RUNNING');
    io.emit('log', { level: 'CMD', message: `Running: ${path.basename(executable)} ${args.join(' ')}` });

    let stdoutBuffer = '';
    hashcatProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      let lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); 
      lines.forEach(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        let isStatusLine = false;
        const statusRegex = /Status\.+:\s+(.*)/i;
        const statusMatch = trimmedLine.match(statusRegex);
        if (statusMatch) {
            isStatusLine = true;
            const currentStatus = statusMatch[1].trim().toUpperCase();
            if (currentStatus === 'PAUSED') io.emit('session_status', 'PAUSED');
            else if (currentStatus === 'RUNNING') io.emit('session_status', 'RUNNING');
            else if (currentStatus === 'EXHAUSTED' || currentStatus === 'QUIT') io.emit('session_status', 'COMPLETED');
        }
        const speedRegex = /Speed\.#(\*|\d+).*?:\s+([\d\.]+)\s+([a-zA-Z]+\/s)/i;
        const speedMatch = trimmedLine.match(speedRegex);
        if (speedMatch) {
            isStatusLine = true;
            const deviceId = speedMatch[1];
            const val = parseFloat(speedMatch[2]);
            const unit = speedMatch[3];
            let hashrate = val;
            if (unit.toLowerCase() === 'kh/s') hashrate *= 1000;
            else if (unit.toLowerCase() === 'mh/s') hashrate *= 1000000;
            else if (unit.toLowerCase() === 'gh/s') hashrate *= 1000000000;
            const isAggregate = deviceId === '*';
            io.emit('stats_update', { type: 'hashrate', value: hashrate, isAggregate });
        }
        const progressRegex = /Progress.*?:\s+\d+\/\d+\s+\(([\d\.]+)%\)/i;
        const progMatch = trimmedLine.match(progressRegex);
        if (progMatch) { isStatusLine = true; io.emit('stats_update', { type: 'progress', value: parseFloat(progMatch[1]) }); }
        const timeRegex = /Time\.Estimated.*?:\s+(.*)/i;
        const timeMatch = trimmedLine.match(timeRegex);
        if (timeMatch) { isStatusLine = true; const timeStr = timeMatch[1].replace(/\(.*\)/, '').trim() || timeMatch[1]; io.emit('stats_update', { type: 'time_estimated', value: timeStr }); }
        const recoveredRegex = /Recovered.*?:\s+(\d+)\//i;
        const recMatch = trimmedLine.match(recoveredRegex);
        if (recMatch) { isStatusLine = true; io.emit('stats_update', { type: 'recovered', value: parseInt(recMatch[1]) }); }
        io.emit('log', { level: 'INFO', message: trimmedLine });
      });
    });
    hashcatProcess.stderr.on('data', (data) => { const msg = data.toString().trim(); if(msg) io.emit('log', { level: 'WARN', message: msg }); });
    hashcatProcess.on('close', (code) => {
      io.emit('log', { level: code === 0 ? 'SUCCESS' : 'WARN', message: `Process exited with code ${code}` });
      io.emit('session_status', 'IDLE');
      hashcatProcess = null;
      if (potfileWatcher) fs.unwatchFile(POTFILE_PATH);
    });
    hashcatProcess.on('error', (err) => { io.emit('log', { level: 'ERROR', message: err.message }); io.emit('session_status', 'IDLE'); hashcatProcess = null; if (potfileWatcher) fs.unwatchFile(POTFILE_PATH); });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/session/stop', (req, res) => {
  if (hashcatProcess) {
    hashcatProcess.kill();
    hashcatProcess = null;
    io.emit('session_status', 'IDLE');
    if (potfileWatcher) fs.unwatchFile(POTFILE_PATH);
    res.json({ success: true });
  } else { res.status(400).json({ message: 'No session' }); }
});

// --- NEW: Check Target against Potfile ---
app.post('/api/target/check', (req, res) => {
    const { targetPath, content } = req.body;
    
    // 1. Get Target Content
    let targetContent = '';
    try {
        if (content) {
            targetContent = content;
        } else if (targetPath && fs.existsSync(targetPath)) {
            targetContent = fs.readFileSync(targetPath, 'utf-8');
        } else {
            return res.status(400).json({ message: 'No valid target found' });
        }
    } catch (e) {
        return res.status(500).json({ message: 'Failed to read target' });
    }

    // 2. Get Potfile Map
    const potfileMap = new Map(); // Hash -> Plain
    if (fs.existsSync(POTFILE_PATH)) {
        try {
            const lines = fs.readFileSync(POTFILE_PATH, 'utf-8').split('\n');
            lines.forEach(line => {
                const parsed = parsePotfileLine(line);
                if (parsed) potfileMap.set(parsed.hash, parsed.plain);
            });
        } catch (e) {
            console.error("Error reading potfile for check:", e);
        }
    }

    // 3. Compare
    const found = [];
    const targetLines = targetContent.split(/\r?\n/).filter(l => l.trim());
    
    targetLines.forEach(line => {
        const hash = line.trim();
        if (potfileMap.has(hash)) {
            found.push({ hash: hash, plain: potfileMap.get(hash) });
        }
    });

    res.json({ 
        totalTarget: targetLines.length, 
        foundCount: found.length, 
        foundHashes: found 
    });
});

// --- ROUTES FOR HISTORY PERSISTENCE ---

// 1. Get History
app.get('/api/history/sessions', (req, res) => {
    if (!fs.existsSync(SESSIONS_PATH)) return res.json([]);
    try {
        const data = fs.readFileSync(SESSIONS_PATH, 'utf-8');
        res.json(JSON.parse(data));
    } catch (e) {
        console.error("Error reading sessions:", e);
        res.json([]);
    }
});

// 2. Save Session
app.post('/api/history/sessions', (req, res) => {
    const newSession = req.body;
    let sessions = [];
    
    if (fs.existsSync(SESSIONS_PATH)) {
        try {
            sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'));
        } catch (e) {
            console.error("Error parsing sessions file, resetting:", e);
        }
    }
    
    // Add new session to the top of the list
    sessions.unshift(newSession);
    
    // Optional: Limit history to last 100 entries to prevent infinite growth
    if (sessions.length > 100) sessions = sessions.slice(0, 100);

    try {
        fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: 'Failed to save session history' });
    }
});

// --- INTERACTIVE TERMINAL & SOCKET SETUP ---
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

io.on('connection', (socket) => {
  // 1. Sync Dashboard Data
  const history = getFullPotfile();
  socket.emit('potfile_sync', history);
  if (hashcatProcess) socket.emit('session_status', 'RUNNING');

  // 2. Terminal Logic
  let ptyProcess = null;

  socket.on('term_init', () => {
    if (ptyProcess || !pty) return;
    
    const { executable, cwd } = getHashcatConfig();
    
    // Spawn PTY in the hashcat folder
    try {
        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: cwd,
            env: process.env
        });

        ptyProcess.onData((data) => socket.emit('term_output', data));
        
        socket.emit('term_output', `\r\n*** Interactive Reactor Shell ***\r\n`);
        socket.emit('term_output', `*** Working Directory: ${cwd} ***\r\n`);
        socket.emit('term_output', `*** Type './hashcat' (Linux/Mac) or '.\\hashcat.exe' (Win) ***\r\n\r\n`);

    } catch (err) {
        socket.emit('term_output', `\r\nError launching shell: ${err.message}\r\n`);
    }
  });

  socket.on('term_input', (data) => {
    if (ptyProcess) ptyProcess.write(data);
  });

  socket.on('term_resize', ({ cols, rows }) => {
    if (ptyProcess) ptyProcess.resize(cols, rows);
  });

  socket.on('disconnect', () => {
    if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));