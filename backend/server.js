const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const readline = require('readline');
const { Readable } = require('stream');

// Import node-pty
let pty;
try {
    pty = require('node-pty');
} catch (e) {
    console.warn("node-pty not found. Interactive terminal will not work.");
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

// --- MULTI-SESSION STATE ---
const activeSessions = {};
let sessionCounter = 0; 

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

// Robust Potfile Parser
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
        return [];
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

// NEW: Identify Devices (FIXED FOR MULTI-LINE FORMAT)
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
            
            let currentBackend = 'OpenCL'; // Default fallback
            let currentDevice = null;
            
            lines.forEach(line => {
                const clean = line.trim();
                if (!clean) return;

                // Detect Section Headers
                if (clean.includes('CUDA Info')) currentBackend = 'CUDA';
                else if (clean.includes('OpenCL Info')) currentBackend = 'OpenCL';
                else if (clean.includes('HIP Info')) currentBackend = 'HIP';

                // Detect Start of Device Block: "Backend Device ID #01"
                const idMatch = clean.match(/Backend Device ID #(\d+)/i);
                if (idMatch) {
                    // Push previous device if exists
                    if (currentDevice) {
                        // Check for duplicates before pushing
                        if(!devices.some(d => d.id === currentDevice.id)) {
                             devices.push(currentDevice);
                        }
                    }
                    
                    // Start new device
                    currentDevice = { 
                        id: idMatch[1], 
                        name: 'Unknown Device', 
                        type: currentBackend 
                    };
                }

                // Detect Name Line: "Name...........: "
                const nameMatch = clean.match(/Name\.+:\s+(.+)/i);
                if (nameMatch && currentDevice) {
                    currentDevice.name = nameMatch[1].trim();
                }
            });

            // Push the last device found
            if (currentDevice) {
                 if(!devices.some(d => d.id === currentDevice.id)) {
                     devices.push(currentDevice);
                 }
            }

            res.json({ devices, raw: fullOutput });
        });

        proc.on('error', (err) => {
            res.status(500).json({ devices: [], raw: `Spawn Error: ${err.message}` });
        });

    } catch (e) {
        res.status(500).json({ devices: [], raw: `Execution Error: ${e.message}` });
    }
});

