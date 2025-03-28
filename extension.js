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

        const config = vscode.workspace.getConfiguration('flattenRepo');
        const includeExtensions = config.get('includeExtensions', ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css']);
        const ignoreDirs = config.get('ignoreDirs', ['node_modules', '.git', 'flattened']);

        // Load flatten_settings.json if present
        let settings = {
            maxTokenLimit: 50000,
            maxTokensPerFile: 25000
        };
        const settingsPath = path.join(flattenedDir, 'flatten_settings.json');
        try {
            const raw = await fs.readFile(settingsPath, 'utf8');
            settings = { ...settings, ...JSON.parse(raw) };
        } catch {}

        const maxChunkSize = settings.maxTokenLimit * 4;
        const maxFileSize = settings.maxTokensPerFile * 4;

        const now = new Date();
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const timestamp = `${now.getMinutes()}:${now.getSeconds()},${now.getDate()}-${monthNames[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;

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

        await ensureFile('.flatten_ignore', `# Default ignore patterns\n.env\n.env.*\n.secret\n*.log\n*.zip\n*.png`);
        await ensureFile('.flatten_whitelist', `# Optional whitelist (glob format)\n# src/**`);
        await ensureFile('.flatten_blacklist', `# Optional blacklist (glob format)\npackage.json\nnode_modules/**\n*.xml\n*.json`);

        async function readList(file) {
            try {
                const content = await fs.readFile(path.join(flattenedDir, file), 'utf-8');
                return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
            } catch {
                return [];
            }
        }

        const toRegex = glob => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        const whitelistRegexes = (await readList('.flatten_whitelist')).map(toRegex);
        const blacklistRegexes = (await readList('.flatten_blacklist')).map(toRegex);
        const ignoreRegexes = (await readList('.flatten_ignore')).map(toRegex);
        const matchesAny = (p, regexes) => regexes.some(r => r.test(p));

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
