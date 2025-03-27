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

        // Get user configuration from workspace settings
        const config = vscode.workspace.getConfiguration('flattenRepo');
        const includeExtensions = config.get('includeExtensions', ['.cpp', '.h', '.py', '.js', '.ts', '.java', '.html', '.css', '.json']);
        const ignoreDirs = config.get('ignoreDirs', ['node_modules', '.git']);
        const maxChunkSize = config.get('maxChunkSize', 20000); // characters per chunk (0 to disable)

        // Prepare 'flattened' directory
        const flattenedDir = path.join(rootPath, 'flattened');
        try {
            // Check if flattenedDir exists; if not, create it
            await fs.access(flattenedDir);
        } catch {
            await fs.mkdir(flattenedDir, { recursive: true });
        }

        // Generate a timestamp for naming the file(s)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${year}${month}${day}-${hour}${minute}${second}`;

        // Collect target files
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
                    if (ignoreDirs.includes(item.name) || item.name.startsWith('.')) {
                        continue;
                    }
                    await collectFiles(fullPath);
                } else if (includeExtensions.includes(path.extname(item.name))) {
                    fileList.push(fullPath);
                }
            }
        }

        try {
            // Show progress notification
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
                        console.error(`Error processing file: ${file}`, err);
                    }
                    processed++;
                    if (processed % 10 === 0) {
                        progress.report({ message: `${processed} of ${fileList.length} files processed` });
                    }
                }

                // Write output to one or multiple files (chunking)
                if (maxChunkSize > 0 && outputContent.length > maxChunkSize) {
                    const chunks = [];
                    for (let i = 0; i < outputContent.length; i += maxChunkSize) {
                        chunks.push(outputContent.substring(i, i + maxChunkSize));
                    }
                    for (let i = 0; i < chunks.length; i++) {
                        const chunkFilePath = path.join(flattenedDir, `flattened_${timestamp}_${i + 1}.txt`);
                        await fs.writeFile(chunkFilePath, chunks[i], 'utf-8');
                    }
                    vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${chunks.length} chunk(s) in /flattened folder.`);
                } else {
                    // If no chunking needed, just write everything to one file
                    const singleFilePath = path.join(flattenedDir, `flattened_${timestamp}_1.txt`);
                    await fs.writeFile(singleFilePath, outputContent, 'utf-8');
                    vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${singleFilePath}`);
                }
            });

            // Finally, update or create .gitignore to ensure /flattened is ignored
            try {
                const gitignorePath = path.join(rootPath, '.gitignore');
                let gitignoreContent = '';
                try {
                    gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
                } catch (error) {
                    // .gitignore doesn't exist yet, so we'll create it
                    if (error.code === 'ENOENT') {
                        gitignoreContent = '';
                    } else {
                        // Some other reading error
                        console.error(`Error reading .gitignore:`, error);
                    }
                }

                // Check if '/flattened' is already in .gitignore
                if (!gitignoreContent.split('\n').some(line => line.trim() === '/flattened')) {
                    // Append if missing
                    gitignoreContent += `${gitignoreContent.endsWith('\n') ? '' : '\n'}/flattened\n`;
                    await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
                }
            } catch (err) {
                console.error('Error updating .gitignore:', err);
            }

        } catch (err) {
            console.error('Error during flattening process:', err);
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
