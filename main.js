const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const solver = require('./solver');

let mainWindow;
let isDetecting = false;
let templatesLoaded = false;

// Auto-updater configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    frame: true,
    icon: path.join(__dirname, 'build/icon.ico'),
    backgroundColor: '#0f172a'
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Check for updates after window loads
  mainWindow.webContents.once('did-finish-load', () => {
    // Send template status to UI
    mainWindow.webContents.send('template-status', { 
      loaded: templatesLoaded,
      count: templatesLoaded ? 7 : 0 
    });
    
    // Only check for updates in production
    if (!process.env.DEBUG) {
      setTimeout(() => {
        autoUpdater.checkForUpdates();
      }, 3000);
    }
  });
}

// ============ AUTO-UPDATER EVENTS ============
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Checking for updates...');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'checking' });
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('✅ Update available:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'available', 
      version: info.version 
    });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('✓ App is up to date');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'not-available' });
  }
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`📥 Download progress: ${Math.round(progress.percent)}%`);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'downloading', 
      percent: progress.percent 
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('✅ Update downloaded, will install on quit');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'ready',
      version: info.version 
    });
  }
});

autoUpdater.on('error', (error) => {
  console.error('❌ Update error:', error);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'error',
      message: error.message 
    });
  }
});

// ============ IPC HANDLERS FOR UPDATES ============
ipcMain.handle('check-for-updates', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (error) {
    console.error('Check for updates error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    console.error('Download update error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ============ SOLVER FUNCTIONALITY ============
// Register global hotkey
function registerHotkey(hotkey) {
  globalShortcut.unregisterAll();
  
  const success = globalShortcut.register(hotkey, () => {
    if (!isDetecting) {
      startSolver();
    } else {
      stopSolver();
    }
  });

  if (!success) {
    console.error('Hotkey registration failed');
    return false;
  }

  return true;
}

async function startSolver() {
  if (isDetecting) return;
  
  // Check if templates are loaded
  if (!templatesLoaded) {
    mainWindow.webContents.send('solver-status', { 
      status: 'error', 
      message: 'Templates not loaded! Check setup instructions.' 
    });
    return;
  }
  
  isDetecting = true;
  mainWindow.webContents.send('solver-status', { 
    status: 'detecting', 
    message: 'Starting fast solver...' 
  });

  try {
    const startTime = Date.now();
    
    // Use the new fast solver
    const result = await solver.solveMinigameFast();
    
    if (!result.success) {
      throw new Error(result.error || 'Solver failed');
    }
    
    // Send detected grid to UI
    const letters = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        letters.push(result.grid[row][col]);
      }
    }
    mainWindow.webContents.send('grid-detected', { letters });
    
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    mainWindow.webContents.send('solver-status', { 
      status: 'complete', 
      message: `Complete in ${executionTime}s`,
      executionTime: parseFloat(executionTime)
    });

  } catch (error) {
    console.error('Solver error:', error);
    mainWindow.webContents.send('solver-status', { 
      status: 'error', 
      message: error.message 
    });
  } finally {
    isDetecting = false;
  }
}

function stopSolver() {
  isDetecting = false;
  solver.stopSolver();
  mainWindow.webContents.send('solver-status', { 
    status: 'stopped', 
    message: 'Stopped' 
  });
}

// IPC Handlers
ipcMain.handle('register-hotkey', async (event, hotkey) => {
  return registerHotkey(hotkey);
});

ipcMain.handle('get-config', async () => {
  return solver.getConfig();
});

ipcMain.handle('update-config', async (event, config) => {
  solver.updateConfig(config);
  return true;
});

ipcMain.handle('start-solver', async () => {
  await startSolver();
});

ipcMain.handle('stop-solver', async () => {
  stopSolver();
});

ipcMain.handle('get-templates-status', async () => {
  return { loaded: templatesLoaded, count: templatesLoaded ? 7 : 0 };
});

// Debug folder handlers
ipcMain.handle('get-debug-folder', () => {
  return solver.getDebugFolder ? solver.getDebugFolder() : path.join(require('os').homedir(), 'Documents', 'MHSolver_Debug');
});

ipcMain.handle('open-debug-folder', async () => {
  const debugFolder = solver.getDebugFolder ? solver.getDebugFolder() : path.join(require('os').homedir(), 'Documents', 'MHSolver_Debug');
  await shell.openPath(debugFolder);
});

ipcMain.handle('open-templates-folder', async () => {
  const templatesFolder = path.join(__dirname, 'letter_templates');
  await shell.openPath(templatesFolder);
});

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  
  // Load templates on startup
  console.log('🚀 MH Solver starting...');
  console.log('📂 Loading letter templates...');
  
  templatesLoaded = await solver.loadTemplates();
  
  if (!templatesLoaded) {
    console.log('⚠️  WARNING: Templates not loaded!');
    console.log('📁 Please add 7 letter images (Q.png, W.png, E.png, R.png, A.png, S.png, D.png)');
    console.log(`📂 To folder: ${path.join(__dirname, 'letter_templates')}`);
  } else {
    console.log('✅ Templates loaded successfully!');
  }
  
  // Register default hotkey (F1)
  registerHotkey('F1');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});