import { Recipe, RenderError } from '../recipe';
import { TexturePlane } from '../gpu';
import { clamp01, contrastFactor, mix, sampleFrame, smooth } from './context';

export function nearness(luma: Float32Array, width: number, height: number) {
  const ratio = Math.min(1, 48 / Math.max(width, height)), cols = Math.max(2, Math.round(width * ratio)), rows = Math.max(2, Math.round(height * ratio));
  const coarse = new Float32Array(cols * rows);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = Math.floor(y * rows / height) * cols + Math.floor(x * cols / width);
    coarse[i] = Math.max(coarse[i], luma[y * width + x]);
  }
  const step = 1 / Math.hypot(cols, rows), diagonal = step * Math.SQRT2;
  for (const direction of [1, -1]) {
    for (let y = direction === 1 ? 0 : rows - 1; y >= 0 && y < rows; y += direction) {
      for (let x = direction === 1 ? 0 : cols - 1; x >= 0 && x < cols; x += direction) {
        const i = y * cols + x;
        if (x - direction >= 0 && x - direction < cols) coarse[i] = Math.max(coarse[i], coarse[i - direction] - step);
        if (y - direction >= 0 && y - direction < rows) {
          coarse[i] = Math.max(coarse[i], coarse[i - direction * cols] - step);
          for (const dx of [-1, 1]) if (x + dx >= 0 && x + dx < cols) {
            coarse[i] = Math.max(coarse[i], coarse[i - direction * cols + dx] - diagonal);
          }
        }
      }
    }
  }
  let low = Infinity, high = -Infinity;
  for (const value of coarse) { low = Math.min(low, value); high = Math.max(high, value); }
  const span = high > low ? 1 / (high - low) : 0;
  for (let i = 0; i < coarse.length; i++) coarse[i] -= low;
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = Math.max(0, Math.min(cols - 1, (x + .5) * cols / width - .5)), py = Math.max(0, Math.min(rows - 1, (y + .5) * rows / height - .5));
    const ix = Math.floor(px), iy = Math.floor(py), nx = Math.min(cols - 1, ix + 1), ny = Math.min(rows - 1, iy + 1);
    result[y * width + x] = mix(mix(coarse[iy * cols + ix], coarse[iy * cols + nx], px - ix),
      mix(coarse[ny * cols + ix], coarse[ny * cols + nx], px - ix), py - iy) * span;
  }
  return result;
}

export function sourceRankField(source: CanvasImageSource, w: number, h: number, r: Recipe,
  amount: number, kind: 'coat' | 'nearness', revision: string) {
  if (amount <= 0 || amount >= 1) return { threshold: amount >= 1 ? -2 : 1.04,
    plane: { width: 1, height: 1, data: new Float32Array([1]), linear: true } satisfies TexturePlane };
  const ratio = 128 / Math.max(w, h), width = Math.max(2, Math.round(w * ratio)), height = Math.max(2, Math.round(h * ratio));
  const pixels = sampleFrame(source, width, height, `rank-field|${revision}`);
  if (!pixels) throw new RenderError('IMAGE_SAMPLE_FAILED', 'Could not prepare effect ranking field.');
  const luma = new Float32Array(width * height), factor = contrastFactor(r.contrast);
  for (let i = 0; i < luma.length; i++) for (let c = 0; c < 3; c++) {
    let value = clamp01((factor * (pixels[4 * i + c] - 128) + 128 + r.brightness * 2.55) / 255);
    if (r.invert) value = 1 - value;
    luma[i] += value * [.299, .587, .114][c];
  }
  const near = nearness(luma, width, height);
  const hash = (x: number, y: number) => { const value = 43758.5453 * Math.sin(127.1 * x + 311.7 * y); return value - Math.floor(value); };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
  };
  let low = Infinity, high = -Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const value = kind === 'coat' ? (.66 * noise(x / 44, y / 13) + .24 * noise(x / 17, y / 5.5) + .1 * noise(x / 5, y / 1.7)) * .72 + .28 * near[i] : .6 * luma[i] + .4 * near[i];
    luma[i] = value; low = Math.min(low, value); high = Math.max(high, value);
  }
  const span = high > low ? 1 / (high - low) : 0, histogram = new Uint32Array(1024);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = (luma[i] - low) * span;
    histogram[Math.max(0, Math.min(1023, Math.floor(luma[i] * 1024)))]++;
  }
  let left = -.04, right = 1.04;
  for (let step = 0; step < 24; step++) {
    const threshold = (left + right) / 2; let count = 0;
    for (let i = 0; i < 1024; i++) count += histogram[i] * smooth(clamp01(((i + .5) / 1024 - threshold + .04) / .04));
    if (count > amount * luma.length) left = threshold; else right = threshold;
  }
  const data = new Float32Array(luma.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[(height - 1 - y) * width + x] = Math.floor(luma[y * width + x] * 255) / 255;
  return { threshold: (left + right) / 2, plane: { width, height, data, linear: true } satisfies TexturePlane };
}

export const rankFieldGLSL = `
uniform sampler2D uRank;
uniform float uThreshold;
uniform float uSubstrate;
float rankedGate(vec2 uv) {
  if (uThreshold < -1.0) return 1.0;
  float t = clamp((texture(uRank, uv).r - uThreshold) * 25.0 + 1.0, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}`;
