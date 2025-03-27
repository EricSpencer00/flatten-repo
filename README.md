
# 📄 flatten-repo

**Flatten your codebase into `.txt` files — perfect for LLM parsing, prompt engineering, or static analysis.**

---

## ✨ Features (v0.0.2)

- 🧠 Automatically collects and flattens all source code in your workspace
- 🔍 Respects **whitelist** and **blacklist** rules via `.flatten_whitelist` and `.flatten_blacklist` files
- 📦 Supports glob patterns like `*.h`, `**/test_*.py`, or `docs/*.md`
- 🗂️ Outputs to a timestamped `/flattened` folder (e.g., `flattened_20250327-131045_1.txt`)
- ✂️ Auto-chunks output files by character limit (configurable via settings)
- ⚠️ Automatically adds `/flattened` to your `.gitignore`

> Each output includes headers like:  
> `=== FILE: relative/path/to/file.ext ===`

---

## 📷 Demo

> _(Coming soon — or submit one!)_  
> Watch the extension scan and flatten your code from the command palette.

---

## ⚙️ How to Use

1. Open your project folder in VS Code
2. Run the command: `Flatten Project to TXT`  
   (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Find the output(s) in the `/flattened` folder inside your workspace

---

## ✅ Requirements

- VS Code
- No dependencies required — just install and run

---

## ⚙️ Configuration (Optional)

Update your **`.vscode/settings.json`** or workspace settings:

```json
"flattenRepo.includeExtensions": [".cpp", ".h", ".py", ".js", ".ts", ".html", ".css", ".json"],
"flattenRepo.ignoreDirs": ["node_modules", ".git", "dist"],
"flattenRepo.maxChunkSize": 20000
```

---

## 🔍 Whitelist / Blacklist Rules

You can define fine-grained rules using glob patterns:

- `.flatten_whitelist` and `.flatten_blacklist`
- Supports `*`, `?`, and full/partial paths
- Located in the root or in `/flattened`

**Examples:**
```
# .flatten_whitelist
*.py
src/**/*.js

# .flatten_blacklist
*.test.*
**/secret/*
.env
```

---

## 🐞 Known Issues

- No UI yet — command-only
- Binary files and ignored folders like `node_modules` and `.git` are skipped by default

---

## 📦 Release Notes

### 0.0.2
- ➕ Added whitelist and blacklist glob support
- ➕ Supports reading config from `/flattened` or root
- 📝 Auto-updates `.gitignore`
- 📁 Outputs timestamped files in a `flattened/` folder

---

## 🤖 Ideal Use Cases

- Prepping source code for LLM input (e.g., ChatGPT, Claude, Gemini)
- Prompt engineering workflows
- Code analysis snapshots
- Audit trails / historical exports

---

## 🧪 Contribute

Have a feature in mind?

- Open an [issue](https://github.com/your-repo/issues)
- Submit a PR
- Ideas: add file token counting, Markdown output, multi-format support

---

## 🔗 Resources

- [VS Code Extension Docs](https://code.visualstudio.com/api)
- [Glob Pattern Reference](https://github.com/isaacs/minimatch)
- [Markdown Cheatsheet](https://www.markdownguide.org/basic-syntax/)

---

Made with ❤️ to help devs wrangle code for LLMs, one flattened file at a time.