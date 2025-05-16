// renderer.js - Handles UI interactions

// DOM Elements
const usernameInput = document.getElementById('username');
const minecraftVersionInput = document.getElementById('minecraft-version');
const fabricVersionInput = document.getElementById('fabric-version');
const ramMinSelect = document.getElementById('ram-min');
const ramMaxSelect = document.getElementById('ram-max');
const downloadBtn = document.getElementById('download-btn');
const playBtn = document.getElementById('play-btn');
const statusBox = document.getElementById('status-box');
const statusMessage = document.getElementById('status-message');
const progressBar = document.getElementById('progress-bar');

// State
let gameState = {
  minecraftVersion: null,
  fabricVersion: null,
  downloadComplete: false
};

// Initialize the launcher
async function initLauncher() {
  try {
    showStatus('Initializing launcher...', 'info');
    
    // Initialize launcher (creates directories)
    await window.launcher.initialize();
    
    // Get latest Minecraft version
    const minecraftVersion = await window.launcher.getLatestMinecraftVersion();
    gameState.minecraftVersion = minecraftVersion;
    minecraftVersionInput.value = minecraftVersion;
    
    // Get latest Fabric version for the Minecraft version
    const fabricVersion = await window.launcher.getLatestFabricVersion(minecraftVersion);
    gameState.fabricVersion = fabricVersion;
    fabricVersionInput.value = fabricVersion;
    
    hideStatus();
  } catch (error) {
    showStatus(`Failed to initialize launcher: ${error.message}`, 'error');
    console.error('Launcher initialization error:', error);
  }
}

// Download game files
async function downloadGameFiles() {
  if (!gameState.minecraftVersion || !gameState.fabricVersion) {
    showStatus('Minecraft or Fabric version not found', 'error');
    return;
  }
  
  try {
    showStatus('Downloading game files...', 'info');
    updateProgress(5);
    
    // Disable download button during download
    downloadBtn.disabled = true;
    
    // Step 1: Download JSON files
    showStatus('Downloading game configuration...', 'info');
    updateProgress(10);
    
    // Step 2: Download game files
    showStatus('Downloading libraries and assets...', 'info');
    updateProgress(20);
    
    // Download game files
    const result = await window.launcher.downloadGameFiles(
      gameState.minecraftVersion,
      gameState.fabricVersion
    );
    
    updateProgress(95);
    
    if (result.success) {
      updateProgress(100);
      
      if (result.missingLibraries && result.missingLibraries.length > 0) {
        showStatus(`Download completed with ${result.missingLibraries.length} missing libraries. The game might still work.`, 'warning');
      } else {
        showStatus('Download completed successfully!', 'info');
      }
      
      gameState.downloadComplete = true;
      playBtn.disabled = false;
    } else {
      showStatus(`Download failed: ${result.error}`, 'error');
    }
    
    // Re-enable download button
    downloadBtn.disabled = false;
  } catch (error) {
    downloadBtn.disabled = false;
    showStatus(`Download failed: ${error.message}`, 'error');
    console.error('Download error:', error);
  }
}

// Launch the game
async function launchGame() {
  const username = usernameInput.value.trim();
  
  if (!username) {
    showStatus('Please enter a username', 'error');
    return;
  }
  
  if (!gameState.downloadComplete) {
    if (confirm('Game files have not been downloaded. Would you like to download them first?')) {
      await downloadGameFiles();
      if (!gameState.downloadComplete) return;
    } else {
      return;
    }
  }
  
  try {
    showStatus('Launching game...', 'info');
    
    // Disable play button during launch
    playBtn.disabled = true;
    
    // Get RAM settings
    const ram = {
      min: ramMinSelect.value,
      max: ramMaxSelect.value
    };
    
    // Launch the game
    const result = await window.launcher.launchGame(
      username,
      gameState.minecraftVersion,
      gameState.fabricVersion,
      ram
    );
    
    if (result.success || result.pid) {
      showStatus(`Game launched successfully! PID: ${result.pid}`, 'info');
    } else {
      showStatus(`Game launch failed: ${result.error}`, 'error');
    }
    
    // Re-enable play button
    playBtn.disabled = false;
  } catch (error) {
    playBtn.disabled = false;
    showStatus(`Game launch failed: ${error.message}`, 'error');
    console.error('Launch error:', error);
  }
}

// Helper Functions
function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusBox.className = 'status show';
  
  if (type === 'error') {
    statusBox.classList.add('status-error');
    statusBox.classList.remove('status-warning');
  } else if (type === 'warning') {
    statusBox.classList.add('status-warning');
    statusBox.classList.remove('status-error');
  } else {
    statusBox.classList.remove('status-error');
    statusBox.classList.remove('status-warning');
  }
}

