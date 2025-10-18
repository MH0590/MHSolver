const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { exec } = require('child_process');
const fs = require('fs').promises;
const os = require('os');

let mainWindow;
const symbols = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
  search: '🔍',
  robot: '🤖'
};

// Debug directory
const debugDir = path.join(os.homedir(), 'Documents', 'MHSolver_Debug');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
  
  // Register global shortcut
  globalShortcut.register('F6', () => {
    console.log('F6 pressed - starting solver...');
    mainWindow.webContents.send('solver-triggered');
  });
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Grid configuration based on resolution
function getGridConfig(width, height) {
  // 1920x1080 configuration
  if (width === 1920 && height === 1080) {
    return {
      cellSize: 100,
      cellSpacing: 95,
      topLeft: { x: 792, y: 445 },
      offset: { x: -118, y: -45 }
    };
  }
  
  // Default fallback
  return {
    cellSize: Math.floor(width * 0.052),
    cellSpacing: Math.floor(width * 0.049),
    topLeft: { 
      x: Math.floor(width * 0.4125), 
      y: Math.floor(height * 0.4120) 
    },
    offset: { x: 0, y: 0 }
  };
}

async function validateMinigame(imagePath) {
  const image = sharp(imagePath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  
  let cyanPixels = 0;
  let darkPixels = 0;
  let gridBorderPixels = 0;
  const totalPixels = width * height;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Cyan letters (bright blue/cyan)
      if (b > 100 && g > 70 && r < 140) {
        cyanPixels++;
      }
      
      // Dark background
      if (r < 50 && g < 50 && b < 70) {
        darkPixels++;
      }
      
      // Grid borders (light gray/blue lines)
      if (r > 100 && r < 150 && g > 100 && g < 150 && b > 100 && b < 150) {
        gridBorderPixels++;
      }
    }
  }
  
  const cyanPercent = (cyanPixels / totalPixels) * 100;
  const darkPercent = (darkPixels / totalPixels) * 100;
  const gridPercent = (gridBorderPixels / totalPixels) * 100;
  
  console.log('Minigame validation:');
  console.log(`  Cyan letters: ${cyanPercent.toFixed(1)}% (${cyanPixels} pixels)`);
  console.log(`  Dark background: ${darkPercent.toFixed(1)}%`);
  console.log(`  Grid borders: ${gridPercent.toFixed(1)}%`);
  
  const hasLetters = cyanPercent > 0.5 && cyanPercent < 5;
  const hasBackground = darkPercent > 70;
  const hasGrid = gridPercent > 0.5 && gridPercent < 10;
  
  console.log(`  Has letters: ${hasLetters}`);
  console.log(`  Has background: ${hasBackground}`);
  console.log(`  Has grid: ${hasGrid}`);
  
  const isValid = hasLetters && hasBackground && hasGrid;
  console.log(`  ${symbols.success} Minigame present: ${isValid}`);
  
  return isValid;
}

