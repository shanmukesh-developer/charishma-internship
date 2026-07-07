const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_home_function.js'), 'utf8');

// Find return statement
const returnIndex = content.indexOf('return /*#__PURE__*/');
if (returnIndex !== -1) {
  console.log(`Found 'return /*#__PURE__*/' at index ${returnIndex}`);
  const returnChunk = content.slice(returnIndex);
  fs.writeFileSync(path.join(__dirname, 'recovered_return_jsx.js'), returnChunk);
  console.log('Saved return JSX block to: recovered_return_jsx.js');
} else {
  console.log('Could not find return /*#__PURE__*/');
}
