// Web (preview / web build): Skia draws through CanvasKit, which has to be downloaded once before the first
// canvas. Same CanvasKit version as the bundled @shopify/react-native-skia expects (canvaskit-wasm 0.41.0).
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

let ready: Promise<boolean> | null = null;
export const ensureSkia = (): Promise<boolean> => {
  if (!ready) {
    ready = LoadSkiaWeb({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.41.0/bin/full/${file}` })
      .then(() => true)
      .catch(() => { ready = null; return false; });
  }
  return ready;
};
