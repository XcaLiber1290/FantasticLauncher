// utils.js - MODIFIED FOR FASTER DOWNLOADS
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { promisify } = require('util');
const mkdirp = promisify(fs.mkdir);

// HTTP GET request with retries and fallback URLs
async function httpGet(url, fallbackUrl = null, retries = 3, delay = 1000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1} to fetch ${url}`);
      return await new Promise((resolve, reject) => {
        const request = https.get(url, (res) => {
          // Handle redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return httpGet(res.headers.location, fallbackUrl, retries - 1, delay)
              .then(resolve)
              .catch(reject);
          }

          // Handle successful responses
          if (res.statusCode >= 200 && res.statusCode < 300) {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
            return;
          }
          
          // Handle error status codes
          reject(new Error(`HTTP status code ${res.statusCode}`));
        });
        
        // Set timeout
        request.setTimeout(15000, () => {
          request.abort();
          reject(new Error('Request timeout'));
        });
        
        request.on('error', (err) => reject(err));
      });
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed:`, err.message);
      
      // If we have a fallback URL and this is the last retry of the primary URL, try the fallback
      if (fallbackUrl && attempt === retries - 1) {
        console.log(`Trying fallback URL: ${fallbackUrl}`);
        try {
          return await httpGet(fallbackUrl, null, retries, delay);
        } catch (fallbackErr) {
          console.error(`Fallback URL failed:`, fallbackErr.message);
        }
      }
      
      // If this isn't the last retry, wait before trying again
      if (attempt < retries - 1) {
        console.log(`Waiting ${delay}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // If all retries failed, throw the error
        throw err;
      }
    }
  }
}

// Parallel download file function with concurrency control
async function downloadFilesParallel(files, concurrency = 10) {
  const queue = [...files];
  const results = [];
  const inProgress = new Set();
  const errors = [];
  
  console.log(`Starting parallel download of ${files.length} files with concurrency ${concurrency}`);
  
  async function processNext() {
    if (queue.length === 0) return;
    
    const file = queue.shift();
    inProgress.add(file);
    
    try {
      const result = await downloadFile(file.url, file.destination, file.retries || 3, file.expectedHash);
      results.push({ file, result, success: true });
    } catch (error) {
      errors.push({ file, error });
      console.error(`Error downloading ${file.url}: ${error.message}`);
    } finally {
      inProgress.delete(file);
      if (queue.length > 0) {
        await processNext();
      }
    }
  }
  
  // Start initial batch of downloads
  const initialBatch = Math.min(concurrency, queue.length);
  const startPromises = [];
  
  for (let i = 0; i < initialBatch; i++) {
    startPromises.push(processNext());
  }
  
  await Promise.all(startPromises);
  await Promise.all([...inProgress].map(file => new Promise(r => inProgress.delete(file) && r())));
  
  return { 
    results,
    errors,
    total: files.length,
    successful: results.length,
    failed: errors.length
  };
}

// Download file with retries
async function downloadFile(url, destination, retries = 3, expectedHash = null) {
  const destDir = path.dirname(destination);
  if (!fs.existsSync(destDir)) {
    await mkdirp(destDir, { recursive: true });
  }
  
  // Create a unique temp file name to avoid conflicts with parallel downloads
  const tempFile = `${destination}.tmp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  
  // If file exists and hash matches, skip download
  if (expectedHash && fs.existsSync(destination)) {
    const isValid = await verifyHash(destination, expectedHash);
    if (isValid) {
      return { destination, skipped: true };
    }
  }
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1} to download ${url}`);
      
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempFile);
        
        const request = https.get(url, (response) => {
          // Handle redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            file.close();
            try {
              if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
              }
            } catch (e) {
              console.error(`Could not delete temp file: ${e.message}`);
            }
            return downloadFile(response.headers.location, destination, retries - 1, expectedHash)
              .then(resolve)
              .catch(reject);
          }
          
          // Handle successful response
          if (response.statusCode >= 200 && response.statusCode < 300) {
            response.pipe(file);
            
            file.on('finish', () => {
              file.close(() => {
                try {
                  // Make sure the destination directory exists again (it might have been deleted)
                  if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                  }
                  
                  // Check if temp file exists before attempting to rename it
                  if (!fs.existsSync(tempFile)) {
                    reject(new Error(`Temp file ${tempFile} does not exist after download`));
                    return;
                  }
                  
                  // Rename temp file to actual destination
                  fs.rename(tempFile, destination, (err) => {
                    if (err) {
                      // If rename fails, try to copy the file instead
                      fs.copyFile(tempFile, destination, (copyErr) => {
                        try {
                          // Only try to unlink if it exists
                          if (fs.existsSync(tempFile)) {
                            fs.unlinkSync(tempFile);
                          }
                        } catch (e) {}
                        
                        if (copyErr) {
                          reject(copyErr);
                        } else {
                          resolve(destination);
                        }
                      });
                    } else {
                      resolve(destination);
                    }
                  });
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
              // Only try to unlink if it exists
              if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
              }
            } catch (e) {}
            reject(new Error(`HTTP status code ${response.statusCode}`));
          });
        });
        
        // Set timeout
        request.setTimeout(30000, () => {
          request.abort();
          file.close();
          try {
            // Only try to unlink if it exists
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {}
          reject(new Error('Download timeout'));
        });
        
        request.on('error', (err) => {
          file.close();
          try {
            // Only try to unlink if it exists
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {}
          reject(err);
        });
        
        file.on('error', (err) => {
          file.close();
          try {
            // Only try to unlink if it exists
            if (fs.existsSync(tempFile)) {
              fs.unlinkSync(tempFile);
            }
          } catch (e) {}
          reject(err);
        });
      });
      
      // Verify hash if provided
      if (expectedHash) {
        const isValid = await verifyHash(destination, expectedHash);
        if (!isValid) {
          throw new Error(`Hash verification failed for ${destination}`);
        }
      }
      
      console.log(`Successfully downloaded ${url}`);
      return { destination, downloaded: true };
    } catch (err) {
      console.error(`Download attempt ${attempt + 1} failed:`, err.message);
      
      // If this isn't the last retry, wait before trying again
      if (attempt < retries - 1) {
        console.log(`Waiting ${1000}ms before retrying download...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // If all retries failed, throw the error
        throw err;
      }
    }
  }
}

// Verify file hash
async function verifyHash(filePath, expectedHash, hashType = 'sha1') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(hashType);
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const fileHash = hash.digest('hex');
      resolve(fileHash.toLowerCase() === expectedHash.toLowerCase());
    });
    stream.on('error', reject);
  });
}

// Generate UUID from username (for offline mode)
function generateUUID(username) {
  const hash = crypto.createHash('md5').update(username).digest('hex');
  return hash.substring(0, 8) + '-' + 
         hash.substring(8, 12) + '-' + 
         hash.substring(12, 16) + '-' + 
         hash.substring(16, 20) + '-' + 
         hash.substring(20);
}

// Get the native OS name for Minecraft
function getNativeOS() {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'osx';
    case 'linux': return 'linux';
    default: return 'unknown';
  }
}

module.exports = {
  httpGet,
  downloadFile,
  downloadFilesParallel,
  verifyHash,
  generateUUID,
  getNativeOS
};