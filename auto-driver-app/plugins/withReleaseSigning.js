// Expo config plugin: Play release signing, re-applied on every `expo prebuild` (android/ is generated and
// git-ignored, so signing cannot live there). The same file is used by every Zenvy partner app
// (delivery-boy-app, restaurant-mobile, vendor-app, auto-driver-app); only the options in app.json differ:
//
//   ["./plugins/withReleaseSigning", { "prefix": "ZENVY_RIDER_UPLOAD", "appLabel": "Zenvy Rider", "readme": "delivery-boy-app/README.md" }]
//
//  - The Play UPLOAD key is read from android/keystore.properties (git-ignored, but deleted by
//    `expo prebuild --clean`) or from ~/.gradle/gradle.properties (survives prebuild), keys
//    <prefix>_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD. Every app has its OWN prefix
//    (ZENVY_RIDER_UPLOAD, ZENVY_RESTAURANT_UPLOAD, ZENVY_VENDOR_UPLOAD, ZENVY_DRIVER_UPLOAD), so one
//    ~/.gradle/gradle.properties can hold all keys and an app is never signed with another app's key.
//    customer-mobile keeps the plain ZENVY_UPLOAD_* names (its own android/keystore.properties).
//  - `legacyPrefix` (auto-driver-app only: ZENVY_UPLOAD) is still accepted, but ONLY from the app's own
//    android/keystore.properties, never from the shared ~/.gradle file (that name belongs to the customer app).
//  - The release build type NEVER uses the debug keystore: with no upload key it is left unsigned, and a key
//    file named debug.keystore is refused.
//  - A local assembleRelease / bundleRelease stops with a clear error when the upload key, its file or
//    google-services.json is missing (overrides: ZENVY_ALLOW_UNSIGNED_RELEASE=1 / ALLOW_BUILD_WITHOUT_FCM=1).
//    EAS builds (EAS_BUILD=true) sign with EAS-managed credentials and skip the key check.
//  - release is never debuggable.
// If the generated build.gradle ever changes shape, prebuild fails here instead of silently shipping a
// debug-signed release.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// zenvy-release-signing';

const groovyStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function propsBlock({ prefix, legacyPrefix, appLabel, readme, pkg }) {
  const P = (k) => `${prefix}_${k}`;
  const L = (k) => (legacyPrefix ? `${legacyPrefix}_${k}` : null);
  const read = (k) => {
    const parts = [`zenvyKeystoreProps.getProperty('${P(k)}')`, `findProperty('${P(k)}')`];
    if (L(k)) parts.push(`zenvyKeystoreProps.getProperty('${L(k)}')`);
    return parts.join(' ?: ');
  };
  const label = groovyStr(appLabel);
  return `${MARK}: Play upload key ${prefix}_* from android/keystore.properties (git-ignored) or ~/.gradle/gradle.properties.
def zenvyKeystoreProps = new Properties()
def zenvyKeystoreFile = rootProject.file('keystore.properties')
if (zenvyKeystoreFile.exists()) {
    zenvyKeystoreFile.withInputStream { zenvyKeystoreProps.load(it) }
}
def zenvyStoreFile = ${read('STORE_FILE')}
def zenvyStorePassword = ${read('STORE_PASSWORD')}
def zenvyKeyAlias = ${read('KEY_ALIAS')}
def zenvyKeyPassword = ${read('KEY_PASSWORD')}
def zenvyHasUploadKey = zenvyStoreFile != null && !zenvyStoreFile.toString().trim().isEmpty()

gradle.taskGraph.whenReady { graph ->
    def releasing = graph.allTasks.any { t ->
        t.project == project && (t.name.startsWith('assemble') || t.name.startsWith('bundle')) && t.name.contains('Release')
    }
    if (!releasing) return
    def onEas = System.getenv('EAS_BUILD') == 'true'
    if (!onEas && !zenvyHasUploadKey && System.getenv('ZENVY_ALLOW_UNSIGNED_RELEASE') != '1') {
        throw new GradleException('${label}: no Play upload key. Set ${prefix}_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD in ~/.gradle/gradle.properties (see ${groovyStr(readme)}). The release build is never signed with the debug key. Set ZENVY_ALLOW_UNSIGNED_RELEASE=1 for an unsigned test build.')
    }
    if (zenvyHasUploadKey) {
        def f = file(zenvyStoreFile)
        if (f.name.toLowerCase() == 'debug.keystore') {
            throw new GradleException('${label}: ${prefix}_STORE_FILE points at a debug keystore. Use the Play upload key.')
        }
        if (!onEas && !f.exists()) {
            throw new GradleException("${label}: upload key file not found: \${f}. Check ${prefix}_STORE_FILE.")
        }
        if (!zenvyStorePassword || !zenvyKeyAlias || !zenvyKeyPassword) {
            throw new GradleException('${label}: ${prefix}_STORE_PASSWORD, _KEY_ALIAS and _KEY_PASSWORD must all be set.')
        }
    }
    if (!file('google-services.json').exists() && System.getenv('ALLOW_BUILD_WITHOUT_FCM') != '1') {
        throw new GradleException('${label}: google-services.json is missing. Add ${groovyStr(pkg)} to the Zenvy Firebase project, put google-services.json next to app.json and run expo prebuild again (see ${groovyStr(readme)}). Without it closed-app pushes never arrive. Set ALLOW_BUILD_WITHOUT_FCM=1 to override.')
    }
}

android {`;
}