function hideStatus() {
  statusBox.className = 'status';
}
async function downloadGameFiles() {
  if (!gameState.minecraftVersion || !gameState.fabricVersion) {
    showStatus('Minecraft or Fabric version not found', 'error');
    return;
  }
  
  try {
    showStatus('Downloading game files...', 'info');
    updateProgress(10);
    
    // Disable download button during download
    downloadBtn.disabled = true;
    
    // Download game files
    const result = await window.launcher.downloadGameFiles(
      gameState.minecraftVersion,
      gameState.fabricVersion
    );
    
    updateProgress(100);
    
    if (result.success) {
      showStatus('Download completed successfully', 'info');
      gameState.downloadComplete = true;
      playBtn.disabled = false;
    } else {
      showStatus(`Download failed: ${result.error}`, 'error');
    }
    
    // Re-enable download button
    downloadBtn.disabled = false;
  } catch (error) {
    downloadBtn.disabled = false;
    showStatus(`Download failed: ${error.message}`, 'error');
    console.error('Download error:', error);
  }
}

// Launch the game
async function launchGame() {
  const username = usernameInput.value.trim();
  
  if (!username) {
    showStatus('Please enter a username', 'error');
    return;
  }
  
  if (!gameState.downloadComplete) {
    showStatus('Please download the game files first', 'error');
    return;
  }
  
  try {
    showStatus('Launching game...', 'info');
    
    // Disable play button during launch
    playBtn.disabled = true;
    
    // Get RAM settings
    const ram = {
      min: ramMinSelect.value,
      max: ramMaxSelect.value
    };
    
    // Launch the game
    const result = await window.launcher.launchGame(
      username,
      gameState.minecraftVersion,
      gameState.fabricVersion,
      ram
    );
    
    if (result.success || result.pid) {
      showStatus(`Game launched successfully! PID: ${result.pid}`, 'info');
    } else {
      showStatus(`Game launch failed: ${result.error}`, 'error');
    }
    
    // Re-enable play button
    playBtn.disabled = false;
  } catch (error) {
    playBtn.disabled = false;
    showStatus(`Game launch failed: ${error.message}`, 'error');
    console.error('Launch error:', error);
  }
}

// Helper Functions
function showStatus(message, type = 'info') {
  statusMessage.textContent = message;
  statusBox.className = 'status show';
  
  if (type === 'error') {
    statusBox.classList.add('status-error');
  } else {
    statusBox.classList.remove('status-error');
  }
}

function hideStatus() {
  statusBox.className = 'status';
}

function updateProgress(percent) {
  progressBar.style.width = `${percent}%`;
}

// Event Listeners
downloadBtn.addEventListener('click', downloadGameFiles);
playBtn.addEventListener('click', launchGame);

// RAM validation
ramMinSelect.addEventListener('change', () => {
  const minValue = ramMinSelect.value;
  const maxValue = ramMaxSelect.value;
  
  // Ensure min RAM is not higher than max RAM
  if (parseInt(minValue) > parseInt(maxValue)) {
    ramMaxSelect.value = minValue;
  }
});

ramMaxSelect.addEventListener('change', () => {
  const minValue = ramMinSelect.value;
  const maxValue = ramMaxSelect.value;
  
  // Ensure max RAM is not lower than min RAM
  if (parseInt(maxValue) < parseInt(minValue)) {
    ramMinSelect.value = maxValue;
  }
});

// Username validation and storage
usernameInput.addEventListener('input', () => {
  // Store username in localStorage
  localStorage.setItem('fabricLauncher.username', usernameInput.value);
});

// Load username from localStorage if available
const savedUsername = localStorage.getItem('fabricLauncher.username');
if (savedUsername) {
  usernameInput.value = savedUsername;
}

// Initialize the launcher on page load
document.addEventListener('DOMContentLoaded', initLauncher);

const updateButton = document.createElement('button');
updateButton.id = 'update-btn';
updateButton.className = 'update-button hidden';
updateButton.textContent = 'Update Available!';

const updateDialog = document.createElement('div');
updateDialog.id = 'update-dialog';
updateDialog.className = 'update-dialog hidden';

// Add update elements to the DOM
document.querySelector('header').appendChild(updateButton);
document.body.appendChild(updateDialog);

// Update state
let updateState = {
  updateAvailable: false,
  updateInfo: null,
  downloadInProgress: false,
  downloadComplete: false,
  updatePath: null
};

// Initialize update system
function initUpdateSystem() {
  // Check for updates on startup
  window.updater.checkForUpdates();
  
  // Set up event listeners for updates
  window.updater.onUpdateAvailable((updateInfo) => {
    updateState.updateAvailable = true;
    updateState.updateInfo = updateInfo;
    showUpdateButton();
  });
  
  window.updater.onUpdateDownloadStarted(() => {
    updateState.downloadInProgress = true;
    showDownloadProgress();
  });
  
  window.updater.onUpdateDownloadProgress((data) => {
    updateDownloadProgress(data.progress);
  });
  
  window.updater.onUpdateDownloadFinished((data) => {
    updateState.downloadInProgress = false;
    updateState.downloadComplete = true;
    updateState.updatePath = data.path;
    showUpdateReadyToInstall();
  });
  
  window.updater.onUpdateReadyToInstall((data) => {
    updateState.updatePath = data.path;
    showRestartButton();
  });
  
  // Handle update button click
  updateButton.addEventListener('click', showUpdateDialog);
}

