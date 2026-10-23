/**
 * One image pipeline for the student / friends / community section.
 *
 *   pick (expo-image-picker)  ->  compress (expo-image-manipulator, long edge <= 1280 px, JPEG 0.7)
 *   ->  upload to POST /api/campus/media  ->  short URL
 *
 * Transport (Expo SDK 57):
 *   - Native: the global `fetch` is expo/fetch (WinterCG). It CANNOT send React Native's
 *     `{ uri, name, type }` FormData file parts: it throws "Unsupported FormDataPart implementation"
 *     before any request is made (that was the "Check your internet" failure on every photo).
 *     So native uploads go multipart through XMLHttpRequest (still React Native's own networking,
 *     which streams the local file), and fall back to JSON base64 through fetch if that fails.
 *   - Web: JSON base64 through fetch (the same endpoint accepts it).
 * Never sends base64 over a socket.
 *
 * Reliability (20 Oct 2026):
 *   - 90 s per attempt (a 1-5 MB photo on campus Wi-Fi / 4G, or a free Render instance waking up, ~60 s).
 *   - One automatic retry on a network error, a timeout or a "waking up" answer (408 / 502 / 503 / 504):
 *     native retries with the JSON base64 transport, web retries the same request.
 *   - The message says the real cause: too large, session expired, Zenvy waking up, upload interrupted,
 *     or "couldn't reach Zenvy" (only when a quick GET /api/ping also fails). Never a blanket "No internet".
 */
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { API_URL } from '../constants/api';
import { getToken } from './auth';

/**
 * Server-side media purposes (POST /api/campus/media). `id_card`, `connect` and `liveness_selfie`
 * are private: the server only serves them to the owner / admins, or through a 1 h signed `previewUrl`.
 */
export type MediaPurpose =
  | 'id_card'
  | 'chat'
  | 'lost_found'
  | 'avatar'
  | 'post'
  | 'other'
  | 'connect'
  | 'forum'
  | 'task'
  | 'liveness_selfie'
  // Rentals: vehicle photos are public; RC / insurance / licences / report photos are private.
  | 'rental_photo'
  | 'rental_doc'
  | 'rental_licence'
  | 'rental_report'
  // C7: pickup / return condition photos and extra-charge evidence (private, both students + admin).
  | 'rental_condition'
  // Campus Events: event posters / gallery images (public, served to every student of the campus).
  | 'event_poster'
  // Support ticket photos (private: the customer and support staff).
  | 'support';

export const PRIVATE_MEDIA_PURPOSES: readonly MediaPurpose[] = ['id_card', 'connect', 'liveness_selfie', 'rental_doc', 'rental_licence', 'rental_report', 'rental_condition', 'support'];

export interface UploadedImage {
  /** Short relative path, e.g. /api/campus/media/<id>. Store this for campus features. */
  url: string;
  /** Absolute https URL. Use for features that only accept http(s) links (posts, wall, birthdays, profile). */
  absoluteUrl: string;
  /** Local compressed file, handy for an instant preview. */
  localUri: string;
  /** Media id (when the server returns it). */
  id?: string;
  /** True for private purposes (id_card, connect, liveness_selfie). */
  isPrivate?: boolean;
  /** Private uploads only: a signed link valid for about 1 hour, for showing the photo right away. */
  previewUrl?: string;
}

export interface PickOptions {
  source?: 'library' | 'camera';
  /** Let the user crop before upload. */
  allowsEditing?: boolean;
  aspect?: [number, number];
  /** Long edge in px after compression. ID cards use 1600 so the text stays readable. */
  maxEdge?: number;
  quality?: number;
}

const DEFAULT_MAX_EDGE = 1280;
const DEFAULT_QUALITY = 0.7;
const UPLOAD_TIMEOUT_MS = 90000;
const PROBE_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1500;

export const UPLOAD_MESSAGES = {
  tooLarge: 'That photo is too large. Please choose a smaller one.',
  session: 'Your session has expired. Please sign in again to upload photos.',
  waking: 'Zenvy is waking up, please try again in a few seconds.',
  interrupted: 'The upload was interrupted. Please try again.',
  unreachable: "Couldn't reach Zenvy. Check your Wi-Fi or mobile data, then try again.",
} as const;

