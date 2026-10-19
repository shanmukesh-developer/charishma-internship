// Document / auto photos: take or pick, shrink to a readable JPEG (long side 1600 px, licence text stays
// legible), then upload to the PRIVATE driver media endpoint (POST /api/auto-ride/driver/media, multipart
// field 'image', 5 MB max, owner = this driver, purpose auto_driver_doc). The server answers with the
// media path to save in documents / photos and a 1-hour signed preview URL. No crop: whole document.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { driverApi } from '../api/driverApi';
import { NetworkError } from './http';
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

export async function uploadPhoto(uri: string, mimeType: string): Promise<MediaUpload> {
  const form = new FormData();
  // React Native's FormData file part (sent with XHR, see apiUploadXhr).
  form.append('image', { uri, name: `doc-${Date.now()}.jpg`, type: mimeType } as any);
  try {
    return await driverApi.uploadMedia(form);
  } catch (err) {
    if (!(err instanceof NetworkError)) throw err;
    // Multipart did not leave the phone: send the same JPEG as base64 JSON (same endpoint, 5 MB cap).
    let base64: string | undefined;
    try {
      const ref = await ImageManipulator.manipulate(uri).renderAsync();
      base64 = (await ref.saveAsync({ compress: 0.72, format: SaveFormat.JPEG, base64: true })).base64;
    } catch {
      base64 = undefined;
    }
    if (!base64) throw err;
    return driverApi.uploadMediaBase64(`data:image/jpeg;base64,${base64}`);
  }
}