// Show update button with animation
function showUpdateButton() {
  updateButton.classList.remove('hidden');
  updateButton.classList.add('flash');
}

// Show update dialog with release notes
function showUpdateDialog() {
  const { updateInfo } = updateState;
  
  updateDialog.innerHTML = `
    <div class="update-dialog-content">
      <h2>Update Available!</h2>
      <p>A new version of Fabric Minecraft Launcher is available.</p>
      <p>Current version: ${updateInfo.currentVersion}</p>
      <p>New version: ${updateInfo.newVersion}</p>
      <div class="release-notes">
        <h3>Release Notes:</h3>
        <pre>${updateInfo.releaseNotes}</pre>
      </div>
      <div class="update-buttons">
        <button id="download-update-btn" class="primary">Download Update</button>
        <button id="skip-update-btn" class="secondary">Skip</button>
      </div>
    </div>
  `;
  
  updateDialog.classList.remove('hidden');
  
  // Add event listeners for dialog buttons
  document.getElementById('download-update-btn').addEventListener('click', downloadUpdate);
  document.getElementById('skip-update-btn').addEventListener('click', hideUpdateDialog);
}

// Hide update dialog
function hideUpdateDialog() {
  updateDialog.classList.add('hidden');
}

// Download the update
async function downloadUpdate() {
  try {
    updateDialog.innerHTML = `
      <div class="update-dialog-content">
        <h2>Downloading Update...</h2>
        <div class="progress-container">
          <div id="update-progress-bar" class="progress-bar"></div>
        </div>
        <p id="update-progress-text">0%</p>
      </div>
    `;
    
    await window.updater.downloadUpdate();
  } catch (error) {
    updateDialog.innerHTML = `
      <div class="update-dialog-content">
        <h2>Download Failed</h2>
        <p>Failed to download update: ${error.message}</p>
        <div class="update-buttons">
          <button id="retry-download-btn" class="primary">Retry</button>
          <button id="close-dialog-btn" class="secondary">Close</button>
        </div>
      </div>
    `;
    
    document.getElementById('retry-download-btn').addEventListener('click', downloadUpdate);
    document.getElementById('close-dialog-btn').addEventListener('click', hideUpdateDialog);
  }
}

// Update download progress
function updateDownloadProgress(progress) {
  const progressBar = document.getElementById('update-progress-bar');
  const progressText = document.getElementById('update-progress-text');
  
  if (progressBar && progressText) {
    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${progress}%`;
  }
}

// Show update ready to install message
function showUpdateReadyToInstall() {
  updateDialog.innerHTML = `
    <div class="update-dialog-content">
      <h2>Update Ready to Install</h2>
      <p>The update has been downloaded and is ready to install.</p>
      <p>The application will restart to install the update.</p>
      <div class="update-buttons">
        <button id="install-update-btn" class="primary">Install Now</button>
        <button id="install-later-btn" class="secondary">Install Later</button>
      </div>
    </div>
  `;
  
  document.getElementById('install-update-btn').addEventListener('click', installUpdate);
  document.getElementById('install-later-btn').addEventListener('click', hideUpdateDialog);
}

// Install the update and restart the application
async function installUpdate() {
  try {
    updateDialog.innerHTML = `
      <div class="update-dialog-content">
        <h2>Installing Update...</h2>
        <p>Please wait while the update is being installed.</p>
      </div>
    `;
    
    await window.updater.applyUpdate(updateState.updatePath);
    
    // The app should restart here after the update is applied
  } catch (error) {
    updateDialog.innerHTML = `
      <div class="update-dialog-content">
        <h2>Installation Failed</h2>
        <p>Failed to install update: ${error.message}</p>
        <div class="update-buttons">
          <button id="retry-install-btn" class="primary">Retry</button>
          <button id="close-dialog-btn" class="secondary">Close</button>
        </div>
      </div>
    `;
    
    document.getElementById('retry-install-btn').addEventListener('click', installUpdate);
    document.getElementById('close-dialog-btn').addEventListener('click', hideUpdateDialog);
  }
}

// Show restart button
function showRestartButton() {
  updateButton.textContent = 'Restart to Update';
  updateButton.classList.remove('flash');
  updateButton.classList.add('restart');
  
  // Change click handler to restart the app
  updateButton.removeEventListener('click', showUpdateDialog);
  updateButton.addEventListener('click', installUpdate);
}

// Initialize the update system on page load
document.addEventListener('DOMContentLoaded', () => {
  initLauncher();
  initUpdateSystem();
});