const RELEASE_SIGNING = `
        if (zenvyHasUploadKey) {
            release {
                storeFile file(zenvyStoreFile)
                storePassword zenvyStorePassword
                keyAlias zenvyKeyAlias
                keyPassword zenvyKeyPassword
            }
        }
    }
    buildTypes {`;

function applySigning(src, opts = {}) {
  const o = {
    prefix: opts.prefix || 'ZENVY_UPLOAD',
    legacyPrefix: opts.legacyPrefix || null,
    appLabel: opts.appLabel || 'Zenvy app',
    readme: opts.readme || 'README.md',
    pkg: opts.pkg || 'this app',
  };
  if (!/^[A-Z][A-Z0-9_]*$/.test(o.prefix)) throw new Error(`[withReleaseSigning] invalid prefix "${o.prefix}"`);
  if (o.legacyPrefix && !/^[A-Z][A-Z0-9_]*$/.test(o.legacyPrefix)) throw new Error(`[withReleaseSigning] invalid legacyPrefix "${o.legacyPrefix}"`);
  if (src.includes(MARK)) return src;
  let out = src;
  // 1. Properties + release guard before the android { } block.
  if (!/^android \{/m.test(out)) throw new Error('[withReleaseSigning] "android {" not found in app/build.gradle');
  const block = propsBlock(o);
  out = out.replace(/^android \{/m, () => block);
  // 2. A release signingConfig (only when the upload key exists), right after the debug one.
  const sc = /(signingConfigs \{\s*debug \{[\s\S]*?\}\s*)\}\s*buildTypes \{/;
  if (!sc.test(out)) throw new Error('[withReleaseSigning] signingConfigs { debug { } } block not found in app/build.gradle');
  out = out.replace(sc, (_m, debugBlock) => `${debugBlock.replace(/\s*$/, '')}${RELEASE_SIGNING}`);
  // 3. The release build type: upload key or unsigned, never signingConfigs.debug.
  const rel = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!rel.test(out)) throw new Error('[withReleaseSigning] release { signingConfig signingConfigs.debug } not found in app/build.gradle');
  out = out.replace(rel, (_m, head) => `${head}// ${MARK.slice(3)}: Play upload key, or unsigned. Never the debug keystore.
            signingConfig zenvyHasUploadKey ? signingConfigs.release : null
            debuggable false`);
  if (/release \{[^}]*signingConfig signingConfigs\.debug/.test(out)) throw new Error('[withReleaseSigning] release still uses the debug keystore');
  return out;
}

module.exports = function withReleaseSigning(config, props = {}) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') throw new Error('[withReleaseSigning] expected a Groovy app/build.gradle');
    cfg.modResults.contents = applySigning(cfg.modResults.contents, {
      appLabel: config.name,
      pkg: config.android && config.android.package,
      ...props,
    });
    return cfg;
  });
};
module.exports.applySigning = applySigning;
