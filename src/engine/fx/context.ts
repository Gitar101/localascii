import { RenderError } from '../recipe';

export type FxRecipe = {
  source: HTMLImageElement | HTMLCanvasElement;
  sourceW: number;
  sourceH: number;
  coverage: number;
  invert: boolean;
  brightness: number;
  contrast: number;
  animated?: boolean;
  animSpeed?: number;
  animIntensity?: number;
  animRandomness?: number;
  animPreset?: string;
  [key: string]: unknown;
};

export const lumaOf = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const smooth = (t: number) => t * t * (3 - 2 * t);

export const hexRgb = (hex: string): [number, number, number] => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h || '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const contrastFactor = (contrast: number) =>
  (259 * (contrast + 255)) / (255 * (259 - contrast));

export function gradePixel(value: number, factor: number, brightness: number, invert: boolean) {
  let v = invert ? 255 - value : value;
  v = factor * (v - 128) + 128 + (brightness / 100) * 255;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

const sampleCache: { source: CanvasImageSource; key: string; data: Uint8ClampedArray }[] = [];
let sampleCanvas: HTMLCanvasElement | null = null;
let sampleCtx: CanvasRenderingContext2D | null = null;

export function sampleFrame(source: CanvasImageSource, width: number, height: number,
  key: string, tone?: { contrast: number; brightness: number; invert: boolean }): Uint8ClampedArray | null {
  key = `${key}|${width}x${height}|${tone ? `${tone.contrast}|${tone.brightness}|${tone.invert}` : 'raw'}`;
  for (let i = 0; i < sampleCache.length; i++) {
    if (sampleCache[i].source === source && sampleCache[i].key === key) {
      const hit = sampleCache[i];
      if (i > 0) { sampleCache.splice(i, 1); sampleCache.unshift(hit); }
      return hit.data;
    }
  }
  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas');
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!sampleCtx) return null;
  if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
    sampleCanvas.width = width; sampleCanvas.height = height;
  }
  sampleCtx.clearRect(0, 0, width, height);
  try { sampleCtx.drawImage(source, 0, 0, width, height); }
  catch { return null; }
  const data = sampleCtx.getImageData(0, 0, width, height).data;
  if (tone) {
    const factor = contrastFactor(tone.contrast);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = gradePixel(data[i], factor, tone.brightness, tone.invert);
      data[i + 1] = gradePixel(data[i + 1], factor, tone.brightness, tone.invert);
      data[i + 2] = gradePixel(data[i + 2], factor, tone.brightness, tone.invert);
    }
  }
  sampleCache.unshift({ source, key, data });
  if (sampleCache.length > 4) sampleCache.length = 4;
  return data;
}

export function putPixels(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, width: number, height: number) {
  const copy = new Uint8ClampedArray(width * height * 4);
  copy.set(data.subarray(0, copy.length));
  ctx.putImageData(new ImageData(copy, width, height), 0, 0);
}

export function imageFromData(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(data.slice(), width, height), 0, 0);
  return canvas;
}

export const num = (recipe: Record<string, unknown>, key: string, fallback: number) => {
  const value = recipe[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

export const str = (recipe: Record<string, unknown>, key: string, fallback: string) => {
  const value = recipe[key];
  return typeof value === 'string' ? value : fallback;
};

// The final blur is written back to src; dst holds the horizontal scratch pass.
export function boxBlurFloat(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number) {
  if (radius < 1) return;
  const scale = 1 / (2 * radius + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + Math.min(width - 1, Math.max(0, i))];
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum * scale;
      const ahead = Math.min(width - 1, x + radius + 1), behind = Math.max(0, x - radius);
      sum += src[row + ahead] - src[row + behind];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += dst[Math.min(height - 1, Math.max(0, i)) * width + x];
    for (let y = 0; y < height; y++) {
      src[y * width + x] = sum * scale;
      const ahead = Math.min(height - 1, y + radius + 1), behind = Math.max(0, y - radius);
      sum += dst[ahead * width + x] - dst[behind * width + x];
    }
  }
}

// Faithful port of the reference coverage solver (module 3oegay3tctwga):
// rank field = luma 0.6 + centroid proximity 0.4, two-stage marks/substrate,
// threshold solved by binary search over a 1024-bin histogram, gate = smoothstep
// over a (t - 0.04, t + 0.04) window.
export function solveCoverage(luma: Float32Array, w: number, h: number, amount: number) {
  const total = w * h;
  const full = { threshold: -2, field: luma, gate: (_value: number) => 1,
    stages: { marks: 1, sub: 1 } };
  if (amount >= 1) return full;
  const stages = { marks: 2 * amount > 1 ? 1 : 2 * amount,
    sub: 2 * amount - 1 < 0 ? 0 : 2 * amount - 1 };
  // centroid
  let cx = 0, cy = 0, mass = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = luma[y * w + x];
    cx += x * v; cy += y * v; mass += v;
  }
  const inv = mass > 0 ? 1 / mass : 0;
  cx *= inv; cy *= inv;
  const centX = mass > 0 ? cx / w : 0.5, centY = mass > 0 ? cy / h : 0.5;
  const aspect = w / h;
  let maxD = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot((x / w - centX) * aspect, y / h - centY);
    if (d > maxD) maxD = d;
  }
  const invMaxD = maxD > 0 ? 1 / maxD : 0;
  const rank = new Float32Array(total);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const prox = 1 - Math.hypot((x / w - centX) * aspect, y / h - centY) * invMaxD;
    const r = luma[y * w + x] * 0.6 + prox * 0.4;
    rank[y * w + x] = r;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  const span = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < total; i++) rank[i] = (rank[i] - lo) * span;
  const target = stages.marks * total;
  const histogram = new Uint32Array(1024);
  for (let i = 0; i < total; i++) {
    const b = (rank[i] * 1024) | 0;
    histogram[b > 1023 ? 1023 : b]++;
  }
  const areaAt = (t: number) => {
    let sum = 0;
    for (let b = 0; b < 1024; b++) {
      const n = histogram[b];
      if (!n) continue;
      const g = clamp01(((b + 0.5) / 1024 - t) * 25 + 1);
      sum += n * smooth(g);
    }
    return sum;
  };
  let lowT = -0.04, highT = 1.04;
  for (let i = 0; i < 24; i++) {
    const mid = (lowT + highT) / 2;
    if (areaAt(mid) > target) lowT = mid; else highT = mid;
  }
  const threshold = (lowT + highT) / 2;
  const gate = (value: number) => {
    const g = clamp01((value - threshold) * 25 + 1);
    return smooth(g);
  };
  return { threshold, field: rank, gate, stages };
}

export function requireCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width); canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new RenderError('CANVAS_UNAVAILABLE', 'Canvas 2D is unavailable.');
  return [canvas, ctx];
}

export function drawData(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, width: number, height: number) {
  ctx.putImageData(new ImageData(data.slice(), width, height), 0, 0);
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function bilinearChannel(data: Uint8ClampedArray, w: number, h: number,
  x: number, y: number, channel: number) {
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
  const ix = Math.floor(x), iy = Math.floor(y), nx = Math.min(w - 1, ix + 1), ny = Math.min(h - 1, iy + 1);
  const top = mix(data[(iy * w + ix) * 4 + channel], data[(iy * w + nx) * 4 + channel], x - ix);
  const bottom = mix(data[(ny * w + ix) * 4 + channel], data[(ny * w + nx) * 4 + channel], x - ix);
  return mix(top, bottom, y - iy);
}

export const rgbCss = (rgb: readonly number[], alpha: number) =>
  `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha})`;
