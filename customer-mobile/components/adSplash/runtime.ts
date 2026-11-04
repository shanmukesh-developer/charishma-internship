// Everything that touches Skia, loaded by AdSplashHost only after ensureSkia() (web needs CanvasKit
// downloaded before @shopify/react-native-skia is first imported; on phones this is just a lazy import).
import { Skia, type SkImage } from '@shopify/react-native-skia';

export { default as AdSplash } from './AdSplash';

export async function loadArt(uri: string): Promise<SkImage | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch { return null; }
}
