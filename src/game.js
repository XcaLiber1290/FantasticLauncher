// game.js - FIXED FOR VIRTUAL ASSETS
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const os = require('os');

class Game {
  constructor() {
    // These will be set by the launcher via setLauncherPaths
    this.MINECRAFT_DIR = null;
    this.VERSIONS_DIR = null;
    this.LIBRARIES_DIR = null;
    this.ASSETS_DIR = null;
    
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
  
  // Set paths from launcher instance
  setLauncherPaths(launcher) {
    this.MINECRAFT_DIR = launcher.MINECRAFT_DIR;
    this.VERSIONS_DIR = launcher.VERSIONS_DIR;
    this.LIBRARIES_DIR = launcher.LIBRARIES_DIR;
    this.ASSETS_DIR = launcher.ASSETS_DIR;
  }

  // Extract native libraries
  async extractNatives(versionJson) {
    const nativesDir = path.join(this.VERSIONS_DIR, versionJson.id, 'natives');
    
    if (!fs.existsSync(nativesDir)) {
      fs.mkdirSync(nativesDir, { recursive: true });
    } else {
      // Clean existing natives directory
      fs.readdirSync(nativesDir)
        .forEach(file => {
          try {
            fs.unlinkSync(path.join(nativesDir, file));
          } catch (err) {
            this.log(`Could not delete file ${file} in natives directory: ${err.message}`, true);
          }
        });
    }
    
    const currentOS = this.getNativeOS();
    
    for (const library of versionJson.libraries) {
      if (!library.natives || !library.natives[currentOS]) continue;
      
      const classifier = library.natives[currentOS].replace('${arch}', process.arch === 'x64' ? '64' : '32');
      
      if (!library.downloads || !library.downloads.classifiers || !library.downloads.classifiers[classifier]) continue;
      
      const nativeLibPath = path.join(this.LIBRARIES_DIR, library.downloads.classifiers[classifier].path);
      
      if (!fs.existsSync(nativeLibPath)) continue;
      
      try {
        const zip = new AdmZip(nativeLibPath);
        const extractFilter = (entry) => {
          const name = entry.entryName;
          
          // Skip META-INF
          if (name.startsWith('META-INF/')) return false;
          
          // Check extract exclusions
          if (library.extract && library.extract.exclude) {
            return !library.extract.exclude.some(pattern => 
              new RegExp(pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')).test(name)
            );
          }
          
          return true;
        };
        
        zip.getEntries()
          .filter(extractFilter)
          .forEach(entry => {
            try {
              zip.extractEntryTo(entry, nativesDir, false, true);
            } catch (err) {
              this.log(`Failed to extract ${entry.entryName}: ${err.message}`, true);
            }
          });
      } catch (err) {
        this.log(`Failed to extract natives from ${nativeLibPath}: ${err.message}`, true);
      }
    }
    
    return nativesDir;
  }

  // Build classpath for game
  async buildClasspath(versionJson) {
    // Get all JARs in the libraries directory
    const libraries = new Set(); // Use a Set to automatically handle duplicates
    
    this.log("Building comprehensive classpath with ALL libraries...");
    
    // Find all JAR files in the libraries directory recursively
    this.findAllJars(this.LIBRARIES_DIR, libraries);
    
    // Add the client jar to classpath
    const clientJarPath = this.getClientJarPath(versionJson);
    if (clientJarPath) {
      libraries.add(clientJarPath);
    }
    
    // Convert Set to array
    const classpath = Array.from(libraries).join(path.delimiter);
    
    this.log(`Classpath contains ${libraries.size} entries`);
    return classpath;
  }

  // Helper method to find all JARs
  findAllJars(dir, libraries) {
    if (!fs.existsSync(dir)) {
      return;
    }
    
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Recursively search subdirectories
        this.findAllJars(filePath, libraries);
      } else if (file.toLowerCase().endsWith('.jar')) {
        // Add JAR files to results
        libraries.add(filePath);
      }
    }
  }

