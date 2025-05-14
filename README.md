# Flatten Repository

![Status](https://github.com/EricSpencer00/flatten-repo/workflows/Status%20Check/badge.svg)

A VS Code extension that helps you flatten your codebase into a single file for easy sharing and analysis with LLMs (Large Language Models).

## Features

- **Intelligent File Processing**
  - Smart filtering of library code and generated files
  - Automatic handling of common patterns across frameworks
  - Configurable token limits for different LLMs
  - Memory-efficient processing of large codebases

- **Customizable Ignore Patterns**
  - Built-in patterns for common libraries and generated code
  - Easy-to-configure `.flatten_ignore` file
  - Support for global, whitelist, and blacklist patterns
  - Automatic directory pattern expansion

- **LLM-Optimized Output**
  - Single file output with size limits for different LLMs
  - Directory tree visualization
  - Smart file prioritization
  - Automatic token limit management

- **Developer Experience**
  - Progress tracking with detailed status updates
  - Error recovery and graceful fallbacks
  - Configurable through VS Code settings
  - Git integration

## Installation

1. Open VS Code
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Flatten Repository"
4. Click Install

## Usage

1. Open your project in VS Code
2. Press `Ctrl+Shift+P` to open the command palette
3. Type "Flatten Repository" and select one of the commands:
   - "Flatten Project to TXT": Creates a flattened version of your codebase
   - "Create/Edit .flatten_ignore File": Configure what files to include/exclude

## Configuration

### .flatten_ignore File

The `.flatten_ignore` file supports three types of patterns:

```ini
# Global ignore patterns (always ignored)
global:
node_modules/**
dist/**
build/**
vendor/**
/generated/**    # Root level generated files
**/generated/**  # Any generated files

# Whitelist patterns (always included)
whitelist:
src/**/*.java
src/**/*.ts
*.md
*.json

# Blacklist patterns (additional ignores)
blacklist:
*.min.js
*.min.css
*.map

# Settings
settings:
maxTokenLimit: 128000    # ~128K tokens (Claude/GPT-4)
maxTokensPerFile: 25000
useGitIgnore: true
```

### VS Code Settings

- `flattenRepo.includeExtensions`: File extensions to include
- `flattenRepo.ignoreDirs`: Directory names to ignore
- `flattenRepo.useGitIgnore`: Use .gitignore patterns
- `flattenRepo.maxChunkSize`: Maximum characters per chunk
- `flattenRepo.globalWhitelist`: Global include patterns
- `flattenRepo.globalBlacklist`: Global exclude patterns

## Token Limits

The extension supports various LLM token limits:
- Claude 3 Opus: ~200K tokens (800K chars)
- Claude 3 Sonnet: ~128K tokens (512K chars) [DEFAULT]
- GPT-4 Turbo: ~128K tokens (512K chars)
- Claude 2: ~100K tokens (400K chars)
- GPT-4: ~32K tokens (128K chars)
- GPT-3.5 Turbo: ~16K tokens (64K chars)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details

## Support

- [GitHub Issues](https://github.com/EricSpencer00/flatten-repo/issues)
- [Documentation](https://github.com/EricSpencer00/flatten-repo#readme)

## Version History

### 1.0.3
- Added support for `/generated` directory ignore patterns
- Improved whitelist pattern handling
- Updated default ignore patterns
- Enhanced LLM token limit documentation

See [CHANGELOG.md](CHANGELOG.md) for full version history.