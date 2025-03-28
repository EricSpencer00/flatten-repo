const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

async function activate(context) {
    let disposable = vscode.commands.registerCommand('flatten-repo.flattenProjectToTxt', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;

        const config = vscode.workspace.getConfiguration('flattenRepo');
        const includeExtensions = config.get('includeExtensions', [
            '.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css'
        ]);
        const ignoreDirs = config.get('ignoreDirs', ['node_modules', '.git', 'flattened']);
        const maxChunkTokens = 50000;
        const estimatedCharsPerToken = 4;
        const maxChunkSize = maxChunkTokens * estimatedCharsPerToken;

        const flattenedDir = path.join(rootPath, 'flattened');
        await fs.mkdir(flattenedDir, { recursive: true });

        // Generate timestamp
        const now = new Date();
        const timestamp = [
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getFullYear())
        ].join(',');

        // Utility: create file if missing
        async function ensureFile(filePath, defaultContent) {
            try {
                await fs.access(filePath);
            } catch {
                await fs.writeFile(filePath, defaultContent, 'utf-8');
                vscode.window.showInformationMessage(`✅ Created default ${path.basename(filePath)}`);
            }
        }

        // Create ignore files with defaults
        await ensureFile(path.join(rootPath, 'flattened/.flatten_ignore'), `# Default ignore patterns
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

        await ensureFile(path.join(rootPath, 'flatten/.flatten_whitelist'), `# Optional whitelist (glob format)
# src/**
`);

        await ensureFile(path.join(rootPath, 'flatten/.flatten_blacklist'), `# Optional blacklist (glob format)
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

        // Read any list file
        async function readListFile(filename) {
            try {
                const data = await fs.readFile(path.join(rootPath, filename), 'utf-8');
                return data.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
            } catch {
                return [];
            }
        }

        const whitelistPatterns = await readListFile('.flatten_whitelist');
        const blacklistPatterns = await readListFile('.flatten_blacklist');
        const flattenIgnorePatterns = await readListFile('.flatten_ignore');

        const globToRegExp = glob => new RegExp(
            `^${glob
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')}$`
        );

        const whitelistRegexes = whitelistPatterns.map(globToRegExp);
        const blacklistRegexes = blacklistPatterns.map(globToRegExp);
        const flattenIgnoreRegexes = flattenIgnorePatterns.map(globToRegExp);

        const matchesAnyGlob = (filePath, regexArray) => regexArray.some(regex => regex.test(filePath));

        // Recursively collect files
        let fileList = [];
        async function collectFiles(dir) {
            let items;
            try {
                items = await fs.readdir(dir, { withFileTypes: true });
            } catch (err) {
                console.error(`Error reading directory: ${dir}`, err);
                return;
            }
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                    if (ignoreDirs.includes(item.name) || item.name.startsWith('.')) continue;
                    await collectFiles(fullPath);
                } else {
                    const ext = path.extname(item.name);
                    const relativePath = path.relative(rootPath, fullPath);

                    if (!includeExtensions.includes(ext)) continue;
                    if (whitelistRegexes.length && !matchesAnyGlob(relativePath, whitelistRegexes)) continue;
                    if (matchesAnyGlob(relativePath, blacklistRegexes)) continue;
                    if (matchesAnyGlob(relativePath, flattenIgnoreRegexes)) continue;

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
                await collectFiles(rootPath);
                progress.report({ message: `Found ${fileList.length} files. Processing...` });

                let outputContent = '';
                let processed = 0;

                for (const file of fileList) {
                    try {
                        const relativePath = path.relative(rootPath, file);
                        outputContent += `\n\n=== FILE: ${relativePath} ===\n`;
                        const content = await fs.readFile(file, 'utf-8');
                        outputContent += content;
                    } catch (err) {
                        console.error(`Error reading file: ${file}`, err);
                    }
                    processed++;
                    if (processed % 10 === 0) {
                        progress.report({ message: `${processed} of ${fileList.length} files processed` });
                    }
                }

                const chunks = [];
                for (let i = 0; i < outputContent.length; i += maxChunkSize) {
                    chunks.push(outputContent.slice(i, i + maxChunkSize));
                }

                for (let i = 0; i < chunks.length; i++) {
                    const filename = `${timestamp}_${i + 1}.txt`;
                    const filePath = path.join(flattenedDir, filename);
                    await fs.writeFile(filePath, chunks[i], 'utf-8');
                }

                vscode.window.showInformationMessage(
                    `✅ Flattened ${fileList.length} files into ${chunks.length} chunk(s) in /flattened folder.`
                );
            });

            // Ensure /flattened is in .gitignore
            const gitignorePath = path.join(rootPath, '.gitignore');
            let gitignoreContent = '';
            try {
                gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
            } catch (err) {
                if (err.code !== 'ENOENT') console.error('Error reading .gitignore:', err);
            }

            if (!gitignoreContent.includes('/flattened')) {
                gitignoreContent += `${gitignoreContent.endsWith('\n') ? '' : '\n'}/flattened\n`;
                await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
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
