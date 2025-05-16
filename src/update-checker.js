// src/update-checker.js - New file to handle update checking and application

const https = require('https');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { version: currentVersion } = require('../package.json');

class UpdateChecker {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.updateInfo = null;
    this.GITHUB_OWNER = 'your-github-username';
    this.GITHUB_REPO = 'fabric-minecraft-launcher';
    this.UPDATE_CHECK_INTERVAL = 3600000; // Check every hour
    this.UPDATE_JSON_PATH = 'updates.json';
    
    // Path to store downloaded updates
    this.updateDownloadPath = path.join(app.getPath('userData'), 'updates');
    
    // Create updates directory if it doesn't exist
    if (!fs.existsSync(this.updateDownloadPath)) {
      fs.mkdirSync(this.updateDownloadPath, { recursive: true });
    }
  }
  
  /**
   * Start periodic update checks
   */
  startUpdateChecks() {
    // Check immediately on startup
    this.checkForUpdates();
    
    // Then check periodically
    setInterval(() => this.checkForUpdates(), this.UPDATE_CHECK_INTERVAL);
  }
  
  /**
   * Check for updates by comparing current version with latest from GitHub
   */
  async checkForUpdates() {
    try {
      const updateData = await this.fetchUpdateData();
      
      if (!updateData) {
        console.log('No update data available');
        return false;
      }
      
      if (this.isNewerVersion(updateData.latestVersion, currentVersion)) {
        console.log(`Update available: ${currentVersion} → ${updateData.latestVersion}`);
        this.updateInfo = {
          currentVersion,
          newVersion: updateData.latestVersion,
          releaseNotes: updateData.releaseNotes,
          publishedDate: updateData.publishedDate,
          downloadUrl: updateData.downloadUrl
        };
        
        // Notify renderer process about update
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('update-available', this.updateInfo);
        }
        
        return true;
      } else {
        console.log('No updates available');
        return false;
      }
    } catch (err) {
      console.error('Failed to check for updates:', err);
      return false;
    }
  }
  
  /**
   * Fetch update data from GitHub
   */
  async fetchUpdateData() {
    return new Promise((resolve, reject) => {
      const apiUrl = `https://api.github.com/repos/${this.GITHUB_OWNER}/${this.GITHUB_REPO}/contents/${this.UPDATE_JSON_PATH}`;
      
      const request = https.get(apiUrl, {
        headers: {
          'User-Agent': `FabricLauncher/${currentVersion}`
        }
      }, (res) => {
        if (res.statusCode === 404) {
          // Update file doesn't exist yet
          console.log('Update file not found on GitHub');
          resolve(null);
          return;
        }
        
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned status code ${res.statusCode}`));
          return;
        }
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            // GitHub API returns base64 encoded content
            const decodedContent = Buffer.from(response.content, 'base64').toString('utf8');
            const updateData = JSON.parse(decodedContent);
            resolve(updateData);
          } catch (err) {
            reject(err);
          }
        });
      });
      
      request.on('error', reject);
      request.end();
    });
  }
  
  /**
   * Compare version strings to determine if newVersion is newer than currentVersion
   */
  isNewerVersion(newVersion, currentVersion) {
    const newParts = newVersion.split('.').map(Number);
    const currentParts = currentVersion.split('.').map(Number);
    
    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
      const newPart = newParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (newPart > currentPart) {
        return true;
      }
      if (newPart < currentPart) {
        return false;
      }
    }
    
    return false; // Versions are equal
  }
  
  /**
   * Download the update
   */
  async downloadUpdate() {
    if (!this.updateInfo || !this.updateInfo.downloadUrl) {
      throw new Error('No update available to download');
    }
    
    const updateFileName = `update-${this.updateInfo.newVersion}.zip`;
    const updateFilePath = path.join(this.updateDownloadPath, updateFileName);
    
    return new Promise((resolve, reject) => {
      // Send download started event to renderer
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-download-started');
      }
      
      const file = fs.createWriteStream(updateFilePath);
      
      https.get(this.updateInfo.downloadUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download update: ${res.statusCode}`));
          return;
        }
        
        // Get total size for progress calculation
        const totalSize = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedSize = 0;
        
        res.pipe(file);
        
        // Report download progress
        res.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const progress = totalSize ? Math.floor((downloadedSize / totalSize) * 100) : -1;
          
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('update-download-progress', { progress });
          }
        });
        
        file.on('finish', () => {
          file.close(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('update-download-finished', { 
                path: updateFilePath,
                version: this.updateInfo.newVersion
              });
            }
            resolve({ path: updateFilePath, version: this.updateInfo.newVersion });
          });
        });
      }).on('error', (err) => {
        fs.unlink(updateFilePath, () => {}); // Delete partial file
        reject(err);
      });
      
      file.on('error', (err) => {
        fs.unlink(updateFilePath, () => {}); // Delete partial file
        reject(err);
      });
    });
  }
  
  /**
   * Apply downloaded update (platform specific implementation required)
   */
  async applyUpdate(updateFilePath) {
    // This is a simplified implementation - actual implementation depends on your app's architecture
    // For Electron apps, you might use electron-updater or a custom update mechanism
    
    if (!fs.existsSync(updateFilePath)) {
      throw new Error('Update file not found');
    }
    
    // Notify the main process to install update on next restart
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-ready-to-install', { path: updateFilePath });
    }
    
    // Return success to indicate update is ready to apply
    return { success: true, path: updateFilePath };
  }
}

module.exports = UpdateChecker;