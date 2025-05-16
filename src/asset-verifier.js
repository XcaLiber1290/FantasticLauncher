// asset-verifier.js - FIXED VERSION
// Verifies integrity of game assets and resolves library conflicts for Minecraft with Fabric

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const https = require('https');

class AssetVerifier {
  constructor() {
    // These will be set by the launcher via initialize()
    this.MINECRAFT_DIR = null;
    this.VERSIONS_DIR = null;
    this.LIBRARIES_DIR = null;
    this.ASSETS_DIR = null;
    
    // Track modified JSON files to restore them later
    this.modifiedJsonFiles = new Map();
    
    // Debug mode
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
  
  // Initialize the verifier with paths from launcher
  async initialize(launcherInstance = null) {
    try {
    if (launcherInstance) {
      this.MINECRAFT_DIR = launcherInstance.MINECRAFT_DIR;
      this.VERSIONS_DIR = launcherInstance.VERSIONS_DIR;
      this.LIBRARIES_DIR = launcherInstance.LIBRARIES_DIR;
      this.ASSETS_DIR = launcherInstance.ASSETS_DIR;
    } else {
      // Default paths if not provided by launcher
      if (process.platform === 'win32') {
        this.MINECRAFT_DIR = path.join(process.env.APPDATA, '.minecraft');
      } else if (process.platform === 'darwin') {
        this.MINECRAFT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
      } else {
        this.MINECRAFT_DIR = path.join(os.homedir(), '.minecraft');
      }
      
      this.VERSIONS_DIR = path.join(this.MINECRAFT_DIR, 'versions');
      this.LIBRARIES_DIR = path.join(this.MINECRAFT_DIR, 'libraries');
      this.ASSETS_DIR = path.join(this.MINECRAFT_DIR, 'assets');
      this.ASSETS_INDEXES_DIR = path.join(this.ASSETS_DIR, 'indexes');
      this.ASSETS_OBJECTS_DIR = path.join(this.ASSETS_DIR, 'objects');
    }
    
    // Clear any previously modified files
    this.modifiedJsonFiles.clear();
    
    this.log("Asset verifier initialized successfully");
    return { status: 'initialized', paths: { MINECRAFT_DIR: this.MINECRAFT_DIR } };
  } catch (err) {
    this.log(`Failed to initialize asset verifier: ${err.message}`, true);
    return { status: 'failed', error: err.message };
  }
}

  /**
   * Compute SHA-1 hash of a file
   */
  async computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
      try {
        const hash = crypto.createHash('sha1');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', (data) => hash.update(data));
        
        stream.on('end', () => {
          const fileHash = hash.digest('hex');
          resolve(fileHash);
        });
        
        stream.on('error', (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  
  /**
   * Process version JSON files to detect and resolve conflicts
   */
  async processVersionFiles(minecraftVersion, fabricVersion) {
    try {
      this.log(`Processing version files for Minecraft ${minecraftVersion} with Fabric ${fabricVersion}`);
      
      const fabricVersionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
      const minecraftJsonPath = path.join(this.VERSIONS_DIR, minecraftVersion, `${minecraftVersion}.json`);
      const fabricJsonPath = path.join(this.VERSIONS_DIR, fabricVersionId, `${fabricVersionId}.json`);
      
      // Check if JSON files exist
      if (!fs.existsSync(minecraftJsonPath)) {
        throw new Error(`Minecraft JSON file not found at ${minecraftJsonPath}`);
      }
      
      if (!fs.existsSync(fabricJsonPath)) {
        throw new Error(`Fabric JSON file not found at ${fabricJsonPath}`);
      }
      
      // Backup the original JSON files
      await this.backupJsonFile(minecraftJsonPath);
      await this.backupJsonFile(fabricJsonPath);
      
      // Load JSON files
      const minecraftJson = JSON.parse(fs.readFileSync(minecraftJsonPath, 'utf8'));
      const fabricJson = JSON.parse(fs.readFileSync(fabricJsonPath, 'utf8'));
      
      // Make sure asset index is present in both
      if (!minecraftJson.assetIndex && fabricJson.assetIndex) {
        minecraftJson.assetIndex = fabricJson.assetIndex;
        this.log("Fixed missing assetIndex in Minecraft JSON");
      } else if (!fabricJson.assetIndex && minecraftJson.assetIndex) {
        fabricJson.assetIndex = minecraftJson.assetIndex;
        this.log("Fixed missing assetIndex in Fabric JSON");
      }
      
      // Identify library conflicts
      const conflicts = this.identifyLibraryConflicts(minecraftJson, fabricJson);
      
      if (conflicts.length > 0) {
        this.log(`Found ${conflicts.length} library conflicts between Minecraft and Fabric`);
        
        // Resolve conflicts (typically by preferring Fabric's libraries)
        this.resolveLibraryConflicts(minecraftJson, fabricJson, conflicts);
        
        // Write modified JSON files back
        fs.writeFileSync(minecraftJsonPath, JSON.stringify(minecraftJson, null, 2));
        fs.writeFileSync(fabricJsonPath, JSON.stringify(fabricJson, null, 2));
        
        return { success: true, conflicts: conflicts.length };
      } else {
        this.log('No library conflicts found');
        return { success: true, conflicts: 0 };
      }
    } catch (err) {
      this.log(`Failed to process version files: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Create a backup of a JSON file before modifying it
   */
  async backupJsonFile(jsonPath) {
    try {
      if (fs.existsSync(jsonPath)) {
        const content = fs.readFileSync(jsonPath, 'utf8');
        this.modifiedJsonFiles.set(jsonPath, content);
        this.log(`Backed up original JSON file: ${jsonPath}`);
      }
    } catch (err) {
      this.log(`Failed to backup JSON file ${jsonPath}: ${err.message}`, true);
    }
  }
  
  /**
   * Restore original JSON files after downloading is complete
   */
  async restoreJsonFiles() {
    try {
      const restored = [];
      
      for (const [filePath, content] of this.modifiedJsonFiles.entries()) {
        try {
          fs.writeFileSync(filePath, content);
          restored.push(filePath);
          this.log(`Restored original JSON file: ${filePath}`);
        } catch (err) {
          this.log(`Failed to restore JSON file ${filePath}: ${err.message}`, true);
        }
      }
      
      // Clear the map
      this.modifiedJsonFiles.clear();
      
      return { success: true, restored };
    } catch (err) {
      this.log(`Failed to restore JSON files: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Identify conflicts between Minecraft and Fabric libraries
   */
  identifyLibraryConflicts(minecraftJson, fabricJson) {
    const conflicts = [];
    const minecraftLibraries = minecraftJson.libraries || [];
    const fabricLibraries = fabricJson.libraries || [];
    
    // Build a map of Minecraft libraries by name
    const minecraftLibMap = new Map();
    for (const lib of minecraftLibraries) {
      if (lib.name) {
        // Extract base name without version
        const nameParts = lib.name.split(':');
        if (nameParts.length >= 2) {
          const baseName = `${nameParts[0]}:${nameParts[1]}`;
          minecraftLibMap.set(baseName, lib);
        }
      }
    }
    
    // Check each Fabric library for conflicts
    for (const fabricLib of fabricLibraries) {
      if (fabricLib.name) {
        const nameParts = fabricLib.name.split(':');
        if (nameParts.length >= 2) {
          const baseName = `${nameParts[0]}:${nameParts[1]}`;
          if (minecraftLibMap.has(baseName)) {
            const minecraftLib = minecraftLibMap.get(baseName);
            
            // If versions are different, we have a conflict
            if (minecraftLib.name !== fabricLib.name) {
              conflicts.push({
                baseName,
                minecraft: minecraftLib.name,
                fabric: fabricLib.name
              });
            }
          }
        }
      }
    }
    
    return conflicts;
  }
  
  /**
   * Resolve library conflicts by modifying the JSON files
   */
  resolveLibraryConflicts(minecraftJson, fabricJson, conflicts) {
    // For each conflict, prefer the Fabric version by removing from Minecraft libraries
    for (const conflict of conflicts) {
      const minecraftLibraries = minecraftJson.libraries || [];
      
      // Filter out the conflicting Minecraft library
      minecraftJson.libraries = minecraftLibraries.filter(lib => {
        if (!lib.name) return true;
        
        const nameParts = lib.name.split(':');
        if (nameParts.length >= 2) {
          const baseName = `${nameParts[0]}:${nameParts[1]}`;
          return baseName !== conflict.baseName;
        }
        return true;
      });
      
      this.log(`Resolved conflict for ${conflict.baseName}: Preferring Fabric version ${conflict.fabric} over Minecraft version ${conflict.minecraft}`);
    }
  }
  
  /**
   * Verify a specific asset by checking its hash
   */
  async verifyAsset(assetPath, expectedHash) {
    try {
      if (!fs.existsSync(assetPath)) {
        return { valid: false, reason: 'file_not_found' };
      }
      
      const actualHash = await this.computeFileHash(assetPath);
      
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        return { valid: false, reason: 'hash_mismatch', expected: expectedHash, actual: actualHash };
      }
      
      return { valid: true };
    } catch (err) {
      return { valid: false, reason: 'error', message: err.message };
    }
  }
  
  /**
   * Verify all assets in an asset index
   */
  async verifyAllAssets(assetIndexId) {
    try {
      const assetIndexPath = path.join(this.ASSETS_DIR, 'indexes', `${assetIndexId}.json`);
      
      if (!fs.existsSync(assetIndexPath)) {
        throw new Error(`Asset index file not found for ${assetIndexId}`);
      }
      
      const assetIndex = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
      const { objects } = assetIndex;
      
      this.log(`Verifying ${Object.keys(objects).length} assets from index ${assetIndexId}`);
      
      let valid = 0;
      let invalid = 0;
      let missing = 0;
      const missingAssets = [];
      
      for (const [assetName, assetInfo] of Object.entries(objects)) {
        const { hash } = assetInfo;
        const hashPrefix = hash.substring(0, 2);
        const assetPath = path.join(this.ASSETS_DIR, 'objects', hashPrefix, hash);
        
        const result = await this.verifyAsset(assetPath, hash);
        
        if (result.valid) {
          valid++;
        } else if (result.reason === 'file_not_found') {
          missing++;
          missingAssets.push({ name: assetName, hash, hashPrefix });
        } else {
          invalid++;
        }
        
        // Log progress every 500 assets
        if ((valid + invalid + missing) % 500 === 0) {
          this.log(`Asset verification progress: ${valid + invalid + missing}/${Object.keys(objects).length}`);
        }
      }
      
      // Try to repair missing assets if there are any
      if (missing > 0) {
        this.log(`Found ${missing} missing assets, attempting to repair...`);
        const repaired = await this.repairMissingAssets(missingAssets);
        if (repaired > 0) {
          this.log(`Successfully repaired ${repaired} assets`);
          missing -= repaired;
        }
      }
      
      // Create legacy virtual assets directory if needed
      if (assetIndex.virtual === true) {
        this.log('Creating virtual assets structure for legacy support...');
        await this.createVirtualAssets(assetIndex);
      }
      
      return {
        success: true,
        totalAssets: Object.keys(objects).length,
        valid,
        invalid,
        missing
      };
    } catch (err) {
      this.log(`Failed to verify assets: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Attempt to repair missing assets by downloading them
   */
  async repairMissingAssets(missingAssets) {
    let repaired = 0;
    
    for (const asset of missingAssets) {
      try {
        const assetUrl = `https://resources.download.minecraft.net/${asset.hashPrefix}/${asset.hash}`;
        const assetDir = path.join(this.ASSETS_DIR, 'objects', asset.hashPrefix);
        const assetPath = path.join(assetDir, asset.hash);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(assetDir)) {
          fs.mkdirSync(assetDir, { recursive: true });
        }
        
        this.log(`Downloading missing asset ${asset.name} from ${assetUrl}`);
        
        // Download the asset
        await this.downloadFile(assetUrl, assetPath);
        
        // Verify the downloaded asset
        const result = await this.verifyAsset(assetPath, asset.hash);
        if (result.valid) {
          repaired++;
        }
      } catch (err) {
        this.log(`Failed to repair asset ${asset.name}: ${err.message}`, true);
      }
    }
    
    return repaired;
  }
  
  /**
   * Download a file with retries
   */
  async downloadFile(url, destination, retries = 3) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destination);
      
      const request = https.get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destination, () => {});
          reject(new Error(`Failed to download: HTTP status ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });
      
      request.on('error', (err) => {
        fs.unlink(destination, () => {});
        reject(err);
      });
      
      file.on('error', (err) => {
        fs.unlink(destination, () => {});
        reject(err);
      });
    });
  }
  
  /**
   * Create virtual/legacy assets structure
   */
  async createVirtualAssets(assetIndex) {
    const { objects } = assetIndex;
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
        const srcPath = path.join(this.ASSETS_DIR, 'objects', hashPrefix, hash);
        const destPath = path.join(virtualDir, assetPath);
        const destDir = path.dirname(destPath);
        
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          processed++;
          
          // Log progress every 500 assets
          if (processed % 500 === 0 || processed === total) {
            this.log(`Virtual assets progress: ${processed}/${total}`);
          }
        }
      } catch (err) {
        this.log(`Failed to create virtual asset ${assetPath}: ${err.message}`, true);
      }
    }
    
    this.log(`Created ${processed} virtual assets`);
    return processed;
  }
  
  /**
   * Verify that the main Fabric class exists in the libraries
   */
  async verifyFabricMainClass(mainClass) {
    try {
      if (!mainClass) {
        this.log('No main class specified', true);
        return false;
      }
      
      this.log(`Verifying main class: ${mainClass}`);
      
      // Convert Java package format to path format
      const classPath = mainClass.replace(/\./g, '/') + '.class';
      
      // Search for class file in all libraries
      const foundInLib = await this.findClassInLibraries(classPath);
      
      if (foundInLib) {
        this.log(`Main class ${mainClass} found in ${foundInLib}`);
        return true;
      } else {
        this.log(`Main class ${mainClass} not found in any library!`, true);
        return false;
      }
    } catch (err) {
      this.log(`Failed to verify main class: ${err.message}`, true);
      return false;
    }
  }
  
  /**
   * Find a specific class file in the libraries directory
   */
  async findClassInLibraries(classPath) {
    return new Promise((resolve, reject) => {
      try {
        const AdmZip = require('adm-zip');
        
        // Get all JAR files in the libraries directory recursively
        const jarFiles = this.findJarFilesRecursively(this.LIBRARIES_DIR);
        
        this.log(`Searching for class ${classPath} in ${jarFiles.length} libraries...`);
        
        let found = false;
        let foundInLib = null;
        
        for (const jarFile of jarFiles) {
          try {
            const zip = new AdmZip(jarFile);
            if (zip.getEntry(classPath)) {
              found = true;
              foundInLib = jarFile;
              break;
            }
          } catch (err) {
            // Ignore errors in individual JAR files
            this.log(`Error examining JAR file ${jarFile}: ${err.message}`, true);
          }
        }
        
        resolve(foundInLib);
      } catch (err) {
        reject(err);
      }
    });
  }
  
  /**
   * Find all JAR files in a directory recursively
   */
  findJarFilesRecursively(dir) {
    const results = [];
    
    if (!fs.existsSync(dir)) {
      return results;
    }
    
    const list = fs.readdirSync(dir);
    
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Recursively search subdirectories
        results.push(...this.findJarFilesRecursively(filePath));
      } else if (path.extname(file).toLowerCase() === '.jar') {
        // Add JAR files to results
        results.push(filePath);
      }
    }
    
    return results;
  }
  
  /**
   * Verify the integrity of a version by checking if all libraries exist
   */
  async verifyVersionIntegrity(versionId, includeInherited = true) {
    try {
      const versionDir = path.join(this.VERSIONS_DIR, versionId);
      const jsonPath = path.join(versionDir, `${versionId}.json`);
      
      if (!fs.existsSync(jsonPath)) {
        throw new Error(`Version JSON not found at ${jsonPath}`);
      }
      
      const versionJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      
      // Check client JAR
      const clientJarPath = path.join(versionDir, `${versionId}.jar`);
      const clientExists = fs.existsSync(clientJarPath);
      
      // Get all libraries
      const libraries = versionJson.libraries || [];
      let totalLibraries = libraries.length;
      let missingLibraries = [];
      
      // Check each library
      for (const library of libraries) {
        const missing = await this.checkLibraryExists(library);
        if (missing) {
          missingLibraries.push(missing);
        }
      }
      
      // Check inherited version if needed
      let inheritedResults = null;
      if (includeInherited && versionJson.inheritsFrom) {
        inheritedResults = await this.verifyVersionIntegrity(versionJson.inheritsFrom, false);
        totalLibraries += inheritedResults.totalLibraries;
        missingLibraries = [...missingLibraries, ...inheritedResults.missingLibraries];
      }
      
      return {
        success: true,
        version: versionId,
        clientExists,
        totalLibraries,
        missingLibraries,
        inheritedResults
      };
    } catch (err) {
      this.log(`Failed to verify version integrity: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Check if a library exists
   */
  async checkLibraryExists(library) {
    try {
      if (library.downloads?.artifact?.path) {
        // Standard Minecraft library
        const libPath = path.join(this.LIBRARIES_DIR, library.downloads.artifact.path);
        
        if (!fs.existsSync(libPath)) {
          return { name: library.name, path: libPath };
        }
      } else if (library.name) {
        // Maven-style library (typical for Fabric)
        const [group, artifact, version] = library.name.split(':');
        
        if (!group || !artifact || !version) {
          return null; // Not a valid Maven coordinate
        }
        
        const groupPath = group.replace(/\./g, '/');
        const jarName = `${artifact}-${version}.jar`;
        const libPath = path.join(this.LIBRARIES_DIR, groupPath, artifact, version, jarName);
        
        if (!fs.existsSync(libPath)) {
          return { name: library.name, path: libPath };
        }
      }
      
      return null; // Library exists
    } catch (err) {
      this.log(`Error checking library ${library.name}: ${err.message}`, true);
      return { name: library.name, error: err.message };
    }
  }
  
  /**
   * Generate a comprehensive classpath with all available JAR files
   * This ensures every downloaded library is included
   */
  async generateComprehensiveClasspath() {
    try {
      const jarFiles = this.findJarFilesRecursively(this.LIBRARIES_DIR);
      const clientJars = this.findJarFilesRecursively(this.VERSIONS_DIR);
      
      // Combine all JAR files
      const allJars = [...jarFiles, ...clientJars];
      
      // Create classpath string with proper delimiter
      const classpath = allJars.join(path.delimiter);
      
      this.log(`Generated comprehensive classpath with ${allJars.length} JAR files`);
      
      return {
        success: true,
        classpath,
        jarCount: allJars.length
      };
    } catch (err) {
      this.log(`Failed to generate classpath: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Apply the comprehensive classpath to game.js
   * This patches the buildClasspath function in game.js to use all JAR files
   */
  async patchGameClasspathFunction() {
    try {
      // Get reference to the game module
      const game = require('./game');
      
      // Save the original buildClasspath function
      const originalBuildClasspath = game.buildClasspath;
      
      // Override the buildClasspath function
      game.buildClasspath = async (versionJson) => {
        try {
          this.log("Using comprehensive classpath instead of selective one");
          
          // Use our function to get all JARs
          const jarFiles = this.findJarFilesRecursively(this.LIBRARIES_DIR);
          
          // Add the client jar to classpath
          const clientJarPath = game.getClientJarPath(versionJson);
          if (clientJarPath) {
            jarFiles.push(clientJarPath);
          }
          
          // Convert array to classpath string
          const classpath = jarFiles.join(path.delimiter);
          
          this.log(`Comprehensive classpath contains ${jarFiles.length} entries`);
          return classpath;
        } catch (err) {
          this.log(`Error in patched buildClasspath: ${err.message}`, true);
          
          // Fall back to original function if there's an error
          this.log("Falling back to original classpath function");
          return await originalBuildClasspath.call(game, versionJson);
        }
      };
      
      this.log("Successfully patched game.buildClasspath function");
      return { success: true };
    } catch (err) {
      this.log(`Failed to patch game classpath function: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Fixes common sound loading issues
   */
  async fixSoundIssues() {
    try {
      this.log("Fixing potential sound loading issues...");
      
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
      
      // Add a .sound_enabled file in the Minecraft directory (helps with some launchers)
      fs.writeFileSync(path.join(this.MINECRAFT_DIR, '.sound_enabled'), '');
      this.log("Created .sound_enabled marker");
      
      // Fix permissions on the resources directory (mainly for Unix systems)
      if (process.platform !== 'win32') {
        try {
          const { execSync } = require('child_process');
          execSync(`chmod -R 755 "${resourcesDir}"`);
          this.log("Fixed resources directory permissions");
        } catch (err) {
          this.log(`Failed to fix permissions: ${err.message}`, true);
        }
      }
      
      // Create a .nomedia file in resources directory to prevent media scanning on Android
      fs.writeFileSync(path.join(resourcesDir, '.nomedia'), '');
      
      // Check if we need to create symlinks for each asset index
      const indexesDir = path.join(this.ASSETS_DIR, 'indexes');
      if (fs.existsSync(indexesDir)) {
        const indexFiles = fs.readdirSync(indexesDir)
          .filter(file => file.endsWith('.json'));
        
        for (const indexFile of indexFiles) {
          try {
            // Parse asset index
            const indexPath = path.join(indexesDir, indexFile);
            const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            const assetIndexId = indexFile.replace('.json', '');
            
            if (indexJson.virtual) {
              // For virtual indexes, create virtual assets structure
              await this.createVirtualAssetsForSounds(indexJson, assetIndexId);
            } else {
              // For regular indexes, create symbolic links in the sounds directory
              await this.linkSoundsFromAssets(indexJson, assetIndexId);
            }
          } catch (err) {
            this.log(`Error processing asset index ${indexFile}: ${err.message}`, true);
          }
        }
      }
      
      return { success: true };
    } catch (err) {
      this.log(`Failed to fix sound issues: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create virtual assets for sounds
   */
  async createVirtualAssetsForSounds(assetIndex, indexId) {
    try {
      const { objects } = assetIndex;
      const virtualDir = path.join(this.ASSETS_DIR, 'virtual', 'legacy');
      const resourcesDir = path.join(this.MINECRAFT_DIR, 'resources');
      
      // Create virtual directory
      if (!fs.existsSync(virtualDir)) {
        fs.mkdirSync(virtualDir, { recursive: true });
      }
      
      // Counter for processed sound files
      let processedSounds = 0;
      
      for (const [assetPath, assetInfo] of Object.entries(objects)) {
        try {
          // Only process sound files
          if (assetPath.startsWith('minecraft/sounds/') && assetPath.endsWith('.ogg')) {
            const { hash } = assetInfo;
            const hashPrefix = hash.substring(0, 2);
            const srcPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
            
            // Create virtual asset
            const virtualPath = path.join(virtualDir, assetPath);
            const virtualDir = path.dirname(virtualPath);
            if (!fs.existsSync(virtualDir)) {
              fs.mkdirSync(virtualDir, { recursive: true });
            }
            
            if (fs.existsSync(srcPath) && !fs.existsSync(virtualPath)) {
              fs.copyFileSync(srcPath, virtualPath);
            }
            
            // Also create a copy in the resources directory
            const resourcePath = path.join(resourcesDir, assetPath.substring('minecraft/'.length));
            const resourceDir = path.dirname(resourcePath);
            if (!fs.existsSync(resourceDir)) {
              fs.mkdirSync(resourceDir, { recursive: true });
            }
            
            if (fs.existsSync(srcPath) && !fs.existsSync(resourcePath)) {
              fs.copyFileSync(srcPath, resourcePath);
              processedSounds++;
            }
          }
        } catch (err) {
          this.log(`Failed to create virtual asset ${assetPath}: ${err.message}`, true);
        }
      }
      
      this.log(`Created ${processedSounds} virtual sound assets for index ${indexId}`);
      return processedSounds;
    } catch (err) {
      this.log(`Failed to create virtual sound assets: ${err.message}`, true);
      return 0;
    }
  }

  /**
   * Link sounds from assets to resources directory
   */
  async linkSoundsFromAssets(assetIndex, indexId) {
    try {
      const { objects } = assetIndex;
      const resourcesDir = path.join(this.MINECRAFT_DIR, 'resources');
      
      // Counter for linked sound files
      let linkedSounds = 0;
      
      for (const [assetName, assetInfo] of Object.entries(objects)) {
        try {
          // Only process sound files
          if (assetName.startsWith('minecraft/sounds/') && assetName.endsWith('.ogg')) {
            const { hash } = assetInfo;
            const hashPrefix = hash.substring(0, 2);
            const srcPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
            
            // Extract the sound name from the path (remove minecraft/ prefix)
            const soundRelativePath = assetName.substring('minecraft/'.length);
            const destPath = path.join(resourcesDir, soundRelativePath);
            
            // Create directory if it doesn't exist
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            
            // Copy file if it exists
            if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
              try {
                fs.copyFileSync(srcPath, destPath);
                linkedSounds++;
              } catch (err) {
                this.log(`Failed to copy sound file ${assetName}: ${err.message}`, true);
              }
            }
          }
        } catch (err) {
          this.log(`Failed to link sound ${assetName}: ${err.message}`, true);
        }
      }
      
      this.log(`Linked ${linkedSounds} sound files for index ${indexId}`);
      return linkedSounds;
    } catch (err) {
      this.log(`Failed to link sounds: ${err.message}`, true);
      return 0;
    }
  }

  async fixAssetLoading(assetIndexId = null) {
  try {
    this.log("Starting asset loading fix...");
    
    // If no assetIndexId is provided, try to find the latest one
    if (!assetIndexId) {
      const indexFiles = fs.readdirSync(this.ASSETS_INDEXES_DIR)
        .filter(file => file.endsWith('.json'))
        .sort(); // Sort to get the latest by filename
      
      if (indexFiles.length > 0) {
        assetIndexId = indexFiles[indexFiles.length - 1].replace('.json', '');
        this.log(`Using latest asset index: ${assetIndexId}`);
      } else {
        throw new Error("No asset index files found");
      }
    }
    
    // Load the asset index
    const assetIndexPath = path.join(this.ASSETS_INDEXES_DIR, `${assetIndexId}.json`);
    if (!fs.existsSync(assetIndexPath)) {
      throw new Error(`Asset index file not found: ${assetIndexPath}`);
    }
    
    const assetIndex = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
    const { objects } = assetIndex;
    
    // Create resources directory structure
    this.log("Creating resources directory structure...");
    const resourcesDir = path.join(this.MINECRAFT_DIR, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir, { recursive: true });
    }
    
    // Create the various sound directories
    const soundDirs = [
      path.join(resourcesDir, 'sounds'),
      path.join(resourcesDir, 'sound'),
      path.join(resourcesDir, 'sound3'),
      path.join(resourcesDir, 'newmusic')
    ];
    
    for (const dir of soundDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.log(`Created directory: ${dir}`);
      }
    }
    
    // Create sound.properties files
    const soundPropsPath = path.join(resourcesDir, 'sounds', 'sound.properties');
    if (!fs.existsSync(soundPropsPath)) {
      fs.writeFileSync(soundPropsPath, 'sounds.enabled=true\n');
      this.log("Created sound.properties file");
    }
    
    // Create virtual structure in Minecraft's assets directory
    this.log("Creating virtual assets structure...");
    const virtualDir = path.join(this.ASSETS_DIR, 'virtual', 'legacy');
    if (!fs.existsSync(virtualDir)) {
      fs.mkdirSync(virtualDir, { recursive: true });
    }
    
    // Process each asset
    let totalAssets = Object.keys(objects).length;
    let processedAssets = 0;
    let copiedAssets = 0;
    
    this.log(`Processing ${totalAssets} assets from index ${assetIndexId}`);
    
    for (const [assetPath, assetInfo] of Object.entries(objects)) {
      try {
        processedAssets++;
        
        const { hash } = assetInfo;
        const hashPrefix = hash.substring(0, 2);
        const srcPath = path.join(this.ASSETS_OBJECTS_DIR, hashPrefix, hash);
        
        // Skip if source file doesn't exist
        if (!fs.existsSync(srcPath)) {
          continue;
        }
        
        // Create virtual asset path
        const virtualPath = path.join(virtualDir, assetPath);
        const virtualDirPath = path.dirname(virtualPath);
        if (!fs.existsSync(virtualDirPath)) {
          fs.mkdirSync(virtualDirPath, { recursive: true });
        }
        
        // Copy to virtual directory
        if (!fs.existsSync(virtualPath)) {
          fs.copyFileSync(srcPath, virtualPath);
          copiedAssets++;
        }
        
        // If this is a sound file, also copy to resources
        if (assetPath.startsWith('minecraft/sounds/') && assetPath.endsWith('.ogg')) {
          const soundRelativePath = assetPath.substring('minecraft/'.length);
          const resourceSoundPath = path.join(resourcesDir, soundRelativePath);
          const resourceSoundDir = path.dirname(resourceSoundPath);
          
          if (!fs.existsSync(resourceSoundDir)) {
            fs.mkdirSync(resourceSoundDir, { recursive: true });
          }
          
          if (!fs.existsSync(resourceSoundPath)) {
            fs.copyFileSync(srcPath, resourceSoundPath);
          }
        }
        
        // Log progress every 500 assets
        if (processedAssets % 500 === 0 || processedAssets === totalAssets) {
          this.log(`Asset processing progress: ${processedAssets}/${totalAssets}`);
        }
      } catch (err) {
        this.log(`Error processing asset ${assetPath}: ${err.message}`, true);
      }
    }
    
    this.log(`Asset fix complete. Processed ${processedAssets} assets, copied ${copiedAssets} to virtual structure.`);
    
    // Create additional required files that help with sound loading
    fs.writeFileSync(path.join(this.MINECRAFT_DIR, '.sound_enabled'), '');
    fs.writeFileSync(path.join(resourcesDir, '.nomedia'), '');
    
    // For Minecraft 1.21.x, copy assets to the game version directory 
    try {
      const versionsDir = path.join(this.MINECRAFT_DIR, 'versions');
      const versionFolders = fs.readdirSync(versionsDir);
      
      // Find folders that start with 1.21 for the latest Minecraft version
      const minecraft121Folders = versionFolders.filter(folder => 
        folder.startsWith('1.21') && 
        fs.statSync(path.join(versionsDir, folder)).isDirectory()
      );
      
      for (const versionFolder of minecraft121Folders) {
        this.log(`Creating assets folder in version directory for ${versionFolder}`);
        
        const versionDir = path.join(versionsDir, versionFolder);
        const versionAssetsDir = path.join(versionDir, 'assets');
        
        if (!fs.existsSync(versionAssetsDir)) {
          fs.mkdirSync(versionAssetsDir, { recursive: true });
        }
        
        // Create a symbolic link or copy index info
        const versionIndexesDir = path.join(versionAssetsDir, 'indexes');
        if (!fs.existsSync(versionIndexesDir)) {
          fs.mkdirSync(versionIndexesDir, { recursive: true });
        }
        
        // Copy the asset index file
        fs.copyFileSync(
          assetIndexPath, 
          path.join(versionIndexesDir, `${assetIndexId}.json`)
        );
        
        this.log(`Copied asset index to version directory for ${versionFolder}`);
      }
    } catch (err) {
      this.log(`Error setting up version directory assets: ${err.message}`, true);
    }
    
    return { success: true, processed: processedAssets, copied: copiedAssets };
  } catch (err) {
    this.log(`Failed to fix asset loading: ${err.message}`, true);
    return { success: false, error: err.message };
  }
}

  
}

module.exports = new AssetVerifier();