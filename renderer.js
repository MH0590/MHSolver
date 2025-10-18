// UI State
let currentView = 'dashboard';
let isStealthMode = true;
let templatesLoaded = false;
let config = {
  hotkey: 'F1',
  baseDelay: 15,  // Much faster with template matching
  delayVariance: 5
};

// DOM Elements
const dashboardView = document.getElementById('dashboard-view');
const minigameView = document.getElementById('minigame-view');
const programCard = document.querySelector('.program-card');
const backBtn = document.getElementById('back-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');

// Settings elements
const resolutionSelect = document.getElementById('resolution-select');
const hotkeyInput = document.getElementById('hotkey-input');
const offsetXSlider = document.getElementById('offsetx-slider');
const offsetXValue = document.getElementById('offsetx-value');
const offsetYSlider = document.getElementById('offsety-slider');
const offsetYValue = document.getElementById('offsety-value');
const delaySlider = document.getElementById('delay-slider');
const delayValue = document.getElementById('delay-value');
const varianceSlider = document.getElementById('variance-slider');
const varianceValue = document.getElementById('variance-value');
const stealthCheckbox = document.getElementById('stealth-checkbox');
const estimatedTime = document.getElementById('estimated-time');
const estimateStatus = document.getElementById('estimate-status');
const hotkeyDisplay = document.getElementById('hotkey-display');

// Status elements
const statusIndicator = document.getElementById('status-indicator');
const statusMessage = document.getElementById('status-message');
const executionTime = document.getElementById('execution-time');

// Grid elements
const gridCells = document.querySelectorAll('.grid-cell');
const gridContainer = document.getElementById('grid-container');
const stealthOverlay = document.getElementById('stealth-overlay');

// Update elements
const updateBtn = document.getElementById('update-btn');
const updateText = document.getElementById('update-text');
const versionBadge = document.getElementById('version-badge');

// Debug elements
const openDebugBtn = document.getElementById('open-debug-btn');
const debugPath = document.getElementById('debug-path');

// Template elements
const templateStatus = document.getElementById('template-status');
const templateBadge = document.getElementById('template-badge');
const openTemplatesBtn = document.getElementById('open-templates-btn');

// Initialize
async function init() {
  // Load config
  const savedConfig = await window.electronAPI.getConfig();
  config = { ...config, ...savedConfig };
  
  // Update UI with config
  resolutionSelect.value = config.resolution || '1920x1080';
  hotkeyInput.value = config.hotkey;
  hotkeyDisplay.textContent = config.hotkey;
  delaySlider.value = config.keyDelay || 15;
  delayValue.textContent = config.keyDelay || 15;
  varianceSlider.value = config.delayVariance || 5;
  varianceValue.textContent = config.delayVariance || 5;
  offsetXSlider.value = config.offsetX || -118;
  offsetXValue.textContent = config.offsetX || -118;
  offsetYSlider.value = config.offsetY || -45;
  offsetYValue.textContent = config.offsetY || -45;
  
  updateEstimatedTime();
  
  // Load app version
  const version = await window.electronAPI.getAppVersion();
  versionBadge.textContent = `v${version}`;
  
  // Load debug folder path
  const debugFolder = await window.electronAPI.getDebugFolder();
  debugPath.textContent = `Location: ${debugFolder}`;
  
  // Setup event listeners
  setupEventListeners();
  
  // Listen to solver events
  window.electronAPI.onSolverStatus(handleSolverStatus);
  window.electronAPI.onGridDetected(handleGridDetected);
  window.electronAPI.onKeyPressed(handleKeyPressed);
  window.electronAPI.onTemplateStatus(handleTemplateStatus);
  
  // Listen to update events
  window.electronAPI.onUpdateStatus(handleUpdateStatus);
}

function setupEventListeners() {
  // Navigation
  programCard.addEventListener('click', () => switchView('minigame'));
  backBtn.addEventListener('click', () => switchView('dashboard'));
  
  // Settings
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('active');
  });
  
  // Resolution select
  resolutionSelect.addEventListener('change', async () => {
    const resolution = resolutionSelect.value;
    config.resolution = resolution;
    await window.electronAPI.updateConfig({ resolution });
  });
  
  // Offset X slider
  offsetXSlider.addEventListener('input', async () => {
    const value = parseInt(offsetXSlider.value);
    offsetXValue.textContent = value;
    config.offsetX = value;
    await window.electronAPI.updateConfig({ offsetX: value });
  });
  
  // Offset Y slider
  offsetYSlider.addEventListener('input', async () => {
    const value = parseInt(offsetYSlider.value);
    offsetYValue.textContent = value;
    config.offsetY = value;
    await window.electronAPI.updateConfig({ offsetY: value });
  });
  
  // Hotkey input
  hotkeyInput.addEventListener('change', async () => {
    const newHotkey = hotkeyInput.value.toUpperCase();
    const success = await window.electronAPI.registerHotkey(newHotkey);
    
    if (success) {
      config.hotkey = newHotkey;
      hotkeyDisplay.textContent = newHotkey;
      await window.electronAPI.updateConfig({ hotkey: newHotkey });
    } else {
      alert('Failed to register hotkey. Try a different key.');
      hotkeyInput.value = config.hotkey;
    }
  });
  
  // Delay slider
  delaySlider.addEventListener('input', async () => {
    const value = parseInt(delaySlider.value);
    delayValue.textContent = value;
    config.keyDelay = value;
    await window.electronAPI.updateConfig({ keyDelay: value });
    updateEstimatedTime();
  });
  
  // Variance slider
  varianceSlider.addEventListener('input', async () => {
    const value = parseInt(varianceSlider.value);
    varianceValue.textContent = value;
    config.delayVariance = value;
    await window.electronAPI.updateConfig({ delayVariance: value });
    updateEstimatedTime();
  });
  
  // Stealth mode
  stealthCheckbox.addEventListener('change', () => {
    isStealthMode = stealthCheckbox.checked;
    updateStealthMode();
  });
  
  // Debug folder button
  openDebugBtn.addEventListener('click', async () => {
    await window.electronAPI.openDebugFolder();
  });
  
  // Templates folder button
  if (openTemplatesBtn) {
    openTemplatesBtn.addEventListener('click', async () => {
      await window.electronAPI.openTemplatesFolder();
    });
  }
}

