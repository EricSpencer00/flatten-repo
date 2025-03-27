
# 📄 flatten-repo

**Flatten your codebase into a single `.txt` file — perfect for LLM parsing, prompt engineering, or snapshot analysis.**

---

## ✨ Features

- 🧠 Automatically collects all source code files in your workspace
- 🗂️ Supports common languages: `.cpp`, `.py`, `.js`, `.ts`, `.html`, `.css`, `.json`, and more
- 📄 Outputs a `flattened_code.txt` file with file headers and full contents
- 🪄 Great for pasting into LLMs or running batch analysis

> The output includes `=== FILE: relative/path/to/file.ext ===` headers for each source file.

---

## 📷 Demo

> _(Coming soon)_  
> Or, drop in a quick GIF of the extension being run from the command palette.

---

## ⚙️ How to Use

1. Open any project folder in VS Code
2. Run the command: `Flatten Project to TXT` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. The extension will generate a file named `flattened_code.txt` in the root of your workspace

---

## ✅ Requirements

- Node.js + VS Code
- Works out of the box — no extra setup required

---

## ⚙️ Extension Settings

_No settings yet!_  
Let us know if you'd like customization like:
- Select file types
- Include/exclude folders
- Output file name

---

## 🐞 Known Issues

- No UI yet — just command-palette based
- Ignores binary files and folders like `node_modules` and `.git` automatically

---

## 📦 Release Notes

### 1.0.0
- Initial release 🎉  
- Flattens supported files into a `.txt` file for LLMs

---

## 🤖 Ideal Use Cases

- Feeding source code into LLMs like ChatGPT or Claude
- Prompt-chunking and token-counting workflows
- Codebase snapshots for analysis

---

## 🧪 Contribute

Ideas welcome! Open an issue or PR if you want to add:
- Custom file type filters
- Support for file size/token limits
- Multi-file outputs (chunked)

---

## 🔗 More Info

- [VS Code API Docs](https://code.visualstudio.com/api)
- [Markdown Syntax Reference](https://www.markdownguide.org/basic-syntax/)

---

Made with ❤️ to help devs wrangle code for LLMs.