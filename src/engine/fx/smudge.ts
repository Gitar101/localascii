import { hexRgb, lumaOf, num } from './context';
import type { FxRecipe } from './context';

function splat(field: Float32Array, aux: Float32Array, x: number, y: number, dx: number, dy: number,
  radius: number, strength: number, aspect: number) {
  const r = Math.max(0.004, radius);
  const ry = r / Math.max(1e-4, aspect);
  const x0 = Math.max(0, Math.floor((x - r) * 256));
  const x1 = Math.min(255, Math.ceil((x + r) * 256));
  const y0 = Math.max(0, Math.floor((y - ry) * 256));
  const y1 = Math.min(255, Math.ceil((y + ry) * 256));
  const inv = 1 / (r * r);
  const sx = dx * strength, sy = dy * strength;
  for (let py = y0; py <= y1; py++) {
    const fy = ((py + 0.5) / 256 - y) * aspect;
    for (let px = x0; px <= x1; px++) {
      const fx = (px + 0.5) / 256 - x;
      const d2 = (fx * fx + fy * fy) * inv;
      if (d2 > 1) continue;
      const w = 0.5 + 0.5 * Math.cos(Math.sqrt(d2) * Math.PI);
      const i = 256 * py + px;
      field[i] += sx * w;
      aux[i] += sy * w;
    }
  }
}

let fieldX: Float32Array | null = null;
let fieldY: Float32Array | null = null;
let fieldKey = '';

export function renderSmudge(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe) {
  const radius = Math.max(0.01, num(r, 'smudgeRadius', 18) / 100);
  const strength = num(r, 'smudgeStrength', 100) / 100;
  const key = `${radius}|${strength}`;
  if (!fieldX || !fieldY || fieldKey !== key) {
    fieldKey = key;
    fieldX = new Float32Array(65536);
    fieldY = new Float32Array(65536);
    for (const [x0, y0, x1, y1] of [[0.1, 0.3, 0.62, 0.56], [0.9, 0.58, 0.46, 0.82]]) {
      const dx = (x1 - x0) / 64, dy = ((y1 - y0) * 0.625) / 64;
      for (let step = 1; step <= 64; step++) {
        const t = step / 64;
        splat(fieldX, fieldY, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, dx, dy, radius, strength * 0.35, 0.625);
      }
    }
  }
  const scale = strength * 1.15;
  const colorMix = num(r, 'smudgeColor', 70) / 100;
  const reveal = Math.max(0.004, (num(r, 'smudgeReveal', 40) / 100) * 0.5);
  const [ca, cb] = [hexRgb(r.smudgeColorA as string || '#1a0602'), hexRgb(r.smudgeColorB as string || '#ff9a1e')];
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = w; sampleCanvas.height = h;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  sampleCtx.drawImage(source, 0, 0, w, h);
  const src = sampleCtx.getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  const outData = out.data;
  const maxX = Math.max(0, w - 1.001), maxY = Math.max(0, h - 1.001);
  const invReveal = 1 / reveal;
  const offset: [number, number] = [0, 0];
  for (let y = 0; y < h; y++) {
    const fy = y / h;
    const outRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const gx = 256 * (x / w) - 0.5, gy = 256 * fy - 0.5;
      const cx = gx < 0 ? 0 : gx > 254.999 ? 254.999 : gx;
      const cy = gy < 0 ? 0 : gy > 254.999 ? 254.999 : gy;
      const ix = cx | 0, iy = cy | 0;
      const fx = cx - ix, fyy = cy - iy;
      const base = 256 * iy + ix;
      const right = base + 1, down = base + 256, diag = down + 1;
      const w00 = (1 - fx) * (1 - fyy), w10 = fx * (1 - fyy), w01 = (1 - fx) * fyy, w11 = fx * fyy;
      const vx = fieldX[base] * w00 + fieldX[right] * w10 + fieldX[down] * w01 + fieldX[diag] * w11;
      const vy = fieldY[base] * w00 + fieldY[right] * w10 + fieldY[down] * w01 + fieldY[diag] * w11;
      offset[0] = vx; offset[1] = vy;
      const sx = x - vx * w * scale;
      const sy = y - vy * w * scale;
      const clx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
      const cly = sy < 0 ? 0 : sy > maxY ? maxY : sy;
      const x0 = clx | 0, y0 = cly | 0;
      const ddx = clx - x0, ddy = cly - y0;
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4;
      const p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
      const q00 = (1 - ddx) * (1 - ddy), q10 = ddx * (1 - ddy), q01 = (1 - ddx) * ddy, q11 = ddx * ddy;
      let rr = src[p00] * q00 + src[p10] * q10 + src[p01] * q01 + src[p11] * q11;
      let gg = src[p00 + 1] * q00 + src[p10 + 1] * q10 + src[p01 + 1] * q01 + src[p11 + 1] * q11;
      let bb = src[p00 + 2] * q00 + src[p10 + 2] * q10 + src[p01 + 2] * q01 + src[p11 + 2] * q11;
      let t = Math.sqrt(vx * vx + vy * vy) * invReveal;
      if (t > 1) t = 1;
      t = t * t * (3 - 2 * t) * colorMix;
      if (t > 0.72) t = 0.72;
      if (t > 0.001) {
        const q = (y * w + x) * 4;
        const luma = lumaOf(src[q], src[q + 1], src[q + 2]) / 255;
        const cr = ca[0] + (cb[0] - ca[0]) * luma;
        const cg = ca[1] + (cb[1] - ca[1]) * luma;
        const cbb = ca[2] + (cb[2] - ca[2]) * luma;
        rr += (cr - rr) * t;
        gg += (cg - gg) * t;
        bb += (cbb - bb) * t;
      }
      const o = outRow + 4 * x;
      outData[o] = rr; outData[o + 1] = gg; outData[o + 2] = bb; outData[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}
