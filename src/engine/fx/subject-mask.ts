import { TexturePlane } from '../gpu';
import { clamp01, requireCanvas, smooth } from './context';

export function subjectMask(source: HTMLImageElement | HTMLCanvasElement, options: {
  maxSize?: number; tolerance?: number; softness?: number; radial?: number
} = {}): TexturePlane {
  const scale = Math.min(1, (options.maxSize ?? 220) / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
  const [, ctx] = requireCanvas(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const border = Math.max(1, Math.floor(0.05 * Math.min(width, height))), background = [0, 0, 0];
  let count = 0;
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) background[c] += pixels[i + c];
    count++;
  };
  for (let y = 0; y < border; y++) for (let x = 0; x < width; x++) { add(x, y); add(x, height - 1 - y); }
  for (let x = 0; x < border; x++) for (let y = border; y < height - border; y++) { add(x, y); add(width - 1 - x, y); }
  for (let c = 0; c < 3; c++) background[c] /= count;
  const mask = new Uint8Array(width * height), data = new Float32Array(width * height);
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const distance = Math.hypot(pixels[i] - background[0], pixels[i + 1] - background[1], pixels[i + 2] - background[2]);
    const radial = 1 - (options.radial ?? 0.6) * smooth(clamp01((Math.hypot((x - cx) / (cx || 1), (y - cy) / (cy || 1)) - 0.75) / 0.6));
    mask[y * width + x] = Math.floor(clamp01((distance - (options.tolerance ?? 42)) / (options.softness ?? 55)) * radial * 255);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let total = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      total += mask[Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))];
    }
    data[(height - 1 - y) * width + x] = Math.floor(total / 9) / 255;
  }
  return { width, height, data, linear: true };
}
