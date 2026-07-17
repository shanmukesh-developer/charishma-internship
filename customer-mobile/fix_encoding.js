// Fix double-encoding: UTF-8 bytes were interpreted as Windows-1252 then saved as UTF-8
const fs = require('fs');
const filePath = 'app/(tabs)/others.tsx';

// Read as raw buffer
const buf = fs.readFileSync(filePath);
let str = buf.toString('utf8');

// The problem: original UTF-8 bytes like E2 94 80 (─) were read as Latin-1/CP1252
// characters â, ", €, then re-saved as UTF-8, producing C3 A2 C2 94 C2 80
// We need to reverse this: find sequences of C3/C2 encoded bytes and decode back

// Step 1: Convert string to array of code points
// Step 2: Find sequences where bytes were individually encoded as Latin-1
// A Latin-1 encoded UTF-8 byte sequence looks like:
//   Original UTF-8: E2 94 80
//   After double-encoding: C3 A2  C2 94  C2 80
//   As JS string: \u00E2 \u0094 \u0080

// Strategy: scan for code points in the 0x80-0xFF range that form valid UTF-8 sequences
function fixDoubleEncoding(input) {
  const chars = [];
  for (let i = 0; i < input.length; i++) {
    chars.push(input.charCodeAt(i));
  }
  
  const output = [];
  let i = 0;
  
  while (i < chars.length) {
    const c = chars[i];
    
    // Check if this starts a double-encoded UTF-8 sequence
    if (c >= 0xC0 && c <= 0xFF) {
      // Try to decode as UTF-8 byte sequence
      const bytes = [];
      let j = i;
      let valid = true;
      
      // Determine expected length from first byte
      let expectedLen;
      if (c >= 0xF0) expectedLen = 4;
      else if (c >= 0xE0) expectedLen = 3;
      else if (c >= 0xC0) expectedLen = 2;
      
      // Collect bytes
      bytes.push(c);
      j++;
      
      for (let k = 1; k < expectedLen && j < chars.length; k++) {
        const next = chars[j];
        if (next >= 0x80 && next <= 0xBF) {
          bytes.push(next);
          j++;
        } else {
          valid = false;
          break;
        }
      }
      
      if (valid && bytes.length === expectedLen) {
        // Decode UTF-8 bytes to code point
        let codePoint;
        if (expectedLen === 2) {
          codePoint = ((bytes[0] & 0x1F) << 6) | (bytes[1] & 0x3F);
        } else if (expectedLen === 3) {
          codePoint = ((bytes[0] & 0x0F) << 12) | ((bytes[1] & 0x3F) << 6) | (bytes[2] & 0x3F);
        } else if (expectedLen === 4) {
          codePoint = ((bytes[0] & 0x07) << 18) | ((bytes[1] & 0x3F) << 12) | ((bytes[2] & 0x3F) << 6) | (bytes[3] & 0x3F);
        }
        
        if (codePoint && codePoint > 0x7F) {
          output.push(String.fromCodePoint(codePoint));
          i = j;
          continue;
        }
      }
    }
    
    // Regular character
    output.push(String.fromCodePoint(c));
    i++;
  }
  
  return output.join('');
}

const fixed = fixDoubleEncoding(str);

// Count changes
let changes = 0;
for (let i = 0; i < Math.min(str.length, fixed.length); i++) {
  if (str.charCodeAt(i) !== fixed.charCodeAt(i)) changes++;
}

fs.writeFileSync(filePath, fixed, 'utf8');
console.log(`Fixed double-encoding. ${changes} character positions changed.`);
console.log(`Original length: ${str.length}, Fixed length: ${fixed.length}`);

// Spot check some lines
const lines = fixed.split('\n');
for (const lineNum of [76, 78, 82, 88, 534, 947]) {
  if (lines[lineNum - 1]) {
    console.log(`Line ${lineNum}: ${lines[lineNum - 1].trim().substring(0, 100)}`);
  }
}