// NEW: File System Scanner for Resources
app.post('/api/fs/scan', (req, res) => {
    const { dirPath } = req.body;
    if (!dirPath || !fs.existsSync(dirPath)) return res.json({ wordlists: [], rules: [], masks: [] });

    const results = { wordlists: [], rules: [], masks: [] };
    
    const scanDir = (currentPath, depth = 0) => {
        if (depth > 3) return; // Limit depth
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
        } catch (e) {
            
        }
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
  const { customCommand, targetPath, restore, ...config } = req.body;
  
  sessionCounter++;
  const sessionId = `s_${Date.now()}_${uuid()}`;
  const friendlyName = `Session #${sessionCounter} (${config.hashType || 'Restore'})`;
  
  const sessionPotFile = path.join(uploadDir, `${sessionId}.potfile`);

  let initialSize = 0;
  try {
      if (fs.existsSync(POTFILE_PATH)) {
          fs.copyFileSync(POTFILE_PATH, sessionPotFile);
          initialSize = fs.statSync(sessionPotFile).size;
      } else {
          fs.writeFileSync(sessionPotFile, ''); 
      }
  } catch (e) {
      console.error("Error creating session potfile", e);
  }

  let args = [];

  if (restore) {
    args.push('--restore', '--status', '--status-timer', (config.statusTimer || 30).toString());
    args.push('--potfile-path', sessionPotFile);
    if (config.hwmonDisable) args.push('--hwmon-disable');
    if (config.backendDisableOpenCL) args.push('--backend-ignore-opencl'); 
    if (config.backendIgnoreCuda) args.push('--backend-ignore-cuda');
  } else if (customCommand) {
    args = parseArgs(customCommand);
    if (args.length > 0 && args[0].toLowerCase().includes('hashcat')) args.shift();
    if (!args.includes('--potfile-path')) {
        args.push('--potfile-path', sessionPotFile);
    }
  } else {
    args.push('-m', config.hashType, '-a', config.attackMode.toString(), '-w', config.workloadProfile.toString());
    
    // Use devices if specified
    if (config.devices) {
        args.push('-d', config.devices);
    }

    args.push('--potfile-path', sessionPotFile);
    args.push('--status', '--status-timer', (config.statusTimer || 30).toString());
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
    
    if (targetPath) args.push(targetPath);

    const mode = Number(config.attackMode);
    if (mode === 0) {
        if (config.wordlistPath) args.push(config.wordlistPath);
        if (config.rulePath) args.push('-r', config.rulePath);
    } 
    else if (mode === 1) {
        if (config.wordlistPath) args.push(config.wordlistPath);
        if (config.wordlistPath2) args.push(config.wordlistPath2);
    } 
    else if (mode === 3) {
        if (config.maskFile) args.push(config.maskFile);
        else if (config.mask) args.push(config.mask);
    } 
    else if (mode === 6 || mode === 7) {
        const w = config.wordlistPath;
        const m = config.maskFile || config.mask;
        if (mode === 6) { if(w) args.push(w); if(m) args.push(m); }
        if (mode === 7) { if(m) args.push(m); if(w) args.push(w); }
    }
    else if ([2, 4, 5, 8, 9].includes(mode)) {
        if (config.wordlistPath) args.push(config.wordlistPath);
    }
  }

  const { executable, cwd } = getHashcatConfig();
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
                          try { fs.appendFileSync(POTFILE_PATH, line + '\n'); } catch (e) { }
                      }
                  });
              });
              lastSessionPotSize = stats.size;
          }
      } catch (e) { console.error(`Error watching potfile ${sessionId}`, e); }
  };

  const potWatcher = fs.watchFile(sessionPotFile, { interval: 500 }, checkSessionPotfile);

  try {
    const child = spawn(executable, args, { cwd, stdio: 'pipe' });
    
    activeSessions[sessionId] = { 
        process: child, 
        startTime: Date.now(), 
        name: friendlyName,
        potFile: sessionPotFile,
        stats: {
            recovered: 0,
            total: 0,
            hashrateSum: 0,
            hashrateCount: 0,
            latestSpeeds: {} 
        }
    };

    if (child.stdin) child.stdin.setEncoding('utf-8');
    
    io.emit('session_started', { sessionId, name: friendlyName, target: targetPath ? path.basename(targetPath) : 'Manual Input' });
    io.emit('session_status', { sessionId, status: 'RUNNING' });
    io.emit('log', { sessionId, level: 'CMD', message: `[${friendlyName}] Started` });

    let stdoutBuffer = '';
    
    const parseOutput = (data, isError = false) => {
        stdoutBuffer += data.toString();
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
            
            // Handles both individual (Speed.#1) and aggregate (Speed.#*)
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
                    activeSessions[sessionId].stats.latestSpeeds[deviceId] = hashrate;
                    const knownDevices = Object.keys(activeSessions[sessionId].stats.latestSpeeds);
                    const isAggregate = deviceId === '*' || (knownDevices.length === 1 && deviceId === '1');
                    io.emit('stats_update', { sessionId, type: 'hashrate', value: hashrate, isAggregate });
                }
            }

            const progressRegex = /Progress.*?:\s+\d+\/\d+\s+\(([\d\.]+)%\)/i;
            const progMatch = trimmedLine.match(progressRegex);
            if (progMatch) {
                io.emit('stats_update', { sessionId, type: 'progress', value: parseFloat(progMatch[1]) });
                if (activeSessions[sessionId]) {
                    const s = activeSessions[sessionId].stats;
                    const speeds = s.latestSpeeds;
                    
                    // Prioritize aggregate speed (*) if available, otherwise sum individuals
                    let currentTotal = speeds['*'];
                    if (currentTotal === undefined) {
                        currentTotal = Object.entries(speeds)
                            .filter(([k]) => !isNaN(parseInt(k)))
                            .reduce((acc, [, v]) => acc + v, 0);
                    }
                    if (currentTotal > 0) {
                        s.hashrateSum += currentTotal;
                        s.hashrateCount++;
                    }
                }
            }

            // MODIFIED: Parse "2 days, 19 hours" from parentheses
            const timeRegex = /Time\.Estimated.*?:\s+(.*)/i;
            const timeMatch = trimmedLine.match(timeRegex);
            if (timeMatch) {
                const fullTimeStr = timeMatch[1];
                // Extract text inside parentheses e.g. "(2 days, 19 hours)" -> "2 days, 19 hours"
                const parenMatch = fullTimeStr.match(/\((.*?)\)/);
                const value = parenMatch ? parenMatch[1] : fullTimeStr;
                io.emit('stats_update', { sessionId, type: 'time_estimated', value: value });
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

    child.stdout.on('data', d => parseOutput(d, false));
    child.stderr.on('data', d => parseOutput(d, true));

    child.on('close', (code) => {
      let duration = 0;
      let finalStats = { recovered: 0, total: 0, avgHashrate: 0 };
      
      if (activeSessions[sessionId]) {
          const s = activeSessions[sessionId];
          const endTime = Date.now();
          duration = (endTime - s.startTime) / 1000;
          
          const avg = s.stats.hashrateCount > 0 
            ? s.stats.hashrateSum / s.stats.hashrateCount 
            : 0;

          finalStats = {
              recovered: s.stats.recovered,
              total: s.stats.total,
              avgHashrate: avg
          };
      }

      io.emit('log', { sessionId, level: code === 0 ? 'SUCCESS' : 'WARN', message: `Session ${friendlyName} exited with code ${code}` });
      io.emit('session_finished', { sessionId, duration, ...finalStats });
      io.emit('session_status', { sessionId, status: 'IDLE' }); 
      
      fs.unwatchFile(sessionPotFile);
      if (fs.existsSync(sessionPotFile)) {
          try { fs.unlinkSync(sessionPotFile); } catch(e) {}
      }

      if(activeSessions[sessionId]) delete activeSessions[sessionId];
    });

    child.on('error', (err) => {
        io.emit('log', { sessionId, level: 'ERROR', message: err.message });
        io.emit('session_status', { sessionId, status: 'ERROR' });
        fs.unwatchFile(sessionPotFile);
        if(activeSessions[sessionId]) delete activeSessions[sessionId];
    });

    res.json({ success: true, sessionId });
  } catch (e) { 
      res.status(500).json({ message: e.message }); 
  }
});

