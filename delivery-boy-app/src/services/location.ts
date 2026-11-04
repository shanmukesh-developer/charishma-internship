// GPS for distance-to-store and live tracking. Runs only while on duty or holding an active order.
// Foreground: watchPositionAsync. Background (the rider switched to Google Maps to navigate): a
// location task with an Android foreground service, so the process and its socket stay alive and the
// customer map / admin radar keep moving during the ride. Background permission is asked once, after the
// in-app prominent disclosure (confirmBackgroundDisclosure, shown before EVERY background request), only when tracking starts (on duty / holding an order); declining keeps foreground-only and
// the Home screen shows a banner to allow it later (requestBackgroundLocation).
// Battery: 'idle' mode (on duty, no order) uses balanced accuracy every 30-60 s; 'active' (holding an order)
// uses high accuracy. The foreground watch pauses while the app is in the background (the task covers it).
import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getItem, setItem } from './session';

export interface Fix {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  /** Metres (68% radius), null when the phone did not say. */
  accuracy: number | null;
  ts: number;
}

/**
 * 'active': holding an order (customer map is live): high accuracy, frequent fixes.
 * 'idle': on duty without an order (admin radar / distance to store only): balanced accuracy, 30-60 s.
 */
export type TrackingMode = 'active' | 'idle';

let sub: Location.LocationSubscription | null = null;
let gen = 0; // bumps on every start/stop so a late result after stop is discarded
let watchGen = 0; // bumps on every watch (re)start / removal
let lastFix: Fix | null = null;
/** Current consumer of fixes from either source; null while tracking is stopped. */
let listener: ((f: Fix) => void) | null = null;
let mode: TrackingMode = 'idle';
let bgMode: TrackingMode | null = null; // options the background task was started with (null = not started by us)
let foreground = true;
let fgGranted = false;

const BG_TASK = 'zenvy-rider-location';
const BG_ASKED_KEY = '@zenvy_rider_bg_location_asked';

// Idle has no distance filter: a rider waiting on duty at one spot (outside a store, at the hostel gate) must
// still report every 30-60 s. With a 50 / 100 m filter a parked rider sent nothing, the server's last fix went
// older than RIDER_FRESH_MINUTES (10) and dispatch ranked them last for new-order pushes. Balanced accuracy
// (Wi-Fi / cell) at that interval stays cheap on battery.
const WATCH_OPTS: Record<TrackingMode, Location.LocationOptions> = {
  active: { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 },
  idle: { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 0 },
};
const BG_OPTS: Record<TrackingMode, Location.LocationTaskOptions> = {
  active: { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 15 },
  idle: { accuracy: Location.Accuracy.Balanced, timeInterval: 60000, distanceInterval: 0, deferredUpdatesInterval: 60000 },
};

// ── Background permission state (Home banner) ──────────────────────────────
export type BgLocationState = 'granted' | 'denied' | 'unknown';
let bgState: BgLocationState = 'unknown';
const bgListeners = new Set<(s: BgLocationState) => void>();

