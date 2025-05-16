// launcher.js - FIXED VERSION
const fs = require('fs');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');
const os = require('os');
const crypto = require('crypto');
const utils = require('./utils');
const game = require('./game');
const assetVerifier = require('./asset-verifier');

/**
 * Main launcher class that coordinates the downloading and launching process
 */
class Launcher {
  constructor() {
    // Basic configuration
    this.APP_NAME = 'Fabric Minecraft Launcher';
    this.APP_VERSION = '1.0.0';
    
    // Paths
    if (process.platform === 'win32') {
      // Windows - use %APPDATA%\Roaming\.minecraft
      this.MINECRAFT_DIR = path.join(process.env.APPDATA, '.minecraft');
    } else if (process.platform === 'darwin') {
      // macOS - use ~/Library/Application Support/minecraft
      this.MINECRAFT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
    } else {
      // Linux and others - use ~/.minecraft
      this.MINECRAFT_DIR = path.join(os.homedir(), '.minecraft');
    }
    
    // Derived paths
    this.VERSIONS_DIR = path.join(this.MINECRAFT_DIR, 'versions');
    this.LIBRARIES_DIR = path.join(this.MINECRAFT_DIR, 'libraries');
    this.ASSETS_DIR = path.join(this.MINECRAFT_DIR, 'assets');
    this.ASSETS_INDEXES_DIR = path.join(this.ASSETS_DIR, 'indexes');
    this.ASSETS_OBJECTS_DIR = path.join(this.ASSETS_DIR, 'objects');
    
    // URLs
    this.FABRIC_META_URL = 'https://meta.fabricmc.net/v2/versions';
    this.FABRIC_META_URL_FALLBACK = 'https://fabricmc.net/meta/v2/versions';
    this.MINECRAFT_VERSION_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
    this.MINECRAFT_VERSION_MANIFEST_FALLBACK = 'https://piston-meta.mojang.com/mc/game/version_manifest.json';
    
    // Maven repositories list
    this.MAVEN_REPOSITORIES = [
      'https://maven.fabricmc.net',
      'https://repo1.maven.org/maven2',
      'https://libraries.minecraft.net',
      'https://jitpack.io'
    ];
    
    // Game settings
    this.RAM_MIN = '1G';
    this.RAM_MAX = '2G';
    
    // Track which libraries have already been downloaded to prevent duplicates
    this.downloadedLibraries = new Set();
    
    // Track download progress
    this.downloadProgress = {
      total: 0,
      completed: 0,
      current: ''
    };
    
    // Debug logging
    this.debug = true;
  }

  // Log with timestamp
  log(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    if (isError) {
      console.error(logMessage);
    } else if (this.debug) {
      console.log(logMessage);
    }
  }

  /**
   * Initialize the launcher
   */
  async initialize() {
  try {
    // Create basic directories if they don't exist
    const dirs = [
      this.MINECRAFT_DIR, 
      this.VERSIONS_DIR, 
      this.LIBRARIES_DIR, 
      this.ASSETS_DIR,
      this.ASSETS_INDEXES_DIR,
      this.ASSETS_OBJECTS_DIR
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    // Initialize asset verifier
    await assetVerifier.initialize();
    
    // ADD THIS NEW LINE - Patch game.js to use comprehensive classpath
    await assetVerifier.patchGameClasspathFunction();
    
    this.log("Launcher initialized successfully");
    return { status: 'initialized' };
  } catch (err) {
    this.log(`Failed to initialize launcher: ${err.message}`, true);
    return { status: 'failed', error: err.message };
  }
}

  /**
   * Get the latest Minecraft version from version manifest
   */
  async getLatestMinecraftVersion() {
    try {
      const manifestUrl = this.MINECRAFT_VERSION_MANIFEST;
      const manifestFallbackUrl = this.MINECRAFT_VERSION_MANIFEST_FALLBACK;
      
      const manifest = JSON.parse(
        await utils.httpGet(manifestUrl, manifestFallbackUrl)
      );
      
      return manifest.latest.release;
    } catch (err) {
      this.log(`Failed to get latest Minecraft version: ${err.message}`, true);
      // Return a fallback version
      return '1.20.4';
    }
  }

  /**
   * Get the latest Fabric version for a Minecraft version from Fabric API
   */
  async getLatestFabricVersion(minecraftVersion) {
    try {
      const url = `${this.FABRIC_META_URL}/loader/${minecraftVersion}`;
      const fallbackUrl = `${this.FABRIC_META_URL_FALLBACK}/loader/${minecraftVersion}`;
      
      const fabricData = JSON.parse(await utils.httpGet(url, fallbackUrl));
      return fabricData[0].loader.version; // Get the latest loader version
    } catch (err) {
      this.log(`Failed to get latest Fabric version: ${err.message}`, true);
      // Return a fallback version
      return '0.15.0';
    }
  }

  /**
   * Verifies a file against its SHA1 hash
   */
  async verifyHash(filePath, expectedHash) {
    try {
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha1');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', (data) => hash.update(data));
        
        stream.on('end', () => {
          const fileHash = hash.digest('hex');
          resolve(fileHash.toLowerCase() === expectedHash.toLowerCase());
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
      });
    } catch (err) {
      this.log(`Error verifying file hash: ${err.message}`, true);
      return false;
    }
  }

  /**
   * Download file with retries
   */
  async downloadFile(url, destination, expectedHash = null) {
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    // Create a temp file name
    const tempFile = `${destination}.tmp`;
    
    try {
      // Update progress tracking
      this.downloadProgress.current = path.basename(destination);
      
      // Check if file already exists and has correct hash
      if (fs.existsSync(destination) && expectedHash) {
        const isValid = await this.verifyHash(destination, expectedHash);
        if (isValid) {
          this.log(`File already exists with valid hash: ${destination}`);
          this.downloadProgress.completed++;
          return destination;
        }
      }
      
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempFile);
        
        const request = https.get(url, (response) => {
          // Handle redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            file.close();
            fs.unlinkSync(tempFile);
            this.downloadFile(response.headers.location, destination, expectedHash)
              .then(resolve)
              .catch(reject);
            return;
          }
          
          // Handle successful response
          if (response.statusCode >= 200 && response.statusCode < 300) {
            response.pipe(file);
            
            file.on('finish', () => {
              file.close(() => {
                try {
                  // Rename temp file to actual destination
                  fs.renameSync(tempFile, destination);
                  
                  // Increment progress
                  this.downloadProgress.completed++;
                  
                  resolve(destination);
                } catch (err) {
                  reject(err);
                }
              });
            });
            
            return;
          }
          
          // Handle error status codes
          file.close(() => {
            try {
              fs.unlinkSync(tempFile);
            } catch (e) {
              // Ignore error
            }
            reject(new Error(`HTTP status code ${response.statusCode}`));
          });
        });
        
