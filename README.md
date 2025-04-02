# 📄 flatten-repo

[![Publish Extension](https://github.com/EricSpencer00/flatten-repo/actions/workflows/publish.yml/badge.svg)](https://github.com/EricSpencer00/flatten-repo/actions/workflows/publish.yml)
[![Code Coverage](https://codecov.io/gh/EricSpencer00/flatten-repo/branch/main/graph/badge.svg)](https://codecov.io/gh/EricSpencer00/flatten-repo)

**Flatten your entire codebase into clean, readable `.txt` files — optimized for LLMs like ChatGPT, Claude, and Gemini.**

---

<<<<<<< HEAD
## ✨ Features (v0.12.0)
=======
## ✨ Features (v0.2.0)
>>>>>>> d6c238e (v0.2.0)

- 🚀 **High Performance**
  - Parallel file processing with configurable concurrency
  - Memory-efficient chunking for large codebases
  - Smart content truncation for oversized files
  
- 🎯 **Smart File Selection**
  - Intelligent scoring system for file importance
  - Configurable file extensions and ignore patterns
  - Support for whitelist and blacklist rules
  
- 📊 **Enhanced Progress Tracking**
  - Detailed progress reporting with step counts
  - Clear error messages with troubleshooting hints
  - Cancellation support at any stage
  
- 🔧 **Flexible Configuration**
  - Single `.flatten_ignore` file for all settings
  - Token limit customization per LLM model
  - Project-specific overrides via VS Code settings

---

## 🚀 Quick Start

1. Install from VS Code Marketplace
2. Open your project folder
3. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
4. Type `Flatten Project to TXT` and press Enter
5. Find your flattened files in the `/flattened` directory

---

## ⚙️ Configuration Options

### VS Code Settings

```json
{
  "flattenRepo.includeExtensions": [
    ".ts", ".tsx", ".js", ".jsx", 
    ".py", ".html", ".css"
  ],
  "flattenRepo.ignoreDirs": [
    "node_modules", ".git", "dist"
  ],
  "flattenRepo.maxChunkSize": 200000,
  "flattenRepo.maxConcurrentFiles": 4
}
```

### .flatten_ignore

```txt
# Global ignore patterns
global:
node_modules
.git
dist
build

# Optional whitelist
whitelist:
src/**/*.ts
lib/**/*.js

# Optional blacklist
blacklist:
**/*.test.ts
**/*.spec.js
.env

# Performance settings
settings:
maxTokenLimit: 128000    # Claude 3.7, GPT-4
maxTokensPerFile: 50000  # Per file limit
maxConcurrentFiles: 4    # Parallel processing
```

---

## 📊 Performance Tips

- **Memory Usage**: Adjust `maxTokensPerFile` for large files
- **Speed**: Configure `maxConcurrentFiles` based on your CPU
- **Size**: Use whitelist/blacklist to focus on important code
- **Efficiency**: Enable parallel processing for faster results

---

## 🔍 Advanced Features

### File Scoring System

Files are scored based on:
- 📏 Size (smaller files preferred)
- 📂 Location (src/lib folders prioritized)
- 📝 File type (source code > config files)
- 🕒 Modification date (recent changes scored higher)

### Error Handling

Detailed error messages for common issues:
- File access permissions
- Memory limitations
- System resource constraints
- Invalid configurations

---

## 🐞 Known Limitations

- Binary files not supported
- Image files excluded
- Some complex glob patterns may need tweaking
- Maximum file size limit of 50MB

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
<<<<<<< HEAD

### Required Tokens for CI/CD

For maintainers, ensure you have set up:
- `VSCE_PAT`: VS Code Marketplace publishing token
- `GH_PAT`: GitHub token with repo and workflow permissions
- `CODECOV_TOKEN`: Codecov.io token for coverage reports

These tokens should be added in the repository's Settings → Secrets and variables → Actions.
=======
>>>>>>> d6c238e (v0.2.0)

---

## 📈 Roadmap

- [ ] Graphical UI for configuration
- [ ] Custom output formatters
- [ ] Multi-model export formats
- [ ] Token count estimation
- [ ] Incremental flattening
- [ ] Project statistics dashboard

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with ❤️ by Eric Spencer. Star ⭐ the repo if you find it useful!