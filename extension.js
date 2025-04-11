const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// ----- Helper Functions -----

/**
 * Converts a glob pattern to a regular expression.
 * This function escapes regex special characters (except '*' and '?'),
 * then replaces '**' with a temporary token, '*' with a pattern matching any characters except '/',
 * then restores the token with '.*', and finally replaces '?' with '.'.
 * @param {string} glob 
 * @returns {RegExp}
 */
function toRegex(glob) {
  let escaped = glob.replace(/([.+^${}()|[\]\\])/g, '\\$1');
  escaped = escaped.replace(/\*\*/g, '<<<TWOSTAR>>>');
  escaped = escaped.replace(/\*/g, '[^/]*');
  escaped = escaped.replace(/<<<TWOSTAR>>>/g, '.*');
  escaped = escaped.replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

/**
 * Ensures that a file exists. If not, writes it with the given default content.
 * @param {string} filePath 
 * @param {string} defaultContent 
 */
async function ensureFile(filePath, defaultContent) {
  try {
    await fs.access(filePath);
  } catch (_) {
    await fs.writeFile(filePath, defaultContent, 'utf-8');
    vscode.window.showInformationMessage(`✅ Created ${path.basename(filePath)} in /flattened`);
  }
}

/**
 * Parses a .flatten_ignore file into four parts: global, whitelist, blacklist, and settings.
 * Expects the file to use section headers "global:", "whitelist:", "blacklist:" and "settings:".
 * For the settings section, each line should be in the format key: value.
 * @param {string} filePath 
 * @param {string} rootPath 
 * @returns {Promise<{global: string[], whitelist: string[], blacklist: string[], settings: Object}>}
 */
async function parseFlattenIgnore(filePath, rootPath) {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (_) {
    return { global: [], whitelist: [], blacklist: [], settings: {} };
  }
  const lines = content.split('\n').map(line => line.trim());
  let section = null;
  const globalArr = [];
  const whitelistArr = [];
  const blacklistArr = [];
  const settingsObj = {};
  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue;
    if (line.toLowerCase().startsWith('global:')) { section = 'global'; continue; }
    if (line.toLowerCase().startsWith('whitelist:')) { section = 'whitelist'; continue; }
    if (line.toLowerCase().startsWith('blacklist:')) { section = 'blacklist'; continue; }
    if (line.toLowerCase().startsWith('settings:')) { section = 'settings'; continue; }
    if (section === 'global') {
      globalArr.push(line);
    } else if (section === 'whitelist') {
      whitelistArr.push(line);
    } else if (section === 'blacklist') {
      blacklistArr.push(line);
    } else if (section === 'settings') {
      // Expect lines in key: value format.
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        // Convert to number if applicable.
        const num = Number(value);
        settingsObj[key] = isNaN(num) ? value : num;
      }
    }
  }

  async function processPattern(pattern) {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      try {
        const full = path.join(rootPath, pattern);
        const stat = await fs.stat(full);
        if (stat.isDirectory() && !pattern.endsWith('/**')) {
          return pattern + '/**';
        }
      } catch (_) {
        // If the path doesn't exist, leave the pattern as is.
      }
    }
    return pattern;
  }
  async function processAll(arr) {
    const result = [];
    for (const pat of arr) {
      result.push(await processPattern(pat));
    }
    return result;
  }
  return {
    global: await processAll(globalArr),
    whitelist: await processAll(whitelistArr),
    blacklist: await processAll(blacklistArr),
    settings: settingsObj
  };
}

/**
 * Returns true if the provided path matches any regex in the array.
 * @param {string} p 
 * @param {RegExp[]} regexes 
 * @returns {boolean}
 */
function matchesAny(p, regexes) {
  return regexes.some(r => r.test(p));
}

/**
 * Builds a directory tree (in a tree-like string format) from an array of relative file paths.
 * @param {string[]} filePaths 
 * @returns {string}
 */
function buildDirectoryTree(filePaths) {
  const tree = {};
  filePaths.forEach(relPath => {
    const parts = relPath.split(path.sep);
    let node = tree;
    parts.forEach(part => {
      if (!node[part]) {
        node[part] = {};
      }
      node = node[part];
    });
  });
  
  function treeToString(node, indent = '') {
    let output = '';
    const entries = Object.entries(node);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    entries.forEach(([name, children], index) => {
      const isLast = index === entries.length - 1;
      output += `${indent}${isLast ? '└─ ' : '├─ '}${name}\n`;
      const newIndent = indent + (isLast ? '   ' : '│  ');
      output += treeToString(children, newIndent);
    });
    return output;
  }
  
  return treeToString(tree);
}

