const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  
  // Hotkey
  registerHotkey: (hotkey) => ipcRenderer.invoke('register-hotkey', hotkey),
  
  // Solver controls
  startSolver: () => ipcRenderer.invoke('start-solver'),
  stopSolver: () => ipcRenderer.invoke('stop-solver'),
  
  // Debug folder
  getDebugFolder: () => ipcRenderer.invoke('get-debug-folder'),
  openDebugFolder: () => ipcRenderer.invoke('open-debug-folder'),
  
  // Auto-update methods
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  
  // Event listeners
  onSolverStatus: (callback) => {
    ipcRenderer.on('solver-status', (event, data) => callback(data));
  },
  onGridDetected: (callback) => {
    ipcRenderer.on('grid-detected', (event, data) => callback(data));
  },
  onKeyPressed: (callback) => {
    ipcRenderer.on('key-pressed', (event, data) => callback(data));
  },
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  }
});