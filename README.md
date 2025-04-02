# 📄 flatten-repo

[![Publish Extension](https://github.com/EricSpencer00/flatten-repo/actions/workflows/publish.yml/badge.svg)](https://github.com/EricSpencer00/flatten-repo/actions/workflows/publish.yml)

**Flatten your entire codebase into clean, readable `.txt` files — optimized for LLMs like ChatGPT, Claude, and Gemini.**

---

## ✨ Features (v0.20.0)

- 🔁 Auto-flattens your workspace into plain `.txt` chunks
- 🧠 Built for LLM parsing, prompt engineering, and static code analysis
- 📂 Each chunk includes a **directory tree** overview of included files
- ✂️ Auto-chunks content using a configurable **token limit** (~4 characters per token)
- 🔍 Powerful support for glob-based **ignore**, **whitelist**, and **blacklist**
- 🧾 All configs live in a single `.flatten_ignore` file (generated automatically)
- ⚙️ Customize file extensions, folders to ignore, and token size limits
- 📁 Output saved in timestamped files under `/flattened`
- 🚫 Auto-adds `/flattened` to your `.gitignore`

> Each chunk starts with a tree-like outline of included files, followed by:
>  
> `=== FILE: path/to/file.ext ===`

---

## ⚙️ How to Use

1. Open a folder in VS Code
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run: `Flatten Project to TXT`
4. View flattened files inside the `/flattened` folder

---

## 🛠️ Configuration

You can configure behavior in your `.vscode/settings.json`:

```json
"flattenRepo.includeExtensions": [".ts", ".tsx", ".js", ".jsx", ".py", ".html", ".css"],
"flattenRepo.ignoreDirs": ["node_modules", ".git", "dist"],
"flattenRepo.maxChunkSize": 200000
```

Or configure per-project settings via `.flatten_ignore`.

---

## 📄 .flatten_ignore

This single file controls:
- ✅ Glob-based `global` ignore rules
- ➕ Optional `whitelist` or `blacklist`
- 📐 Token limits via a `settings:` section

Auto-generated in `/flattened` if missing.

### 🔁 Sample `.flatten_ignore`

```txt
# Ignore rules
global:
node_modules
.git
dist

# Whitelist (optional)
whitelist:
src/**/*.js

# Blacklist (optional)
blacklist:
**/*.test.js
.env

# Settings (optional)
settings:
maxTokenLimit: 50000
maxTokensPerFile: 25000

# Suggestions:
#   Claude 3.7: 128k tokens
#   ChatGPT 4o: 128k tokens
#   ChatGPT o3-mini-high: 200k tokens
#   Claude 2: 100k tokens
#   Anthropic Claude 3 Opus: 200k tokens
#   Cohere Command: 32k tokens
#   Google PaLM 2: 8k tokens
#   Meta LLaMA 2: 4k tokens
```

---

## 📐 Output Format

Each `.txt` output file looks like this:

```
=== Directory Tree ===
├─ App.tsx
├─ index.js
└─ components
   ├─ Header.tsx
   └─ Footer.tsx

=== FILE: App.tsx ===
import React from 'react';
...
```

---

## ✅ Use Cases

- Preparing source code for LLM input
- Clean context formatting for ChatGPT, Claude, Gemini, etc.
- Snapshotting your repo for AI audits or static reviews
- Prompt engineering pipelines
- Code flattening for full-project memory with agents

---

## 🐞 Known Limitations

- No graphical UI (yet) — command-only
- Does not flatten binary or image files
- Some advanced glob edge cases may need refinement

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/EricSpencer00/flatten-repo.git
cd flatten-repo
npm install
code .
```

Press F5 to start debugging the extension.

### Required Tokens for CI/CD

For maintainers, ensure you have set up:
- `VSCE_PAT`: VS Code Marketplace publishing token
- `GH_PAT`: GitHub token with repo and workflow permissions
- `CODECOV_TOKEN`: Codecov.io token for coverage reports

These tokens should be added in the repository's Settings → Secrets and variables → Actions.

---

## 🔗 Resources

- [VS Code Extension Docs](https://code.visualstudio.com/api)
- [Glob Patterns (minimatch)](https://github.com/isaacs/minimatch)
- [Token Estimator Tool](https://platform.openai.com/tokenizer)

---

Made with ❤️ to help devs and LLMs speak the same language.