function setBgState(next: BgLocationState): void {
  if (next === bgState) return;
  bgState = next;
  bgListeners.forEach((l) => {
    try {
      l(next);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeBackgroundLocation(l: (s: BgLocationState) => void): () => void {
  bgListeners.add(l);
  l(bgState);
  return () => {
    bgListeners.delete(l);
  };
}

function toFix(loc: Location.LocationObject): Fix {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    heading: Number.isFinite(loc.coords.heading ?? NaN) && (loc.coords.heading ?? -1) >= 0 ? loc.coords.heading : null,
    speed: Number.isFinite(loc.coords.speed ?? NaN) && (loc.coords.speed ?? -1) >= 0 ? loc.coords.speed : null,
    accuracy: Number.isFinite(loc.coords.accuracy ?? NaN) && (loc.coords.accuracy ?? -1) >= 0 ? loc.coords.accuracy : null,
    ts: loc.timestamp,
  };
}

function deliver(f: Fix): void {
  // Drop out-of-order fixes (the watch and the background task can both report).
  if (lastFix && f.ts < lastFix.ts) return;
  lastFix = f;
  listener?.(f);
}

// Must be defined at module load (also when Android restarts the JS context for the task).
if (!TaskManager.isTaskDefined(BG_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(BG_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    if (!listener) {
      // Tracking was stopped (logout / off duty) or the app was killed: never keep tracking on our own.
      Location.stopLocationUpdatesAsync(BG_TASK).catch(() => {});
      return;
    }
    const latest = data.locations[data.locations.length - 1];
    deliver(toFix(latest));
  });
}

/**
 * C9 (Google Play "prominent disclosure"): shown in the app BEFORE every request for background location
 * (the system prompt or the app's settings page). Resolves true only on "Accept".
 */
export const BACKGROUND_DISCLOSURE_TITLE = 'Allow location in the background?';
export const BACKGROUND_DISCLOSURE_TEXT =
  'ZenWe Rider collects your location to assign nearby orders and share live location with customers during deliveries, ' +
  'even when the app is closed or not in use (for example while you navigate in Google Maps). It is used only while you are ' +
  'on duty or delivering, a notification shows whenever it is on, and it stops when you go offline. ' +
  'On the next screen choose "Allow all the time".';

export function confirmBackgroundDisclosure(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    Alert.alert(
      BACKGROUND_DISCLOSURE_TITLE,
      BACKGROUND_DISCLOSURE_TEXT,
      [
        { text: 'Not now', style: 'cancel', onPress: () => finish(false) },
        { text: 'Accept', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}

async function ensureBackgroundPermission(): Promise<boolean> {
  try {
    const cur = await Location.getBackgroundPermissionsAsync();
    if (cur.status === 'granted') {
      setBgState('granted');
      return true;
    }
    setBgState('denied');
    // Asked once already: the Home banner offers "Allow" instead of a popup on every start.
    if (!cur.canAskAgain || (await getItem(BG_ASKED_KEY)) === '1') return false;
    await setItem(BG_ASKED_KEY, '1');
    const ok = await confirmBackgroundDisclosure();
    if (!ok) return false;
    const granted = (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
    setBgState(granted ? 'granted' : 'denied');
    return granted;
  } catch {
    return false;
  }
}

/**
 * Home banner "Allow": ask again, or open the app's settings page when Android will not show the prompt
 * (Android 11+ only offers "Allow all the time" there). Starts background updates once granted.
 */
export async function requestBackgroundLocation(): Promise<boolean> {
  try {
    const cur = await Location.getBackgroundPermissionsAsync();
    let granted = cur.status === 'granted';
    if (!granted) {
      // Prominent disclosure first, every time (before the system prompt or the settings page).
      if (!(await confirmBackgroundDisclosure())) return false;
      if (cur.canAskAgain) granted = (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
    }
    if (!granted) {
      await Linking.openSettings().catch(() => {});
      return false;
    }
    setBgState('granted');
    if (listener && fgGranted) startBackgroundUpdates(gen);
    return true;
  } catch {
    return false;
  }
}

/** Re-read the permission on resume (the rider may have changed it on the settings page). */
export async function recheckBackgroundLocation(): Promise<void> {
  try {
    const cur = await Location.getBackgroundPermissionsAsync();
    const granted = cur.status === 'granted';
    setBgState(granted ? 'granted' : 'denied');
    if (granted && listener && fgGranted && bgMode === null) startBackgroundUpdates(gen);
  } catch {
    // keep the last known state
  }
}

async function startBackgroundUpdates(my: number): Promise<void> {
  if (!(await ensureBackgroundPermission()) || my !== gen) return;
  const want = mode;
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BG_TASK);
    if (running && bgMode === want) return;
    // Mode changed (order taken / delivered): restart with the new accuracy + interval.
    if (running) await Location.stopLocationUpdatesAsync(BG_TASK);
    if (my !== gen) return;
    bgMode = want;
    await Location.startLocationUpdatesAsync(BG_TASK, {
      ...BG_OPTS[want],
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.OtherNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'ZenWe Rider is on duty',
        notificationBody:
          want === 'active'
            ? 'Sharing your live location with the customer while you deliver.'
            : 'Sharing your location with ZenWe while you are on duty.',
        notificationColor: '#C9A84C',
        killServiceOnDestroy: true,
      },
    });
    if (my !== gen) stopBackgroundUpdates(); // stopped while starting
    else if (mode !== want) startBackgroundUpdates(my); // mode changed while starting
  } catch {
    bgMode = null;
    // no background support on this build: foreground tracking still works
  }
}

function stopBackgroundUpdates(): void {
  bgMode = null;
  Location.hasStartedLocationUpdatesAsync(BG_TASK)
    .then((on) => (on ? Location.stopLocationUpdatesAsync(BG_TASK) : undefined))
    .catch(() => {});
}

function removeWatch(): void {
  watchGen++;
  try {
    sub?.remove();
  } catch {
    // ignore
  }
  sub = null;
}

/** (Re)start the foreground watch with the current mode's options. Only while the app is in the foreground. */
async function applyWatch(): Promise<void> {
  removeWatch();
  if (!listener || !fgGranted || !foreground) return;
  const my = watchGen;
  try {
    const s = await Location.watchPositionAsync(WATCH_OPTS[mode], (loc) => deliver(toFix(loc)));
    if (my !== watchGen) {
      s.remove();
      return;
    }
    sub = s;
  } catch {
    // the background task (if any) still reports
  }
}

export function getLastFix(): Fix | null {
  return lastFix;
}

const SOS_FRESH_MS = 60 * 1000;

/**
 * Best position for an SOS, within ~6 s: a fix from the last minute, else a new one (only when location is
 * already allowed: no permission popup in an emergency), else the newest of the phone's last known position
 * and our last fix. The caller sends `ts` along so the server can tell the admin how old it is.
 */
export async function getSosFix(): Promise<Fix | null> {
  const known = lastFix;
  if (known && Date.now() - known.ts < SOS_FRESH_MS) return known;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return known;
    const current = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(toFix),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]).catch(() => null);
    if (current) return current;
    const last = await Location.getLastKnownPositionAsync().then((l) => (l ? toFix(l) : null)).catch(() => null);
    if (last && (!known || last.ts > known.ts)) return last;
  } catch {
    // fall back to what we have
  }
  return known;
}

export async function startTracking(onFix: (f: Fix) => void, nextMode: TrackingMode = mode): Promise<'granted' | 'denied'> {
  listener = onFix;
  if (fgGranted) {
    setTrackingMode(nextMode);
    return 'granted';
  }
  mode = nextMode;
  const my = ++gen;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return 'denied';
    if (my !== gen) return 'granted';
    fgGranted = true;
    await applyWatch();
    if (my !== gen) return 'granted';
    startBackgroundUpdates(my);
    return 'granted';
  } catch {
    return 'denied';
  }
}

/** Holding an order or not: switch accuracy / interval of both the watch and the background task. */
export function setTrackingMode(next: TrackingMode): void {
  if (next === mode) return;
  mode = next;
  if (!listener || !fgGranted) return;
  applyWatch();
  if (bgMode !== null) startBackgroundUpdates(gen);
}

/**
 * App went to the background / came back. In the background only the location task reports (it runs as a
 * foreground service); the watch would only duplicate it, so it is paused.
 */
export function setAppForeground(active: boolean): void {
  if (active === foreground) return;
  foreground = active;
  if (!listener || !fgGranted) return;
  if (active) applyWatch();
  else removeWatch();
}

export function stopTracking(): void {
  gen++;
  listener = null;
  fgGranted = false;
  removeWatch();
  stopBackgroundUpdates();
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
