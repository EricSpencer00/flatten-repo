const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);

async function analyzeCodebase() {
  const results = {
    totalFiles: 0,
    totalSize: 0,
    largestFiles: [],
    fileTypes: {},
    suggestions: []
  };

  async function analyzeDirectory(dir) {
    const files = await fs.promises.readdir(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await stat(filePath);
      
      if (stats.isDirectory()) {
        await analyzeDirectory(filePath);
      } else {
        const ext = path.extname(file);
        const size = stats.size;
        
        results.totalFiles++;
        results.totalSize += size;
        
        // Track file types
        results.fileTypes[ext] = (results.fileTypes[ext] || 0) + 1;
        
        // Track largest files
        results.largestFiles.push({ path: filePath, size });
        results.largestFiles.sort((a, b) => b.size - a.size);
        if (results.largestFiles.length > 5) {
          results.largestFiles.pop();
        }
      }
    }
  }

  await analyzeDirectory(process.cwd());

  // Generate suggestions
  if (results.totalSize > 1024 * 1024) { // If total size > 1MB
    results.suggestions.push({
      type: 'size',
      message: 'Consider excluding large files from flattening',
      files: results.largestFiles.map(f => ({
        path: f.path,
        size: `${(f.size / 1024).toFixed(2)} KB`
      }))
    });
  }

  // Format results
  return {
    summary: {
      totalFiles: results.totalFiles,
      totalSize: `${(results.totalSize / 1024).toFixed(2)} KB`,
      fileTypes: results.fileTypes
    },
    largestFiles: results.largestFiles.map(f => ({
      path: f.path,
      size: `${(f.size / 1024).toFixed(2)} KB`
    })),
    suggestions: results.suggestions
  };
}

// Run analysis and output results
analyzeCodebase().then(results => {
  console.log('Codebase Analysis Results:');
  console.log('\nSummary:');
  console.log(`Total Files: ${results.summary.totalFiles}`);
  console.log(`Total Size: ${results.summary.totalSize}`);
  console.log('\nFile Types:');
  Object.entries(results.summary.fileTypes).forEach(([ext, count]) => {
    console.log(`${ext}: ${count} files`);
  });
  
  console.log('\nLargest Files:');
  results.largestFiles.forEach(file => {
    console.log(`${file.path}: ${file.size}`);
  });
  
  console.log('\nSuggestions:');
  results.suggestions.forEach(suggestion => {
    console.log(`\n${suggestion.type}: ${suggestion.message}`);
    if (suggestion.files) {
      console.log('Affected files:');
      suggestion.files.forEach(file => {
        console.log(`  ${file.path}: ${file.size}`);
      });
    }
  });
}).catch(console.error); 