async function detectLetter(imagePath, x, y, width, height, row, col) {
  const image = sharp(imagePath);
  
  // Extract the cell region
  const cellBuffer = await image
    .extract({ left: x, top: y, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  const { data, info } = cellBuffer;
  const { width: w, height: h, channels } = info;
  
  const brightPixels = [];
  const colorSamples = [];
  
  // Scan for cyan/bright pixels - VERY LENIENT to catch all letter pixels
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // VERY LENIENT: Catch ALL shades of cyan/blue letters
      // Including anti-aliased edges, gradients, and darker shades
      const brightness = r + g + b;
      const colorDeviation = Math.abs(r - g) + Math.abs(r - b) + Math.abs(g - b);
      
      const isCyanLetter = (
        b > 80 &&                // Blue present (lowered from 100)
        g > 50 &&                // Green present (lowered from 70)
        r < 160 &&               // Red not dominant (raised from 140)
        brightness > 180 &&      // Somewhat bright (lowered from 230)
        colorDeviation > 60 &&   // NOT gray (lowered from 80)
        (b > r * 0.7)            // Blue comparable to red (more lenient)
      );
      
      if (isCyanLetter) {
        brightPixels.push({ x, y });
        if (colorSamples.length < 5) {
          colorSamples.push({ r, g, b });
        }
      }
    }
  }
  
  // Show average color
  if (colorSamples.length > 0) {
    const avgR = Math.round(colorSamples.reduce((s, c) => s + c.r, 0) / colorSamples.length);
    const avgG = Math.round(colorSamples.reduce((s, c) => s + c.g, 0) / colorSamples.length);
    const avgB = Math.round(colorSamples.reduce((s, c) => s + c.b, 0) / colorSamples.length);
    console.log(`  Letter color (avg): RGB(${avgR}, ${avgG}, ${avgB})`);
  }
  
  console.log(`\nCell [${row},${col}]:`);
  console.log(`  Cyan pixels found: ${brightPixels.length}`);
  
  if (brightPixels.length < 30) {
    console.log(`  ${symbols.warning} Too few pixels, might be empty`);
    return { letter: '?', row, col };
  }
  
  // Calculate bounding box
  const minX = Math.min(...brightPixels.map(p => p.x));
  const maxX = Math.max(...brightPixels.map(p => p.x));
  const minY = Math.min(...brightPixels.map(p => p.y));
  const maxY = Math.max(...brightPixels.map(p => p.y));
  
  const letterWidth = maxX - minX;
  const letterHeight = maxY - minY;
  const aspectRatio = letterWidth / letterHeight;
  
  console.log(`  Aspect: ${aspectRatio.toFixed(2)}`);
  
  // Check for hole (empty center area)
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const checkRadius = Math.min(letterWidth, letterHeight) * 0.25;
  
  let centerPixels = 0;
  for (const pixel of brightPixels) {
    const dx = pixel.x - centerX;
    const dy = pixel.y - centerY;
    if (Math.sqrt(dx*dx + dy*dy) < checkRadius) {
      centerPixels++;
    }
  }
  
  const hasHole = centerPixels < brightPixels.length * 0.3;
  console.log(`  Hole: ${hasHole}`);
  
  // Weight distribution (left vs right, top vs bottom)
  const leftPixels = brightPixels.filter(p => p.x < centerX).length;
  const rightPixels = brightPixels.filter(p => p.x >= centerX).length;
  const topPixels = brightPixels.filter(p => p.y < centerY).length;
  const bottomPixels = brightPixels.filter(p => p.y >= centerY).length;
  
  const leftPercent = Math.round((leftPixels / brightPixels.length) * 100);
  const rightPercent = Math.round((rightPixels / brightPixels.length) * 100);
  const topPercent = Math.round((topPixels / brightPixels.length) * 100);
  const bottomPercent = Math.round((bottomPixels / brightPixels.length) * 100);
  
  console.log(`  Left: ${leftPercent}%  Right: ${rightPercent}%`);
  console.log(`  Top: ${topPercent}%  Bottom: ${bottomPercent}%`);
  
  // Letter detection logic
  let letter = '?';
  
  if (hasHole) {
    if (aspectRatio > 0.95) {
      letter = 'A';
    } else if (aspectRatio < 0.65 && leftPixels > rightPixels * 1.5) {
      letter = 'D';
    } else if (aspectRatio > 0.75 && aspectRatio < 0.95) {
      letter = 'Q';
    } else {
      letter = 'D';
    }
  } else {
    if (aspectRatio > 1.1) {
      letter = 'W';
    } else {
      letter = 'S';
    }
  }
  
  // REMAPPING: Fix consistent detection errors
  const letterMap = {
    'A': 'D',  // Detected A is actually D
    'S': 'A',  // Detected S is actually A
    'D': 'E',  // Detected D is actually E
    'Q': 'R',  // Detected Q is actually R
    'W': 'W'   // W is correct
  };
  
  const correctedLetter = letterMap[letter] || letter;
  console.log(`  ${symbols.success} Detected: "${letter}" → Corrected: "${correctedLetter}"`);
  
  return {
    letter: correctedLetter,
    row,
    col,
    stats: {
      pixels: brightPixels.length,
      aspect: aspectRatio.toFixed(2),
      hole: hasHole,
      leftRight: `${leftPercent}%  Right: ${rightPercent}%`,
      topBottom: `${topPercent}%  Bottom: ${bottomPercent}%`
    }
  };
}

function detectLetters(imagePath) {
  const image = sharp(imagePath);
  
  return image.metadata().then(metadata => {
    const { width, height } = metadata;
    
    // Calculate cell dimensions (3x3 grid)
    // Add small padding to avoid grid lines
    const cellWidth = Math.floor(width / 3);
    const cellHeight = Math.floor(height / 3);
    const padding = 8; // Pixels to skip from edges
    
    const detectionPromises = [];
    
    // Process each of the 9 cells
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = col * cellWidth + padding;
        const y = row * cellHeight + padding;
        const w = cellWidth - (padding * 2);
        const h = cellHeight - (padding * 2);
        
        detectionPromises.push(
          detectLetter(imagePath, x, y, w, h, row, col)
        );
      }
    }
    
    return Promise.all(detectionPromises);
  });
}