  // Add libraries to classpath
  async addLibrariesToClasspath(libraries, versionJson) {
    if (!versionJson.libraries) return;
    
    for (const library of versionJson.libraries) {
      // Handle standard libraries with downloads field
      if (library.downloads && library.downloads.artifact) {
        const libPath = path.join(this.LIBRARIES_DIR, library.downloads.artifact.path);
        if (fs.existsSync(libPath)) {
          libraries.add(libPath);
        }
      }
      // Handle Fabric libraries with Maven format name
      else if (library.name) {
        try {
          // Parse maven coordinates
          const [group, artifact, version] = library.name.split(':');
          const groupPath = group.replace(/\./g, '/');
          
          // Construct path
          const libPath = path.join(
            this.LIBRARIES_DIR,
            groupPath,
            artifact,
            version,
            `${artifact}-${version}.jar`
          );
          
          if (fs.existsSync(libPath)) {
            libraries.add(libPath);
          }
        } catch (err) {
          this.log(`Failed to process library path for ${library.name}: ${err.message}`, true);
        }
      }
    }
  }

  // Get the path to the client JAR file
  getClientJarPath(versionJson) {
    if (versionJson.inheritsFrom) {
      // Fabric version points to the base Minecraft version
      const clientJarPath = path.join(
        this.VERSIONS_DIR, 
        versionJson.inheritsFrom, 
        `${versionJson.inheritsFrom}.jar`
      );
      
      if (fs.existsSync(clientJarPath)) {
        return clientJarPath;
      } else {
        this.log(`Warning: Client JAR ${clientJarPath} does not exist`, true);
      }
    } else {
      // Regular Minecraft version
      const clientJarPath = path.join(
        this.VERSIONS_DIR, 
        versionJson.id, 
        `${versionJson.id}.jar`
      );
      
      if (fs.existsSync(clientJarPath)) {
        return clientJarPath;
      } else {
        this.log(`Warning: Client JAR ${clientJarPath} does not exist`, true);
      }
    }
    
    return null;
  }

  // Build JVM arguments
  async buildJvmArgs(versionJson, ramMin, ramMax) {
    const args = [];
    const nativesDir = path.join(this.VERSIONS_DIR, versionJson.id, 'natives');
    
    // Memory settings
    args.push(`-Xms${ramMin}`, `-Xmx${ramMax}`);
    
    // System properties
    args.push(
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+UseG1GC',
      '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20',
      '-XX:MaxGCPauseMillis=50',
      '-XX:G1HeapRegionSize=32M',
      '-Dfml.ignoreInvalidMinecraftCertificates=true',
      '-Dfml.ignorePatchDiscrepancies=true'
    );
    
    // Add natives directory
    args.push(`-Djava.library.path=${nativesDir}`);
    
    // MODIFIED: Force the use of the legacy asset index path
    args.push('-Dminecraft.applet.TargetDirectory=' + this.MINECRAFT_DIR);
    
    // Build classpath first and then add it to args
    const classpath = await this.buildClasspath(versionJson);
    args.push('-cp', classpath);
    
    // Process JVM arguments from version JSON
    if (versionJson.arguments && versionJson.arguments.jvm) {
      for (const arg of versionJson.arguments.jvm) {
        if (typeof arg === 'string') {
          const replacedArg = arg
            .replace('${natives_directory}', nativesDir)
            .replace('${launcher_name}', 'FabricLauncher')
            .replace('${launcher_version}', '1.0.0')
            .replace('${classpath}', classpath);
          
          // Avoid duplicate arguments
          if (!args.includes(replacedArg)) {
            args.push(replacedArg);
          }
        } else if (typeof arg === 'object' && this.checkArgConditions(arg)) {
          for (const value of arg.value) {
            if (typeof value === 'string') {
              const replacedArg = value
                .replace('${natives_directory}', nativesDir)
                .replace('${launcher_name}', 'FabricLauncher')
                .replace('${launcher_version}', '1.0.0')
                .replace('${classpath}', classpath);
              
              // Avoid duplicate arguments
              if (!args.includes(replacedArg)) {
                args.push(replacedArg);
              }
            }
          }
        }
      }
    }
    
    return args;
  }

