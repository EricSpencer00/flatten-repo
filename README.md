# Flatten Repository

![Status](https://github.com/EricSpencer00/flatten-repo/workflows/Status%20Check/badge.svg)

A VS Code extension that helps you flatten your codebase into a single file for easy sharing and analysis.

## Features

- **Smart File Analysis**
  - Detailed insights about your codebase
  - File size visualization
  - Smart suggestions for optimization
  - Progress preview functionality

- **Interactive Configuration**
  - Guided setup for `.flatten_ignore`
  - Custom configuration templates
  - Version control integration
  - Batch processing support

- **File Processing**
  - Smart file filtering
  - Memory-efficient chunking
  - Progress tracking
  - Error recovery

- **Output Management**
  - Single file output
  - Size optimization
  - Format preservation
  - Documentation integration

## Installation

1. Open VS Code
2. Go to the Extensions view (Ctrl+Shift+X)
3. Search for "Flatten Repository"
4. Click Install

## Usage

1. Open your project in VS Code
2. Press `Ctrl+Shift+P` to open the command palette
3. Type "Flatten Repository" and select one of the commands:
   - "Flatten Project to TXT"
   - "Create/Edit .flatten_ignore File"

## Configuration

The extension can be configured through:

1. `.flatten_ignore` file in your project root
2. VS Code settings
3. Command palette options

### .flatten_ignore Example

```ini
# Global ignore patterns
[global]
node_modules/
dist/
build/
.flattened/

# Local whitelist patterns
[whitelist]
src/main.js
test/main.test.js

# Local blacklist patterns
[blacklist]
test/coverage/
docs/api/

# Settings
[settings]
maxTokenLimit=8000
maxConcurrentFiles=10
useGitIgnore=true
```

## VS Code Settings

- `flattenRepo.includeExtensions`: File extensions to include
- `flattenRepo.ignoreDirs`: Directory names to ignore
- `flattenRepo.useGitIgnore`: Use .gitignore patterns
- `flattenRepo.maxChunkSize`: Maximum characters per chunk
- `flattenRepo.globalWhitelist`: Global include patterns
- `flattenRepo.globalBlacklist`: Global exclude patterns

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

See [CHANGELOG.md](CHANGELOG.md) for version history and changes.