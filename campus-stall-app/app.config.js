// Wraps app.json.
//  - Firebase Android config (google-services.json): without it the app gets no FCM device token, so a stall with
//    the app closed never hears about a new booking. Until the owner registers com.srm.zcscampusstall in the ZCS
//    Firebase project (README), the app works fully without it: bookings still arrive live over the socket and by a
//    30 s refresh while the app is open, and Settings says closed-app alerts are not set up on this build. An EAS
//    *production* build and a local release build (plugins/withReleaseSigning.js) refuse to build without it.
//    Set ALLOW_BUILD_WITHOUT_FCM=1 to override on purpose (both places).
//  - android.allowBackup=false: the session token must never be copied into Google / adb backups.
//  - Release signing: plugins/withReleaseSigning.js (Play upload key ZCS_CAMPUSSTALL_UPLOAD_* from
//    ~/.gradle/gradle.properties or android/keystore.properties, never the debug keystore).
//    R8 / no cleartext / SDK 36: expo-build-properties (app.json).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const file = path.join(__dirname, 'google-services.json');
  const hasFirebase = fs.existsSync(file);
  const production = process.env.EAS_BUILD_PROFILE === 'production';
  if (!hasFirebase && production && process.env.ALLOW_BUILD_WITHOUT_FCM !== '1') {
    throw new Error(
      `[app.config] google-services.json is missing. Add the Android app "${config.android?.package}" ` +
      'to the ZCS Firebase project and put its google-services.json next to app.json (see README), or ' +
      'booking pushes will never reach a closed app.',
    );
  }
  config.android = {
    ...(config.android || {}),
    allowBackup: false,
    ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
  };
  return config;
};