  // Build game arguments - MODIFIED FOR VIRTUAL ASSETS
  buildGameArgs(versionJson, username, minecraftVersion) {
    const args = [];
    const uuid = this.generateUUID(username);
    const userProperties = '{}';
    const assetIndex = versionJson.assetIndex?.id || minecraftVersion;
    
    // Define assets paths properly based on asset index
    let assetsDir = this.ASSETS_DIR;
    let gameAssetsDir = null;
    let virtualDir = path.join(this.ASSETS_DIR, 'virtual', 'legacy');
    
    // Determine if we should use virtual assets
    let useVirtualAssets = false;
    
    try {
      // First check if the virtual directory exists
      if (fs.existsSync(virtualDir) && fs.readdirSync(virtualDir).length > 0) {
        useVirtualAssets = true;
        this.log(`Virtual assets directory exists and has content. Using virtual assets path.`);
      } else {
        // If not, check the asset index JSON to determine if it should be virtual
        const assetIndexPath = path.join(this.ASSETS_DIR, 'indexes', `${assetIndex}.json`);
        if (fs.existsSync(assetIndexPath)) {
          const assetIndexData = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
          if (assetIndexData.virtual === true) {
            useVirtualAssets = true;
            this.log(`Asset index indicates virtual assets should be used.`);
            
            // If virtual directory doesn't exist or is empty, we have a problem
            if (!fs.existsSync(virtualDir) || fs.readdirSync(virtualDir).length === 0) {
              this.log(`WARNING: Asset index indicates virtual assets, but ${virtualDir} is missing or empty!`, true);
              
              // Create virtual directory if it doesn't exist
              if (!fs.existsSync(virtualDir)) {
                fs.mkdirSync(virtualDir, { recursive: true });
                this.log(`Created empty virtual assets directory. Game may not load assets correctly.`);
              }
            }
          }
        }
      }
      
      // Set gameAssetsDir based on our findings
      if (useVirtualAssets) {
        gameAssetsDir = virtualDir;
        this.log(`Using virtual assets path: ${gameAssetsDir}`);
      } else {
        gameAssetsDir = assetsDir;
        this.log(`Using standard assets path: ${gameAssetsDir}`);
      }
    } catch (err) {
      this.log(`Error determining asset type: ${err.message}. Falling back to standard assets.`, true);
      gameAssetsDir = assetsDir;
    }
    
    // ADDITIONAL PATH OPTIONS FOR PRE-1.6 MINECRAFT VERSIONS
    // For older Minecraft versions, they might look for resources in the resources folder
    const resourcesDir = path.join(this.MINECRAFT_DIR, 'resources');
    if (!fs.existsSync(resourcesDir)) {
      try {
        fs.mkdirSync(resourcesDir, { recursive: true });
        this.log(`Created resources directory: ${resourcesDir}`);
      } catch (err) {
        this.log(`Failed to create resources directory: ${err.message}`, true);
      }
    }
    
    // Game arguments from JSON
    if (versionJson.arguments && versionJson.arguments.game) {
      for (const arg of versionJson.arguments.game) {
        if (typeof arg === 'string') {
          args.push(this.replaceGameArgPlaceholders(arg, username, uuid, userProperties, assetIndex, versionJson, assetsDir, gameAssetsDir));
        } else if (typeof arg === 'object' && this.checkArgConditions(arg)) {
          for (const value of arg.value) {
            if (typeof value === 'string') {
              args.push(this.replaceGameArgPlaceholders(value, username, uuid, userProperties, assetIndex, versionJson, assetsDir, gameAssetsDir));
            }
          }
        }
      }
    } else if (versionJson.minecraftArguments) {
      // Legacy format
      const gameArgs = versionJson.minecraftArguments.split(' ');
      for (const arg of gameArgs) {
        args.push(this.replaceGameArgPlaceholders(arg, username, uuid, userProperties, assetIndex, versionJson, assetsDir, gameAssetsDir));
      }
    }
    
    // EXPLICITLY ADD CUSTOM ARGS FOR VIRTUAL ASSETS
    if (useVirtualAssets) {
      // If these args were not already set by the JSON, add them explicitly
      // Check if we already have assets dir args
      let hasAssetsDir = false;
      let hasAssetsIndex = false;
      let hasGameAssets = false;
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--assetsDir') hasAssetsDir = true;
        if (args[i] === '--assetIndex') hasAssetsIndex = true;
        if (args[i] === '--gameDir') hasGameAssets = true;
      }
      
      // Add missing arguments
      if (!hasAssetsDir) {
        args.push('--assetsDir', assetsDir);
      }
      
      if (!hasAssetsIndex) {
        args.push('--assetIndex', assetIndex);
      }
      
      if (!hasGameAssets) {
        args.push('--gameDir', this.MINECRAFT_DIR);
      }
      
      // Always add these additional arguments to ensure virtual assets are found
      if (!args.includes('--resourcesDir')) {
        args.push('--resourcesDir', virtualDir);
      }
    }
    
