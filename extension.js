const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
    let disposable = vscode.commands.registerCommand('flatten-repo.flattenProjectToTxt', async function () {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const outputPath = path.join(rootPath, 'flattened_code.txt');
        const extensions = ['.cpp', '.h', '.py', '.js', '.ts', '.java', '.html', '.css', '.json'];

        let fileList = [];

        function collectFiles(dir) {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    if (item === "node_modules" || item.startsWith(".")) continue;
                    collectFiles(fullPath);
                } else if (extensions.includes(path.extname(item))) {
                    fileList.push(fullPath);
                }
            }
        }

        collectFiles(rootPath);

        const output = fs.createWriteStream(outputPath);
        for (const file of fileList) {
            output.write(`\n\n=== FILE: ${path.relative(rootPath, file)} ===\n`);
            const content = fs.readFileSync(file, 'utf-8');
            output.write(content);
        }
        output.end();

        vscode.window.showInformationMessage(`✅ Flattened ${fileList.length} files into ${outputPath}`);
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
