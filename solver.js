const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const debugDir = path.join(os.homedir(), 'Documents', 'MHSolver_Debug');
const templatesDir = path.join(__dirname, 'letter_templates');

// Configuration
let config = {
  resolution: { width: 1920, height: 1080 },
  cellSize: 100,
  cellSpacing: 95,
  topLeft: { x: 792, y: 445 },
  offset: { x: -118, y: -45 },
  keyDelay: 15  // REDUCED from 50ms to 15ms for speed
};

let shouldStop = false;
let templates = {};

// Load letter templates on startup
async function loadTemplates() {
  console.log('📂 Loading letter templates...');
  
  // Create templates directory if it doesn't exist
  try {
    await fs.mkdir(templatesDir, { recursive: true });
  } catch (err) {}
  
  const letters = ['Q', 'W', 'E', 'R', 'A', 'S', 'D'];
  
  for (const letter of letters) {
    const templatePath = path.join(templatesDir, `${letter}.png`);
    try {
      // Load and preprocess template
      const templateBuffer = await sharp(templatePath)
        .resize(80, 80, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      templates[letter] = templateBuffer;
      console.log(`  ✅ Loaded template: ${letter}`);
    } catch (err) {
      console.log(`  ⚠️  Missing template: ${letter}.png`);
    }
  }
  
  const loadedCount = Object.keys(templates).length;
  if (loadedCount === 0) {
    console.log('\n❌ No templates found!');
    console.log(`📁 Please save letter images as PNG files in: ${templatesDir}`);
    console.log('   Required files: Q.png, W.png, E.png, R.png, A.png, S.png, D.png\n');
    return false;
  }
  
  console.log(`✅ Loaded ${loadedCount}/7 templates\n`);
  return true;
}

// Compare two images using template matching
async function compareImages(cellBuffer, templateBuffer) {
  const { data: cellData, info: cellInfo } = cellBuffer;
  const { data: templateData, info: templateInfo } = templateBuffer;
  
  // Simple pixel-by-pixel comparison of cyan pixels
  let matchingPixels = 0;
  let totalCyanPixels = 0;
  
  const minWidth = Math.min(cellInfo.width, templateInfo.width);
  const minHeight = Math.min(cellInfo.height, templateInfo.height);
  
  for (let y = 0; y < minHeight; y++) {
    for (let x = 0; x < minWidth; x++) {
      const cellIdx = (y * cellInfo.width + x) * 3;
      const templateIdx = (y * templateInfo.width + x) * 3;
      
      const cellR = cellData[cellIdx];
      const cellG = cellData[cellIdx + 1];
      const cellB = cellData[cellIdx + 2];
      
      const templateR = templateData[templateIdx];
      const templateG = templateData[templateIdx + 1];
      const templateB = templateData[templateIdx + 2];
      
      // Check if both are cyan pixels
      const cellIsCyan = (cellB > 100 && cellG > 80 && cellR < 140);
      const templateIsCyan = (templateB > 100 && templateG > 80 && templateR < 140);
      
      if (templateIsCyan) {
        totalCyanPixels++;
        if (cellIsCyan) {
          matchingPixels++;
        }
      }
    }
  }
  
  // Return match percentage
  return totalCyanPixels > 0 ? (matchingPixels / totalCyanPixels) * 100 : 0;
}

// Detect letter using template matching
async function detectLetterFast(cellBuffer) {
  let bestMatch = { letter: '?', confidence: 0 };
  
  // Compare against all templates
  for (const [letter, templateBuffer] of Object.entries(templates)) {
    const confidence = await compareImages(cellBuffer, templateBuffer);
    
    if (confidence > bestMatch.confidence) {
      bestMatch = { letter, confidence };
    }
  }
  
  return bestMatch;
}

// Capture and process grid - OPTIMIZED FOR SPEED
async function solveMinigameFast() {
  const startTime = Date.now();
  console.log('🚀 Starting FAST solver...\n');
  
  try {
    // Step 1: Capture screen (0.2s)
    console.log('📸 Capturing screen...');
    const imgBuffer = await screenshot();
    const image = sharp(imgBuffer);
    const metadata = await image.metadata();
    
    // Step 2: Calculate grid position
    const { width, height } = metadata;
    const gridConfig = {
      cellSize: config.cellSize,
      cellSpacing: config.cellSpacing,
      topLeft: {
        x: config.topLeft.x + config.offset.x,
        y: config.topLeft.y + config.offset.y
      }
    };
    
    // Step 3: Extract all 9 cells in parallel (0.3s)
    console.log('🔍 Extracting cells...');
    const cellPromises = [];
    
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = gridConfig.topLeft.x + (col * gridConfig.cellSpacing);
        const y = gridConfig.topLeft.y + (row * gridConfig.cellSpacing);
        
        cellPromises.push(
          image.clone()
            .extract({ left: x, top: y, width: gridConfig.cellSize, height: gridConfig.cellSize })
            .resize(80, 80, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .raw()
            .toBuffer({ resolveWithObject: true })
            .then(buffer => ({ row, col, buffer }))
        );
      }
    }
    
    const cells = await Promise.all(cellPromises);
    
    // Step 4: Detect all letters in parallel (0.5s)
    console.log('🔤 Detecting letters...');
    const detectionPromises = cells.map(async ({ row, col, buffer }) => {
      const result = await detectLetterFast(buffer);
      return { row, col, letter: result.letter, confidence: result.confidence };
    });
    
    const results = await Promise.all(detectionPromises);
    
    // Step 5: Build grid
    const grid = Array(3).fill(null).map(() => Array(3).fill('?'));
    results.forEach(({ row, col, letter }) => {
      grid[row][col] = letter;
    });
    
    // Display detected grid
    console.log('\n📋 Detected Grid:');
    console.log('┌─────┬─────┬─────┐');
    for (let row = 0; row < 3; row++) {
      console.log(`│  ${grid[row][0]}  │  ${grid[row][1]}  │  ${grid[row][2]}  │`);
      if (row < 2) console.log('├─────┼─────┼─────┤');
    }
    console.log('└─────┴─────┴─────┘\n');
    
    // Step 6: Press keys FAST (0.4s)
    console.log('⌨️  Pressing keys...');
    const sequence = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        sequence.push(grid[row][col]);
      }
    }
    
    await pressKeySequenceFast(sequence);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Complete! Total time: ${totalTime}s\n`);
    
    return { success: true, grid, time: totalTime };
    
  } catch (error) {
    console.error('❌ Error:', error);
    return { success: false, error: error.message };
  }
}

// Press keys as fast as possible
async function pressKeySequenceFast(keys) {
  for (const key of keys) {
    if (shouldStop) break;
    if (key === '?') continue;
    
    const keyLower = key.toLowerCase();
    
    // Use PowerShell SendKeys - FASTEST method
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${keyLower}')
    `;
    
    await new Promise((resolve, reject) => {
      exec(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    // Minimal delay between keys
    await new Promise(resolve => setTimeout(resolve, config.keyDelay));
  }
}

// Update configuration
function updateConfig(newConfig) {
  config = { ...config, ...newConfig };
}

function getConfig() {
  return config;
}

function stopSolver() {
  shouldStop = true;
}

function resetStop() {
  shouldStop = false;
}

module.exports = {
  loadTemplates,
  solveMinigameFast,
  updateConfig,
  getConfig,
  stopSolver,
  resetStop
};