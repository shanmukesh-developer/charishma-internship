const admin = require('./config/firebase');
const { getAuth } = require('firebase-admin/auth');
console.log('Admin SDK Initialized. Checking credentials...');
try {
  getAuth().listUsers(1).then(() => {
    console.log('SUCCESS: Connection to Google servers is valid!');
    process.exit(0);
  }).catch((err) => {
    console.error('ERROR validating with Google:', err.message);
    process.exit(1);
  });
} catch(e) {
  console.error('CRASH:', e.message);
  process.exit(1);
}
