const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const os = require('os');
const fs = require('fs');

const execPromise = util.promisify(exec);

// Get user's Documents folder for saving debug images
const DEBUG_FOLDER = path.join(os.homedir(), 'Documents', 'MHSolver_Debug');

// Create debug folder if it doesn't exist
if (!fs.existsSync(DEBUG_FOLDER)) {
  fs.mkdirSync(DEBUG_FOLDER, { recursive: true });
  console.log(`Created debug folder: ${DEBUG_FOLDER}`);
}

const VALID_LETTERS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D'];

// Resolution-specific configs
const RESOLUTION_CONFIGS = {
  '1920x1080': {
    cellSize: 100,
    cellSpacing: 95,
    offsetX: -108,
    offsetY: -88
  },
  '2560x1440': {
    cellSize: 133,
    cellSpacing: 127,
    offsetX: -144,
    offsetY: -117
  }
};

let config = {
  baseDelay: 150,
  delayVariance: 50,
  resolution: '1920x1080',
  ...RESOLUTION_CONFIGS['1920x1080']
};

let shouldStop = false;

// Get screen center position for the TOP-LEFT cell
async function getTopLeftCellPosition() {
  const { cellSize, cellSpacing, offsetX, offsetY, resolution } = config;
  
  let screenWidth = 1920;
  let screenHeight = 1080;
  
  if (resolution === '2560x1440') {
    screenWidth = 2560;
    screenHeight = 1440;
  } else if (resolution === '1920x1080') {
    screenWidth = 1920;
    screenHeight = 1080;
  }
  
  console.log(`Using resolution: ${resolution} (${screenWidth}x${screenHeight})`);
  console.log(`Grid settings: cellSize=${cellSize}px, cellSpacing=${cellSpacing}px`);
  
  const topLeftX = Math.floor((screenWidth - cellSize) / 2) + offsetX;
  const topLeftY = Math.floor((screenHeight - cellSize) / 2) + offsetY;
  
  console.log(`Top-left cell position: (${topLeftX}, ${topLeftY})`);
  console.log(`Offset: X=${offsetX}px, Y=${offsetY}px`);
  
  return {
    x: Math.max(0, topLeftX),
    y: Math.max(0, topLeftY)
  };
}

function getCellPosition(row, col, topLeftPos) {
  const { cellSize, cellSpacing } = config;
  
  return {
    x: topLeftPos.x + (col * cellSpacing),
    y: topLeftPos.y + (row * cellSpacing),
    width: cellSize,
    height: cellSize
  };
}

async function captureSingleCell(row, col, fullScreenshot, topLeftPos) {
  try {
    const cellPos = getCellPosition(row, col, topLeftPos);
    
    const cellBuffer = await sharp(fullScreenshot)
      .extract({
        left: cellPos.x,
        top: cellPos.y,
        width: cellPos.width,
        height: cellPos.height
      })
      .toBuffer();
    
    return cellBuffer;
  } catch (error) {
    throw new Error(`Failed to capture cell [${row},${col}]: ${error.message}`);
  }
}

async function captureScreen() {
  try {
    const img = await screenshot({ format: 'png' });
    console.log('✓ Full screen captured');
    return img;
  } catch (error) {
    throw new Error(`Screen capture failed: ${error.message}`);
  }
}

