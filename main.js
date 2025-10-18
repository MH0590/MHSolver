const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const solver = require('./solver');

let mainWindow;
let isDetecting = false;

// Auto-updater configuration
autoUpdater.autoDownload = false; // Don't auto-download, let user decide
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

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Check for updates after window loads
  mainWindow.webContents.once('did-finish-load', () => {
    // Only check for updates in production
    if (!process.env.DEBUG) {
      setTimeout(() => {
        autoUpdater.checkForUpdates();
      }, 3000); // Check 3 seconds after launch
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
  // Unregister previous hotkey
  globalShortcut.unregisterAll();
  
  // Register new hotkey
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
  
  isDetecting = true;
  mainWindow.webContents.send('solver-status', { status: 'detecting', message: 'Scanning screen...' });

  try {
    // Step 1: Capture screen
    mainWindow.webContents.send('solver-status', { status: 'detecting', message: 'Capturing screen...' });
    const screenshot = await solver.captureScreen();

    // Step 1.5: Validate minigame is present
    mainWindow.webContents.send('solver-status', { status: 'detecting', message: 'Checking for minigame...' });
    const isMinigamePresent = await solver.validateMinigamePresent(screenshot);
    
    //if (!isMinigamePresent) {
    //  throw new Error('Minigame not detected on screen. Make sure the alphabet grid is visible and centered.');
    //}

    // Step 2: Detect letters
    mainWindow.webContents.send('solver-status', { status: 'detecting', message: 'Detecting letters...' });
    const letters = await solver.detectLetters(screenshot);
    
    // Send detected grid to UI
    mainWindow.webContents.send('grid-detected', { letters });

    // Step 3: Validate detection
    const unknownCount = letters.filter(l => l === '?').length;
    if (unknownCount > 5) {
      throw new Error(`Too many undetected letters (${unknownCount}/9). Try adjusting capture size or positioning minigame in center.`);
    }
    
    if (unknownCount > 0) {
      mainWindow.webContents.send('solver-status', { 
        status: 'detecting', 
        message: `Warning: ${unknownCount} letters unclear, will skip those positions` 
      });
    }

    mainWindow.webContents.send('solver-status', { 
      status: 'executing', 
      message: 'Executing key sequence...' 
    });

    // Step 4: Execute key sequence
    const startTime = Date.now();
    await solver.executeKeySequence(letters, (index) => {
      // Update UI with current position
      mainWindow.webContents.send('key-pressed', { index, letter: letters[index] });
    });
    
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Step 5: Complete
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
  solver.stop();
  mainWindow.webContents.send('solver-status', { status: 'stopped', message: 'Stopped' });
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

// Debug folder handlers
ipcMain.handle('get-debug-folder', () => {
  return solver.getDebugFolder();
});

ipcMain.handle('open-debug-folder', async () => {
  const debugFolder = solver.getDebugFolder();
  await shell.openPath(debugFolder);
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  
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