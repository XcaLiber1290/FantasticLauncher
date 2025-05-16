// preload.js
// Secure bridge between renderer and main processes

const { contextBridge, ipcRenderer } = require('electron');

// Expose launcher functions to renderer process
contextBridge.exposeInMainWorld('launcher', {
  initialize: () => ipcRenderer.invoke('launcher:initialize'),
  
  getLatestMinecraftVersion: () => 
    ipcRenderer.invoke('launcher:get-latest-minecraft-version'),
    
  getLatestFabricVersion: (minecraftVersion) => 
    ipcRenderer.invoke('launcher:get-latest-fabric-version', minecraftVersion),
    
  downloadGameFiles: (minecraftVersion, fabricVersion) => 
    ipcRenderer.invoke('launcher:download-game-files', minecraftVersion, fabricVersion),
    
  launchGame: (username, minecraftVersion, fabricVersion, ram) => 
    ipcRenderer.invoke('launcher:launch-game', username, minecraftVersion, fabricVersion, ram),
    
  // New asset verifier functions
  verifyAssets: (minecraftVersion, fabricVersion) => 
    ipcRenderer.invoke('launcher:verify-assets', minecraftVersion, fabricVersion),
    
  fixLibraryConflicts: (conflicts) => 
    ipcRenderer.invoke('launcher:fix-library-conflicts', conflicts),
    
  cleanupBackups: (olderThanDays) => 
    ipcRenderer.invoke('launcher:cleanup-backups', olderThanDays)
});

contextBridge.exposeInMainWorld('updater', {
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  
  applyUpdate: (updatePath) => ipcRenderer.invoke('update:apply', updatePath),
  
  getUpdateInfo: () => ipcRenderer.invoke('update:get-info'),
  
  // Event listeners for update process
  onUpdateAvailable: (callback) => 
    ipcRenderer.on('update-available', (_, updateInfo) => callback(updateInfo)),
    
  onUpdateDownloadStarted: (callback) => 
    ipcRenderer.on('update-download-started', () => callback()),
    
  onUpdateDownloadProgress: (callback) => 
    ipcRenderer.on('update-download-progress', (_, data) => callback(data)),
    
  onUpdateDownloadFinished: (callback) => 
    ipcRenderer.on('update-download-finished', (_, data) => callback(data)),
    
  onUpdateReadyToInstall: (callback) => 
    ipcRenderer.on('update-ready-to-install', (_, data) => callback(data)),
    
  // Remove event listeners when no longer needed
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-download-started');
    ipcRenderer.removeAllListeners('update-download-progress');
    ipcRenderer.removeAllListeners('update-download-finished');
    ipcRenderer.removeAllListeners('update-ready-to-install');
  }
});