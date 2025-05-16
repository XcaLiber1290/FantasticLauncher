// main.js
// Main process file for the Fabric Minecraft Launcher application

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const launcher = require('./src/launcher');
const assetVerifier = require('./src/asset-verifier');

// Global reference to the mainWindow
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Uncomment to open DevTools on startup
  // mainWindow.webContents.openDevTools();
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Set up IPC handlers for launcher functions
ipcMain.handle('launcher:initialize', async () => {
  return await launcher.initialize();
});

ipcMain.handle('launcher:get-latest-minecraft-version', async () => {
  return await launcher.getLatestMinecraftVersion();
});

ipcMain.handle('launcher:get-latest-fabric-version', async (event, minecraftVersion) => {
  return await launcher.getLatestFabricVersion(minecraftVersion);
});

ipcMain.handle('launcher:download-game-files', async (event, minecraftVersion, fabricVersion) => {
  return await launcher.downloadGameFiles(minecraftVersion, fabricVersion);
});

ipcMain.handle('launcher:launch-game', async (event, username, minecraftVersion, fabricVersion, ram) => {
  return await launcher.launchGame(username, minecraftVersion, fabricVersion, ram);
});

// New IPC handlers for asset verifier
ipcMain.handle('launcher:verify-assets', async (event, minecraftVersion, fabricVersion) => {
  await assetVerifier.initialize();
  return await assetVerifier.analyzeVersionFiles(minecraftVersion, fabricVersion);
});

ipcMain.handle('launcher:fix-library-conflicts', async (event, conflicts) => {
  return await assetVerifier.fixConflicts(conflicts);
});

// Handler for cleaning up old backups
ipcMain.handle('launcher:cleanup-backups', async (event, olderThanDays) => {
  return await assetVerifier.cleanupBackups(olderThanDays || 7);
});

ipcMain.handle('update:check', async () => {
  return await updateChecker.checkForUpdates();
});

ipcMain.handle('update:download', async () => {
  return await updateChecker.downloadUpdate();
});

ipcMain.handle('update:apply', async (event, updatePath) => {
  return await updateChecker.applyUpdate(updatePath);
});

ipcMain.handle('update:get-info', () => {
  return updateChecker.updateInfo;
});