async function detectCellLetter(cellBuffer, row, col) {
  try {
    const { data, info } = await sharp(cellBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const signature = createLetterSignature(data, info.width, info.height, info.channels);
    
    console.log(`\nCell [${row},${col}]:`);
    console.log(`  Cyan pixels found: ${signature.cyanPixels}`);
    
    if (signature.cyanPixels < 50) {
      console.log(`  ⚠️ Too few cyan pixels - empty cell or wrong position!`);
      return '?';
    }
    
    console.log(`  Aspect: ${signature.aspectRatio.toFixed(2)}`);
    console.log(`  Hole: ${signature.centerHole}`);
    console.log(`  Left: ${(signature.leftHeavy * 100).toFixed(0)}%  Right: ${(signature.rightHeavy * 100).toFixed(0)}%`);
    console.log(`  Top: ${(signature.topHeavy * 100).toFixed(0)}%  Bottom: ${(signature.bottomHeavy * 100).toFixed(0)}%`);
    
    // Match to letter (will return the "wrong" letter)
    const detectedLetter = matchSignatureToLetter(signature);
    
    // REMAPPING: Fix consistent detection errors
    const letterMap = {
      'A': 'D',  // Detected A → Actually D
      'S': 'A',  // Detected S → Actually A
      'D': 'E',  // Detected D → Actually E
      'Q': 'R',  // Detected Q → Actually R
      'W': 'W'   // W is correct
    };
    
    const correctedLetter = letterMap[detectedLetter] || detectedLetter;
    
    console.log(`  ✓ Detected: "${detectedLetter}" → Corrected: "${correctedLetter}"`);
    
    return correctedLetter;
    
  } catch (error) {
    console.error(`✗ Cell [${row},${col}]: Error - ${error.message}`);
    return '?';
  }
}

function matchSignatureToLetter(signature) {
  if (signature.cyanPixels < 50) {
    console.log(`  ⚠️ Only ${signature.cyanPixels} cyan pixels - might be empty or miscapture!`);
    return '?';
  }
  
  const { aspectRatio, pixelCount, topHeavy, bottomHeavy, leftHeavy, rightHeavy, centerHole } = signature;
  
  if (aspectRatio > 2.0 || aspectRatio < 0.15) {
    console.log(`  ⚠️ Unusual aspect ratio ${aspectRatio.toFixed(2)} - detection may be unreliable`);
    if (leftHeavy > 0.65) return 'E';
    if (leftHeavy > 0.55) return 'D';
    return 'S';
  }
  
  // W: VERY wide letter
  if (aspectRatio > 1.30) {
    return 'W';
  }
  
  // Letters with CENTER HOLES: A, D, Q
  if (centerHole) {
    // D: Left-heavy with hole
    if (aspectRatio < 0.85 && leftHeavy > 0.60) {
      return 'D';
    }
    
    // Q: Round with hole, balanced sides
    if (aspectRatio > 0.65 && aspectRatio < 0.90 && Math.abs(leftHeavy - rightHeavy) < 0.15) {
      return 'Q';
    }
    
    // A: Triangle with hole at top
    return 'A';
  }
  
  // Letters WITHOUT holes: E, R, S
  
  // E: Very left-heavy
  if (aspectRatio < 1.1 && leftHeavy > 0.60) {
    return 'E';
  }
  
  // R: Left-heavy but less extreme than E
  if (aspectRatio < 1.1 && leftHeavy > 0.54 && leftHeavy <= 0.60) {
    return 'R';
  }
  
  // S: Curvy and relatively balanced
  if (aspectRatio > 0.70 && aspectRatio < 1.25) {
    if (Math.abs(leftHeavy - rightHeavy) < 0.18) {
      return 'S';
    }
  }
  
  // Fallback logic
  if (aspectRatio > 1.25) {
    return 'W';
  }
  
  if (leftHeavy > 0.58) {
    return 'E';
  }
  
  if (leftHeavy > 0.52) {
    return centerHole ? 'D' : 'R';
  }
  
  return 'S';
}

function createLetterSignature(data, width, height, channels) {
  let brightPixels = [];
  let colorSamples = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      const isCyanLetter = (
        r < 120 &&
        g > 100 &&
        b > 120 &&
        (g + b) > 230
      );
      
      if (isCyanLetter) {
        brightPixels.push({ x, y });
        if (colorSamples.length < 5) {
          colorSamples.push({ r, g, b });
        }
      }
    }
  }
  
  if (colorSamples.length > 0) {
    const avgR = Math.round(colorSamples.reduce((sum, c) => sum + c.r, 0) / colorSamples.length);
    const avgG = Math.round(colorSamples.reduce((sum, c) => sum + c.g, 0) / colorSamples.length);
    const avgB = Math.round(colorSamples.reduce((sum, c) => sum + c.b, 0) / colorSamples.length);
    console.log(`  Letter color (avg): RGB(${avgR}, ${avgG}, ${avgB})`);
  }
  
  if (brightPixels.length < 80) {
    return {
      cyanPixels: brightPixels.length,
      pixelCount: brightPixels.length,
      aspectRatio: 1,
      topHeavy: 0.5,
      bottomHeavy: 0.5,
      leftHeavy: 0.5,
      rightHeavy: 0.5,
      centerHole: false
    };
  }
  
  const minX = Math.min(...brightPixels.map(p => p.x));
  const maxX = Math.max(...brightPixels.map(p => p.x));
  const minY = Math.min(...brightPixels.map(p => p.y));
  const maxY = Math.max(...brightPixels.map(p => p.y));
  
  const letterWidth = maxX - minX + 1;
  const letterHeight = maxY - minY + 1;
  const aspectRatio = letterWidth / letterHeight;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  const topPixels = brightPixels.filter(p => p.y < centerY).length;
  const bottomPixels = brightPixels.filter(p => p.y >= centerY).length;
  const leftPixels = brightPixels.filter(p => p.x < centerX).length;
  const rightPixels = brightPixels.filter(p => p.x >= centerX).length;
  
  const total = brightPixels.length;
  const topHeavy = topPixels / total;
  const bottomHeavy = bottomPixels / total;
  const leftHeavy = leftPixels / total;
  const rightHeavy = rightPixels / total;
  
  const centerRadius = Math.min(letterWidth, letterHeight) / 4;
  const centerPixels = brightPixels.filter(p => 
    Math.abs(p.x - centerX) < centerRadius && 
    Math.abs(p.y - centerY) < centerRadius
  ).length;
  
  const centerHole = centerPixels < (total * 0.15);
  
  return {
    cyanPixels: brightPixels.length,
    pixelCount: brightPixels.length,
    aspectRatio: aspectRatio,
    topHeavy: topHeavy,
    bottomHeavy: bottomHeavy,
    leftHeavy: leftHeavy,
    rightHeavy: rightHeavy,
    centerHole: centerHole
  };
}