function switchView(view) {
  currentView = view;
  
  if (view === 'dashboard') {
    dashboardView.classList.add('active');
    minigameView.classList.remove('active');
  } else {
    dashboardView.classList.remove('active');
    minigameView.classList.add('active');
  }
}

function updateEstimatedTime() {
  const keyDelay = config.keyDelay || 15;
  const estimatedMs = (keyDelay * 9) + 1000; // 1s for detection
  const estimatedSeconds = (estimatedMs / 1000).toFixed(2);
  
  estimatedTime.textContent = `${estimatedSeconds}s`;
  
  if (estimatedSeconds <= 3.0) {
    estimateStatus.textContent = '✓ Within 3 second requirement';
    estimateStatus.style.color = '#06b6d4';
  } else {
    estimateStatus.textContent = '⚠ Exceeds 3 second limit - reduce delays';
    estimateStatus.style.color = '#f59e0b';
  }
}

function updateStealthMode() {
  if (isStealthMode) {
    stealthOverlay.classList.add('active');
  } else {
    stealthOverlay.classList.remove('active');
  }
}

function handleSolverStatus(data) {
  const { status, message, executionTime: execTime } = data;
  
  statusMessage.textContent = message;
  
  // Update status indicator
  statusIndicator.classList.remove('active', 'error');
  
  if (status === 'detecting' || status === 'executing') {
    statusIndicator.classList.add('active');
  } else if (status === 'error') {
    statusIndicator.classList.add('error');
  }
  
  // Show execution time
  if (execTime) {
    executionTime.textContent = `Last: ${execTime}s`;
    executionTime.style.display = 'inline';
  }
  
  // Reset grid after completion
  if (status === 'complete' || status === 'error' || status === 'stopped') {
    setTimeout(() => {
      resetGrid();
      statusMessage.textContent = 'Ready - Press hotkey to start';
      statusIndicator.classList.remove('active', 'error');
      executionTime.style.display = 'none';
    }, 3000);
  }
}

function handleGridDetected(data) {
  const { letters } = data;
  
  gridCells.forEach((cell, index) => {
    cell.textContent = letters[index];
    
    if (letters[index] !== '?') {
      cell.classList.add('detected');
    } else {
      cell.classList.remove('detected');
    }
    
    cell.classList.remove('active');
  });
}

function handleKeyPressed(data) {
  const { index } = data;
  
  // Remove active class from all cells
  gridCells.forEach(cell => cell.classList.remove('active'));
  
  // Add active class to current cell
  if (index >= 0 && index < gridCells.length) {
    gridCells[index].classList.add('active');
  }
}

function handleTemplateStatus(data) {
  const { loaded, count } = data;
  templatesLoaded = loaded;
  
  if (templateBadge) {
    if (loaded) {
      templateBadge.textContent = `✓ ${count}/7 Templates`;
      templateBadge.style.background = 'rgba(34, 197, 94, 0.2)';
      templateBadge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
      templateBadge.style.color = '#4ade80';
    } else {
      templateBadge.textContent = `⚠ Templates Missing`;
      templateBadge.style.background = 'rgba(234, 179, 8, 0.2)';
      templateBadge.style.borderColor = 'rgba(234, 179, 8, 0.3)';
      templateBadge.style.color = '#facc15';
    }
  }
  
  if (templateStatus && !loaded) {
    templateStatus.style.display = 'block';
  }
}

function resetGrid() {
  gridCells.forEach(cell => {
    cell.textContent = '?';
    cell.classList.remove('detected', 'active');
  });
}

// ============ UPDATE HANDLING ============
function handleUpdateStatus(data) {
  const { status, version, percent, message } = data;
  
  if (status === 'checking') {
    updateBtn.style.display = 'none';
  } 
  else if (status === 'available') {
    updateBtn.style.display = 'flex';
    updateBtn.style.background = 'rgba(34, 197, 94, 0.2)';
    updateBtn.style.borderColor = 'rgba(34, 197, 94, 0.3)';
    updateText.textContent = `Update to v${version}`;
    updateText.style.color = '#4ade80';
    
    updateBtn.onclick = async () => {
      updateText.textContent = 'Downloading...';
      await window.electronAPI.downloadUpdate();
    };
  } 
  else if (status === 'downloading') {
    updateBtn.style.display = 'flex';
    updateBtn.style.background = 'rgba(59, 130, 246, 0.2)';
    updateBtn.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    updateText.textContent = `Downloading ${Math.round(percent)}%`;
    updateText.style.color = '#60a5fa';
    updateBtn.onclick = null;
  } 
  else if (status === 'ready') {
    updateBtn.style.display = 'flex';
    updateBtn.style.background = 'rgba(168, 85, 247, 0.2)';
    updateBtn.style.borderColor = 'rgba(168, 85, 247, 0.3)';
    updateText.textContent = 'Install & Restart';
    updateText.style.color = '#c084fc';
    
    updateBtn.onclick = () => {
      window.electronAPI.installUpdate();
    };
  } 
  else if (status === 'not-available') {
    updateBtn.style.display = 'none';
  } 
  else if (status === 'error') {
    console.error('Update error:', message);
    updateBtn.style.display = 'none';
  }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);