        request.on('error', (err) => {
          file.close();
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // Ignore error
          }
          reject(err);
        });
        
        file.on('error', (err) => {
          file.close();
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // Ignore error
          }
          reject(err);
        });
      });
      
      // Verify hash after download if expectedHash provided
      if (expectedHash) {
        const isValid = await this.verifyHash(destination, expectedHash);
        if (!isValid) {
          throw new Error(`Hash verification failed for ${destination}`);
        }
      }
      
      this.log(`Downloaded ${url} to ${destination}`);
      return destination;
    } catch (err) {
      this.log(`Download error for ${url}: ${err.message}`, true);
      throw err;
    }
  }
  
  /**
   * Load the base game JSON file
   */
  async loadMinecraftJson(minecraftVersion) {
    const versionDir = path.join(this.VERSIONS_DIR, minecraftVersion);
    const jsonPath = path.join(versionDir, `${minecraftVersion}.json`);
    
    if (fs.existsSync(jsonPath)) {
      this.log(`Using cached Minecraft ${minecraftVersion} JSON`);
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }
    
    // We need to download the JSON file
    this.log(`Downloading Minecraft ${minecraftVersion} JSON`);
    
    // Get the version manifest to find the JSON URL
    const manifest = JSON.parse(
      await utils.httpGet(
        this.MINECRAFT_VERSION_MANIFEST,
        this.MINECRAFT_VERSION_MANIFEST_FALLBACK
      )
    );
    
    const versionInfo = manifest.versions.find(v => v.id === minecraftVersion);
    
    if (!versionInfo) {
      throw new Error(`Minecraft version ${minecraftVersion} not found`);
    }
    
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }
    
    // Download the JSON file
    const versionJson = await utils.httpGet(versionInfo.url);
    fs.writeFileSync(jsonPath, versionJson);
    
    return JSON.parse(versionJson);
  }

  /**
   * Load the Fabric JSON file
   */
  async loadFabricJson(minecraftVersion, fabricVersion) {
    const fabricVersionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
    const fabricVersionDir = path.join(this.VERSIONS_DIR, fabricVersionId);
    const jsonPath = path.join(fabricVersionDir, `${fabricVersionId}.json`);
    
    if (fs.existsSync(jsonPath)) {
      this.log(`Using cached Fabric ${fabricVersionId} JSON`);
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }
    
    // We need to download the JSON file
    this.log(`Downloading Fabric ${fabricVersionId} JSON`);
    
    if (!fs.existsSync(fabricVersionDir)) {
      fs.mkdirSync(fabricVersionDir, { recursive: true });
    }
    
    // Get the fabric JSON URL
    const fabricMetaUrl = `${this.FABRIC_META_URL}/loader/${minecraftVersion}/${fabricVersion}/profile/json`;
    const fabricMetaUrlFallback = `${this.FABRIC_META_URL_FALLBACK}/loader/${minecraftVersion}/${fabricVersion}/profile/json`;
    
    const fabricJson = await utils.httpGet(fabricMetaUrl, fabricMetaUrlFallback);
    fs.writeFileSync(jsonPath, fabricJson);
    
    return JSON.parse(fabricJson);
  }

  /**
 * Transfer Fabric loader JAR from libraries to versions directory
 * @param {string} minecraftVersion - Minecraft version
 * @param {string} fabricVersion - Fabric loader version
 * @returns {Promise<object>} - Result of the transfer operation
 */
