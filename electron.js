const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Security: allowRunningInsecureContent is sometimes needed if you load local resources improperly, 
      // but usually defaults are fine. Kept your settings.
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // Ensure this path matches your build output structure
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

function startServer() {
  // 1. Define paths explicitly
  const backendDir = isDev 
    ? path.join(__dirname, 'backend') 
    : path.join(process.resourcesPath, 'backend');

  const serverPath = path.join(backendDir, 'server.js');

  console.log(`[Electron] Launching server from: ${serverPath}`);
  console.log(`[Electron] Server CWD: ${backendDir}`);

  // 2. Setup Environment
  const env = {
    ...process.env,
    IS_ELECTRON: 'true',
    USER_DATA_PATH: app.getPath('userData'), 
    RESOURCES_PATH: process.resourcesPath 
  };

  try {
    // 3. Fork with specific CWD and Pipe stdio
    serverProcess = fork(serverPath, [], {
      cwd: backendDir, // CRITICAL: Helps node-pty find native binaries
      env,
      silent: true, // Must be true to pipe stdout/stderr programmatically
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'] // Pipe logs so we can see them
    });

    // 4. Wire up logging
    if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
            console.log(`[Backend]: ${data.toString().trim()}`);
        });
    }

    if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
            console.error(`[Backend ERROR]: ${data.toString().trim()}`);
        });
    }

    serverProcess.on('error', (err) => {
      console.error('[Electron] Server process failed to launch:', err);
    });
    
    serverProcess.on('exit', (code, signal) => {
        console.log(`[Electron] Server process exited. Code: ${code}, Signal: ${signal}`);
    });

    console.log(`[Electron] Backend started with PID: ${serverProcess.pid}`);
  } catch (error) {
    console.error('[Electron] Failed to fork server process:', error);
  }
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (serverProcess) {
    console.log('[Electron] Killing server process...');
    serverProcess.kill();
  }
});