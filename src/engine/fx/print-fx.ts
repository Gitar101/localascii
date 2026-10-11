import { lumaOf, num, hexRgb, clamp01, smooth } from './context';
import type { FxRecipe } from './context';

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function putData(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number) {
  const copy = new Uint8ClampedArray(w * h * 4);
  copy.set(data.subarray(0, copy.length));
  ctx.putImageData(new ImageData(copy, w, h), 0, 0);
}

const rand1 = (seed: number) => {
  const v = 43758.5453 * Math.sin(127.1 * seed);
  return v - Math.floor(v);
};

const hashInt = (n: number) => {
  let h = (Math.imul(n | 0, 0x165667b1) + 0x27d4eb2f) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 0x4bf19f61) ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
};

function separableBox(src: Float32Array, w: number, h: number, radius: number) {
  if (radius < 1) return src.slice();
  const dst = new Float32Array(w * h);
  const scale = 1 / (2 * radius + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * scale;
      sum += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += dst[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = sum * scale;
      sum += dst[Math.min(h - 1, y + radius + 1) * w + x] - dst[Math.max(0, y - radius) * w + x];
    }
  }
  return src;
}

export function renderComic(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const levels = Math.max(2, Math.min(8, Math.round(num(r, 'cmLevels', 5))));
  const ink = Math.max(0, Math.min(1, num(r, 'cmInk', 90) / 100));
  const threshold = Math.max(0, Math.min(1, num(r, 'cmThreshold', 45) / 100));
  const thickness = Math.max(1, Math.min(3, Math.round(num(r, 'cmThickness', 1))));
  const smoothing = Math.max(0, Math.min(1, num(r, 'cmSmooth', 40) / 100));
  const total = w * h;
  const cr = new Float32Array(total), cg = new Float32Array(total), cb = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    cr[i] = pixels[p]; cg[i] = pixels[p + 1]; cb[i] = pixels[p + 2];
  }
  const blurRadius = Math.round(3 * smoothing);
  if (blurRadius > 0) {
    separableBox(cr, w, h, blurRadius);
    separableBox(cg, w, h, blurRadius);
    separableBox(cb, w, h, blurRadius);
  }
  const lum = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4)
    lum[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]);
  const edgeThreshold = 20 + 420 * threshold;
  const edges = new Uint8Array(total);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] +
        lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
      const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] +
        lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      if (Math.sqrt(gx * gx + gy * gy) > edgeThreshold) edges[i] = 1;
    }
  }
  if (thickness > 1) {
    const spread = new Uint8Array(edges);
    const grow = thickness - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!edges[y * w + x]) continue;
        for (let dy = -grow; dy <= grow; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -grow; dx <= grow; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            spread[yy * w + xx] = 1;
          }
        }
      }
    }
    edges.set(spread);
  }
  const step = 255 / (levels - 1);
  const out = new Uint8ClampedArray(total * 4);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    let rr = Math.round(cr[i] / step) * step;
    let gg = Math.round(cg[i] / step) * step;
    let bb = Math.round(cb[i] / step) * step;
    if (edges[i]) {
      const keep = 1 - ink;
      rr *= keep; gg *= keep; bb *= keep;
    }
    out[p] = rr; out[p + 1] = gg; out[p + 2] = bb; out[p + 3] = 255;
  }
  putData(ctx, out, w, h);
}

export function renderSketch(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const scale = Math.max(1, Math.min(10, Math.round(num(r, 'skScale', 3))));
  const tau = Math.max(0.5, Math.min(1, num(r, 'skTau', 97) / 100));
  const phi = Math.max(1, Math.min(60, num(r, 'skPhi', 15)));
  const epsilon = ((num(r, 'skThreshold', 50) / 100) - 0.5) * 0.2;
  const shading = Math.max(0, Math.min(1, num(r, 'skShading', 55) / 100));
  const total = w * h;
  const b2Radius = Math.max(scale + 1, Math.round(1.6 * scale));
  const lum = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4)
    lum[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
  const b1 = separableBox(lum.slice(), w, h, scale);
  const b2 = separableBox(lum.slice(), w, h, b2Radius);
  const out = new Uint8ClampedArray(total * 4);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const diff = b1[i] - tau * b2[i];
    let value = diff >= epsilon ? 1 : 1 + Math.tanh(phi * (diff - epsilon));
    if (value < 0) value = 0; else if (value > 1) value = 1;
    const shade = value * (1 - shading * (1 - (0.2 + 0.8 * lum[i]))) * 255;
    out[p] = shade; out[p + 1] = shade; out[p + 2] = shade; out[p + 3] = 255;
  }
  putData(ctx, out, w, h);
}

