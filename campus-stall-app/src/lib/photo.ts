// Dish photo: take / pick, then shrink to a small JPEG before upload. The server stores the photo inside
// the item (as a data URL, 2 MB max) and sends it to every customer with the menu, so it must stay small.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_SIDE = 720;
const SERVER_LIMIT = 2 * 1024 * 1024;

export type PhotoSource = 'camera' | 'gallery';
export type PickResult =
  | { ok: true; uri: string; mimeType: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'denied' | 'failed' | 'tooBig'; message: string };

export async function pickPhoto(source: PhotoSource): Promise<PickResult> {
  try {
    if (source === 'camera' && Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        return { ok: false, reason: 'denied', message: 'Camera permission is off. Allow it in phone Settings, or pick from Gallery.' };
      }
    }
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      exif: false,
    };
    const res = source === 'camera' && Platform.OS !== 'web'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return { ok: false, reason: 'cancelled' };
    const asset = res.assets[0];

    try {
      const longSide = Math.max(asset.width || 0, asset.height || 0);
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (longSide > MAX_SIDE || longSide === 0) {
        ctx.resize((asset.width || 0) >= (asset.height || 0) ? { width: MAX_SIDE } : { height: MAX_SIDE });
      }
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
      return { ok: true, uri: out.uri, mimeType: 'image/jpeg' };
    } catch {
      // Compression failed (rare): send the picked file only if it fits the server limit.
      if (asset.fileSize && asset.fileSize > SERVER_LIMIT) {
        return { ok: false, reason: 'tooBig', message: 'This photo is too big. Please pick a smaller one.' };
      }
      return { ok: true, uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' };
    }
  } catch {
    return { ok: false, reason: 'failed', message: "Couldn't open the photo. Please try again." };
  }
}
