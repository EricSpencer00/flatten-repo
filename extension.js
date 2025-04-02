const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

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
  } catch (err) {
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

// ----- Main Extension Code -----

async function activate(context) {
  const disposable = vscode.commands.registerCommand('flatten-repo.flattenProjectToTxt', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    const flattenedDir = path.join(rootPath, 'flattened');
    await fs.mkdir(flattenedDir, { recursive: true });

    const config = vscode.workspace.getConfiguration('flattenRepo');
    const includeExtensions = config.get('includeExtensions', ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css']);

    // ==========================
    // 1. Create or load .flatten_ignore file with settings suggestions.
    // ==========================
    const flattenIgnorePath = path.join(flattenedDir, '.flatten_ignore');
    const defaultIgnoreContent = `# .flatten_ignore
# This file controls which files and directories are ignored or explicitly included during flattening.
# Use glob patterns here.
# When a directory is specified without wildcards, it is automatically treated as "directory/**".
#
# --------------------------
# Global Ignore Patterns:
global:
node_modules
.git
dist
build
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

    // ==========================
    // 2. Parse the .flatten_ignore file into four parts.
    // ==========================
    const ignoreRules = await parseFlattenIgnore(flattenIgnorePath, rootPath);
    const globalIgnoreRegexes = ignoreRules.global.map(toRegex);
    const whitelistRegexes = ignoreRules.whitelist.map(toRegex);
    const blacklistRegexes = ignoreRules.blacklist.map(toRegex);
    
    // Merge settings: use settings from .flatten_ignore if provided.
    const defaultSettings = {
      maxTokenLimit: 50000, // tokens
      maxTokensPerFile: 25000
    };
    const settings = { ...defaultSettings, ...ignoreRules.settings };

    const maxChunkSize = settings.maxTokenLimit * 4; // approximate characters (assuming 4 chars per token)
    const maxFileSize = settings.maxTokensPerFile * 4;
    
    // Timestamp for output file naming.
    const now = new Date();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const timestamp = `${now.getHours()}:${now.getMinutes()},${now.getDate()}-${monthNames[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;

    // ==========================
    // 3. Collect files based on ignore/whitelist/blacklist logic.
    // ==========================
    const fileList = [];
    async function collect(dir) {
      let items;
      try {
        items = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        console.error(`Failed to read directory ${dir}:`, err);
        return;
      }
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relative = path.relative(rootPath, fullPath);
        if (item.isDirectory()) {
          if (matchesAny(relative, globalIgnoreRegexes)) continue;
          await collect(fullPath);
        } else {
          if (matchesAny(relative, globalIgnoreRegexes)) continue;
          if (whitelistRegexes.length && !matchesAny(relative, whitelistRegexes)) continue;
          if (matchesAny(relative, blacklistRegexes)) continue;
          if (!includeExtensions.includes(path.extname(item.name))) continue;
          fileList.push(fullPath);
        }
      }
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Flattening repository...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Collecting files...' });
        await collect(rootPath);
        progress.report({ message: `Processing ${fileList.length} files...` });
        
        // Instead of just a string, group files into chunks with their own file list.
        const chunks = [];
        let currentChunk = { content: '', files: [] };
        let fileCount = 0;

        for (const file of fileList) {
          const rel = path.relative(rootPath, file);
          let content;
          try {
            content = await fs.readFile(file, 'utf-8');
          } catch (err) {
            console.error(`Error reading ${file}:`, err);
            continue;
          }
          const fileEntry = `\n\n=== FILE: ${rel} ===\n${content}`;
          if (fileEntry.length > maxFileSize) {
            console.warn(`⚠️ Skipping ${rel} (too large)`);
            continue;
          }
          if ((currentChunk.content.length + fileEntry.length) > maxChunkSize) {
            // Push current chunk and start a new one.
            chunks.push(currentChunk);
            currentChunk = { content: '', files: [] };
          }
          currentChunk.content += fileEntry;
          currentChunk.files.push(rel);
          fileCount++;
          if (fileCount % 10 === 0) {
            progress.report({ message: `${fileCount} of ${fileList.length} files processed` });
          }
        }
        if (currentChunk.content) chunks.push(currentChunk);
        
        // Write each chunk to a file, prepending a directory tree header.
        for (let i = 0; i < chunks.length; i++) {
          const treeString = buildDirectoryTree(chunks[i].files);
          const header = `=== Directory Tree ===\n${treeString}\n\n`;
          const filePath = path.join(flattenedDir, `${timestamp}_${i + 1}.txt`);
          await fs.writeFile(filePath, header + chunks[i].content, 'utf-8');
        }
        
        vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${chunks.length} file(s).`);
      });

      // Optionally update .gitignore to ignore /flattened.
      const gitignorePath = path.join(rootPath, '.gitignore');
      let gitignore = '';
      try {
        gitignore = await fs.readFile(gitignorePath, 'utf-8');
      } catch { }
      if (!gitignore.includes('/flattened')) {
        gitignore += `${gitignore.endsWith('\n') ? '' : '\n'}/flattened\n`;
        await fs.writeFile(gitignorePath, gitignore, 'utf-8');
      }
    } catch (err) {
      console.error('❌ Error during flattening:', err);
      vscode.window.showErrorMessage('An error occurred during the flattening process.');
    }
  });
  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
