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
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

function startServer() {
  // 1. Define paths explicitly
  const backendDir = isDev 
    ? path.join(__dirname, 'backend') 
    : path.join(process.resourcesPath, 'backend');

  const serverPath = path.join(backendDir, 'server.js');
  
  // 2. Calculate Frontend Path 
  const frontendDir = path.join(__dirname, 'dist'); 

  console.log(`[Electron] Launching server from: ${serverPath}`);
  console.log(`[Electron] Frontend serving path: ${frontendDir}`);

  // 3. Setup Environment
  const env = {
    ...process.env,
    IS_ELECTRON: 'true',
    USER_DATA_PATH: app.getPath('userData'), 
    RESOURCES_PATH: process.resourcesPath,
    FRONTEND_BUILD_PATH: frontendDir 
  };

  try {
    // 4. Fork with specific CWD and Pipe stdio
    serverProcess = fork(serverPath, [], {
      cwd: backendDir, 
      env,
      silent: true, 
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'] 
    });

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