export class ImageUploadError extends Error {
  code: string;
  retryable: boolean;
  constructor(message: string, code = 'UPLOAD_FAILED', retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/** Relative /api/... media paths must be prefixed with the API host before <Image> can load them. */
export const resolveMediaUrl = (url?: string | null): string | null => {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (/^(https?:|data:|file:|content:|blob:|ph:|assets-library:)/i.test(u)) return u;
  if (u.startsWith('/')) return `${API_URL}${u}`;
  return null;
};

/** Ask for the right permission and open the gallery or camera. Returns null when cancelled or denied. */
export const pickImageAsset = async (opts: PickOptions = {}): Promise<ImagePicker.ImagePickerAsset | null> => {
  const source = opts.source || 'library';
  try {
    // Android: the gallery opens the system photo picker, which needs NO permission (Google Play
    // photo & video policy: the app declares no READ_MEDIA_* / storage permission). Only the camera
    // and the iOS photo library ask.
    if (Platform.OS !== 'web' && (source === 'camera' || Platform.OS === 'ios')) {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          source === 'camera' ? 'Camera access needed' : 'Photo access needed',
          source === 'camera'
            ? 'Allow camera access in your phone settings to take a photo.'
            : 'Allow photo access in your phone settings to choose a picture.'
        );
        return null;
      }
    }
    const pickerOpts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: !!opts.allowsEditing,
      aspect: opts.aspect,
      // Full quality here: the manipulator does the real compression in one pass.
      quality: 1,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOpts)
        : await ImagePicker.launchImageLibraryAsync(pickerOpts);
    if (result.canceled || !result.assets || !result.assets[0]) return null;
    return result.assets[0];
  } catch {
    Alert.alert(
      source === 'camera' ? "Couldn't open the camera" : "Couldn't open your photos",
      'Please try again.'
    );
    return null;
  }
};

/** Resize to a long edge of maxEdge px and re-encode as JPEG. Falls back to the original on failure. */
export const compressImage = async (
  uri: string,
  opts: { width?: number; height?: number; maxEdge?: number; quality?: number } = {}
): Promise<{ uri: string; base64?: string }> => {
  const maxEdge = opts.maxEdge || DEFAULT_MAX_EDGE;
  // Native also keeps the base64 copy: it is the fallback body if the multipart upload fails.
  const wantBase64 = true;
  try {
    let width = opts.width || 0;
    let height = opts.height || 0;
    let ctx = ImageManipulator.manipulate(uri);
    if (!width || !height) {
      const probe = await ctx.renderAsync();
      width = probe.width;
      height = probe.height;
      ctx = ImageManipulator.manipulate(probe);
    }
    if (Math.max(width, height) > maxEdge) {
      ctx = width >= height ? ctx.resize({ width: maxEdge }) : ctx.resize({ height: maxEdge });
    }
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({
      compress: opts.quality ?? DEFAULT_QUALITY,
      format: SaveFormat.JPEG,
      base64: wantBase64,
    });
    return { uri: out.uri, base64: out.base64 };
  } catch {
    return { uri };
  }
};

/** 408 (server request timeout) and 502 / 503 / 504 (Render waking up, or "starting up") are worth a retry. */
const isWakingStatus = (status: number) => status === 408 || (status >= 502 && status <= 504);

const friendlyStatusMessage = (status: number, json: any): ImageUploadError => {
  const code = String(json?.code || '');
  if (status === 401) return new ImageUploadError(UPLOAD_MESSAGES.session, 'AUTH', false);
  if (status === 413 || code === 'FILE_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE') {
    return new ImageUploadError(UPLOAD_MESSAGES.tooLarge, 'FILE_TOO_LARGE', false);
  }
  if (status === 415 || code === 'UNSUPPORTED_TYPE') {
    return new ImageUploadError('Please choose a JPG, PNG or WEBP photo.', 'UNSUPPORTED_TYPE', false);
  }
  if (status === 429) {
    return new ImageUploadError('You have uploaded a lot of photos. Please wait a little and try again.', 'RATE_LIMIT');
  }
  if (isWakingStatus(status)) {
    return new ImageUploadError(UPLOAD_MESSAGES.waking, 'SERVER_BUSY');
  }
  const msg = typeof json?.message === 'string' && json.message.length < 160 ? json.message : '';
  return new ImageUploadError(msg || "Couldn't upload the photo. Please try again.", code || 'UPLOAD_FAILED');
};

