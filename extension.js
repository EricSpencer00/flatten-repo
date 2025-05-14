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
  } catch (error) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, defaultContent, 'utf-8');
      vscode.window.showInformationMessage(`✅ Created ${path.basename(filePath)} in /flattened`);
    } catch (writeError) {
      const errorMessage = `Failed to create ${path.basename(filePath)}: ${getDetailedErrorMessage(writeError)}`;
      vscode.window.showErrorMessage(errorMessage);
      throw new Error(errorMessage);
    }
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
  const errors = [];
  
  // Split files into batches
  for (let i = 0; i < files.length; i += maxConcurrent) {
    batches.push(files.slice(i, i + maxConcurrent));
  }

  // Process batches in parallel
  for (const batch of batches) {
    const batchPromises = batch.map(async file => {
      try {
        const stats = await fs.stat(file);
        if (stats.size > maxFileSize) {
          console.warn(`⚠️ Skipping ${path.relative(rootPath, file)} (exceeds size limit of ${maxFileSize} bytes)`);
          return null;
        }

        const content = await fs.readFile(file, 'utf-8');
        const rel = path.relative(rootPath, file);
        return { file, content, rel, stats };
      } catch (err) {
        const errorMessage = `Error processing ${file}: ${getDetailedErrorMessage(err)}`;
        errors.push(errorMessage);
        console.error(errorMessage);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(r => r !== null));
  }

  if (errors.length > 0) {
    vscode.window.showWarningMessage(`⚠️ Some files could not be processed. Check the output for details.`);
  }

  return results;
}

/**
 * Estimates the total size of files and suggests optimizations
 * @param {Array<{file: string, size: number}>} files 
 * @param {number} maxChunkSize 
 * @returns {Promise<{estimatedFiles: number, totalSize: number, suggestions: string[]}>}
 */
async function estimateOutputFiles(files, maxChunkSize) {
  let currentChunkSize = 0;
  let numChunks = 1;
  let totalSize = 0;
  const suggestions = [];

  for (const { size } of files) {
    totalSize += size;
    if ((currentChunkSize + size) > maxChunkSize) {
      numChunks++;
      currentChunkSize = size;
    } else {
      currentChunkSize += size;
    }
  }

  // Add suggestions if multiple files would be created
  if (numChunks > 1) {
    suggestions.push(
      `⚠️ This will create ${numChunks} files (${(totalSize / 1024 / 1024).toFixed(1)}MB total).`,
      "To reduce to a single file, you can:",
      "1. Increase maxTokenLimit in settings",
      "2. Add more patterns to blacklist",
      "3. Use 'Process only smallest non-library files' option"
    );
  }

  return { estimatedFiles: numChunks, totalSize, suggestions };
}

/**
 * Ensures output is a single file by adjusting settings or filtering files
 * @param {Array<{file: string, size: number, score: number}>} files 
 * @param {number} maxChunkSize 
 * @returns {Promise<{files: Array, maxChunkSize: number}>}
 */
async function ensureSingleFileOutput(files, maxChunkSize) {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  
  // If total size is within limits, no changes needed
  if (totalSize <= maxChunkSize) {
    return { files, maxChunkSize };
  }

  // Show warning and get user choice
  const message = 
    `⚠️ The total size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds the current limit.\n\n` +
    `Choose how to proceed:`;
  
  const INCREASE_LIMIT = 'Increase token limit';
  const FILTER_FILES = 'Filter to smallest files';
  const CANCEL = 'Cancel';
  
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    INCREASE_LIMIT,
    FILTER_FILES,
    CANCEL
  );

  if (choice === CANCEL || !choice) {
    throw new Error('Operation cancelled by user');
  }

  if (choice === INCREASE_LIMIT) {
    // Calculate required limit (add 20% buffer)
    const requiredLimit = Math.ceil(totalSize * 1.2);
    return { files, maxChunkSize: requiredLimit };
  }

  if (choice === FILTER_FILES) {
    // Sort by size and filter to fit within current limit
    const sortedFiles = files
      .sort((a, b) => a.size - b.size);
    
    let currentSize = 0;
    const filteredFiles = [];
    
    for (const file of sortedFiles) {
      if (currentSize + file.size > maxChunkSize) break;
      filteredFiles.push(file);
      currentSize += file.size;
    }

    if (filteredFiles.length === 0) {
      throw new Error('No files small enough to fit within the limit. Try increasing the token limit.');
    }

    return { files: filteredFiles, maxChunkSize };
  }

  return { files, maxChunkSize };
}

