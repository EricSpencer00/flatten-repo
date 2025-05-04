const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

class FlattenBuilder {
  constructor() {
    this.config = {
      outputDir: '.flattened',
      maxFileSize: 1024 * 1024, // 1MB
      ignorePatterns: [
        'node_modules',
        'dist',
        'build',
        '.git',
        '.flattened'
      ]
    };
  }

  async ensureOutputDir() {
    try {
      await mkdir(this.config.outputDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async shouldIgnore(filePath) {
    const relativePath = path.relative(process.cwd(), filePath);
    return this.config.ignorePatterns.some(pattern => 
      relativePath.includes(pattern) || 
      relativePath.startsWith(pattern)
    );
  }

  async processFile(filePath) {
    const content = await readFile(filePath, 'utf8');
    const stats = await stat(filePath);
    
    return {
      path: filePath,
      content,
      size: stats.size
    };
  }

  async build() {
    console.log('Starting build process...');
    await this.ensureOutputDir();

    const files = [];
    const errors = [];
    let totalSize = 0;

    async function processDirectory(dir) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (await this.shouldIgnore(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await processDirectory.call(this, fullPath);
        } else {
          try {
            const file = await this.processFile(fullPath);
            files.push(file);
            totalSize += file.size;
          } catch (error) {
            errors.push({
              path: fullPath,
              error: error.message
            });
          }
        }
      }
    }

    await processDirectory.call(this, process.cwd());

    // Sort files by size
    files.sort((a, b) => b.size - a.size);

    // Generate output
    const output = {
      summary: {
        totalFiles: files.length,
        totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
        errors: errors.length
      },
      largestFiles: files.slice(0, 5).map(f => ({
        path: f.path,
        size: `${(f.size / 1024).toFixed(2)} KB`
      })),
      errors: errors
    };

    // Write output to file
    const outputPath = path.join(this.config.outputDir, 'flattened.txt');
    await writeFile(
      outputPath,
      JSON.stringify(output, null, 2),
      'utf8'
    );

    // Display results
    console.log('\nBuild Results:');
    console.log(`Total Files Processed: ${output.summary.totalFiles}`);
    console.log(`Total Size: ${output.summary.totalSize}`);
    console.log(`Errors: ${output.summary.errors}`);
    
    if (output.largestFiles.length > 0) {
      console.log('\nLargest Files:');
      output.largestFiles.forEach(file => {
        console.log(`${file.path}: ${file.size}`);
      });
    }

    if (output.errors.length > 0) {
      console.log('\nErrors:');
      output.errors.forEach(error => {
        console.log(`${error.path}: ${error.error}`);
      });
    }

    console.log(`\nOutput written to: ${outputPath}`);
  }
}

// Run the build process
new FlattenBuilder().build().catch(console.error); 