type UploadResult = { status: number; json: any };

const logUpload = (stage: string, err: any) => {
  // Shows the real cause in Metro / logcat (the user only sees the friendly message).
  console.warn(`[imageUpload] ${stage} failed:`, err?.name || '', err?.code || '', err?.message || String(err));
};

/** Multipart through React Native's XMLHttpRequest (supports { uri, name, type } file parts). */
const uploadMultipartXhr = (uri: string, purpose: MediaPurpose, token: string): Promise<UploadResult> =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('image', { uri, name: `${purpose}-${Date.now()}.jpg`, type: 'image/jpeg' } as any);
    form.append('purpose', purpose);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/campus/media`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    // No Content-Type: the networking layer adds multipart/form-data with its boundary.
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.onload = () => {
      // Status 0 = no HTTP answer at all (connection dropped): a transport failure, not a server reply.
      if (!xhr.status) { reject(Object.assign(new Error('XHR status 0'), { code: 'XHR_ERROR' })); return; }
      let json: any = null;
      try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { json = null; }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(Object.assign(new Error('XHR network error'), { code: 'XHR_ERROR' }));
    xhr.ontimeout = () => reject(Object.assign(new Error('XHR timeout'), { code: 'XHR_TIMEOUT' }));
    xhr.send(form as any);
  });

/** JSON { image: dataUrl, purpose } through fetch (works with expo/fetch and on web). */
const uploadJson = async (dataUrl: string, purpose: MediaPurpose, token: string): Promise<UploadResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/campus/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ image: dataUrl, purpose }),
      signal: controller.signal,
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch (e: any) {
    throw e?.name === 'AbortError' ? Object.assign(new Error('fetch timeout'), { code: 'FETCH_TIMEOUT' }) : e;
  } finally {
    clearTimeout(timer);
  }
};

const isTimeout = (e: any) => /TIMEOUT/.test(String(e?.code || ''));

/**
 * After every attempt failed without an HTTP answer: is the server reachable at all? A quick GET /api/ping
 * tells "Zenvy is waking up" (slow / no answer in 8 s, or a 5xx) from "the upload itself was cut off"
 * (ping answers) from "nothing gets through" (ping fails at once).
 */
const probeServer = async (): Promise<'up' | 'waking' | 'unreachable'> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/ping`, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    return res.status >= 500 ? 'waking' : 'up';
  } catch (e: any) {
    return e?.name === 'AbortError' ? 'waking' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }
};