export function renderEngraving(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const spacing = Math.max(2, Math.round(num(r, 'enSpacing', 6)));
  const wave = (num(r, 'enWave', 30) / 100) * 1.2;
  const relief = (num(r, 'enRelief', 40) / 100) * 2;
  const contrast = 1 + (num(r, 'enContrast', 45) / 100) * 3;
  let ink: number[], paper: number[];
  switch (String(r.enColor ?? 'ink')) {
    case 'mono': ink = [15, 15, 15]; paper = [248, 248, 248]; break;
    case 'blueprint': ink = [224, 231, 245]; paper = [16, 32, 66]; break;
    case 'currency': ink = [18, 58, 42]; paper = [233, 226, 205]; break;
    default: ink = [22, 19, 15]; paper = [239, 230, 210];
  }
  const freq1 = (2 * Math.PI * 4) / w;
  const freq2 = (2 * Math.PI * 9) / w;
  const lineScale = 0.8 / spacing;
  const sinA = new Float32Array(w), sinB = new Float32Array(w), cosB = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    sinA[x] = Math.sin(x * freq1);
    sinB[x] = Math.sin(x * freq2);
    cosB[x] = Math.cos(x * freq2);
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const drift = Math.cos(0.02 * y);
    const drift2 = Math.sin(0.02 * y);
    const rowPhase = y / spacing;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) << 2;
      const lum = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
      const dark = 1 - lum;
      const phase = rowPhase + wave * (sinA[x] + 0.5 * (sinB[x] * drift + cosB[x] * drift2)) +
        relief * (lum - 0.5);
      const toned = (dark - 0.5) * contrast + 0.5;
      const clamped = clamp01(toned);
      let value = (0.5 * (0.05 + 0.95 * clamped) - Math.abs(phase - Math.floor(phase) - 0.5)) /
        lineScale + 0.5;
      value = clamp01(value);
      out[p] = paper[0] + (ink[0] - paper[0]) * value;
      out[p + 1] = paper[1] + (ink[1] - paper[1]) * value;
      out[p + 2] = paper[2] + (ink[2] - paper[2]) * value;
      out[p + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}