async transferFabricLoaderJar(minecraftVersion, fabricVersion) {
  try {
    // Construct paths
    const fabricVersionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
    const fabricVersionDir = path.join(this.VERSIONS_DIR, fabricVersionId);
    const targetJarPath = path.join(fabricVersionDir, `${fabricVersionId}.jar`);
    
    // Source path in libraries
    const sourceJarPath = path.join(
      this.LIBRARIES_DIR,
      'net',
      'fabricmc',
      'fabric-loader',
      fabricVersion,
      `fabric-loader-${fabricVersion}.jar`
    );
    
    // Check if already in the correct location
    if (fs.existsSync(targetJarPath)) {
      this.log(`Fabric loader JAR already exists in versions directory: ${targetJarPath}`);
      return { success: true, path: targetJarPath };
    }
    
    // Check if source exists
    if (!fs.existsSync(sourceJarPath)) {
      this.log(`Source Fabric loader JAR not found at: ${sourceJarPath}`, true);
      return { success: false, error: 'Source JAR not found', sourcePath: sourceJarPath };
    }
    
    // Create the versions directory if it doesn't exist
    if (!fs.existsSync(fabricVersionDir)) {
      fs.mkdirSync(fabricVersionDir, { recursive: true });
    }
    
    // Copy the JAR file
    fs.copyFileSync(sourceJarPath, targetJarPath);
    this.log(`Transferred Fabric loader JAR from ${sourceJarPath} to ${targetJarPath}`);
    
    return { success: true, path: targetJarPath };
  } catch (err) {
    this.log(`Failed to transfer Fabric loader JAR: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}

  /**
   * Download and prepare all game files with conflict resolution
   */
  async downloadGameFiles(minecraftVersion, fabricVersion) {
  try {
    this.log(`Starting download of game files for Minecraft ${minecraftVersion} with Fabric ${fabricVersion}`);
    
    // Reset progress tracking
    this.downloadProgress = {
      total: 0,
      completed: 0,
      current: ''
    };
    
    // Step 1: Initialize asset verifier
    this.log("Step 1: Initializing asset verifier");
    await assetVerifier.initialize();
    
    // Step 2: Initialize tracking
    this.downloadedLibraries = new Set();
    
    // Step 3: Load Minecraft JSON
    this.log("Step 2: Loading Minecraft JSON");
    const minecraftJson = await this.loadMinecraftJson(minecraftVersion);
    this.log("Minecraft JSON loaded successfully");
    
    // Step 4: Load Fabric JSON
    this.log("Step 3: Loading Fabric JSON");
    const fabricJson = await this.loadFabricJson(minecraftVersion, fabricVersion);
    this.log("Fabric JSON loaded successfully");
    
    // Step 5: Pre-process JSON files to remove conflicting libraries
    this.log("Step 4: Pre-processing JSON files to resolve library conflicts");
    const modifyResult = await assetVerifier.processVersionFiles(minecraftVersion, fabricVersion);
    
    if (!modifyResult.success) {
      this.log("Warning: Failed to process version files for conflicts", true);
    } else {
      this.log(`Modified JSON files to resolve ${modifyResult.conflicts} conflicts`);
    }
    
    // Step 6: Calculate total downloads for progress tracking
    let totalDownloads = 0;
    
    // Count Minecraft libraries
    if (minecraftJson.libraries) {
      totalDownloads += minecraftJson.libraries.length;
    }
    
    // Count Fabric libraries
    if (fabricJson.libraries) {
      totalDownloads += fabricJson.libraries.length;
    }
    
    // Count client JAR
    if (minecraftJson.downloads?.client) {
      totalDownloads += 1;
    }
    
    // Count assets
    if (minecraftJson.assetIndex) {
      // We'll add more to the total once we load the asset index
      totalDownloads += 1; // For the asset index itself
    }
    
    this.downloadProgress.total = totalDownloads;
    
    // Step 7: Download dependencies from JSON files
    this.log("Step 5: Downloading dependencies from JSON files");
    const downloadResults = await this.downloadDependencies(minecraftJson, fabricJson);
    
    // Step 8: Transfer Fabric loader JAR to versions directory
    this.log("Step 6: Transferring Fabric loader JAR to versions directory");
    await this.transferFabricLoaderJar(minecraftVersion, fabricVersion);
    
    // Step 9: Restore original JSON files
    this.log("Step 7: Restoring original JSON files");
    const restoreResult = await assetVerifier.restoreJsonFiles();
    
    if (!restoreResult.success) {
      this.log("Warning: Failed to restore original JSON files", true);
    } else {
      this.log(`Restored ${restoreResult.restored.length} JSON files`);
    }
    
    // Step 10: Verify Fabric loader main class exists
    this.log("Step 8: Verifying Fabric loader main class");
    // Update the game module to use the launcher paths
    game.setLauncherPaths(this);
    this.log("Fixing asset loading structure...");
    const assetIndex = minecraftJson.assetIndex?.id || minecraftVersion;
    await assetVerifier.fixAssetLoading(assetIndex);
    
    const mainClassExists = await assetVerifier.verifyFabricMainClass(fabricJson.mainClass);
    if (!mainClassExists) {
      this.log(`Warning: Fabric main class ${fabricJson.mainClass} not found in libraries! The game may not launch correctly.`, true);
    }
    
    return { 
      success: true, 
      results: downloadResults,
      progress: {
        total: this.downloadProgress.total,
        completed: this.downloadProgress.completed
      }
    };
  } catch (err) {
    this.log(`Failed to download game files: ${err.message}`, true);
    
    // Make sure to restore JSON files even if there's an error
    try {
      await assetVerifier.restoreJsonFiles();
    } catch (restoreErr) {
      this.log(`Error restoring JSON files: ${restoreErr.message}`, true);
    }
    
    return { success: false, error: err.message };
  }
}

/**
 * Transfer Fabric loader JAR from libraries to versions directory
 * @param {string} minecraftVersion - Minecraft version
 * @param {string} fabricVersion - Fabric loader version
 * @returns {Promise<object>} - Result of the transfer operation
 */
async transferFabricLoaderJar(minecraftVersion, fabricVersion) {
  try {
    // Construct paths
    const fabricVersionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
    const fabricVersionDir = path.join(this.VERSIONS_DIR, fabricVersionId);
    const targetJarPath = path.join(fabricVersionDir, `${fabricVersionId}.jar`);
    
    // Source path in libraries
    const sourceJarPath = path.join(
      this.LIBRARIES_DIR,
      'net',
      'fabricmc',
      'fabric-loader',
      fabricVersion,
      `fabric-loader-${fabricVersion}.jar`
    );
    
    // Check if already in the correct location
    if (fs.existsSync(targetJarPath)) {
      this.log(`Fabric loader JAR already exists in versions directory: ${targetJarPath}`);
      return { success: true, path: targetJarPath };
    }
    
    // Check if source exists
    if (!fs.existsSync(sourceJarPath)) {
      this.log(`Source Fabric loader JAR not found at: ${sourceJarPath}`, true);
      
      // Try to download directly to versions directory
      this.log("Attempting to download Fabric loader JAR directly to versions directory...");
      return await this.downloadFabricLoaderJar(minecraftVersion, fabricVersion);
    }
    
    // Create the versions directory if it doesn't exist
    if (!fs.existsSync(fabricVersionDir)) {
      fs.mkdirSync(fabricVersionDir, { recursive: true });
    }
    
    // Copy the JAR file
    fs.copyFileSync(sourceJarPath, targetJarPath);
    this.log(`Transferred Fabric loader JAR from ${sourceJarPath} to ${targetJarPath}`);
    
    return { success: true, path: targetJarPath };
  } catch (err) {
    this.log(`Failed to transfer Fabric loader JAR: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}

/**
 * Download Fabric loader JAR directly to versions directory
 * @param {string} minecraftVersion - Minecraft version
 * @param {string} fabricVersion - Fabric loader version
 * @returns {Promise<object>} - Result of the download operation
 */
async downloadFabricLoaderJar(minecraftVersion, fabricVersion) {
  try {
    const fabricVersionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
    const fabricVersionDir = path.join(this.VERSIONS_DIR, fabricVersionId);
    const jarPath = path.join(fabricVersionDir, `${fabricVersionId}.jar`);
    
    // Ensure the versions directory exists
    if (!fs.existsSync(fabricVersionDir)) {
      fs.mkdirSync(fabricVersionDir, { recursive: true });
    }
    
    // Get the download URL from Fabric meta API
    const fabricMetaUrl = `${this.FABRIC_META_URL}/loader/${minecraftVersion}/${fabricVersion}`;
    const fabricMetaFallbackUrl = `${this.FABRIC_META_URL_FALLBACK}/loader/${minecraftVersion}/${fabricVersion}`;
    
    const loaderData = JSON.parse(await utils.httpGet(fabricMetaUrl, fabricMetaFallbackUrl));
    
    if (!loaderData || !loaderData.loader || !loaderData.loader.maven) {
      throw new Error(`Failed to get loader Maven information from Fabric API`);
    }
    
    // Parse the Maven coordinates
    const mavenCoords = loaderData.loader.maven;
    const [group, artifact, version] = mavenCoords.split(':');
    
    if (!group || !artifact || !version) {
      throw new Error(`Invalid Maven coordinates: ${mavenCoords}`);
    }
    
    // Try each Maven repository to download the JAR
    const repositories = [
      'https://maven.fabricmc.net/',
      'https://repo1.maven.org/maven2/',
      'https://libraries.minecraft.net/'
    ];
    
    const groupPath = group.replace(/\./g, '/');
    const jarName = `${artifact}-${version}.jar`;
    let downloaded = false;
    
    for (const repo of repositories) {
      try {
        const url = `${repo}${groupPath}/${artifact}/${version}/${jarName}`;
        
        this.log(`Trying to download Fabric loader JAR from ${url}`);
        await this.downloadFile(url, jarPath);
        
        if (fs.existsSync(jarPath)) {
          const stats = fs.statSync(jarPath);
          if (stats.size > 0) {
            this.log(`Successfully downloaded Fabric loader JAR to versions directory`);
            downloaded = true;
            break;
          }
        }
      } catch (err) {
        this.log(`Failed to download from ${repo}: ${err.message}`, true);
        // Continue to next repository
      }
    }
    
    if (!downloaded) {
      throw new Error(`Failed to download Fabric loader JAR from all repositories`);
    }
    
    return { success: true, path: jarPath };
  } catch (err) {
    this.log(`Failed to download Fabric loader JAR: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}

  /**
   * Download dependencies defined in the JSON files with deduplication
   */
  async downloadDependencies(minecraftJson, fabricJson) {
    const results = {
      minecraft: { libraries: [], client: null, assets: null },
      fabric: { libraries: [] }
    };
    
    // 1. Download Minecraft client JAR
    if (minecraftJson.downloads && minecraftJson.downloads.client) {
      results.minecraft.client = await this.downloadClient(minecraftJson);
    }
    
    // 2. Download Minecraft libraries (direct download with hash verification)
    if (minecraftJson.libraries) {
      results.minecraft.libraries = await this.downloadMinecraftLibraries(minecraftJson.libraries);
    }
    
    // 3. Download Fabric libraries (Maven style)
    if (fabricJson.libraries) {
      results.fabric.libraries = await this.downloadFabricLibraries(fabricJson.libraries);
    }
    
    // 4. Download assets
    if (minecraftJson.assetIndex) {
      results.minecraft.assets = await this.downloadAssets(minecraftJson);
    }
    
    return results;
  }
  
  /**
   * Download client JAR
   */
  async downloadClient(versionJson) {
    try {
      const { downloads } = versionJson;
      const clientJarPath = path.join(this.VERSIONS_DIR, versionJson.id, `${versionJson.id}.jar`);
      
      // Check if file already exists and has correct hash
      if (fs.existsSync(clientJarPath)) {
        const isValid = await this.verifyHash(clientJarPath, downloads.client.sha1);
        if (isValid) {
          this.log(`Client JAR already exists with valid hash: ${clientJarPath}`);
          this.downloadProgress.completed++;
          return { path: clientJarPath, success: true };
        }
      }
      
      this.log(`Downloading client JAR from ${downloads.client.url}`);
      await this.downloadFile(downloads.client.url, clientJarPath, downloads.client.sha1);
      
      return { path: clientJarPath, success: true };
    } catch (err) {
      this.log(`Failed to download client: ${err.message}`, true);
      return { path: null, success: false, error: err.message };
    }
  }

  /**
   * Download Minecraft libraries (direct download with URL in JSON)
   */
  async downloadMinecraftLibraries(libraries) {
  if (!libraries || !Array.isArray(libraries)) {
    this.log('No Minecraft libraries to download or invalid libraries data', true);
    return [];
  }
  
  this.log(`Starting download of ${libraries.length} Minecraft libraries...`);
  
  const downloadedLibs = [];
  const failedLibs = [];
  
  for (const library of libraries) {
    try {
      // Skip if this library has rules and they don't apply
      if (library.rules && !this.shouldUseLibrary(library)) {
        this.log(`Skipping library due to rules: ${library.name || 'unknown'}`);
        this.downloadProgress.completed++;
        continue;
      }

      // IMPORTANT: This is the key fix - check what's available and use the right method
      if (library.downloads?.artifact?.url) {
        // Use the direct download with URL approach
        await this.downloadMinecraftLibraryArtifact(library, downloadedLibs, failedLibs);
      } 
      else if (library.name) {
        // Use the Maven coordinate approach
        await this.downloadLibraryByName(library, downloadedLibs, failedLibs);
      }
      else {
        this.log(`Library has neither downloads.artifact.url nor name: ${JSON.stringify(library).substring(0, 100)}...`, true);
        this.downloadProgress.completed++;
      }
      
      // Handle native libraries (OS-specific) if available
      if (library.downloads?.classifiers) {
        await this.downloadMinecraftNativeLibrary(library, downloadedLibs, failedLibs);
      }
    } catch (err) {
      this.log(`Error processing library ${library.name || 'unknown'}: ${err.message}`, true);
      failedLibs.push({ name: library.name || 'unknown', error: err.message });
      this.downloadProgress.completed++;
    }
  }
  
  this.log(`Downloaded ${downloadedLibs.length} Minecraft libraries successfully`);
  if (failedLibs.length > 0) {
    this.log(`Failed to download ${failedLibs.length} Minecraft libraries`, true);
  }
  
  return downloadedLibs;
}

  // Add this new method to your launcher.js file
  async downloadLibraryByName(library, downloadedLibs, failedLibs) {
  try {
    // Parse Maven coordinates from name
    const [group, artifact, version] = library.name.split(':');
    if (!group || !artifact || !version) {
      this.log(`Invalid Maven coordinates: ${library.name}`, true);
      this.downloadProgress.completed++;
      return;
    }
    
    // Skip if already downloaded
    if (this.downloadedLibraries.has(library.name)) {
      this.log(`Skipping already downloaded library: ${library.name}`);
      this.downloadProgress.completed++;
      return;
    }
    
    // Construct paths
    const groupPath = group.replace(/\./g, '/');
    const jarName = `${artifact}-${version}.jar`;
    const relativePath = `${groupPath}/${artifact}/${version}/${jarName}`;
    const libraryPath = path.join(this.LIBRARIES_DIR, relativePath);
    
    // Create directory structure
    const libraryDir = path.dirname(libraryPath);
    if (!fs.existsSync(libraryDir)) {
      fs.mkdirSync(libraryDir, { recursive: true });
    }
    
    // Check if file already exists
    if (fs.existsSync(libraryPath)) {
      const stats = fs.statSync(libraryPath);
      if (stats.size > 0) {
        this.log(`Library already exists: ${library.name}`);
        this.downloadedLibraries.add(library.name);
        downloadedLibs.push({ path: relativePath, success: true });
        this.downloadProgress.completed++;
        return;
      }
    }
    
    // Try each repository until download succeeds
    const repositories = [
      'https://libraries.minecraft.net/',
      'https://repo1.maven.org/maven2/',
      'https://maven.fabricmc.net/'
    ];
    
    // Add custom URL if provided in library
    if (library.url) {
      let baseUrl = library.url;
      if (!baseUrl.endsWith('/')) {
        baseUrl += '/';
      }
      repositories.unshift(baseUrl); // Try the custom URL first
    }
    
    let downloadSucceeded = false;
    let error = null;
    
    for (const repo of repositories) {
      try {
        const url = `${repo}${groupPath}/${artifact}/${version}/${jarName}`;
        
        this.log(`Trying to download ${library.name} from ${url}`);
        await this.downloadFile(url, libraryPath);
        
        // Verify download
        if (fs.existsSync(libraryPath)) {
          const stats = fs.statSync(libraryPath);
          if (stats.size > 0) {
            this.log(`Successfully downloaded ${library.name}`);
            this.downloadedLibraries.add(library.name);
            downloadedLibs.push({ path: relativePath, success: true });
            downloadSucceeded = true;
            break;
          } else {
            this.log(`Downloaded empty file for ${library.name} from ${url}`, true);
            try {
              fs.unlinkSync(libraryPath);
            } catch (err) {
              // Ignore error
            }
          }
        }
      } catch (err) {
        this.log(`Failed to download ${library.name} from ${repo}: ${err.message}`, true);
        error = err;
        // Continue to next repository
      }
    }
    
    if (!downloadSucceeded) {
      this.log(`Failed to download library ${library.name} from all repositories`, true);
      failedLibs.push({ name: library.name, error: error ? error.message : 'Unknown error' });
    }
    
    this.downloadProgress.completed++;
  } catch (err) {
    this.log(`Error downloading library by name ${library.name}: ${err.message}`, true);
    failedLibs.push({ name: library.name || 'unknown', error: err.message });
    this.downloadProgress.completed++;
  }
}

  /**
   * Download a single Minecraft library artifact
   */
  async downloadMinecraftLibraryArtifact(library, downloadedLibs, failedLibs) {
  try {
    if (!library.downloads?.artifact?.url) {
      this.log(`Missing URL for library ${library.name || 'unknown'}`, true);
      this.downloadProgress.completed++;
      return;
    }

    const artifact = library.downloads.artifact;
    
    // Determine the library path - either from the artifact path or generate from name
    let libPath;
    if (artifact.path) {
      // Use the provided path if available
      libPath = artifact.path;
    } else if (library.name) {
      // Generate path from Maven coordinates (group:artifact:version)
      const [group, artifactId, version] = library.name.split(':');
      
      // Skip if not a valid Maven coordinate
      if (!group || !artifactId || !version) {
        this.log(`Invalid Maven coordinates: ${library.name}`, true);
        this.downloadProgress.completed++;
        return;
      }
      
      // Replace dots in group with slashes to create path
      const groupPath = group.replace(/\./g, '/');
      // Form jar name from artifact ID and version
      const jarName = `${artifactId}-${version}.jar`;
      // Combine into a full relative path
      libPath = `${groupPath}/${artifactId}/${version}/${jarName}`;
    } else {
      this.log(`Cannot determine path for library: missing both path and name`, true);
      this.downloadProgress.completed++;
      return;
    }
    
    // Use a unique identifier for tracking downloaded libraries
    const libraryId = library.name || libPath;
    
    // Skip if already downloaded
    if (this.downloadedLibraries.has(libraryId)) {
      this.log(`Skipping already downloaded library: ${libraryId}`);
      this.downloadProgress.completed++;
      return;
    }
    
    // Full path to where the library should be saved
    const libraryPath = path.join(this.LIBRARIES_DIR, libPath);
    
    // Create directory for the library if it doesn't exist
    const libraryDir = path.dirname(libraryPath);
    if (!fs.existsSync(libraryDir)) {
      fs.mkdirSync(libraryDir, { recursive: true });
    }
    
    // Check if file already exists and has correct hash
    if (fs.existsSync(libraryPath) && artifact.sha1) {
      const isValid = await this.verifyHash(libraryPath, artifact.sha1);
      if (isValid) {
        this.log(`Library already exists with valid hash: ${libPath}`);
        this.downloadedLibraries.add(libraryId);
        downloadedLibs.push({ path: libPath, success: true });
        this.downloadProgress.completed++;
        return;
      }
    }
    
    // Download the library
    this.log(`Downloading library ${library.name} from ${artifact.url}`);
    await this.downloadFile(artifact.url, libraryPath, artifact.sha1);
    
    // Mark as downloaded
    this.downloadedLibraries.add(libraryId);
    downloadedLibs.push({ path: libPath, success: true });
    this.downloadProgress.completed++;
  } catch (err) {
    this.log(`Failed to download library ${library.name || 'unknown'}: ${err.message}`, true);
    failedLibs.push({ name: library.name || 'unknown', error: err.message });
    this.downloadProgress.completed++;
  }
}

  /**
   * Download native OS-specific libraries
   */
  async downloadMinecraftNativeLibrary(library, downloadedLibs, failedLibs) {
    const nativeOS = this.getNativeOS();
    const nativeClassifier = library.natives?.[nativeOS];
    
    if (!nativeClassifier) {
      return; // No native for this OS
    }
    
    const classifier = nativeClassifier.replace('${arch}', process.arch === 'x64' ? '64' : '32');
    
    if (!library.downloads.classifiers || !library.downloads.classifiers[classifier]) {
      this.log(`No classifier ${classifier} found for native library ${library.name}`, true);
      return;
    }
    
    const { path: libPath, url, sha1 } = library.downloads.classifiers[classifier];
    
    // Skip if path or URL is undefined - FIX: This is part of the fix
    if (!libPath || !url) {
      this.log(`No path or URL for native library ${library.name || 'unknown'}`, true);
      this.downloadProgress.completed++;
      return;
    }
    
    // Check if already downloaded
    const nativeId = `${library.name || ''}-native-${nativeOS}`;
    if (this.downloadedLibraries.has(nativeId)) {
      this.log(`Skipping already downloaded native library: ${nativeId}`);
      this.downloadProgress.completed++;
      return;
    }
    
    const libraryPath = path.join(this.LIBRARIES_DIR, libPath);
    
    try {
      // Check if file already exists and has correct hash
      if (fs.existsSync(libraryPath) && sha1) {
        const isValid = await this.verifyHash(libraryPath, sha1);
        if (isValid) {
          this.log(`Native library already exists with valid hash: ${libPath}`);
          this.downloadedLibraries.add(nativeId);
          downloadedLibs.push({ path: libPath, success: true });
          this.downloadProgress.completed++;
          return;
        }
      }
      
      this.log(`Downloading native library: ${libPath}`);
      await this.downloadFile(url, libraryPath, sha1);
      
      this.downloadedLibraries.add(nativeId);
      downloadedLibs.push({ path: libPath, success: true });
    } catch (err) {
      this.log(`Failed to download native library ${libPath}: ${err.message}`, true);
      failedLibs.push({ path: libPath, error: err.message });
      this.downloadProgress.completed++;
    }
  }

  /**
   * Download Fabric libraries using Maven repository style
   */
  async downloadFabricLibraries(libraries) {
    if (!libraries || !Array.isArray(libraries)) {
      this.log('No Fabric libraries to download or invalid libraries data', true);
      return [];
    }
    
    this.log(`Starting download of ${libraries.length} Fabric libraries...`);
    
    const downloadedLibs = [];
    const failedLibs = [];
    
    for (const library of libraries) {
      try {
        // Skip if already downloaded
        if (library.name && this.downloadedLibraries.has(library.name)) {
          this.log(`Skipping already downloaded Fabric library: ${library.name}`);
          this.downloadProgress.completed++;
          continue;
        }
        
        // Skip libraries without name
        if (!library.name) {
          this.log('Skipping library with no name', true);
          this.downloadProgress.completed++;
          continue;
        }
        
        // Parse maven coordinates
        const [group, artifact, version] = library.name.split(':');
        if (!group || !artifact || !version) {
          this.log(`Invalid Maven coordinates: ${library.name}`, true);
          this.downloadProgress.completed++;
          continue;
        }
        
        const groupPath = group.replace(/\./g, '/');
        const jarName = `${artifact}-${version}.jar`;
        const relativePath = `${groupPath}/${artifact}/${version}/${jarName}`;
        const libraryPath = path.join(this.LIBRARIES_DIR, relativePath);
        
        // Create directory structure
        const libraryDir = path.dirname(libraryPath);
        if (!fs.existsSync(libraryDir)) {
          fs.mkdirSync(libraryDir, { recursive: true });
        }
        
        // Check if file already exists
        if (fs.existsSync(libraryPath)) {
          const stats = fs.statSync(libraryPath);
          if (stats.size > 0) {
            this.log(`Fabric library already exists: ${library.name}`);
            this.downloadedLibraries.add(library.name);
            downloadedLibs.push({ path: libraryPath, success: true });
            this.downloadProgress.completed++;
            continue;
          }
        }
        
        // Determine repositories to try
        const repositories = [];
        
        // Add library-specific URL if provided
        if (library.url) {
          let baseUrl = library.url;
          if (!baseUrl.endsWith('/')) {
            baseUrl += '/';
          }
          repositories.push(baseUrl);
        }
        
        // Add default repositories
        repositories.push(
          'https://maven.fabricmc.net/',
          'https://libraries.minecraft.net/',
          'https://repo1.maven.org/maven2/'
        );
        
        // Try each repository until download succeeds
        let downloadSucceeded = false;
        let error = null;
        
        for (const repo of repositories) {
          try {
            // Construct proper URL
            const url = `${repo}${groupPath}/${artifact}/${version}/${jarName}`;
            
            this.log(`Trying to download ${library.name} from ${url}`);
            await this.downloadFile(url, libraryPath);
            
            // Verify download
            if (fs.existsSync(libraryPath)) {
              const stats = fs.statSync(libraryPath);
              if (stats.size > 0) {
                this.log(`Successfully downloaded ${library.name}`);
                this.downloadedLibraries.add(library.name);
                downloadedLibs.push({ path: libraryPath, success: true });
                downloadSucceeded = true;
                break;
              } else {
                this.log(`Downloaded empty file for ${library.name} from ${url}`, true);
                try {
                  fs.unlinkSync(libraryPath);
                } catch (err) {
                  // Ignore error
                }
              }
            }
          } catch (err) {
            this.log(`Failed to download ${library.name} from ${repo}: ${err.message}`, true);
            error = err;
            // Continue to next repository
          }
        }
        
        if (!downloadSucceeded) {
          this.log(`Failed to download library ${library.name} from all repositories`, true);
          failedLibs.push({ name: library.name, error: error ? error.message : 'Unknown error' });
        }
        
        this.downloadProgress.completed++;
      } catch (err) {
        this.log(`Error processing Fabric library ${library.name}: ${err.message}`, true);
        failedLibs.push({ name: library.name || 'unknown', error: err.message });
        this.downloadProgress.completed++;
      }
    }
    
    this.log(`Downloaded ${downloadedLibs.length} Fabric libraries successfully`);
    if (failedLibs.length > 0) {
      this.log(`Failed to download ${failedLibs.length} Fabric libraries`, true);
    }
    
    return downloadedLibs;
  }

  /**
 * Setup sound resources properly for Minecraft
 * @param {string} assetIndex - The asset index ID
 */
async setupSoundResources(assetIndex) {
  try {
    this.log(`Setting up sound resources for asset index: ${assetIndex}`);
    
    // Create resources directory if it doesn't exist
    const resourcesDir = path.join(this.MINECRAFT_DIR, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir, { recursive: true });
    }
    
    // Create sounds directory if it doesn't exist
    const soundsDir = path.join(resourcesDir, 'sounds');
    if (!fs.existsSync(soundsDir)) {
      fs.mkdirSync(soundsDir, { recursive: true });
    }

    // Add a sound.properties file if it doesn't exist
    const soundPropsPath = path.join(soundsDir, 'sound.properties');
    if (!fs.existsSync(soundPropsPath)) {
      fs.writeFileSync(soundPropsPath, 'sounds.enabled=true\n');
      this.log("Created sound.properties file");
    }
    
    // Load the asset index JSON
    const assetIndexPath = path.join(this.ASSETS_INDEXES_DIR, `${assetIndex}.json`);
    if (!fs.existsSync(assetIndexPath)) {
      throw new Error(`Asset index file not found: ${assetIndexPath}`);
    }
    
    const assetIndexJson = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
    const { objects } = assetIndexJson;
    
    // Create the legacy assets structure
    let legacyAssetsDir;
    
    // Different path handling based on asset index type
    if (assetIndexJson.virtual === true) {
      // If virtual, use the virtual/legacy path
      legacyAssetsDir = path.join(this.ASSETS_DIR, 'virtual', 'legacy');
      if (!fs.existsSync(legacyAssetsDir)) {
        fs.mkdirSync(legacyAssetsDir, { recursive: true });
      }
      
      // Setup virtual structure for all assets
      this.log(`Creating virtual assets structure in ${legacyAssetsDir}`);
      
      let processed = 0;
      
      for (const [assetPath, assetInfo] of Object.entries(objects)) {
        try {
          const { hash } = assetInfo;
          const hashPrefix = hash.substring(0, 2);
          const srcPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
          const destPath = path.join(legacyAssetsDir, assetPath);
          const destDir = path.dirname(destPath);
          
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          
          if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            processed++;
            
            // Also copy sound files to resources/sounds
            if (assetPath.startsWith('minecraft/sounds/') && assetPath.endsWith('.ogg')) {
              const soundRelativePath = assetPath.substring('minecraft/'.length);
              const resourceSoundPath = path.join(resourcesDir, soundRelativePath);
              const resourceSoundDir = path.dirname(resourceSoundPath);
              
              if (!fs.existsSync(resourceSoundDir)) {
                fs.mkdirSync(resourceSoundDir, { recursive: true });
              }
              
              fs.copyFileSync(srcPath, resourceSoundPath);
            }
          }
        } catch (err) {
          this.log(`Failed to process asset ${assetPath}: ${err.message}`, true);
        }
      }
      
      this.log(`Processed ${processed} virtual assets`);
    } else {
      // For non-virtual indexes, just link sound files to resources/sounds
      this.log(`Linking sound assets to resources/sounds directory`);
      
      let processed = 0;
      
      for (const [assetPath, assetInfo] of Object.entries(objects)) {
        try {
          // Only process sound files
          if (assetPath.startsWith('minecraft/sounds/') && assetPath.endsWith('.ogg')) {
            const { hash } = assetInfo;
            const hashPrefix = hash.substring(0, 2);
            const srcPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
            
            // Copy to resources/sounds directory
            const soundRelativePath = assetPath.substring('minecraft/'.length);
            const resourceSoundPath = path.join(resourcesDir, soundRelativePath);
            const resourceSoundDir = path.dirname(resourceSoundPath);
            
            if (!fs.existsSync(resourceSoundDir)) {
              fs.mkdirSync(resourceSoundDir, { recursive: true });
            }
            
            if (fs.existsSync(srcPath) && !fs.existsSync(resourceSoundPath)) {
              fs.copyFileSync(srcPath, resourceSoundPath);
              processed++;
            }
          }
        } catch (err) {
          this.log(`Failed to process sound asset ${assetPath}: ${err.message}`, true);
        }
      }
      
      this.log(`Processed ${processed} sound assets`);
    }
    
    // Create .nomedia file to prevent media scanning on Android
    fs.writeFileSync(path.join(resourcesDir, '.nomedia'), '');
    
    return { success: true };
  } catch (err) {
    this.log(`Failed to setup sound resources: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}

  /**
   * Download assets defined in the version JSON
   */
  async downloadAssets(versionJson) {
  try {
    const { assetIndex } = versionJson;
    const assetIndexPath = path.join(this.ASSETS_INDEXES_DIR, `${assetIndex.id}.json`);
    
    // Download asset index JSON
    if (!fs.existsSync(assetIndexPath) || !(await this.verifyHash(assetIndexPath, assetIndex.sha1))) {
      this.log(`Downloading asset index for ${assetIndex.id} from ${assetIndex.url}`);
      await this.downloadFile(assetIndex.url, assetIndexPath, assetIndex.sha1);
    } else {
      this.log(`Using existing asset index for ${assetIndex.id}`);
    }
    
    // Parse asset index
    const assetIndexJson = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
    const { objects } = assetIndexJson;
    
    // Update progress tracking
    this.downloadProgress.total += Object.keys(objects).length;
    
    this.log(`Asset index contains ${Object.keys(objects).length} objects`);
    
    // Prepare download queue
    const downloadQueue = [];
    const existingAssets = [];
    
    for (const [assetName, assetInfo] of Object.entries(objects)) {
      const { hash, size } = assetInfo;
      const hashPrefix = hash.substring(0, 2);
      const assetPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
      
      // Check if file already exists and has correct hash
      if (fs.existsSync(assetPath)) {
        const isValid = await this.verifyHash(assetPath, hash);
        if (isValid) {
          existingAssets.push(assetName);
          this.downloadProgress.completed++;
          continue;
        }
      }
      
      // Create directory for asset if it doesn't exist
      const assetDir = path.dirname(assetPath);
      if (!fs.existsSync(assetDir)) {
        fs.mkdirSync(assetDir, { recursive: true });
      }
      
      // Add to download queue
      const assetUrl = `https://resources.download.minecraft.net/${hashPrefix}/${hash}`;
      downloadQueue.push({
        url: assetUrl,
        destination: assetPath,
        expectedHash: hash,
        name: assetName
      });
    }
    
    this.log(`Found ${existingAssets.length} existing assets and ${downloadQueue.length} assets to download`);
    
    // If there are assets to download, use parallel download
    if (downloadQueue.length > 0) {
      // Calculate concurrency based on number of assets
      // More assets = higher concurrency, but cap at a reasonable number
      const concurrency = Math.min(
        Math.max(10, Math.floor(downloadQueue.length / 100)), 
        50  // Maximum 50 concurrent downloads
      );
      
      this.log(`Starting parallel download of ${downloadQueue.length} assets with concurrency ${concurrency}`);
      
      const downloadResults = await utils.downloadFilesParallel(downloadQueue, concurrency);
      
      this.log(`Downloaded ${downloadResults.successful} assets, failed to download ${downloadResults.failed} assets`);
      this.downloadProgress.completed += downloadQueue.length;
      
      // Try to download failed assets one more time sequentially
      if (downloadResults.errors.length > 0) {
        this.log(`Retrying ${downloadResults.errors.length} failed assets sequentially...`);
        
        let retrySuccess = 0;
        let retryFailed = 0;
        
        for (const { file } of downloadResults.errors) {
          try {
            await this.downloadFile(file.url, file.destination, file.expectedHash);
            retrySuccess++;
          } catch (err) {
            this.log(`Failed to download asset ${file.name} in retry: ${err.message}`, true);
            retryFailed++;
          }
        }
        
        this.log(`Retry results: ${retrySuccess} succeeded, ${retryFailed} failed`);
      }
    }
    
    // Create virtual/legacy assets structure if needed
    if (assetIndexJson.virtual === true) {
      this.log('Creating virtual assets structure...');
      await this.createVirtualAssets(assetIndexJson);
    }

    // Fix sound loading issues
    await this.setupSoundResources(assetIndex.id);
    
    return { 
      success: true, 
      totalAssets: Object.keys(objects).length, 
      existingAssets: existingAssets.length,
      downloadedAssets: downloadQueue.length,
      assetIndex: assetIndexJson
    };
  } catch (err) {
    this.log(`Failed to download assets: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}

  /**
   * Create virtual/legacy assets structure
   */
  async createVirtualAssets(assetIndexJson) {
    const { objects } = assetIndexJson;
    const virtualDir = path.join(this.ASSETS_DIR, 'virtual', 'legacy');
    
    // Create virtual directory
    if (!fs.existsSync(virtualDir)) {
      fs.mkdirSync(virtualDir, { recursive: true });
    }
    
    let processed = 0;
    const total = Object.keys(objects).length;
    
    for (const [assetPath, assetInfo] of Object.entries(objects)) {
      try {
        const { hash } = assetInfo;
        const hashPrefix = hash.substring(0, 2);
        const srcPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
        const destPath = path.join(virtualDir, assetPath);
        const destDir = path.dirname(destPath);
        
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          
          processed++;
          if (processed % 100 === 0 || processed === total) {
            this.log(`Virtual assets progress: ${processed}/${total}`);
          }
        }
      } catch (err) {
        this.log(`Failed to create virtual asset ${assetPath}: ${err.message}`, true);
      }
    }
    
    this.log(`Created ${processed} virtual assets`);
  }

  async setupPreLaunchClasspath() {
  try {
    this.log("Setting up pre-launch classpath for LWJGL and other critical libraries");
    
    // Find all LWJGL JARs
    const lwjglJars = [];
    this.findJarsWithPattern(this.LIBRARIES_DIR, /lwjgl/, lwjglJars);
    
    // Find SLF4J and Log4J JARs
    const loggingJars = [];
    this.findJarsWithPattern(this.LIBRARIES_DIR, /(slf4j|log4j)/, loggingJars);
    
    // Combine them
    const criticalJars = [...lwjglJars, ...loggingJars];
    
    if (criticalJars.length === 0) {
      this.log("WARNING: No critical JARs found!", true);
      return false;
    }
    
    // Set Java system property for extra classpath
    const classpathString = criticalJars.join(path.delimiter);
    process.env.JAVA_CLASS_PATH = (process.env.JAVA_CLASS_PATH || "") + path.delimiter + classpathString;
    
    // If this is Node.js, explicitly set the classpath
    if (typeof module !== 'undefined' && module.exports) {
      process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || "") + 
        ` --require=${criticalJars[0]}`;
    }
    
    this.log(`Pre-launch classpath set up with ${criticalJars.length} critical JARs`);
    return true;
  } catch (err) {
    this.log(`Failed to set up pre-launch classpath: ${err.message}`, true);
    return false;
  }
}

// Add this helper method to your launcher.js file
findJarsWithPattern(dir, pattern, result) {
  if (!fs.existsSync(dir)) {
    return;
  }
  
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Recursively search subdirectories
      this.findJarsWithPattern(filePath, pattern, result);
    } else if (file.toLowerCase().endsWith('.jar') && pattern.test(file)) {
      // Add matching JAR files to results
      result.push(filePath);
      this.log(`Found critical JAR: ${filePath}`);
    }
  }
}

  /**
   * Determine if a library should be used based on rules
   */
  shouldUseLibrary(library) {
    // Check rules if they exist
    if (library.rules) {
      let allowed = false;
      
      for (const rule of library.rules) {
        // Default action if not specified is 'allow'
        let action = rule.action === 'disallow' ? false : true;
        
        // Check OS conditions
        if (rule.os) {
          const currentOS = this.getNativeOS();
          if (rule.os.name && rule.os.name !== currentOS) {
            continue;
          }
          
          if (rule.os.version && !new RegExp(rule.os.version).test(process.platform.version)) {
            continue;
          }
        }
        
        // Set the current state based on this rule
        allowed = action;
      }
      
      return allowed;
    }
    
    // No rules, default to true
    return true;
  }

  /**
   * Get the native OS name for Minecraft
   */
  getNativeOS() {
    switch (process.platform) {
      case 'win32': return 'windows';
      case 'darwin': return 'osx';
      case 'linux': return 'linux';
      default: return 'unknown';
    }
  }

  /**
   * Get current download progress
   */
  getProgress() {
    return {
      total: this.downloadProgress.total,
      completed: this.downloadProgress.completed,
      current: this.downloadProgress.current,
      percentage: this.downloadProgress.total === 0 ? 0 :
        Math.floor((this.downloadProgress.completed / this.downloadProgress.total) * 100)
    };
  }

  /**
   * Launch the game
   */
  async launchGame(username, minecraftVersion, fabricVersion, ram) {
    try {
      // Make sure game module has correct paths
      game.setLauncherPaths(this);
      
      // Launch the game
      this.log(`Launching game for user ${username} with Minecraft ${minecraftVersion}, Fabric ${fabricVersion}`);
      return await game.launchGame(
        username, 
        minecraftVersion, 
        fabricVersion, 
        ram || { min: this.RAM_MIN, max: this.RAM_MAX }
      );
    } catch (err) {
      this.log(`Failed to launch game: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
}

module.exports = new Launcher();