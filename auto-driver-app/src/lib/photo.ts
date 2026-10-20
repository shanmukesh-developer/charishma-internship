// Document / auto photos: take or pick, shrink to a readable JPEG (long side 1600 px, licence text stays
// legible), then upload to the PRIVATE driver media endpoint (POST /api/auto-ride/driver/media, multipart
// field 'image', 5 MB max, owner = this driver, purpose auto_driver_doc). The server answers with the
// media path to save in documents / photos and a 1-hour signed preview URL. No crop: whole document.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { driverApi } from '../api/driverApi';
import { ApiError, isWakingStatus, NetworkError, probeServer, UPLOAD_MESSAGES, uploadStatusMessage } from './http';
import type { MediaUpload } from '../types';

const MAX_SIDE = 1600;
const SERVER_LIMIT = 5 * 1024 * 1024;

export type PhotoSource = 'camera' | 'gallery';
export type PickResult =
  | { ok: true; uri: string; mimeType: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'denied' | 'failed' | 'tooBig'; message: string };

export async function pickPhoto(source: PhotoSource): Promise<PickResult> {
  try {
    if (source === 'camera' && Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied', message: 'Camera permission is off. Allow it in phone Settings, or pick from Gallery.' };
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8, exif: false };
    const res = source === 'camera' && Platform.OS !== 'web'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return { ok: false, reason: 'cancelled' };
    const asset = res.assets[0];
    try {
      const longSide = Math.max(asset.width || 0, asset.height || 0);
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (longSide > MAX_SIDE || longSide === 0) ctx.resize((asset.width || 0) >= (asset.height || 0) ? { width: MAX_SIDE } : { height: MAX_SIDE });
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ compress: 0.72, format: SaveFormat.JPEG });
      return { ok: true, uri: out.uri, mimeType: 'image/jpeg' };
    } catch {
      if (asset.fileSize && asset.fileSize > SERVER_LIMIT) return { ok: false, reason: 'tooBig', message: 'This photo is larger than 5 MB. Please pick a smaller one.' };
      return { ok: true, uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' };
    }
  } catch {
    return { ok: false, reason: 'failed', message: "Couldn't open the photo. Please try again." };
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** No answer, a timeout, or a "waking up" status (408 / 502-504): worth the one automatic retry. */
const retryable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && isWakingStatus(e.status));
/** Server errors from the JSON transport carry the upload wording too (too large, session expired, ...). */
const asUploadError = (e: unknown) => (e instanceof ApiError ? new ApiError(e.status, uploadStatusMessage(e.status, e.data), e.data) : e);

/**
 * Attempt 1: multipart through XHR (apiUploadXhr, 90 s). After no answer, a timeout or a "waking up"
 * status, ONE retry with the same JPEG as base64 JSON (same endpoint, 5 MB cap, a different transport).
 * A final failure says the real cause: waking up / interrupted / couldn't reach Zenvy.
 */
export async function uploadPhoto(uri: string, mimeType: string): Promise<MediaUpload> {
  const form = new FormData();
  // React Native's FormData file part (sent with XHR, see apiUploadXhr).
  form.append('image', { uri, name: `doc-${Date.now()}.jpg`, type: mimeType } as any);
  try {
    return await driverApi.uploadMedia(form);
  } catch (err) {
    if (!retryable(err)) throw err;
    console.warn('[uploadPhoto] attempt 1 failed:', (err as Error)?.message);
    let base64: string | undefined;
    try {
      const ref = await ImageManipulator.manipulate(uri).renderAsync();
      base64 = (await ref.saveAsync({ compress: 0.72, format: SaveFormat.JPEG, base64: true })).base64;
    } catch {
      base64 = undefined;
    }
    await wait(1500);
    try {
      if (!base64) throw err; // could not re-encode: report the first failure
      return await driverApi.uploadMediaBase64(`data:image/jpeg;base64,${base64}`);
    } catch (second) {
      console.warn('[uploadPhoto] attempt 2 failed:', (second as Error)?.message);
      if (!(second instanceof NetworkError)) throw asUploadError(second);
      if (second.timeout) throw new NetworkError(UPLOAD_MESSAGES.waking, true);
      const state = await probeServer();
      throw new NetworkError(state === 'waking' ? UPLOAD_MESSAGES.waking : state === 'up' ? UPLOAD_MESSAGES.interrupted : UPLOAD_MESSAGES.unreachable);
    }
  }
}