app.post('/api/session/stop', (req, res) => {
  const { sessionId } = req.body;
  
  const stopSession = (id) => {
      if(activeSessions[id]) {
          const s = activeSessions[id];
          try { if(s.process) s.process.kill('SIGKILL'); } catch(e) {}
          if(s.potFile && fs.existsSync(s.potFile)) {
              fs.unwatchFile(s.potFile);
              try { fs.unlinkSync(s.potFile); } catch(e) {}
          }
          io.emit('log', { sessionId: id, level: 'WARN', message: `Session ${s.name} stopped manually.` });
          io.emit('session_status', { sessionId: id, status: 'IDLE' }); 
          // FIX: Do NOT delete session here. Let the process 'close' event handle stats saving and cleanup.
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
        } catch (e) { console.error("Error reading potfile map:", e); }
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
                if (foundCount < 100) found.push({ hash, plain });
                foundCount++;
            }
        }
        writeStream.end();
        writeStream.on('finish', () => {
            potfileMap.clear();
            res.json({ totalTarget: totalProcessed, foundCount, preview: found, downloadToken: resultFilename });
        });
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ message: 'Failed to process large file' });
    }
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
    if (fs.existsSync(SESSIONS_PATH)) {
        try { sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8')); } catch (e) {}
    }
    sessions.unshift(newSession);
    if (sessions.length > 100) sessions = sessions.slice(0, 100);
    try { fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2)); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ message: 'Failed to save session history' }); }
});

io.on('connection', (socket) => {
  const history = getFullPotfile();
  socket.emit('potfile_sync', history);
  
  Object.keys(activeSessions).forEach(sessionId => {
      socket.emit('session_started', { sessionId, name: activeSessions[sessionId].name });
      socket.emit('session_status', { sessionId, status: 'RUNNING' });
  });

  let ptyProcess = null;
  socket.on('term_init', () => {
    if (ptyProcess || !pty) return;
    const { executable, cwd } = getHashcatConfig();
    try {
        ptyProcess = pty.spawn(os.platform() === 'win32' ? 'powershell.exe' : 'bash', [], {
            name: 'xterm-color', 
            cols: 80, 
            rows: 30, 
            cwd: cwd, 
            env: process.env
        });
        ptyProcess.onData((data) => socket.emit('term_output', data));
        socket.emit('term_output', `\r\n*** Interactive Reactor Shell ***\r\n`);
    } catch (err) { socket.emit('term_output', `\r\nError launching shell: ${err.message}\r\n`); }
  });
  socket.on('term_input', (data) => { if (ptyProcess) ptyProcess.write(data); });
  socket.on('term_resize', ({ cols, rows }) => { if (ptyProcess) ptyProcess.resize(cols, rows); });
  socket.on('disconnect', () => { if (ptyProcess) { ptyProcess.kill(); ptyProcess = null; } });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`Bridge running on ${PORT}`));