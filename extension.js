const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

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

        // Config
        const config = vscode.workspace.getConfiguration('flattenRepo');
        const includeExtensions = config.get('includeExtensions', ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css']);
        const ignoreDirs = config.get('ignoreDirs', ['node_modules', '.git', 'flattened']);
        const maxChunkTokens = 50000;
        const estimatedCharsPerToken = 4;
        const maxChunkSize = maxChunkTokens * estimatedCharsPerToken;

        // Timestamp: m:ss,dd-MMM-yy
        const now = new Date();
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const timestamp = `${now.getMinutes()}:${now.getSeconds()},${now.getDate()}-${monthNames[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;

        // Create helper files if missing
        async function ensureFile(filename, defaultContent) {
            const filePath = path.join(flattenedDir, filename);
            try {
                await fs.access(filePath);
            } catch {
                await fs.writeFile(filePath, defaultContent, 'utf-8');
                vscode.window.showInformationMessage(`✅ Created ${filename} in /flattened`);
            }
            return filePath;
        }

        const flattenIgnorePath = await ensureFile('.flatten_ignore', `# Default ignore patterns
.env
.env.*
.secret
.secret.*
.credentials
*.log
*.zip
*.tar
*.gz
*.rar
*.7z
*.bin
*.exe
*.dll
*.so
*.dylib
*.ico
*.png
*.jpg
*.jpeg
*.gif
*.mp3
*.mp4
*.mov
*.avi
*.pdf
*.docx
*.xlsx
*.pptx
`);
        const whitelistPath = await ensureFile('.flatten_whitelist', `# Optional whitelist (glob format)
# src/**
`);
        const blacklistPath = await ensureFile('.flatten_blacklist', `# Optional blacklist (glob format)
package.json
package-lock.json
yarn.lock
babel.config.js
metro.config.js
jest.config.js
android/**
ios/**
assets/**
`);

        async function readList(file) {
            try {
                const content = await fs.readFile(path.join(flattenedDir, file), 'utf-8');
                return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
            } catch {
                return [];
            }
        }

        const whitelistPatterns = await readList('.flatten_whitelist');
        const blacklistPatterns = await readList('.flatten_blacklist');
        const ignorePatterns = await readList('.flatten_ignore');

        const toRegex = glob =>
            new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

        const whitelistRegexes = whitelistPatterns.map(toRegex);
        const blacklistRegexes = blacklistPatterns.map(toRegex);
        const ignoreRegexes = ignorePatterns.map(toRegex);

        const matchesAny = (path, regexes) => regexes.some(re => re.test(path));

        // File collection
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
                    if (ignoreDirs.includes(item.name) || item.name.startsWith('.')) continue;
                    await collect(fullPath);
                } else {
                    const ext = path.extname(item.name);
                    if (!includeExtensions.includes(ext)) continue;
                    if (whitelistRegexes.length && !matchesAny(relative, whitelistRegexes)) continue;
                    if (matchesAny(relative, blacklistRegexes)) continue;
                    if (matchesAny(relative, ignoreRegexes)) continue;

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

                let output = '';
                let processed = 0;

                for (const file of fileList) {
                    try {
                        const rel = path.relative(rootPath, file);
                        output += `\n\n=== FILE: ${rel} ===\n`;
                        output += await fs.readFile(file, 'utf-8');
                    } catch (err) {
                        console.error(`Error reading ${file}:`, err);
                    }
                    if (++processed % 10 === 0) {
                        progress.report({ message: `${processed}/${fileList.length} files processed` });
                    }
                }

                const chunks = [];
                for (let i = 0; i < output.length; i += maxChunkSize) {
                    chunks.push(output.slice(i, i + maxChunkSize));
                }

                for (let i = 0; i < chunks.length; i++) {
                    const outPath = path.join(flattenedDir, `${timestamp}_${i + 1}.txt`);
                    await fs.writeFile(outPath, chunks[i], 'utf-8');
                }

                vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${chunks.length} file(s).`);
            });

            // Add /flattened to .gitignore
            const gitignorePath = path.join(rootPath, '.gitignore');
            let gitignore = '';
            try {
                gitignore = await fs.readFile(gitignorePath, 'utf-8');
            } catch {}

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
