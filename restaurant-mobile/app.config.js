// Wraps app.json.
//  - Firebase Android config (google-services.json): without it the app gets no FCM device token, so a
//    store with the app closed / swiped away never hears a new order. Dev builds still work without the
//    file (alerts then only work while the app is open, and the app shows a banner saying so), but an EAS
//    *production* build refuses to build without it. Set ALLOW_BUILD_WITHOUT_FCM=1 to override on purpose.
//  - android.allowBackup=false: the session token must never be copied into Google / adb backups.
//  - Release signing: plugins/withReleaseSigning.js (app.json; Play upload key from ~/.gradle/gradle.properties or
//    android/keystore.properties, never the debug keystore). R8 / no cleartext / SDK 36: expo-build-properties (app.json).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const file = path.join(__dirname, 'google-services.json');
  const hasFirebase = fs.existsSync(file);
  const profile = process.env.EAS_BUILD_PROFILE || '';
  if (!hasFirebase && profile === 'production' && process.env.ALLOW_BUILD_WITHOUT_FCM !== '1') {
    throw new Error(
      `[app.config] google-services.json is missing. Register the Android package "${config.android?.package}" ` +
      'in the Zenvy Firebase project and put its google-services.json next to app.json, or new-order pushes ' +
      'will never reach a closed app.',
    );
  }
  config.android = {
    ...(config.android || {}),
    allowBackup: false,
    ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
  };
  return config;
};