export function renderMezzotint(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const type = String(r.mezzoType ?? 'grain');
  const density = Math.max(0, Math.min(1, num(r, 'mezzoDensity', 55) / 100));
  const contrast = Math.max(0, Math.min(1, num(r, 'mezzoContrast', 75) / 100));
  const colorMode = String(r.mezzoColor ?? 'mono');
  const noiseAt = (x: number, y: number, index: number) => {
    if (type === 'dots') return rand1((y >> 1) * 263.1 + (x >> 1) * 71.7 + 1.3);
    if (type === 'coarse') return rand1((y >> 2) * 263.1 + (x >> 2) * 71.7 + 2.7);
    if (type === 'lines') return rand1(131.7 * y + ((x / 6) | 0) * 57.3 + 3.1);
    if (type === 'strokes') return rand1(131.7 * y + ((x / 24) | 0) * 57.3 + 4.3);
    return rand1(0.15 * index + 0.5);
  };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const pr = pixels[p], pg = pixels[p + 1], pb = pixels[p + 2];
      const lum = lumaOf(pr, pg, pb) / 255;
      let noise = noiseAt(x, y, p) + (density - 0.5) * 0.6;
      const tone = (lum > noise ? 1 : 0) * contrast + lum * (1 - contrast);
      let rr: number, gg: number, bb: number;
      if (colorMode === 'source') { rr = pr * tone; gg = pg * tone; bb = pb * tone; }
      else if (colorMode === 'saturated') {
        const base = 255 * lum;
        rr = clampByte(Math.max(0, Math.min(255, (pr - base) * 1.9 + base)) * tone);
        gg = clampByte(Math.max(0, Math.min(255, (pg - base) * 1.9 + base)) * tone);
        bb = clampByte(Math.max(0, Math.min(255, (pb - base) * 1.9 + base)) * tone);
      } else { rr = gg = bb = 255 * tone; }
      out[p] = rr; out[p + 1] = gg; out[p + 2] = bb; out[p + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}

export function renderPointillize(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const cell = Math.max(3, Math.round(num(r, 'pointCell', 10)));
  const fill = Math.max(0.05, Math.min(1, num(r, 'pointFill', 60) / 100));
  const jitter = Math.max(0, Math.min(1, num(r, 'pointJitter', 60) / 100));
  const shape = String(r.pointShape ?? 'circle');
  const bg = String(r.pointBg ?? 'white');
  ctx.save();
  ctx.fillStyle = ({ white: '#ffffff', black: '#000000', cream: '#efe9d9', charcoal: '#1a1a1a' } as Record<string, string>)[bg] || '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const radius = 0.5 * cell * fill;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const seed = row * (cols + 1) + col;
      const cx = (col + 0.5 + (rand1(seed) - 0.5) * jitter) * cell;
      const cy = (row + 0.5 + (rand1(seed + 7) - 0.5) * jitter) * cell;
      const sx = Math.min(w - 1, Math.max(0, cx | 0));
      const sy = Math.min(h - 1, Math.max(0, cy | 0));
      const p = (sy * w + sx) * 4;
      ctx.fillStyle = `rgb(${pixels[p]},${pixels[p + 1]},${pixels[p + 2]})`;
      if (shape === 'square') ctx.fillRect(cx - radius, cy - radius, 2 * radius, 2 * radius);
      else {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function renderCrosshatch(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const scale = Math.max(5, Math.round((num(r, 'hatchScale', 50) / 100) * (4 + 24 * (h / 900) > 0 ? 4 + 24 : 4 + 24)));
  const hatchScale = Math.max(5, Math.round((h / 900) * (4 + (num(r, 'hatchScale', 50) / 100) * 24)));
  const ink = r.hatchInk as string || '#172044';
  const paper = r.hatchPaper as string || '#f2efe7';
  const weight = num(r, 'hatchWeight', 1);
  const darkness = num(r, 'hatchDarkness', 50);
  const angle = (num(r, 'hatchAngle', 0) * Math.PI) / 180;
  const bias = ((darkness - 50) / 50) * 60;
  const dark1 = 85 + bias, dark2 = 160 + bias;
  const lineWidth = Math.max(0.5, (hatchScale / 8) * weight);
  const cell = hatchScale;
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  ctx.globalAlpha = 1;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  ctx.beginPath();
  for (let row = 0; row < h; row += cell) {
    for (let col = 0; col < w; col += cell) {
      const sx = Math.min(w - 1, col), sy = Math.min(h - 1, row);
      const p = (sy * w + sx) * 4;
      const lum = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]);
      const passes = lum < dark1 ? 3 : lum < dark2 ? 2 : 1;
      const midX = col + cell / 2, midY = row + cell / 2;
      const line = (x0: number, y0: number, x1: number, y1: number) => {
        const ax = x0 - midX, ay = y0 - midY;
        const bx = x1 - midX, by = y1 - midY;
        ctx.moveTo(midX + ax * cosA - ay * sinA, midY + ax * sinA + ay * cosA);
        ctx.lineTo(midX + bx * cosA - by * sinA, midY + bx * sinA + by * cosA);
      };
      for (let pass = 0; pass < passes; pass++) {
        const offset = 2 * pass;
        line(col, row + offset, col + cell, row + cell + offset);
        if (passes === 3) line(col + cell, row + offset, col, row + cell + offset);
      }
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export { smooth };