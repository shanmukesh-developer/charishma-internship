// Listing photos: take or pick, shrink to a JPEG (long side 1600 px), then upload to POST /api/pg-owner/media
// (multipart field 'image', 5 MB max, PUBLIC 'pg' media). Same transport rules as the other partner apps:
// attempt 1 = multipart through XHR (Expo's fetch cannot send RN file parts), and after no answer / a timeout /
// a "waking up" status ONE retry with the same JPEG as base64 JSON. Final failures say the real cause.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ownerApi } from '../api/ownerApi';
import { API_URL } from '../config';
import { ApiError, isWakingStatus, NetworkError, probeServer, UPLOAD_MESSAGES, uploadStatusMessage } from './http';
import type { MediaUpload } from '../types';

const MAX_SIDE = 1600;
const SERVER_LIMIT = 5 * 1024 * 1024;

export type PhotoSource = 'camera' | 'gallery';
export type PickResult =
  | { ok: true; uri: string; mimeType: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'denied' | 'failed' | 'tooBig'; message: string };

/** Absolute URL for an image the server stored relative ('/api/campus/media/<id>') or absolute. */
export const imageUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `${API_URL.replace(/\/+$/, '')}${u.startsWith('/') ? '' : '/'}${u}`;
};

export async function pickPhoto(source: PhotoSource): Promise<PickResult> {
  try {
    if (source === 'camera' && Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: 'denied', message: 'Camera permission is off. Allow it in phone Settings, or pick from Gallery.' };
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.85, exif: false };
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
      const out = await ref.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
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
const retryable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && isWakingStatus(e.status));
const asUploadError = (e: unknown) => (e instanceof ApiError ? new ApiError(e.status, uploadStatusMessage(e.status, e.data), e.data) : e);

export async function uploadPhoto(uri: string, mimeType: string): Promise<MediaUpload> {
  const form = new FormData();
  // React Native's FormData file part (sent with XHR, see apiUploadXhr).
  form.append('image', { uri, name: `pg-${Date.now()}.jpg`, type: mimeType } as any);
  try {
    return await ownerApi.uploadMedia(form);
  } catch (err) {
    if (!retryable(err)) throw asUploadError(err);
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
      return await ownerApi.uploadMediaBase64(`data:image/jpeg;base64,${base64}`);
    } catch (second) {
      if (!(second instanceof NetworkError)) throw asUploadError(second);
      if (second.timeout) throw new NetworkError(UPLOAD_MESSAGES.waking, true);
      const state = await probeServer();
      throw new NetworkError(state === 'waking' ? UPLOAD_MESSAGES.waking : state === 'up' ? UPLOAD_MESSAGES.interrupted : UPLOAD_MESSAGES.unreachable);
    }
  }
}
