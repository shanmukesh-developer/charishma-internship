import { Platform } from 'react-native';

// Firebase Crashlytics (P-H1: crash reporting for the closed test). Release builds on a phone only:
// never in dev (__DEV__) and never on web. Uncaught JS errors and native crashes are collected by
// Crashlytics itself; recordJsError() adds the React render errors that ErrorBoundary catches.
// firebase.json keeps collection off in debug builds as well. Needs a native rebuild (EAS).
const enabled = !__DEV__ && Platform.OS !== 'web';

let mod: any = null;
let instance: any = null;
function crashlytics(): { m: any; c: any } | null {
  if (!enabled) return null;
  try {
    if (!mod) mod = require('@react-native-firebase/crashlytics');
    if (!instance) instance = mod.getCrashlytics();
    return { m: mod, c: instance };
  } catch {
    return null; // native module missing (older build without Crashlytics): do nothing
  }
}

/** Reports a caught JS error (with a short context label). Never throws. */
export function recordJsError(error: unknown, context?: string): void {
  const ch = crashlytics();
  if (!ch) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    if (context) ch.m.log(ch.c, String(context).slice(0, 500));
    ch.m.recordError(ch.c, err, context ? String(context).slice(0, 100) : undefined);
  } catch {
    // reporting must never break the app
  }
}