    return args;
  }

  // Replace game arg placeholders - UPDATED WITH FIXED VIRTUAL ASSETS SUPPORT
  replaceGameArgPlaceholders(arg, username, uuid, userProperties, assetIndex, versionJson, assetsDir, gameAssetsDir) {
    // Make sure we have gameAssetsDir defined
    gameAssetsDir = gameAssetsDir || assetsDir;
    
    // Replace placeholders in arguments
    return arg
      .replace('${auth_player_name}', username)
      .replace('${auth_uuid}', uuid)
      .replace('${auth_access_token}', 'null')
      .replace('${auth_session}', 'null') // For older MC versions
      .replace('${user_type}', 'mojang')
      .replace('${user_properties}', userProperties)
      .replace('${version_name}', versionJson?.id || 'unknown')
      .replace('${assets_index_name}', assetIndex)
      .replace('${game_directory}', this.MINECRAFT_DIR)
      .replace('${assets_root}', assetsDir)
      .replace('${game_assets}', gameAssetsDir)
      .replace('${version_type}', 'release');
  }

  // Check if argument conditions are met
  checkArgConditions(arg) {
    if (!arg.rules) return true;
    
    for (const rule of arg.rules) {
      let applies = rule.action === 'allow';
      
      if (rule.os) {
        const currentOS = this.getNativeOS();
        if (rule.os.name && rule.os.name !== currentOS) {
          applies = !applies;
        }
        
        if (rule.os.version && !new RegExp(rule.os.version).test(process.platform.version)) {
          applies = !applies;
        }
      }
      
      if (rule.features) {
        // Feature checks not implemented yet
        applies = false;
      }
      
      if (!applies) return false;
    }
    
    return true;
  }

  // Generate UUID from username (for offline mode)
  generateUUID(username) {
    const hash = crypto.createHash('md5').update(username).digest('hex');
    return hash.substring(0, 8) + '-' + 
           hash.substring(8, 12) + '-' + 
           hash.substring(12, 16) + '-' + 
           hash.substring(16, 20) + '-' + 
           hash.substring(20);
  }

  // Get the native OS name for Minecraft
  getNativeOS() {
    switch (process.platform) {
      case 'win32': return 'windows';
      case 'darwin': return 'osx';
      case 'linux': return 'linux';
      default: return 'unknown';
    }
  }

  // Find Java executable
  async findJava() {
    // Simple implementation - should be expanded for proper Java detection
    if (process.env.JAVA_HOME) {
      const javaPath = path.join(
        process.env.JAVA_HOME,
        'bin',
        process.platform === 'win32' ? 'java.exe' : 'java'
      );
      
      if (fs.existsSync(javaPath)) {
        return javaPath;
      }
    }
    
    // Default to 'java' on PATH
    return 'java';
  }

  // Launch the game
  async launchGame(username, minecraftVersion, fabricVersion, ram) {
    try {
      const ramMin = ram?.min || '1G';
      const ramMax = ram?.max || '2G';
      
      const fabricVersionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
      const fabricJsonPath = path.join(this.VERSIONS_DIR, fabricVersionId, `${fabricVersionId}.json`);
      
      if (!fs.existsSync(fabricJsonPath)) {
        throw new Error(`Fabric version JSON not found at ${fabricJsonPath}`);
      }
      
      const fabricJson = JSON.parse(fs.readFileSync(fabricJsonPath, 'utf8'));
      
      // Before launching, ensure virtual assets are properly set up
      await this.ensureVirtualAssetsSetup(fabricJson);
      
      // Extract natives
      this.log("Extracting native libraries...");
      await this.extractNatives(fabricJson);
      
      // Build JVM arguments
      this.log("Building JVM arguments...");
      const jvmArgs = await this.buildJvmArgs(fabricJson, ramMin, ramMax);
      
      // Build game arguments
      this.log("Building game arguments...");
      const gameArgs = this.buildGameArgs(fabricJson, username, minecraftVersion);
      
      // Find java executable
      const javaPath = await this.findJava();
      
      // Final command
      const args = [...jvmArgs, fabricJson.mainClass, ...gameArgs];
      
      // Log the launch command (useful for debugging)
      this.log('Launching with command:');
      this.log(`${javaPath} ${args.join(' ')}`);
      
      // Launch the game
      const gameProcess = spawn(javaPath, args, {
        cwd: this.MINECRAFT_DIR,
        detached: true,
        stdio: 'inherit'
      });
      
      return new Promise((resolve, reject) => {
        gameProcess.on('error', (err) => {
          reject(err);
        });
        
        gameProcess.once('spawn', () => {
          resolve({ pid: gameProcess.pid, success: true });
          gameProcess.unref(); // Detach process
        });
      });
    } catch (err) {
      this.log('Failed to launch game:', err);
      throw err;
    }
  }

  // NEW METHOD: Ensure virtual assets are properly set up
  async ensureVirtualAssetsSetup(versionJson) {
    try {
      const assetIndex = versionJson.assetIndex?.id || versionJson.id;
      this.log(`Ensuring virtual assets setup for asset index: ${assetIndex}`);
      
      // Get the asset index JSON
      const assetIndexPath = path.join(this.ASSETS_DIR, 'indexes', `${assetIndex}.json`);
      if (!fs.existsSync(assetIndexPath)) {
        this.log(`Asset index file not found: ${assetIndexPath}`, true);
        return false;
      }
      
      const assetIndexJson = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
      const { objects } = assetIndexJson;
      
      // If the asset index is virtual, ensure the virtual structure exists
      if (assetIndexJson.virtual === true) {
        this.log("Asset index is marked as virtual, creating virtual assets structure...");
        const virtualDir = path.join(this.ASSETS_DIR, 'virtual', 'legacy');
        
        // Create virtual directory if it doesn't exist
        if (!fs.existsSync(virtualDir)) {
          fs.mkdirSync(virtualDir, { recursive: true });
        }
        
        // Check if we have assets in the virtual directory
        const hasContent = fs.readdirSync(virtualDir).length > 0;
        
        if (!hasContent) {
          this.log("Virtual assets directory is empty, copying assets...");
          
          // Copy assets to virtual structure
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
              
              if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
                fs.copyFileSync(srcPath, destPath);
                processed++;
                
                // Log progress periodically
                if (processed % 100 === 0 || processed === total) {
                  this.log(`Virtual assets progress: ${processed}/${total}`);
                }
              }
            } catch (err) {
              this.log(`Failed to create virtual asset ${assetPath}: ${err.message}`, true);
            }
          }
          
          this.log(`Created ${processed} virtual assets`);
        } else {
          this.log("Virtual assets directory already has content, skipping copy");
        }
        
        // Also set up resources directory for legacy Minecraft versions
        const resourcesDir = path.join(this.MINECRAFT_DIR, 'resources');
        if (!fs.existsSync(resourcesDir)) {
          fs.mkdirSync(resourcesDir, { recursive: true });
        }
        
        // Create important sound directories
        ['sound', 'sounds', 'music', 'newmusic'].forEach(dir => {
          const soundDir = path.join(resourcesDir, dir);
          if (!fs.existsSync(soundDir)) {
            fs.mkdirSync(soundDir, { recursive: true });
          }
        });
        
        // Create a sound.properties file
        const soundPropsPath = path.join(resourcesDir, 'sound', 'sound.properties');
        if (!fs.existsSync(soundPropsPath)) {
          fs.writeFileSync(soundPropsPath, 'sounds.enabled=true\n');
        }
        
        // Copy sound files to resources directory
        for (const [assetPath, assetInfo] of Object.entries(objects)) {
          try {
            if (assetPath.startsWith('minecraft/sound/') || assetPath.startsWith('minecraft/sounds/')) {
              const { hash } = assetInfo;
              const hashPrefix = hash.substring(0, 2);
              const srcPath = path.join(this.ASSETS_DIR, 'objects', hashPrefix, hash);
              
              // Extract the relative path without "minecraft/"
              const relativePath = assetPath.substring('minecraft/'.length);
              const resourcePath = path.join(resourcesDir, relativePath);
              const resourceDir = path.dirname(resourcePath);
              
              if (!fs.existsSync(resourceDir)) {
                fs.mkdirSync(resourceDir, { recursive: true });
              }
              
              if (fs.existsSync(srcPath) && !fs.existsSync(resourcePath)) {
                fs.copyFileSync(srcPath, resourcePath);
              }
            }
          } catch (err) {
            this.log(`Failed to copy sound file ${assetPath}: ${err.message}`, true);
          }
        }
        
        this.log("Sound resources set up successfully");
      } else {
        this.log("Asset index is not virtual, no need to create virtual structure");
      }
      
      return true;
    } catch (err) {
      this.log(`Error ensuring virtual assets setup: ${err.message}`, true);
      return false;
    }
  }
}

module.exports = new Game();