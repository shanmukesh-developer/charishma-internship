// JS side of the local Expo module (android/…/ZenWeInAppUpdateModule.kt): Google Play In-App Updates.
// The native module exists on Android only. On iOS / web (and in any build without it) getInAppUpdateNative()
// returns null, so callers fall back to opening the store listing. Never import this file's native module
// directly anywhere else: use utils/inAppUpdate.ts.
import { Platform } from 'react-native';

export type PlayInstallStatus =
  | 'pending'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'failed'
  | 'canceled'
  | 'unknown';

export type PlayUpdateInfo = {
  /** Play has a newer version for this install (UPDATE_AVAILABLE). */
  available: boolean;
  /** An immediate update was started and interrupted (resume it with startImmediate). */
  inProgress: boolean;
  /** versionCode of the newer version on Play (0 when none). */
  versionCode: number;
  flexibleAllowed: boolean;
  immediateAllowed: boolean;
  /** Days since Play told this device about the update (null when unknown). */
  stalenessDays: number | null;
  /** Play Console update priority 0..5. */
  priority: number;
  installStatus: PlayInstallStatus;
  bytesDownloaded: number;
  totalBytes: number;
  /** Installed by the Play Store (a sideloaded APK gets "no update" from Play, never an error). */
  installedFromPlay: boolean;
};

export type PlayInstallState = {
  status: PlayInstallStatus;
  bytesDownloaded: number;
  totalBytes: number;
  errorCode: number;
};

export type PlayStartResult = 'accepted' | 'canceled' | 'failed' | 'not_allowed' | 'not_started';

export type InAppUpdateNative = {
  checkForUpdate(): Promise<PlayUpdateInfo>;
  startFlexible(): Promise<PlayStartResult>;
  startImmediate(): Promise<PlayStartResult>;
  completeUpdate(): Promise<boolean>;
  addListener(event: 'onInstallState', fn: (s: PlayInstallState) => void): { remove(): void };
};

let cached: InAppUpdateNative | null | undefined;

export function getInAppUpdateNative(): InAppUpdateNative | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'android') return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expo = require('expo');
    const mod = expo && typeof expo.requireOptionalNativeModule === 'function'
      ? expo.requireOptionalNativeModule('ZenWeInAppUpdate')
      : null;
    cached = mod && typeof mod.checkForUpdate === 'function' ? (mod as InAppUpdateNative) : null;
  } catch {
    cached = null;
  }
  return cached;
}