/**
 * Scores a file based on various criteria to determine its importance
 * @param {string} filePath 
 * @param {Object} stats 
 * @returns {Promise<number>} Score from 0-100, higher is more important
 */
async function scoreFile(filePath, stats) {
  let score = 50; // Base score
  
  // Size scoring - prefer smaller files
  const sizeInKB = stats.size / 1024;
  if (sizeInKB < 10) score += 20;
  else if (sizeInKB < 50) score += 10;
  else if (sizeInKB > 500) score -= 20;
  
  // Path scoring - prefer source files
  const relativePath = filePath.toLowerCase();
  if (relativePath.includes('src/') || relativePath.includes('lib/')) score += 15;
  if (relativePath.includes('test/') || relativePath.includes('spec/')) score -= 10;
  if (relativePath.includes('example/') || relativePath.includes('demo/')) score -= 5;
  
  // File type scoring
  const ext = path.extname(filePath).toLowerCase();
  const mainFiles = ['.ts', '.js', '.py', '.java', '.go', '.rs'];
  const configFiles = ['.json', '.yml', '.yaml', '.toml'];
  if (mainFiles.includes(ext)) score += 10;
  if (configFiles.includes(ext)) score += 5;
  
  // Recent modification bonus
  const now = new Date();
  const modifiedDays = (now - stats.mtime) / (1000 * 60 * 60 * 24);
  if (modifiedDays < 7) score += 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Process files in parallel batches for better performance
 * @param {string[]} files 
 * @param {string} rootPath
 * @param {number} maxFileSize
 * @param {number} maxConcurrent
 * @returns {Promise<Array>}
 */
async function processFilesInParallel(files, rootPath, maxFileSize, maxConcurrent = 4) {
  const results = [];
  const batches = [];
  
  // Split files into batches
  for (let i = 0; i < files.length; i += maxConcurrent) {
    batches.push(files.slice(i, i + maxConcurrent));
  }

  // Process batches in parallel
  for (const batch of batches) {
    const batchPromises = batch.map(async file => {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const rel = path.relative(rootPath, file);
        if (content.length > maxFileSize) {
          console.warn(`⚠️ Skipping ${rel} (too large)`);
          return null;
        }
        return { file, content, rel };
      } catch (err) {
        console.error(`Error reading ${file}:`, err);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(r => r !== null));
  }

  return results;
}

/**
 * Estimates the number of output files that will be created based on file sizes and chunk limits
 * @param {Array<{file: string, size: number}>} files 
 * @param {number} maxChunkSize 
 * @returns {Promise<{estimatedFiles: number, totalSize: number}>}
 */
async function estimateOutputFiles(files, maxChunkSize) {
  let currentChunkSize = 0;
  let numChunks = 1;
  let totalSize = 0;

  for (const { size } of files) {
    totalSize += size;
    if ((currentChunkSize + size) > maxChunkSize) {
      numChunks++;
      currentChunkSize = size;
    } else {
      currentChunkSize += size;
    }
  }

  return { estimatedFiles: numChunks, totalSize };
}

/**
 * Common library and build tool patterns that should be ignored by default
 */
const DEFAULT_LIBRARY_PATTERNS = [
  // Package managers and dependencies
  '**/node_modules/**',
  '**/bower_components/**',
  '**/jspm_packages/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/requirements.txt',
  '**/go.sum',
  '**/Cargo.lock',
  '**/vendor/**',
  
  // Build outputs and caches
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/output/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  
  // Python
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.pyd',
  '**/venv/**',
  '**/.env/**',
  '**/.pytest_cache/**',
  '**/.tox/**',
  '**/*.egg-info/**',
  
  // Java/Kotlin/Scala
  '**/target/**',
  '**/.gradle/**',
  '**/gradle/**',
  '**/*.class',
  '**/classes/**',
  '**/META-INF/**',
  
  // .NET
  '**/bin/**',
  '**/obj/**',
  '**/packages/**',
  '**/Debug/**',
  '**/Release/**',
  
  // iOS/macOS
  '**/Pods/**',
  '**/*.xcworkspace/**',
  '**/*.xcodeproj/**',
  '**/DerivedData/**',
  
  // IDE and editor files
  '**/.idea/**',
  '**/.vscode/**',
  '**/.vs/**',
  '**/.project/**',
  '**/.settings/**',
  '**/.classpath',
  '**/.factorypath',
  
  // Minified files and source maps
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.bundle.*',
  '**/*.chunk.*',
  
  // Generated documentation
  '**/docs/api/**',
  '**/docs/generated/**',
  '**/api-docs/**',
  '**/jsdoc/**',
  '**/javadoc/**',
  '**/swagger/**',
  
  // Common test fixtures and mocks
  '**/fixtures/**',
  '**/mocks/**',
  '**/stubs/**',
  '**/test-data/**',
  '**/test-utils/**',
  '**/testing-utils/**',
  
  // Common third-party code directories
  '**/third-party/**',
  '**/external/**',
  '**/deps/**',
  '**/lib/vendor/**',
  '**/assets/vendor/**',
  
  // Temporary and backup files
  '**/*.tmp',
  '**/*.temp',
  '**/*.bak',
  '**/*.log',
  '**/tmp/**',
  '**/temp/**',
  '**/logs/**',
  
  // Version control
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  
  // Configuration files that often contain third-party settings
  '**/webpack.config.*',
  '**/babel.config.*',
  '**/tsconfig.*',
  '**/jest.config.*',
  '**/karma.conf.*',
  '**/rollup.config.*',
  '**/grunt*',
  '**/gulpfile.*'
];

/**
 * Gets suggestions for reducing the number of output files
 * @param {number} currentTokenLimit 
 * @param {number} estimatedFiles 
 * @param {string[]} localBlacklist 
 * @returns {{suggestions: string[], patterns: string[]}}
 */
function getSuggestions(currentTokenLimit, estimatedFiles, localBlacklist) {
  const suggestions = [];
  const patterns = [];
  
  // Suggest increasing token limit if it's relatively low
  if (currentTokenLimit < 100000) {
    suggestions.push(
      "- Increase `maxTokenLimit` in settings (many modern LLMs support 100k+ tokens)"
    );
  }
  
  // Common patterns to suggest if not in local blacklist
  const commonPatterns = [
    'test/**',
    '**/*.test.*',
    '**/*.spec.*',
    'docs/**',
    'examples/**',
    'demo/**',
    'samples/**',
    '__tests__/**',
    '__mocks__/**',
    'coverage/**',
    'e2e/**'
  ];
  
  const missingPatterns = commonPatterns.filter(pattern => 
    !localBlacklist.some(b => b === pattern)
  );
  
  if (missingPatterns.length > 0) {
    suggestions.push(
      "- Add these patterns to your blacklist to exclude test and example files:",
      ...missingPatterns.map(p => `  ${p}`)
    );
    patterns.push(...missingPatterns);
  }
  
  return { suggestions, patterns };
}

/**
 * Checks if a path matches any of the patterns
 * @param {string} filePath 
 * @param {string[]} patterns 
 * @returns {boolean}
 */
function matchesPatterns(filePath, patterns) {
  return patterns.some(pattern => {
    const regex = toRegex(pattern);
    return regex.test(filePath);
  });
}

/**
 * Converts an array of glob patterns to RegExp objects
 * @param {string[]} patterns 
 * @returns {RegExp[]}
 */
function patternsToRegex(patterns) {
  return patterns.map(toRegex);
}

/**
 * Memory-efficient file content processing
 * @param {string} content 
 * @param {number} maxChunkSize 
 * @returns {string}
 */
function processContentEfficiently(content, maxChunkSize) {
  // If content is small enough, return as is
  if (content.length <= maxChunkSize) {
    return content;
  }

  // For large files, truncate and add warning
  const truncatedContent = content.slice(0, maxChunkSize);
  return `${truncatedContent}\n\n... Content truncated (${((content.length - maxChunkSize) / 1024).toFixed(1)}KB remaining) ...`;
}

/**
 * Memory-efficient chunk creation
 * @param {Array<{rel: string, content: string}>} files 
 * @param {number} maxChunkSize 
 * @returns {Array<{content: string, files: string[]}>}
 */
function createChunksEfficiently(files, maxChunkSize) {
  const chunks = [];
  let currentChunk = { content: '', files: [] };
  
  for (const { rel, content } of files) {
    const processedContent = processContentEfficiently(content, maxChunkSize);
    const fileEntry = `\n\n=== FILE: ${rel} ===\n${processedContent}`;
    
    // If adding this file would exceed chunk size, create new chunk
    if ((currentChunk.content.length + fileEntry.length) > maxChunkSize) {
      if (currentChunk.content) {
        chunks.push(currentChunk);
      }
      currentChunk = { content: fileEntry, files: [rel] };
    } else {
      currentChunk.content += fileEntry;
      currentChunk.files.push(rel);
    }
  }
  
  if (currentChunk.content) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

// ----- Main Extension Code -----

/**
 * Enhanced progress reporting
 */
class ProgressTracker {
  constructor(progress, token) {
    this.progress = progress;
    this.token = token;
    this.totalSteps = 0;
    this.currentStep = 0;
  }

  setTotalSteps(total) {
    this.totalSteps = total;
  }

  increment(message) {
    this.currentStep++;
    if (this.token.isCancellationRequested) {
      throw new Error('Operation cancelled by user');
    }
    this.progress.report({
      message: `${message} (${this.currentStep}/${this.totalSteps})`,
      increment: (100 / this.totalSteps)
    });
  }
}

/**
 * Enhanced error handling with detailed messages
 * @param {Error} error 
 * @returns {string}
 */
function getDetailedErrorMessage(error) {
  if (error.message.includes('ENOENT')) {
    return 'File or directory not found. Please check if the path exists.';
  }
  if (error.message.includes('EACCES')) {
    return 'Permission denied. Please check file permissions.';
  }
  if (error.message.includes('EMFILE')) {
    return 'Too many open files. Try reducing the batch size.';
  }
  if (error.message.includes('ENOMEM')) {
    return 'Out of memory. Try reducing the chunk size or processing fewer files.';
  }
  return error.message;
}

async function activate(context) {
  // Register the create/edit .flatten_ignore command
  const createIgnoreCmd = vscode.commands.registerCommand('flatten-repo.createFlattenIgnore', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    
    const rootPath = workspaceFolders[0].uri.fsPath;
    const flattenedDir = path.join(rootPath, 'flattened');
    await fs.mkdir(flattenedDir, { recursive: true });
    
    const flattenIgnorePath = path.join(flattenedDir, '.flatten_ignore');
    const defaultIgnoreContent = `# .flatten_ignore
# This file controls which files and directories are ignored or explicitly included during flattening.
# Use glob patterns here.
# When a directory is specified without wildcards, it is automatically treated as "directory/**".
#
# --------------------------
# Global Ignore Patterns:
global:
flattened
node_modules
.git
dist
build
venv
<<<<<<< HEAD
=======
.vscode
.idea
__pycache__
.gradle
Pods
.DS_Store
.env
>>>>>>> aec9ab3 (Refactor file and add global ignore patterns)
# --------------------------
# Local Whitelist Patterns:
whitelist:
# Example:
# src/**
# lib/**/*.js
# --------------------------
# Local Blacklist Patterns:
blacklist:
# Example:
# test/**
# *.spec.js
# --------------------------
# Settings:
# Set the token limits for flattening.
# Suggestions:
#   Claude 3.7: 128k tokens
#   ChatGPT 4o: 128k tokens
#   ChatGPT o3-mini-high: 200k tokens
#   Claude 2: 100k tokens
#   Anthropic Claude 3 Opus: 200k tokens
#   Cohere Command: 32k tokens
#   Google PaLM 2: 8k tokens
#   Meta LLaMA 2: 4k tokens
settings:
maxTokenLimit: 50000
maxTokensPerFile: 25000
`;
    await ensureFile(flattenIgnorePath, defaultIgnoreContent);
    
    // Open the file in the editor
    const doc = await vscode.workspace.openTextDocument(flattenIgnorePath);
    await vscode.window.showTextDocument(doc);
  });
  
  // Register the main flatten command with improvements
  const flattenCmd = vscode.commands.registerCommand('flatten-repo.flattenProjectToTxt', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    
    const rootPath = workspaceFolders[0].uri.fsPath;
    const flattenedDir = path.join(rootPath, 'flattened');
    
    try {
      await fs.mkdir(flattenedDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create flattened directory:', err);
      vscode.window.showErrorMessage('Failed to create /flattened directory.');
      return;
    }

    // Initialize variables at the top level so they're available throughout the function
    let processFiles = [];
    const fileList = [];
    let maxChunkSize = 0;
    let maxFileSize = 0;
    
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Analyzing repository...',
        cancellable: true
      }, async (progress, token) => {
        try {
          // Add cancellation support
          token.onCancellationRequested(() => {
            throw new Error('Operation cancelled by user');
          });
          
          // Get configuration and settings
          const config = vscode.workspace.getConfiguration('flattenRepo');
          const includeExtensions = config.get('includeExtensions', ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css']);
          
          // Get ignore rules including default library patterns
          const ignoreRules = await parseFlattenIgnore(
            path.join(flattenedDir, '.flatten_ignore'),
            rootPath
          );
          
          // Convert patterns to regex once
          const globalRegexes = patternsToRegex(ignoreRules.global);
          const whitelistRegexes = patternsToRegex(ignoreRules.whitelist);
          const blacklistRegexes = patternsToRegex([
            ...DEFAULT_LIBRARY_PATTERNS,
            ...ignoreRules.blacklist
          ]);
          
          // Get settings
          const settings = ignoreRules.settings || {};
          maxChunkSize = (settings.maxTokenLimit || 50000) * 4; // 4 chars per token
          maxFileSize = (settings.maxTokensPerFile || 25000) * 4;
          
          const tracker = new ProgressTracker(progress, token);
          
          // Set total steps (file collection + processing + writing)
          tracker.setTotalSteps(3);
          
          // Update progress calls
          tracker.increment('Collecting files...');
          
          // Define collect function with access to the regex patterns
          async function collect(dir) {
            let items;
            try {
              items = await fs.readdir(dir, { withFileTypes: true });
            } catch (err) {
              console.error(`Failed to read directory ${dir}:`, err);
              return;
            }
            
            for (const item of items) {
              if (token.isCancellationRequested) {
                throw new Error('Operation cancelled by user');
              }
              
              const fullPath = path.join(dir, item.name);
              const relative = path.relative(rootPath, fullPath);
              
              // Check global patterns first
              if (globalRegexes.some(r => r.test(relative))) continue;
              
              // Then check blacklist
              if (blacklistRegexes.some(r => r.test(relative))) continue;
              
              // If whitelist exists, file must match it
              if (whitelistRegexes.length && !whitelistRegexes.some(r => r.test(relative))) continue;
              
              if (item.isDirectory()) {
                await collect(fullPath);
              } else {
                if (!includeExtensions.includes(path.extname(item.name))) continue;
                fileList.push(fullPath);
              }
            }
          }
          
          // Collect files
          await collect(rootPath);
          
          if (fileList.length === 0) {
            throw new Error('No matching files found. Check your ignore patterns and file extensions.');
          }
          
          // Score and sort files
          tracker.increment('Processing files...');
          const scoredFiles = [];
          for (const file of fileList) {
            if (token.isCancellationRequested) {
              throw new Error('Operation cancelled by user');
            }
            
            const stats = await fs.stat(file);
            const score = await scoreFile(file, stats);
            scoredFiles.push({ file, score, size: stats.size });
          }
          
          // Sort by score descending
          scoredFiles.sort((a, b) => b.score - a.score);
          
          // Estimate number of output files
          const { estimatedFiles, totalSize } = await estimateOutputFiles(
            scoredFiles,
            maxChunkSize
          );
          
          if (estimatedFiles > 10) {
            const { suggestions, patterns } = getSuggestions(
              settings.maxTokenLimit,
              estimatedFiles,
              ignoreRules.blacklist
            );
            
            const message = 
              `This operation will create ${estimatedFiles} files ` +
              `(total size: ${(totalSize / 1024 / 1024).toFixed(1)}MB).\n\n` +
              `${suggestions.length ? `Suggestions to reduce the number of files:\n${suggestions.join('\n')}\n\n` : ''}` +
              `Choose how to proceed:`;
            
            const PROCEED = 'Proceed with all files';
            const SMALL_FILES = 'Process only smallest non-library files (50k tokens)';
            const UPDATE_IGNORE = 'Add suggested patterns to .flatten_ignore';
            const CANCEL = 'Cancel';
            
            const choice = await vscode.window.showWarningMessage(
              message,
              { modal: true },
              PROCEED,
              SMALL_FILES,
              UPDATE_IGNORE,
              CANCEL
            );
            
            if (choice === CANCEL || !choice) {
              throw new Error('Operation cancelled by user');
            }
            
            if (choice === UPDATE_IGNORE && patterns.length > 0) {
              // Update .flatten_ignore with new patterns
              const flattenIgnorePath = path.join(flattenedDir, '.flatten_ignore');
              let content = await fs.readFile(flattenIgnorePath, 'utf8');
              const newPatterns = patterns.map(p => p).join('\n');
              content = content.replace(/blacklist:\n/, `blacklist:\n${newPatterns}\n`);
              await fs.writeFile(flattenIgnorePath, content, 'utf8');
              throw new Error('Updated .flatten_ignore with new patterns. Please run the flatten command again.');
            }
            
            if (choice === SMALL_FILES) {
              // Filter to only include smallest non-library files up to 50k tokens
              const smallestFiles = scoredFiles
                .filter(f => !matchesPatterns(path.relative(rootPath, f.file), DEFAULT_LIBRARY_PATTERNS))
                .sort((a, b) => a.size - b.size);
              
              let totalTokens = 0;
              const tokenLimit = 50000;
              const selectedFiles = [];
              
              for (const file of smallestFiles) {
                const estimatedTokens = file.size / 4;
                if (totalTokens + estimatedTokens > tokenLimit) break;
                selectedFiles.push(file);
                totalTokens += estimatedTokens;
              }
              
              processFiles = selectedFiles;
            } else {
              processFiles = scoredFiles;
            }
          } else {
            processFiles = scoredFiles;
          }
          
          if (processFiles.length === 0) {
            throw new Error('No files to process after filtering. Try adjusting your settings or using "Proceed with all files".');
          }
          
          // Process files in batches
          tracker.increment('Processing files...');
          const batchSize = 10;
          const batches = [];
          const sortedFiles = processFiles.map(f => f.file);
          
          const results = await processFilesInParallel(sortedFiles, rootPath, maxFileSize);
          
          const chunks = createChunksEfficiently(results, maxChunkSize);
          
          if (chunks.length === 0) {
            throw new Error('No output files created. All files may have been too large or filtered out.');
          }
          
          // Write chunks to files
          tracker.increment('Writing output files...');
          const now = new Date();
          const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const timestamp = `${now.getHours()}:${now.getMinutes()},${now.getDate()}-${monthNames[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;
          
          for (let i = 0; i < chunks.length; i++) {
            if (token.isCancellationRequested) {
              throw new Error('Operation cancelled by user');
            }
            
            const treeString = buildDirectoryTree(chunks[i].files);
            const header = `=== Directory Tree ===\n${treeString}\n\n`;
            const filePath = path.join(flattenedDir, `${timestamp}_${i + 1}.txt`);
            await fs.writeFile(filePath, header + chunks[i].content, 'utf-8');
          }
          
          vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${chunks.length} file(s).`);
          
          // Update .gitignore
          const gitignorePath = path.join(rootPath, '.gitignore');
          try {
            let gitignore = '';
            try {
              gitignore = await fs.readFile(gitignorePath, 'utf-8');
            } catch {
              // File doesn't exist, that's fine
            }
            if (!gitignore.includes('/flattened')) {
              gitignore += `${gitignore.endsWith('\n') ? '' : '\n'}/flattened\n`;
              await fs.writeFile(gitignorePath, gitignore, 'utf-8');
            }
          } catch (err) {
            console.error('Failed to update .gitignore:', err);
            // Non-critical error, don't throw
          }
        } catch (err) {
          const detailedMessage = getDetailedErrorMessage(err);
          vscode.window.showErrorMessage(`Error during flattening: ${detailedMessage}`);
          throw err;
        }
      });
    } catch (err) {
      console.error('Error during flattening:', err);
      if (err.message.includes('Updated .flatten_ignore')) {
        vscode.window.showInformationMessage(err.message);
      } else if (err.message === 'Operation cancelled by user') {
        vscode.window.showInformationMessage('Flattening operation cancelled.');
      } else {
        vscode.window.showErrorMessage(`Error during flattening: ${err.message}`);
      }
    }
  });
  
  context.subscriptions.push(createIgnoreCmd, flattenCmd);
}

// Worker thread code
if (!isMainThread) {
  const { files } = workerData;
  
  (async () => {
    const results = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        results.push({ file, content });
      } catch (err) {
        console.error(`Error reading ${file}:`, err);
      }
    }
    parentPort.postMessage(results);
  })();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