async function validateMinigamePresent(fullScreenshot) {
  try {
    const topLeftPos = await getTopLeftCellPosition();
    const { cellSize, cellSpacing } = config;
    const gridSize = cellSpacing * 2 + cellSize;
    
    const gridBuffer = await sharp(fullScreenshot)
      .extract({
        left: topLeftPos.x,
        top: topLeftPos.y,
        width: gridSize,
        height: gridSize
      })
      .toBuffer();
    
    const { data, info } = await sharp(gridBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    let cyanPixelCount = 0;
    let darkBluePixelCount = 0;
    let gridBorderPixelCount = 0;
    
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      const brightness = r + g + b;
      const colorDeviation = Math.abs(r - g) + Math.abs(r - b) + Math.abs(g - b);
      if (b > 100 && g > 70 && r < 140 && brightness > 230 && colorDeviation > 80) {
        cyanPixelCount++;
      }
      
      if (b > 20 && b < 80 && r < 50 && g < 70) {
        darkBluePixelCount++;
      }
      
      if ((b > 90 && b < 220) && (g > 70 && g < 180) && r < 140) {
        gridBorderPixelCount++;
      }
    }
    
    const totalPixels = data.length / info.channels;
    const cyanPercentage = (cyanPixelCount / totalPixels) * 100;
    const darkBluePercentage = (darkBluePixelCount / totalPixels) * 100;
    const borderPercentage = (gridBorderPixelCount / totalPixels) * 100;
    
    console.log(`Minigame validation:`);
    console.log(`  Cyan letters: ${cyanPercentage.toFixed(1)}% (${cyanPixelCount} pixels)`);
    console.log(`  Dark background: ${darkBluePercentage.toFixed(1)}%`);
    console.log(`  Grid borders: ${borderPercentage.toFixed(1)}%`);
    
    const hasLetters = cyanPercentage > 0.2 && cyanPixelCount > 150;
    const hasBackground = darkBluePercentage > 25;
    const hasGridLines = borderPercentage > 1.0;
    
    const isPresent = hasLetters && hasBackground && hasGridLines;
    
    console.log(`  Has letters: ${hasLetters}`);
    console.log(`  Has background: ${hasBackground}`);
    console.log(`  Has grid: ${hasGridLines}`);
    console.log(`  ✓ Minigame present: ${isPresent}`);
    
    if (!isPresent) {
      console.log(`  Reason: Missing required elements`);
      if (!hasLetters) console.log(`    - Not enough cyan letter pixels`);
      if (!hasBackground) console.log(`    - Wrong background color`);
      if (!hasGridLines) console.log(`    - No grid borders detected`);
    }
    
    return isPresent;
    
  } catch (error) {
    console.error('Validation error:', error.message);
    return false;
  }
}

