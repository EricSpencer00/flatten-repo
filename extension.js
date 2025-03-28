const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

// ----- Helper Functions -----

/**
 * Converts a glob pattern to a regular expression.
 * This function first escapes special regex characters (except '*' and '?'),
 * then replaces '**' with a temporary token, '*' with a regex that matches any character except a slash,
 * then restores the token to match any character (including slashes), and finally replaces '?' with '.'.
 * @param {string} glob 
 * @returns {RegExp}
 */
function toRegex(glob) {
  // Escape regex special characters, excluding * and ?
  let escaped = glob.replace(/([.+^${}()|[\]\\])/g, '\\$1');
  // Replace '**' with a temporary placeholder.
  escaped = escaped.replace(/\*\*/g, '<<<TWOSTAR>>>');
  // Replace remaining '*' with a pattern that matches anything except '/'
  escaped = escaped.replace(/\*/g, '[^/]*');
  // Replace our temporary placeholder with '.*'
  escaped = escaped.replace(/<<<TWOSTAR>>>/g, '.*');
  // Replace '?' with '.' (any single character)
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
  } catch {
    await fs.writeFile(filePath, defaultContent, 'utf-8');
    vscode.window.showInformationMessage(`✅ Created ${path.basename(filePath)} in /flattened`);
  }
}

/**
 * Parses a .flatten_ignore file into three arrays: global, whitelist, and blacklist.
 * Expects the file to use section headers "global:", "whitelist:" and "blacklist:".
 * @param {string} filePath 
 * @param {string} rootPath 
 * @returns {Promise<{global: string[], whitelist: string[], blacklist: string[]}>}
 */
async function parseFlattenIgnore(filePath, rootPath) {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    return { global: [], whitelist: [], blacklist: [] };
  }
  const lines = content.split('\n').map(line => line.trim());
  let section = null;
  const globalArr = [];
  const whitelistArr = [];
  const blacklistArr = [];
  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue;
    if (line.toLowerCase().startsWith('global:')) { section = 'global'; continue; }
    if (line.toLowerCase().startsWith('whitelist:')) { section = 'whitelist'; continue; }
    if (line.toLowerCase().startsWith('blacklist:')) { section = 'blacklist'; continue; }
    if (section === 'global') {
      globalArr.push(line);
    } else if (section === 'whitelist') {
      whitelistArr.push(line);
    } else if (section === 'blacklist') {
      blacklistArr.push(line);
    }
  }

  // For each pattern, if no glob wildcard is given and the pattern exists as a directory in the workspace,
  // then automatically treat it as "pattern/**".
  async function processPattern(pattern) {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      try {
        const full = path.join(rootPath, pattern);
        const stat = await fs.stat(full);
        if (stat.isDirectory() && !pattern.endsWith('/**')) {
          return pattern + '/**';
        }
      } catch (err) {
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
    blacklist: await processAll(blacklistArr)
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
    // 1. Create or load .flatten_ignore file
    // ==========================
    const flattenIgnorePath = path.join(flattenedDir, '.flatten_ignore');
    const defaultIgnoreContent = `# .flatten_ignore
# This file controls which files and directories are ignored or explicitly included during flattening.
# You can use glob patterns here.
# When a directory is specified without wildcards, it is automatically treated as "directory/**".
#
# --------------------------
# Global Ignore Patterns:
# Files or directories matching these patterns will always be ignored.
global:
node_modules
.git
dist
build
# --------------------------
# Local Whitelist Patterns:
# If any patterns are specified here, then only files matching at least one of these patterns will be included.
whitelist:
# Example:
# src/**
# lib/**/*.js
# --------------------------
# Local Blacklist Patterns:
# Files matching these patterns will be excluded.
blacklist:
# Example:
# test/**
# *.spec.js
`;
    await ensureFile(flattenIgnorePath, defaultIgnoreContent);

    // ==========================
    // 2. Parse the .flatten_ignore file into three arrays
    // ==========================
    const ignoreRules = await parseFlattenIgnore(flattenIgnorePath, rootPath);
    // Convert glob patterns to regexes using our new converter.
    const globalIgnoreRegexes = ignoreRules.global.map(toRegex);
    const whitelistRegexes = ignoreRules.whitelist.map(toRegex);
    const blacklistRegexes = ignoreRules.blacklist.map(toRegex);

    // ==========================
    // 3. Other settings (token limits etc.)
    // ==========================
    let settings = {
      maxTokenLimit: 50000,
      maxTokensPerFile: 25000
    };
    const settingsPath = path.join(flattenedDir, 'flatten_settings.json');
    try {
      const raw = await fs.readFile(settingsPath, 'utf8');
      settings = { ...settings, ...JSON.parse(raw) };
    } catch { }
    const maxChunkSize = settings.maxTokenLimit * 4;
    const maxFileSize = settings.maxTokensPerFile * 4;
    
    // Timestamp for output file naming
    const now = new Date();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const timestamp = `${now.getHours()}:${now.getMinutes()},${now.getDate()}-${monthNames[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;

    // ==========================
    // 4. Collect files based on our new ignore/whitelist/blacklist logic
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
          // Skip if the directory matches any global ignore pattern.
          if (matchesAny(relative, globalIgnoreRegexes)) continue;
          await collect(fullPath);
        } else {
          // Skip files that match the global ignore.
          if (matchesAny(relative, globalIgnoreRegexes)) continue;
          // If a whitelist exists, the file must match one of its patterns.
          if (whitelistRegexes.length && !matchesAny(relative, whitelistRegexes)) continue;
          // Skip if it matches the blacklist.
          if (matchesAny(relative, blacklistRegexes)) continue;
          // Only include files with allowed extensions.
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
        
        let chunks = [];
        let currentChunk = '';
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
          if ((currentChunk.length + fileEntry.length) > maxChunkSize) {
            chunks.push(currentChunk);
            currentChunk = '';
          }
          currentChunk += fileEntry;
          fileCount++;
          if (fileCount % 10 === 0) {
            progress.report({ message: `${fileCount} of ${fileList.length} files processed` });
          }
        }
        if (currentChunk) chunks.push(currentChunk);
        for (let i = 0; i < chunks.length; i++) {
          const filePath = path.join(flattenedDir, `${timestamp}_${i + 1}.txt`);
          await fs.writeFile(filePath, chunks[i], 'utf-8');
        }
        vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${chunks.length} file(s).`);
      });

      // Optionally, update the workspace’s .gitignore to ignore /flattened if not already present.
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
