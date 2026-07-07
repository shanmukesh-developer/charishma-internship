/**
 * DIAGNOSTIC: Check if delivery-app is being reverted
 * Run this before making UI changes to identify the root cause
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pageFile = path.join(__dirname, 'delivery-app/src/app/page.tsx');

console.log('🔍 DELIVERY-APP REVERSION DIAGNOSTIC\n');

// 1. Check file hash before
console.log('1️⃣  Getting file hash...');
try {
  const content = fs.readFileSync(pageFile, 'utf8');
  const hash = require('crypto').createHash('md5').update(content).digest('hex');
  console.log(`   Current hash: ${hash}`);
  console.log(`   File size: ${content.length} bytes\n`);
} catch (e) {
  console.error('   ❌ Failed to read file:', e.message);
}

// 2. Check git status
console.log('2️⃣  Checking git status...');
try {
  const status = execSync('git status --porcelain delivery-app/src/app/page.tsx', { encoding: 'utf8' }).trim();
  console.log(`   Status: ${status || 'Clean (no changes)'}\n`);
} catch (e) {
  console.error('   ❌ Git error:', e.message);
}

// 3. Check git log for reverses
console.log('3️⃣  Checking for git reversions...');
try {
  const log = execSync('git log --oneline -n 10 delivery-app/src/app/page.tsx', { encoding: 'utf8' });
  console.log('   Recent commits:');
  log.split('\n').slice(0, 5).forEach(line => {
    if (line) console.log(`     ${line}`);
  });
  console.log();
} catch (e) {
  console.error('   ❌ Error:', e.message);
}

// 4. Check .next cache
console.log('4️⃣  Checking Next.js cache...');
const nextCachePath = path.join(__dirname, 'delivery-app/.next');
if (fs.existsSync(nextCachePath)) {
  console.log('   ⚠️  .next cache directory exists (may show stale content)\n');
} else {
  console.log('   ✓ .next cache clean\n');
}

// 5. List active scripts
console.log('5️⃣  Checking for auto-scripts...');
const scriptDirs = ['backend', 'frontend', 'admin-dashboard', 'restaurant-portal'];
let foundScripts = false;
scriptDirs.forEach(dir => {
  const scriptFiles = fs.readdirSync(path.join(__dirname, dir))
    .filter(f => f.endsWith('.js') && (f.includes('sync') || f.includes('update') || f.includes('revert') || f.includes('restore')));
  if (scriptFiles.length > 0) {
    console.log(`   ⚠️  Found in ${dir}:`, scriptFiles.join(', '));
    foundScripts = true;
  }
});
if (!foundScripts) {
  console.log('   ✓ No problematic auto-scripts found\n');
} else {
  console.log();
}

console.log('✅ Diagnostic complete!\n');
console.log('📝 If changes are still reverting:');
console.log('   1. Clear VSCode cache: Ctrl+Shift+P → Clear Cache');
console.log('   2. Clear browser cache: Ctrl+Shift+Delete');
console.log('   3. Restart dev server: npm run dev (in delivery-app)');
console.log('   4. Check git: git diff delivery-app/src/app/page.tsx');
