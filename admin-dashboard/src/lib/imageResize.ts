/**
 * Browser-side image resizing used before every admin upload (moved here from
 * components/restaurants/helpers.ts so lib/api.ts uploadImage can use it everywhere).
 */

/**
 * Scales an image down to fit maxW × maxH (cover crop when `crop` is set) and re-encodes it as JPEG
 * (or WEBP for logos with transparency) under ~600 KB. Smaller images load much faster in the customer app.
 */
export async function resizeImage(file: File, opts: { maxW: number; maxH: number; crop?: boolean; keepAlpha?: boolean }): Promise<File> {
  if (!/^image\/(jpe?g|png|webp)$/.test(file.type)) throw new Error('Use a JPEG, PNG or WEBP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is over 15 MB. Pick a smaller photo.');
  const bitmap = await loadImage(file);
  const { width: w, height: h } = bitmap;
  let sx = 0, sy = 0, sw = w, sh = h;
  let tw: number, th: number;
  if (opts.crop) {
    const target = opts.maxW / opts.maxH;
    if (w / h > target) { sw = Math.round(h * target); sx = Math.round((w - sw) / 2); }
    else { sh = Math.round(w / target); sy = Math.round((h - sh) / 2); }
    const scale = Math.min(1, opts.maxW / sw);
    tw = Math.round(sw * scale); th = Math.round(sh * scale);
  } else {
    const scale = Math.min(1, opts.maxW / w, opts.maxH / h);
    tw = Math.round(w * scale); th = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize images.');
  const alpha = !!opts.keepAlpha && file.type !== 'image/jpeg';
  if (!alpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, tw, th); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, tw, th);
  const type = alpha ? 'image/webp' : 'image/jpeg';
  let quality = 0.86;
  let blob = await toBlob(canvas, type, quality);
  while (blob.size > 600 * 1024 && quality > 0.5) {
    quality -= 0.08;
    blob = await toBlob(canvas, type, quality);
  }
  if (blob.size > 2 * 1024 * 1024) throw new Error('The image is still over 2 MB after resizing. Try a simpler photo.');
  const name = file.name.replace(/\.[^.]+$/, '') + (alpha ? '.webp' : '.jpg');
  return new File([blob], name, { type });
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, quality));
}