async function detectLetters(fullScreenshot) {
  const letters = [];
  const topLeftPos = await getTopLeftCellPosition();
  
  console.log('\n🔍 Detecting individual cells...');
  
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cellBuffer = await captureSingleCell(row, col, fullScreenshot, topLeftPos);
      
      const cellDebugPath = path.join(DEBUG_FOLDER, `debug_cell_${row}_${col}.png`);
      await sharp(cellBuffer).toFile(cellDebugPath);
      
      const letter = await detectCellLetter(cellBuffer, row, col);
      letters.push(letter);
    }
  }
  
  try {
    const { cellSize, cellSpacing } = config;
    const gridSize = cellSpacing * 2 + cellSize;
    
    const gridDebugPath = path.join(DEBUG_FOLDER, 'debug_capture.png');
    await sharp(fullScreenshot)
      .extract({
        left: topLeftPos.x - 10,
        top: topLeftPos.y - 10,
        width: gridSize + 20,
        height: gridSize + 20
      })
      .toFile(gridDebugPath);
    
    console.log(`\n✓ Debug images saved to: ${DEBUG_FOLDER}`);
    console.log('  - debug_capture.png (full grid)');
    console.log('  - debug_cell_X_Y.png (individual cells)');
  } catch (err) {
    console.log('Could not save debug images:', err.message);
  }
  
  return letters;
}

function getRandomDelay() {
  const { baseDelay, delayVariance } = config;
  const variance = Math.random() * delayVariance * 2 - delayVariance;
  return Math.max(50, baseDelay + variance);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendKey(key) {
  try {
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')`;
    await execPromise(`powershell -Command "${psScript}"`);
  } catch (error) {
    console.error(`Failed to send key ${key}:`, error.message);
  }
}

async function executeKeySequence(letters, onKeyPress) {
  shouldStop = false;
  
  console.log('Grid order:', letters.join(' '));
  
  for (let i = 0; i < letters.length; i++) {
    if (shouldStop) {
      throw new Error('Sequence stopped by user');
    }
    
    const letter = letters[i];
    
    if (letter === '?') {
      console.log(`Skipping unknown letter at position ${i + 1}`);
      continue;
    }
    
    if (onKeyPress) {
      onKeyPress(i);
    }
    
    try {
      await sendKey(letter.toLowerCase());
      console.log(`Pressed: ${letter} (position ${i + 1}/9)`);
    } catch (error) {
      console.error(`Failed to press key ${letter}:`, error);
    }
    
    if (i < letters.length - 1) {
      const delay = getRandomDelay();
      await sleep(delay);
    }
  }
}

function stop() {
  shouldStop = true;
}

function getConfig() {
  return { ...config };
}

function updateConfig(newConfig) {
  config = { ...config, ...newConfig };
  
  if (newConfig.resolution && RESOLUTION_CONFIGS[newConfig.resolution]) {
    const resConfig = RESOLUTION_CONFIGS[newConfig.resolution];
    config.cellSize = resConfig.cellSize;
    config.cellSpacing = resConfig.cellSpacing;
    
    if (!newConfig.offsetX) config.offsetX = resConfig.offsetX;
    if (!newConfig.offsetY) config.offsetY = resConfig.offsetY;
    
    console.log(`Applied ${newConfig.resolution} settings: cellSize=${config.cellSize}, cellSpacing=${config.cellSpacing}`);
  }
}

function getDebugFolder() {
  return DEBUG_FOLDER;
}

module.exports = {
  captureScreen,
  detectLetters,
  executeKeySequence,
  validateMinigamePresent,
  stop,
  getConfig,
  updateConfig,
  getDebugFolder
};