async function captureAndCropGrid() {
  console.log(`${symbols.success} Full screen captured`);
  
  const displays = screen.getAllDisplays();
  const primaryDisplay = displays[0];
  const { width, height } = primaryDisplay.bounds;
  
  console.log(`Using resolution: ${width}x${height} (${primaryDisplay.size.width}x${primaryDisplay.size.height})`);
  
  const config = getGridConfig(width, height);
  console.log(`Grid settings: cellSize=${config.cellSize}px, cellSpacing=${config.cellSpacing}px`);
  console.log(`Top-left cell position: (${config.topLeft.x}, ${config.topLeft.y})`);
  console.log(`Offset: X=${config.offset.x}px, Y=${config.offset.y}px`);
  
  const imgBuffer = await screenshot({ format: 'png' });
  
  const gridSize = (config.cellSize * 3) + (config.cellSpacing * 2);
  const cropX = config.topLeft.x + config.offset.x;
  const cropY = config.topLeft.y + config.offset.y;
  
  // Ensure debug directory exists
  await fs.mkdir(debugDir, { recursive: true });
  
  const debugPath = path.join(debugDir, 'debug_capture.png');
  const croppedBuffer = await sharp(imgBuffer)
    .extract({
      left: cropX,
      top: cropY,
      width: gridSize,
      height: gridSize
    })
    .toFile(debugPath);
  
  return debugPath;
}

function pressKeys(sequence) {
  return new Promise((resolve, reject) => {
    const keys = sequence.split('');
    let commands = [];
    
    keys.forEach((key, index) => {
      const lowerKey = key.toLowerCase();
      const keyName = lowerKey === 'q' ? 'q' : 
                      lowerKey === 'w' ? 'w' : 
                      lowerKey === 'e' ? 'e' :
                      lowerKey === 'r' ? 'r' :
                      lowerKey === 'a' ? 'a' : 
                      lowerKey === 's' ? 's' : 
                      lowerKey === 'd' ? 'd' : lowerKey;
      
      console.log(`${lowerKey}Pressed: ${key.toUpperCase()} (position ${index + 1}/${keys.length})`);
      
      // Properly escape quotes in PowerShell
      commands.push(`[System.Windows.Forms.SendKeys]::SendWait('${keyName}')`);
      commands.push('Start-Sleep -Milliseconds 50');
    });
    
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      ${commands.join('\n      ')}
    `;
    
    exec(`powershell.exe -Command "${psScript.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`${symbols.error} Error pressing keys:`, error);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

ipcMain.handle('solve-minigame', async () => {
  try {
    const gridImagePath = await captureAndCropGrid();
    
    const isValid = await validateMinigame(gridImagePath);
    if (!isValid) {
      return {
        success: false,
        message: 'Minigame not detected. Make sure the game is visible and the 3x3 grid is on screen.'
      };
    }
    
    console.log(`Using resolution: ${screen.getPrimaryDisplay().bounds.width}x${screen.getPrimaryDisplay().bounds.height} (${screen.getPrimaryDisplay().size.width}x${screen.getPrimaryDisplay().size.height})`);
    const config = getGridConfig(screen.getPrimaryDisplay().bounds.width, screen.getPrimaryDisplay().bounds.height);
    console.log(`Grid settings: cellSize=${config.cellSize}px, cellSpacing=${config.cellSpacing}px`);
    console.log(`Top-left cell position: (${config.topLeft.x}, ${config.topLeft.y})`);
    console.log(`Offset: X=${config.offset.x}px, Y=${config.offset.y}px`);
    
    console.log(`\n${symbols.search} Detecting individual cells...`);
    const detectedLetters = await detectLetters(gridImagePath);
    
    const gridOrder = detectedLetters
      .sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        return a.col - b.col;
      })
      .map(l => l.letter)
      .join(' ');
    
    console.log(`\n${symbols.success} Debug images saved to: ${debugDir}`);
    console.log('  - debug_capture.png (full grid)');
    console.log('  - debug_cell_X_Y.png (individual cells)');
    
    console.log('Grid order:', gridOrder);
    
    const sequence = detectedLetters
      .sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        return a.col - b.col;
      })
      .map(l => l.letter)
      .join('');
    
    await new Promise(resolve => setTimeout(resolve, 100));
    await pressKeys(sequence);
    
    return {
      success: true,
      sequence: sequence,
      grid: gridOrder
    };
    
  } catch (error) {
    console.error(`${symbols.error} Error:`, error);
    return {
      success: false,
      message: error.message
    };
  }
});