/** The friendly error for "no HTTP answer" after the retry. */
const transportError = async (lastErr: any): Promise<ImageUploadError> => {
  if (isTimeout(lastErr)) return new ImageUploadError(UPLOAD_MESSAGES.waking, 'SERVER_BUSY');
  const state = await probeServer();
  logUpload(`probe=${state}`, lastErr);
  if (state === 'waking') return new ImageUploadError(UPLOAD_MESSAGES.waking, 'SERVER_BUSY');
  if (state === 'up') return new ImageUploadError(UPLOAD_MESSAGES.interrupted, 'INTERRUPTED');
  return new ImageUploadError(UPLOAD_MESSAGES.unreachable, 'NETWORK');
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A data URL for the file: the base64 we already have, or a fresh JPEG encode of the local file. */
const dataUrlFor = async (file: { uri: string; base64?: string }): Promise<string | null> => {
  if (/^data:/i.test(file.uri)) return file.uri;
  if (file.base64) return `data:image/jpeg;base64,${file.base64}`;
  try {
    const ref = await ImageManipulator.manipulate(file.uri).renderAsync();
    const out = await ref.saveAsync({ compress: DEFAULT_QUALITY, format: SaveFormat.JPEG, base64: true });
    return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
  } catch (e) {
    logUpload('base64 encode', e);
    return null;
  }
};

/** Upload an already-compressed local image to /api/campus/media. */
export const uploadImageFile = async (
  file: { uri: string; base64?: string },
  purpose: MediaPurpose = 'other'
): Promise<UploadedImage> => {
  const token = await getToken();
  if (!token) throw new ImageUploadError('Please sign in to upload photos.', 'AUTH', false);

  let result: UploadResult | null = null;
  let lastErr: any = null;
  const multipartFirst = Platform.OS !== 'web' && !/^data:/i.test(file.uri);
  let dataUrl: string | null | undefined; // encoded once, only when the JSON transport is needed

  const viaJson = async (): Promise<UploadResult> => {
    if (dataUrl === undefined) dataUrl = await dataUrlFor(file);
    if (!dataUrl) throw Object.assign(new Error('could not encode the photo'), { code: 'READ_FAILED' });
    return uploadJson(dataUrl, purpose, token);
  };

  // Attempt 1: native = multipart via XHR (streams the file, no base64 in JS memory); web / data URL = JSON.
  // Attempt 2 (the one automatic retry), only after no answer / a timeout / a "waking up" status:
  // JSON base64 via fetch (a different transport, so it also covers a multipart-only failure).
  let wakingResult: UploadResult | null = null; // attempt 1 answered 408 / 5xx
  for (let attempt = 1; attempt <= 2; attempt++) {
    const transport = attempt === 1 && multipartFirst ? 'multipart XHR' : 'JSON base64 fetch';
    try {
      result = transport === 'multipart XHR' ? await uploadMultipartXhr(file.uri, purpose, token) : await viaJson();
      if (attempt === 1 && isWakingStatus(result.status)) {
        logUpload(`attempt 1 (${transport}, HTTP ${result.status})`, new Error('server waking / busy'));
        wakingResult = result;
        result = null;
        await wait(RETRY_DELAY_MS);
        continue;
      }
      break;
    } catch (e: any) {
      result = null;
      if (e?.code === 'READ_FAILED') break; // nothing to send as JSON: report the earlier failure (below)
      lastErr = e;
      logUpload(`attempt ${attempt} (${transport})`, e);
      if (attempt === 1) await wait(RETRY_DELAY_MS);
    }
  }

  if (!result) {
    if (lastErr) throw await transportError(lastErr);
    if (wakingResult) throw friendlyStatusMessage(wakingResult.status, wakingResult.json);
    throw new ImageUploadError("Couldn't read that photo. Please pick another one.", 'READ_FAILED', false);
  }

  const { status, json } = result;
  if (status < 200 || status >= 300) throw friendlyStatusMessage(status, json);
  const url: string = json?.url || '';
  if (!url) throw new ImageUploadError("Couldn't upload the photo. Please try again.");
  // Build the absolute link from the API host this app talks to (always https in production).
  const absoluteUrl: string = (url.startsWith('/') ? resolveMediaUrl(url) : null) || json.absoluteUrl || json.imageUrl || url;
  const out: UploadedImage = { url, absoluteUrl, localUri: file.uri };
  if (typeof json?.id === 'string') out.id = json.id;
  if (typeof json?.isPrivate === 'boolean') out.isPrivate = json.isPrivate;
  if (typeof json?.previewUrl === 'string' && json.previewUrl) out.previewUrl = json.previewUrl;
  return out;
};

/** Compress + upload a local image (for example one picked earlier for a preview). */
export const prepareAndUploadImage = async (
  asset: { uri: string; width?: number; height?: number },
  purpose: MediaPurpose = 'other',
  opts: { maxEdge?: number; quality?: number } = {}
): Promise<UploadedImage> => {
  const compressed = await compressImage(asset.uri, {
    width: asset.width,
    height: asset.height,
    maxEdge: opts.maxEdge,
    quality: opts.quality,
  });
  return uploadImageFile(compressed, purpose);
};

/**
 * Pick -> compress -> upload in one call. Returns null if the user cancelled.
 * Throws ImageUploadError with a friendly message on failure.
 */
export const pickAndUploadImage = async (
  purpose: MediaPurpose,
  opts: PickOptions = {}
): Promise<UploadedImage | null> => {
  const asset = await pickImageAsset(opts);
  if (!asset) return null;
  return prepareAndUploadImage(asset, purpose, { maxEdge: opts.maxEdge, quality: opts.quality });
};

/** Standard error alert with a Retry button (only when retrying can help). */
export const alertUploadError = (err: any, retry?: () => void, title = "Photo didn't upload") => {
  const message =
    err instanceof ImageUploadError || (err && typeof err.message === 'string' && err.message.length < 160)
      ? err.message
      : "Couldn't upload the photo. Please try again.";
  const canRetry = !!retry && !(err instanceof ImageUploadError && !err.retryable);
  Alert.alert(title, message, canRetry ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Retry', onPress: retry }] : undefined);
};