/**
 * Common library and build tool patterns that should be ignored by default
 */
const DEFAULT_LIBRARY_PATTERNS = [
  // Generated code patterns - catch any framework's generated files
  '**/generated/**',
  '**/.generated/**',
  '**/auto-generated/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/output/**',
  '**/target/**',
  '**/_build/**',
  '**/compiled/**',
  '**/transpiled/**',
  '**/bundles/**',
  '**/releases/**',
  '**/public/assets/**',
  '**/public/static/**',
  '**/static/generated/**',
  '**/lib/generated/**',
  '**/src/generated/**',
  '**/gen/**',
  '**/gen-*/**',
  '**/*.generated.*',
  '**/*-generated.*',
  '**/*.gen.*',
  '**/*.g.*',
  
  // Library and dependency directories
  '**/node_modules/**',
  '**/bower_components/**',
  '**/vendor/**',
  '**/third-party/**',
  '**/external/**',
  '**/deps/**',
  '**/packages/**',
  '**/lib/vendor/**',
  '**/assets/vendor/**',
  '**/externals/**',
  '**/dependencies/**',
  
  // Common build artifacts and intermediates
  '**/intermediates/**',
  '**/temp/**',
  '**/tmp/**',
  '**/.tmp/**',
  '**/cache/**',
  '**/.cache/**',
  '**/artifacts/**',
  '**/obj/**',
  '**/bin/**',
  '**/Debug/**',
  '**/Release/**',
  '**/x64/**',
  '**/x86/**',
  '**/arm64/**',
  '**/publish/**',
  
  // Framework agnostic build/bundle files
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.*',
  '**/*.chunk.*',
  '**/*.umd.*',
  '**/*.esm.*',
  '**/*.cjs.*',
  '**/*.module.*',
  '**/*.compiled.*',
  '**/*.transpiled.*',
  '**/*.optimized.*',
  '**/*.processed.*',
  '**/*.map',
  
  // Common configuration files
  '**/*config.*',
  '**/*conf.*',
  '**/*.config.js',
  '**/*.config.ts',
  '**/*.config.json',
  '**/*.conf.js',
  '**/*.conf.ts',
  '**/*.conf.json',
  '**/.*rc',
  '**/.*rc.js',
  '**/.*rc.json',
  '**/.*rc.yaml',
  '**/.*rc.yml',
  
  // Lock files and dependency management
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/*-lock.*',
  '**/*.lock',
  '**/requirements.txt',
  '**/requirements/*.txt',
  '**/deps.ts',
  '**/deps.js',
  '**/dependencies.xml',
  
  // Type definitions and declarations
  '**/*.d.ts',
  '**/@types/**',
  '**/typings/**',
  '**/types/**',
  '**/type-definitions/**',
  '**/definitions/**',
  '**/*.types.*',
  '**/*-types.*',
  '**/*-typings.*',
  '**/type-declarations/**',
  
  // Common test and development files
  '**/test/**',
  '**/tests/**',
  '**/spec/**',
  '**/specs/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/__snapshots__/**',
  '**/test-*/**',
  '**/testing/**',
  '**/e2e/**',
  '**/integration/**',
  '**/fixtures/**',
  '**/mocks/**',
  '**/stubs/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.e2e.*',
  '**/*.fixture.*',
  '**/*.mock.*',
  '**/*.stub.*',
  
  // Documentation
  '**/docs/**',
  '**/doc/**',
  '**/documentation/**',
  '**/api-docs/**',
  '**/api-documentation/**',
  '**/reference/**',
  '**/guides/**',
  '**/examples/**',
  '**/demo/**',
  '**/samples/**',
  
  // IDE and editor files
  '**/.idea/**',
  '**/.vscode/**',
  '**/.vs/**',
  '**/.eclipse/**',
  '**/.settings/**',
  '**/.project',
  '**/.classpath',
  '**/.factorypath',
  '**/*.sublime-*',
  '**/*.iml',
  '**/*.ipr',
  '**/*.iws',
  
  // Version control
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/.github/**',
  '**/.gitlab/**',
  '**/.bzr/**',
  
  // Temporary and backup files
  '**/*~',
  '**/*.bak',
  '**/*.backup',
  '**/*.old',
  '**/*.orig',
  '**/*.swp',
  '**/*.tmp',
  '**/*.temp',
  '**/Thumbs.db',
  '**/.DS_Store',
  
  // Common resource directories
  '**/resources/static/**',
  '**/resources/public/**',
  '**/resources/assets/**',
  '**/assets/generated/**',
  '**/static/generated/**',
  '**/public/generated/**',
  '**/resources/generated/**',
  '**/assets/compiled/**',
  '**/static/compiled/**',
  '**/public/compiled/**',
  
  // Common metadata and manifest files
  '**/META-INF/**',
  '**/WEB-INF/**',
  '**/MANIFEST.MF',
  '**/manifest.*',
  '**/manifest-*.json',
  '**/asset-manifest.*',
  '**/resource-manifest.*',
  '**/build-manifest.*',
  
  // Logs and reports
  '**/logs/**',
  '**/log/**',
  '**/reports/**',
  '**/report/**',
  '**/coverage/**',
  '**/.coverage/**',
  '**/coverage-*/**',
  '**/htmlcov/**',
  '**/*.log',
  '**/*.log.*',
  '**/report.*',
  '**/reports.*'
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
 * Memory-efficient chunk creation that ensures single file output
 * @param {Array<{rel: string, content: string}>} files 
 * @param {number} maxChunkSize 
 * @returns {Array<{content: string, files: string[]}>}
 */
function createChunksEfficiently(files, maxChunkSize) {
  // Set hard limit for single file (Claude 3 Sonnet/GPT-4 Turbo compatible)
  const HARD_LIMIT = 512 * 1024; // ~128K tokens
  
  let totalContent = '';
  const includedFiles = [];
  const skippedFiles = [];
  
  for (const { rel, content } of files) {
    const fileEntry = `\n\n=== FILE: ${rel} ===\n${content}`;
    
    // If adding this file would exceed the hard limit, skip it
    if ((totalContent.length + fileEntry.length) > HARD_LIMIT) {
      skippedFiles.push(rel);
      continue;
    }
    
    totalContent += fileEntry;
    includedFiles.push(rel);
  }
  
  // If we skipped files, add a warning message
  if (skippedFiles.length > 0) {
    const warningMessage = `\n\n=== WARNING: CONTENT TRUNCATED ===\nThe following ${skippedFiles.length} files were skipped to stay within LLM token limits:\n${skippedFiles.join('\n')}\n`;
    totalContent = warningMessage + totalContent;
  }
  
  return [{
    content: totalContent,
    files: includedFiles
  }];
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
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack || ''}`;
  }
  return String(error);
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
# Use glob patterns here. When a directory is specified without wildcards, it is automatically treated as "directory/**".
#
# --------------------------
# Global Ignore Patterns:
# These patterns are always ignored, regardless of other settings
global:
# Generated code and build artifacts
generated/**
dist/**
build/**
out/**
target/**
.next/**
.nuxt/**
output/**
jar-resources/**
flow-generated/**
flow/generated/**
vaadin-dev-tools/**

# Package managers and dependencies
node_modules/**
bower_components/**
jspm_packages/**
vendor/**

# Build configuration
package-lock.json
yarn.lock
pnpm-lock.yaml
composer.lock
Gemfile.lock
poetry.lock
requirements.txt
go.sum
Cargo.lock
pom.xml
build.gradle
gradle.properties
*.config.js
*.config.ts
tsconfig*.json
webpack*.js
rollup*.js
vite*.js
vite*.ts

# Framework-specific
vaadin-*.js
vaadin-*.ts
vaadin/*.js
vaadin/*.ts
flow/*.js
flow/*.ts
flow-component-*.js
flow-component-*.ts
generated-flow-*.js
generated-flow-*.ts

# Type definitions
*.d.ts
types.ts
types/*.ts
typings/*.ts

# Cache and temporary
.cache/**
tmp/**
temp/**
coverage/**
.nyc_output/**

# IDE and editor
.idea/**
.vscode/**
.vs/**
.project/**
.settings/**
.classpath
.factorypath

# Version control
.git/**
.svn/**
.hg/**
.github/**

# Test and example files
test/**
tests/**
spec/**
specs/**
__tests__/**
__mocks__/**
fixtures/**
mocks/**
stubs/**
test-data/**
test-utils/**
testing-utils/**
e2e/**
*.test.*
*.spec.*
examples/**
example/**
demo/**
demos/**
samples/**

# --------------------------
# Local Whitelist Patterns:
# These patterns are always included, even if they match global ignore patterns
whitelist:
# Core application code
src/main/java/**/*.java
src/main/kotlin/**/*.kt
src/main/scala/**/*.scala
src/main/python/**/*.py
src/main/js/**/*.js
src/main/ts/**/*.ts
src/main/jsx/**/*.jsx
src/main/tsx/**/*.tsx

# Important configuration that should be included
README.md
CONTRIBUTING.md
LICENSE
# --------------------------
# Local Blacklist Patterns:
# These patterns are ignored in addition to global patterns
blacklist:
# Add any additional patterns specific to your project

# --------------------------
# Settings:
# Configure token limits and other processing options
settings:
# Token limits for different LLMs (characters, ~4 chars per token):
# - Claude 3 Opus: ~800K chars (200K tokens)
# - Claude 3 Sonnet: ~512K chars (128K tokens) [DEFAULT]
# - GPT-4 Turbo: ~512K chars (128K tokens)
# - Claude 2: ~400K chars (100K tokens)
# - GPT-4: ~128K chars (32K tokens)
# - GPT-3.5 Turbo: ~64K chars (16K tokens)
maxTokenLimit: 128000
maxTokensPerFile: 25000
# Processing options
useGitIgnore: true
maxConcurrentFiles: 4
`;

    await ensureFile(flattenIgnorePath, defaultIgnoreContent);
    
    // Open the file in the editor
    const doc = await vscode.workspace.openTextDocument(flattenIgnorePath);
    await vscode.window.showTextDocument(doc);
  });

  // Register the flatten repository command
  let disposable = vscode.commands.registerCommand('flatten-repo.flattenProjectToTxt', async () => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        throw new Error('No workspace folder is open');
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const flattenedDir = path.join(rootPath, 'flattened');
      
      // Create the flattened directory if it doesn't exist
      try {
        await fs.mkdir(flattenedDir, { recursive: true });
      } catch (err) {
        console.error(`Failed to create flattened directory: ${getDetailedErrorMessage(err)}`);
        vscode.window.showErrorMessage(`Failed to create flattened directory: ${getDetailedErrorMessage(err)}`);
        return;
      }
      
      // Ensure the .flatten_ignore file exists
      const flattenIgnorePath = path.join(flattenedDir, '.flatten_ignore');
      const defaultIgnoreContent = `# .flatten_ignore
# This file controls which files and directories are ignored or explicitly included during flattening.
# Use glob patterns here. When a directory is specified without wildcards, it is automatically treated as "directory/**".
#
# --------------------------
# Global Ignore Patterns:
# These patterns are always ignored, regardless of other settings
global:
# Generated code and build artifacts
generated/**
dist/**
build/**
out/**
target/**
.next/**
.nuxt/**
output/**
jar-resources/**
flow-generated/**
flow/generated/**
vaadin-dev-tools/**

# Package managers and dependencies
node_modules/**
bower_components/**
jspm_packages/**
vendor/**

# Build configuration
package-lock.json
yarn.lock
pnpm-lock.yaml
composer.lock
Gemfile.lock
poetry.lock
requirements.txt
go.sum
Cargo.lock
# Generated files
*.min.js
*.min.css
*.map
*.bundle.*
*.chunk.*
# Documentation
docs/api
docs/generated
api-docs
jsdoc
javadoc
swagger
# Test and example files
test
tests
spec
__tests__
__mocks__
fixtures
mocks
stubs
test-data
test-utils
testing-utils
examples
demo
samples
# Environment and configuration
.env
.env.*
config
configs
settings
# IDE and editor files
.vscode
.idea
.vs
.project
.settings
.classpath
.factorypath
# Version control
.git/**
.svn/**
.hg/**
.github/**

# Test and example files
test/**
tests/**
spec/**
specs/**
__tests__/**
__mocks__/**
fixtures/**
mocks/**
stubs/**
test-data/**
test-utils/**
testing-utils/**
e2e/**
*.test.*
*.spec.*
examples/**
example/**
demo/**
demos/**
samples/**

# --------------------------
# Local Whitelist Patterns:
# These patterns are always included, even if they match global ignore patterns
whitelist:
# Core application code
src/main/java/**/*.java
src/main/kotlin/**/*.kt
src/main/scala/**/*.scala
src/main/python/**/*.py
src/main/js/**/*.js
src/main/ts/**/*.ts
src/main/jsx/**/*.jsx
src/main/tsx/**/*.tsx

# Important configuration that should be included
README.md
CONTRIBUTING.md
LICENSE
# --------------------------
# Local Blacklist Patterns:
# These patterns are ignored in addition to global patterns
blacklist:
# Add any additional patterns specific to your project

# --------------------------
# Settings:
# Configure token limits and other processing options
settings:
# Token limits for different LLMs (characters, ~4 chars per token):
# - Claude 3 Opus: ~800K chars (200K tokens)
# - Claude 3 Sonnet: ~512K chars (128K tokens) [DEFAULT]
# - GPT-4 Turbo: ~512K chars (128K tokens)
# - Claude 2: ~400K chars (100K tokens)
# - GPT-4: ~128K chars (32K tokens)
# - GPT-3.5 Turbo: ~64K chars (16K tokens)
maxTokenLimit: 128000
maxTokensPerFile: 25000
# Processing options
useGitIgnore: true
maxConcurrentFiles: 4
`;

      try {
        await ensureFile(flattenIgnorePath, defaultIgnoreContent);
      } catch (err) {
        console.error(`Failed to create .flatten_ignore file: ${getDetailedErrorMessage(err)}`);
        vscode.window.showErrorMessage(`Failed to create .flatten_ignore file: ${getDetailedErrorMessage(err)}`);
        // Continue with default ignore patterns
      }
      
      const config = vscode.workspace.getConfiguration('flattenRepo');
      
      // Validate configuration with defaults if invalid
      let includeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css'];
      let ignoreDirs = [];
      let useGitIgnore = true;
      
      try {
        if (Array.isArray(config.get('includeExtensions'))) {
          includeExtensions = config.get('includeExtensions');
        }
        if (Array.isArray(config.get('ignoreDirs'))) {
          ignoreDirs = config.get('ignoreDirs');
        }
        if (typeof config.get('useGitIgnore') === 'boolean') {
          useGitIgnore = config.get('useGitIgnore');
        }
      } catch (err) {
        console.error(`Invalid configuration: ${getDetailedErrorMessage(err)}`);
        vscode.window.showWarningMessage('Using default configuration due to invalid settings.');
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Flattening repository...',
        cancellable: true
      }, async (progress, token) => {
        try {
          // Add cancellation support
          token.onCancellationRequested(() => {
            throw new Error('Operation cancelled by user');
          });
          
          // Get ignore rules including default library patterns
          let ignoreRules = { global: [], whitelist: [], blacklist: [], settings: {} };
          try {
            ignoreRules = await parseFlattenIgnore(
              flattenIgnorePath,
              rootPath
            );
          } catch (err) {
            console.error(`Failed to parse .flatten_ignore file: ${getDetailedErrorMessage(err)}`);
            vscode.window.showWarningMessage('Using default ignore patterns due to error parsing .flatten_ignore file.');
          }
          
          // Convert patterns to regex once
          const globalRegexes = patternsToRegex(ignoreRules.global);
          const whitelistRegexes = patternsToRegex(ignoreRules.whitelist);
          const blacklistRegexes = patternsToRegex([
            ...DEFAULT_LIBRARY_PATTERNS,
            ...ignoreRules.blacklist
          ]);
          
          // Get settings
          const settings = ignoreRules.settings || {};
          const maxChunkSize = (settings.maxTokenLimit || 50000) * 4; // 4 chars per token
          const maxFileSize = (settings.maxTokensPerFile || 25000) * 4;
          
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
              
              // Skip the flattened directory itself
              if (relative === 'flattened') continue;
              
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
          const fileList = [];
          await collect(rootPath);
          
          if (fileList.length === 0) {
            vscode.window.showWarningMessage('No matching files found. Check your ignore patterns and file extensions.');
            return;
          }
          
          // Score and sort files
          tracker.increment('Processing files...');
          const scoredFiles = [];
          for (const file of fileList) {
            if (token.isCancellationRequested) {
              throw new Error('Operation cancelled by user');
            }
            
            try {
              const stats = await fs.stat(file);
              const score = await scoreFile(file, stats);
              scoredFiles.push({ file, score, size: stats.size });
            } catch (err) {
              console.error(`Failed to process file ${file}: ${getDetailedErrorMessage(err)}`);
              // Continue with other files
            }
          }
          
          if (scoredFiles.length === 0) {
            vscode.window.showWarningMessage('No files could be processed. Check file permissions and try again.');
            return;
          }
          
          // Sort by score descending
          scoredFiles.sort((a, b) => b.score - a.score);
          
          // Process files in batches with error handling
          tracker.increment('Processing files...');
          const sortedFiles = scoredFiles.map(f => f.file);
          
          let results = [];
          try {
            results = await processFilesInParallel(sortedFiles, rootPath, maxFileSize);
          } catch (err) {
            console.error(`Error processing files: ${getDetailedErrorMessage(err)}`);
            vscode.window.showWarningMessage('Some files could not be processed. Continuing with available content.');
            
            // Try to recover with a simpler approach if parallel processing fails
            if (results.length === 0) {
              for (const file of sortedFiles.slice(0, 100)) { // Limit to first 100 files as fallback
                try {
                  const stats = await fs.stat(file);
                  if (stats.size <= maxFileSize) {
                    const content = await fs.readFile(file, 'utf-8');
                    const rel = path.relative(rootPath, file);
                    results.push({ file, content, rel, stats });
                  }
                } catch (fileErr) {
                  console.error(`Failed to read file ${file}: ${getDetailedErrorMessage(fileErr)}`);
                  // Continue with other files
                }
              }
            }
          }
          
          if (results.length === 0) {
            vscode.window.showErrorMessage('Failed to process any files. Please check the console for errors.');
            return;
          }
          
          let chunks = [];
          try {
            chunks = createChunksEfficiently(results, maxChunkSize);
          } catch (err) {
            console.error(`Error creating chunks: ${getDetailedErrorMessage(err)}`);
            
            // Simple fallback chunking if the efficient method fails
            const simpleChunk = {
              content: results.map(r => `\n\n--- ${r.rel} ---\n\n${r.content}`).join('\n'),
              files: results.map(r => r.rel)
            };
            chunks = [simpleChunk];
          }
          
          if (chunks.length === 0) {
            vscode.window.showErrorMessage('Failed to create output chunks. Please check the console for errors.');
            return;
          }
          
          // Write single file
          tracker.increment('Writing output file...');
          const now = new Date();
          const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getFullYear()).slice(-2)}`;
          
          try {
            const treeString = buildDirectoryTree(chunks[0].files);
            const header = `=== Directory Tree ===\n${treeString}\n\n`;
            const filePath = path.join(flattenedDir, `${timestamp}.txt`);
            await fs.writeFile(filePath, header + chunks[0].content, 'utf-8');
            
            vscode.window.showInformationMessage(`✅ Flattened ${chunks[0].files.length} files into a single file in /flattened directory.`);
            
            // Open the file
            try {
              const doc = await vscode.workspace.openTextDocument(filePath);
              await vscode.window.showTextDocument(doc);
            } catch (err) {
              console.error(`Failed to open output file: ${getDetailedErrorMessage(err)}`);
            }
          } catch (writeErr) {
            console.error(`Failed to write output file: ${getDetailedErrorMessage(writeErr)}`);
            vscode.window.showErrorMessage('Failed to write output file. Please check the console for errors.');
            return;
          }
          
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
        } catch (error) {
          const errorMessage = getDetailedErrorMessage(error);
          vscode.window.showErrorMessage(`Failed during operation: ${errorMessage}`);
          console.error(errorMessage);
        }
      });
    } catch (error) {
      const errorMessage = getDetailedErrorMessage(error);
      vscode.window.showErrorMessage(`Failed to flatten repository: ${errorMessage}`);
      console.error(errorMessage);
    }
  });

  context.subscriptions.push(createIgnoreCmd);
  context.subscriptions.push(disposable);
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
