const fs = require('fs');
const parser = require('@babel/parser');

const code = fs.readFileSync('frontend/src/App.jsx', 'utf8');

try {
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });
  console.log("No syntax errors found!");
} catch (e) {
  console.error("Syntax Error:");
  console.error(e.message);
  console.error(`Line: ${e.loc.line}, Column: ${e.loc.column}`);
}
