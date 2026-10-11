import { solveCoverage, hexRgb, lumaOf, clamp01, num, smooth } from './context';
import type { FxRecipe } from './context';
import { hashNoise } from './blur-fx';

export const thermalPalettes: Record<string, [number, string][]> = {
  rainbow: [[0, '#001a55'], [0.18, '#0b3fd4'], [0.35, '#00a3d9'], [0.5, '#1fb84d'],
    [0.65, '#b6e02a'], [0.78, '#ffd21a'], [0.9, '#ff5a1a'], [1, '#ffffff']],
  ironbow: [[0, '#000000'], [0.13, '#10023a'], [0.28, '#4a0a6b'], [0.42, '#8f1a5a'],
    [0.55, '#d21e3c'], [0.68, '#f5511e'], [0.8, '#ff9500'], [0.9, '#ffe23d'], [1, '#ffffff']],
  whitehot: [[0, '#000000'], [1, '#ffffff']],
  blackhot: [[0, '#ffffff'], [1, '#000000']],
  lava: [[0, '#000000'], [0.3, '#4a0000'], [0.55, '#c21807'], [0.75, '#ff6f00'],
    [0.9, '#ffd000'], [1, '#fffde0']],
  arctic: [[0, '#00111f'], [0.3, '#062f5c'], [0.55, '#0a6fb5'], [0.75, '#4fc3f7'],
    [0.9, '#b3e5fc'], [1, '#ffffff']],
};

const paletteCache = new Map<string, Uint8Array>();

export function thermalRamp(name: string): Uint8Array {
  const cached = paletteCache.get(name);
  if (cached) return cached;
  const stops = thermalPalettes[name] || thermalPalettes.rainbow;
  const ramp = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [p0, h0] = stops[s];
    const [p1, h1] = stops[Math.min(stops.length - 1, s + 1)];
    const f = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
    const a = hexRgb(h0), b = hexRgb(h1);
    ramp[3 * i] = a[0] + (b[0] - a[0]) * f;
    ramp[3 * i + 1] = a[1] + (b[1] - a[1]) * f;
    ramp[3 * i + 2] = a[2] + (b[2] - a[2]) * f;
  }
  paletteCache.set(name, ramp);
  return ramp;
}

function boxBlur(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number) {
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

export function renderThermal(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  const ramp = thermalRamp(r.thermalPalette as string || 'rainbow');
  const sensitivity = num(r, 'thermalSensitivity', 50);
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const exposure = Math.exp((0.5 - sensitivity / 100) * 1.4);
  const bleed = Math.round((num(r, 'thermalBleed', 35) / 100) * w * 0.02);
  const noise = (num(r, 'thermalNoise', 20) / 100) * 0.18;
  const scale = Math.max(1, Math.round(1 + 30 * Math.pow(num(r, 'thermalScale', 0) / 100, 1.8) * (w / 900)));
  const solarize = Math.max(0, Math.min(1, num(r, 'thermalSolarize', 0) / 100));
  const total = w * h;
  const heat = new Float32Array(total);
  const temp = new Float32Array(total);
  const blended = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) heat[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
  boxBlur(heat, temp, w, h, bleed);
  let grid: Float32Array | null = null, gridW = 0;
  if (scale > 1) {
    gridW = Math.ceil(w / scale);
    const gridH = Math.ceil(h / scale);
    const sums = new Float32Array(gridW * gridH), counts = new Float32Array(gridW * gridH);
    for (let y = 0; y < h; y++) {
      const gy = (y / scale) | 0;
      for (let x = 0; x < w; x++) {
        const gi = gy * gridW + ((x / scale) | 0);
        sums[gi] += heat[y * w + x]; counts[gi]++;
      }
    }
    for (let i = 0; i < sums.length; i++) if (counts[i]) sums[i] /= counts[i];
    grid = sums;
  }
  let covFactor = 1.05;
  const covField = new Float32Array(total);
  if (coverage < 1) {
    covField.set(heat.subarray(0, total));
    boxBlur(covField, temp, w, h, Math.max(1, Math.round(0.25 * Math.min(w, h))));
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < total; i++) {
      const v = heat[i] + 0.22 * covField[i];
      covField[i] = v;
      if (v < low) low = v;
      if (v > high) high = v;
    }
    const span = high > low ? 1 / (high - low) : 0;
    const histogram = new Uint32Array(1024);
    for (let i = 0; i < total; i++) {
      const v = (covField[i] - low) * span;
      covField[i] = v;
      let bucket = (1024 * v) | 0;
      if (bucket >= 1024) bucket = 1023;
      histogram[bucket]++;
    }
    const target = coverage * total;
    const areaAt = (t: number) => {
      let sum = 0;
      for (let b = 0; b < 1024; b++) {
        const n = histogram[b];
        if (!n) continue;
        const x = clamp01(((b + 0.5) / 1024 - t + 0.05) / 0.1);
        sum += n * smooth(x);
      }
      return sum;
    };
    let lo = -0.05, hi = 1.05;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (areaAt(mid) > target) lo = mid; else hi = mid;
    }
    covFactor = (lo + hi) / 2;
  }
  const out = new ImageData(w, h);
  const outData = out.data;
  for (let y = 0; y < h; y++) {
    const gy = scale > 1 ? (y / scale) | 0 : 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = 4 * i;
      let value: number;
      if (grid) {
        const gi = gy * gridW + ((x / scale) | 0);
        value = grid[gi] * exposure;
      } else {
        value = heat[i] * exposure;
      }
      if (noise > 0) value += (hashNoise(x + 19, y + 73) - 0.5) * noise;
      value = clamp01(value);
      if (solarize > 0) {
        const folded = value > 0.5 ? 1 - value : value;
        value += (folded - value) * solarize;
      }
      const idx = (value < 0 ? 0 : value > 1 ? 255 : (255 * value) | 0) * 3;
      let fr = ramp[idx], fg = ramp[idx + 1], fb = ramp[idx + 2];
      if (coverage < 1) {
        const gateX = clamp01(((covField[i] - covFactor + 0.05) * 20));
        const gate = smooth(gateX);
        fr = pixels[p] + (fr - pixels[p]) * gate;
        fg = pixels[p + 1] + (fg - pixels[p + 1]) * gate;
        fb = pixels[p + 2] + (fb - pixels[p + 2]) * gate;
      }
      outData[p] = fr; outData[p + 1] = fg; outData[p + 2] = fb; outData[p + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function drawSource(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray, w: number, h: number) {
  ctx.putImageData(new ImageData(pixels.slice(), w, h), 0, 0);
}

export function renderPosterize(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const levels = Math.max(2, Math.min(16, Math.round(num(r, 'posterizeLevels', 6))));
  const total = w * h;
  const luma = new Float32Array(total);
  const chromaHist = new Uint32Array(256);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const value = (77 * pixels[p] + 150 * pixels[p + 1] + 29 * pixels[p + 2]) >> 8;
    luma[i] = value;
    const dr = Math.abs(pixels[p] - value), dg = Math.abs(pixels[p + 1] - value);
    const db = Math.abs(pixels[p + 2] - value);
    chromaHist[dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db]++;
  }
  const radius = Math.min(6, Math.max(2, Math.round(Math.min(w, h) / 160)));
  const blurred = new Float32Array(luma);
  const scratch = new Float32Array(total);
  boxBlurFloat2(blurred, scratch, w, h, radius);
  const edge = new Float32Array(total);
  const span = Math.max(2, Math.round(Math.min(w, h) / 200));
  for (let y = 0; y < h; y++) {
    const above = (y - span < 0 ? 0 : y - span) * w, below = (y + span >= h ? h - 1 : y + span) * w;
    for (let x = 0; x < w; x++) {
      const left = x - span < 0 ? 0 : x - span, right = x + span >= w ? w - 1 : x + span;
      const row = y * w;
      const gx = blurred[row + right] - blurred[row + left];
      const gy = blurred[below + x] - blurred[above + x];
      edge[row + x] = Math.abs(gx) + Math.abs(gy);
    }
  }
  const lumaHist = new Uint32Array(256);
  for (let i = 0; i < total; i++) lumaHist[luma[i] | 0]++;
  const trim = Math.max(1, Math.round(0.01 * total));
  let low = 0, high = 255;
  {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += lumaHist[v]; if (acc >= trim) { low = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += lumaHist[v]; if (acc >= trim) { high = v; break; } }
  }
  low = 8 * Math.floor(low / 8);
  high = 8 * Math.ceil(high / 8);
  if (high - low < 48) high = Math.min(255, (low = Math.max(0, Math.round((high + low) / 2 - 24))) + 48);
  const range = high - low;
  const step = range / (levels - 1);
  const maxLevel = levels - 1;
  const levelMap = new Float32Array(256);
  {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      const cdf = (acc + 0.5 * lumaHist[v]) / total;
      acc += lumaHist[v];
      const normalized = Math.min(1, Math.max(0, (v - low) / range));
      levelMap[v] = (0.6 * cdf + 0.4 * normalized) * maxLevel;
    }
  }
  const palette = new Float32Array(16), counts = new Float32Array(16);
  for (let v = 0; v < 256; v++) {
    if (!lumaHist[v]) continue;
    const level = Math.round(levelMap[v]);
    palette[level < 0 ? 0 : level > maxLevel ? maxLevel : level] += v * lumaHist[v];
    counts[level < 0 ? 0 : level > maxLevel ? maxLevel : level] += lumaHist[v];
  }
  const shadow = 0.55 * low;
  const lightScale = (high + (255 - high) * 0.45 - shadow) / maxLevel;
  for (let level = 0; level <= maxLevel; level++) {
    const linear = shadow + level * lightScale;
    palette[level] = counts[level] ? (palette[level] / counts[level]) * 0.35 + 0.65 * linear : linear;
  }
  const chromaTrim = Math.max(1, Math.round(0.02 * total));
  let chromaMax = 0;
  {
    let acc = 0;
    for (let v = 255; v >= 0; v--) { acc += chromaHist[v]; if (acc >= chromaTrim) { chromaMax = v; break; } }
    chromaMax = Math.max(12, 4 * Math.ceil(chromaMax / 4));
  }
  const chromaLevels = chromaMax / Math.max(2, Math.round(levels / 2));
  const chromaScale = new Float32Array(256);
  chromaScale[0] = 0;
  for (let v = 1; v < 256; v++) chromaScale[v] = (Math.round(v / chromaLevels) * chromaLevels) / v;
  const indices = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const level = Math.round(levelMap[luma[i] | 0]);
    indices[i] = level < 0 ? 0 : level > maxLevel ? maxLevel : level;
  }
  const smoothed = new Uint8Array(indices);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
      const left = indices[i - 1];
      if (indices[i] !== left && indices[i + 1] === left && indices[i - w] === left && indices[i + w] === left)
        smoothed[i] = left;
    }
  }
  let covField: Float32Array | null = null;
  if (coverage < 1) {
    const field = new Float32Array(total);
    for (let i = 0, p = 0; i < total; i++, p += 4)
      field[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
    covNearness(field, w, h);
    const solved = solveCoverage(field, w, h, coverage);
    covField = new Float32Array(total);
    for (let i = 0; i < total; i++) covField[i] = solved.gate(field[i]);
  }
  const out = new ImageData(w, h);
  const outData = out.data;
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const baseR = pixels[p], baseG = pixels[p + 1], baseB = pixels[p + 2];
    const l = (77 * baseR + 150 * baseG + 29 * baseB) >> 8;
    const posterized = palette[smoothed[i]];
    let dr = baseR - l, dg = baseG - l, db = baseB - l;
    const cr = Math.abs(dr), cg = Math.abs(dg), cb = Math.abs(db);
    const scale = chromaScale[cr > cg ? (cr > cb ? cr : cb) : cg > cb ? cg : cb];
    dr *= scale; dg *= scale; db *= scale;
    const lumaDelta = (77 * dr + 150 * dg + 29 * db) / 256;
    dr -= lumaDelta; dg -= lumaDelta; db -= lumaDelta;
    let or = clampByte(posterized + dr), og = clampByte(posterized + dg), ob = clampByte(posterized + db);
    if (covField) {
      const gate = covField[i];
      or = baseR + (or - baseR) * gate;
      og = baseG + (og - baseG) * gate;
      ob = baseB + (ob - baseB) * gate;
    }
    outData[p] = or; outData[p + 1] = og; outData[p + 2] = ob; outData[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

function covNearness(field: Float32Array, w: number, h: number) {
  const total = w * h;
  const near = new Float32Array(total);
  const radius = Math.max(1, Math.round(Math.min(w, h) * 0.12));
  const scale = 1 / (2 * radius + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += field[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      near[row + x] = sum * scale;
      sum += field[row + Math.min(w - 1, x + radius + 1)] - field[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += near[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      field[y * w + x] = sum * scale;
      sum += near[Math.min(h - 1, y + radius + 1) * w + x] - near[Math.max(0, y - radius) * w + x];
    }
  }
  return near;
}

function boxBlurFloat2(src: Float32Array, dst: Float32Array, width: number, height: number, radius: number) {
  if (radius < 1) return;
  const scale = 1 / (2 * radius + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + Math.min(width - 1, Math.max(0, i))];
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum * scale;
      sum += src[row + Math.min(width - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += dst[Math.min(height - 1, Math.max(0, i)) * width + x];
    for (let y = 0; y < height; y++) {
      src[y * width + x] = sum * scale;
      sum += dst[Math.min(height - 1, y + radius + 1) * width + x] - dst[Math.max(0, y - radius) * width + x];
    }
  }
}

export function renderDuotoneFx(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const [sr, sg, sb] = hexRgb(r.duoShadow as string || '#1a1636');
  const [hr, hg, hb] = hexRgb(r.duoHighlight as string || '#f5c542');
  const midpoint = num(r, 'duoMidpoint', 50) / 100;
  const contrast = num(r, 'duoContrast', 100) / 100;
  const total = w * h;
  let marks: Float32Array | null = null, sub = 1;
  if (coverage < 1) {
    const luma = new Float32Array(total);
    for (let i = 0, p = 0; i < total; i++, p += 4)
      luma[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
    const solved = solveCoverage(luma, w, h, coverage);
    marks = new Float32Array(total);
    sub = solved.stages.sub;
    for (let i = 0; i < total; i++) marks[i] = solved.gate(luma[i]);
  }
  const out = new ImageData(w, h);
  const outData = out.data;
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    let value = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
    value = clamp01((value - midpoint) * contrast + midpoint);
    let or: number, og: number, ob: number;
    if (marks) {
      const gate = marks[i] * value;
      const dr = pixels[p] + (sr - pixels[p]) * sub;
      const dg = pixels[p + 1] + (sg - pixels[p + 1]) * sub;
      const db = pixels[p + 2] + (sb - pixels[p + 2]) * sub;
      or = dr + (hr - dr) * gate;
      og = dg + (hg - dg) * gate;
      ob = db + (hb - db) * gate;
    } else {
      or = sr + (hr - sr) * value;
      og = sg + (hg - sg) * value;
      ob = sb + (hb - sb) * value;
    }
    outData[p] = or; outData[p + 1] = og; outData[p + 2] = ob; outData[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

export function renderScanlineFx(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const spacing = Math.max(2, Math.round(num(r, 'scanSpacing', 4)));
  const thickness = Math.max(1, Math.round(num(r, 'scanThickness', 1)));
  const darkness = num(r, 'scanDarkness', 55) / 100;
  const bloom = num(r, 'scanBloom', 0) / 100;
  const tint = hexRgb(r.scanTint as string || '#ffffff');
  const out = new ImageData(w, h);
  const outData = out.data;
  for (let y = 0; y < h; y++) {
    const lineDark = y % spacing < thickness;
    const multiplier = lineDark ? 1 - darkness * 0.9 : 1 + bloom * 0.6;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let rr = pixels[p], gg = pixels[p + 1], bb = pixels[p + 2];
      if (lineDark) {
        rr = rr * multiplier * tint[0] / 255;
        gg = gg * multiplier * tint[1] / 255;
        bb = bb * multiplier * tint[2] / 255;
      } else if (bloom > 0) {
        rr = rr * multiplier; gg = gg * multiplier; bb = bb * multiplier;
      }
      outData[p] = Math.min(255, rr); outData[p + 1] = Math.min(255, gg); outData[p + 2] = Math.min(255, bb);
      outData[p + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function renderRgbSplitFx(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const amount = num(r, 'rgbAmount', 40) / 100;
  const angle = num(r, 'rgbAngle', 0) * Math.PI / 180;
  const falloff = num(r, 'rgbFalloff', 0) / 100;
  const balance = num(r, 'rgbBalance', 50) / 50;
  const shift = Math.max(1, amount * w * 0.03) * coverage;
  const dx = Math.cos(angle) * shift, dy = Math.sin(angle) * shift;
  const out = new ImageData(w, h);
  const outData = out.data;
  const sampleAt = (x: number, y: number, c: number) => {
    const sx = Math.min(w - 1, Math.max(0, Math.round(x))), sy = Math.min(h - 1, Math.max(0, Math.round(y)));
    return pixels[(sy * w + sx) * 4 + c];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const radial = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / ((w / 2) ** 2 + (h / 2) ** 2);
      const factor = 1 - falloff + falloff * radial;
      const red = sampleAt(x + dx * factor * balance, y + dy * factor * balance, 0);
      const blue = sampleAt(x - dx * factor * (2 - balance), y - dy * factor * (2 - balance), 2);
      outData[p] = red; outData[p + 1] = pixels[p + 1]; outData[p + 2] = blue; outData[p + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function renderEdgeGlow(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const threshold = (num(r, 'egThreshold', 30) / 100) * 90;
  const intensity = num(r, 'egIntensity', 120) / 100;
  const bgDim = 1 - num(r, 'egBg', 80) / 100;
  const falloff = num(r, 'egFalloff', 100) / 100;
  const widthPx = Math.round(num(r, 'egWidth', 0));
  const total = w * h;
  const edge = new Float32Array(total);
  for (let y = 0; y < h; y++) {
    const rowBelow = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = 4 * i;
      const right = (y * w + Math.min(w - 1, x + 1)) * 4;
      const below = (rowBelow + x) * 4;
      const luma = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]);
      const gx = Math.abs(luma - lumaOf(pixels[right], pixels[right + 1], pixels[right + 2]));
      const gy = Math.abs(luma - lumaOf(pixels[below], pixels[below + 1], pixels[below + 2]));
      const g = gx + gy - threshold;
      edge[i] = g > 0 ? g : 0;
    }
  }
  if (widthPx > 0) {
    const spread = new Float32Array(total);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - widthPx), y1 = Math.min(h - 1, y + widthPx);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - widthPx), x1 = Math.min(w - 1, x + widthPx);
        let m = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const row = yy * w;
          for (let xx = x0; xx <= x1; xx++) {
            const v = edge[row + xx];
            if (v > m) m = v;
          }
        }
        spread[y * w + x] = m;
      }
    }
    edge.set(spread);
  }
  const out = new ImageData(w, h);
  const outData = out.data;
  const hue = hexRgb(r.egColor as string || '#7fd4ff');
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    const t = clamp01(edge[i] / 255 * intensity * falloff);
    const glow = smooth(t);
    const rr = pixels[p] * bgDim + hue[0] * glow * intensity;
    const gg = pixels[p + 1] * bgDim + hue[1] * glow * intensity;
    const bb = pixels[p + 2] * bgDim + hue[2] * glow * intensity;
    outData[p] = Math.min(255, rr); outData[p + 1] = Math.min(255, gg); outData[p + 2] = Math.min(255, bb);
    outData[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

export function renderLedMatrix(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const scale = Math.max(4, 1.4 * td(num(r, 'ledScale', 45), w));
  const glow = num(r, 'ledGlow', 60) / 100;
  const ledColor = hexRgb(r.ledColor as string || '#ff7a18');
  const type = r.ledType as string || 'round';
  const bg = r.ledBg as string || '#000000';
  const brightness = num(r, 'ledBrightness', 100) / 100;
  const sourceMode = (r.ledColorMode as string || 'solid') === 'source' && type !== 'stripe';
  const cell = 0.5 * scale;
  const cols = Math.ceil(w / scale), rows = Math.ceil(h / scale);
  const total = cols * rows;
  let field: Float32Array | null = null;
  if (coverage < 1) {
    const cellLuma = new Float32Array(total);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const sx = Math.floor(Math.min(w - 1, x * scale + (scale >> 1)));
        const sy = Math.floor(Math.min(h - 1, y * scale + (scale >> 1)));
        const p = (sy * w + sx) * 4;
        const value = lumaOf(pixels[p] || 0, pixels[p + 1] || 0, pixels[p + 2] || 0) / 255;
        cellLuma[y * cols + x] = Number.isNaN(value) ? 0 : value;
      }
    }
    const solved = solveCoverage(cellLuma, cols, rows, coverage);
    field = new Float32Array(total);
    for (let i = 0; i < total; i++) field[i] = solved.gate(cellLuma[i]);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (field) {
    drawSource(ctx, pixels, w, h);
    ctx.fillStyle = bg;
    for (let y = 0; y < rows; y++) {
      const py = Math.round(y * scale), ph = Math.round((y + 1) * scale);
      for (let x = 0; x < cols; x++) {
        const gate = field[y * cols + x];
        if (gate <= 0) continue;
        const px = Math.round(x * scale), pw = Math.round((x + 1) * scale);
        ctx.globalAlpha = gate;
        ctx.fillRect(px, py, pw - px, ph - py);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const halo = 0.24 * scale;
  const stripeWidth = 1.5 * cell;
  const gap = 0.3 * scale;
  ctx.fillStyle = sourceMode ? 'rgba(255,255,255,0.05)' :
    `rgba(${ledColor[0]},${ledColor[1]},${ledColor[2]},0.06)`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (field) {
        const gate = field[y * cols + x];
        if (gate <= 0) continue;
        ctx.globalAlpha = gate;
      }
      const cx = x * scale + cell, cy = y * scale + cell;
      if (type === 'stripe') {
        for (let i = 0; i < 3; i++) ctx.fillRect(cx + (i - 1) * gap - 0.5 * stripeWidth, cy - 0.5 * halo, stripeWidth, halo);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, cell * (type === 'bulb' ? 0.62 : 0.42), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (field) {
        const gate = field[y * cols + x];
        if (gate <= 0) continue;
        ctx.globalAlpha = gate;
      }
      const sx = Math.floor(Math.min(w - 1, x * scale + (scale >> 1)));
      const sy = Math.floor(Math.min(h - 1, y * scale + (scale >> 1)));
      const p = (sy * w + sx) * 4;
      const pr = pixels[p] || 0, pg = pixels[p + 1] || 0, pb = pixels[p + 2] || 0;
      const value = lumaOf(pr, pg, pb) / 255;
      if (Number.isNaN(value)) continue;
      let energy = clamp01(value * brightness);
      const cx = x * scale + cell, cy = y * scale + cell;
      if (type === 'stripe') {
        const radius = cell * (0.8 + 1.8 * glow);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(${pr | 0},${pg | 0},${pb | 0},${0.5 * energy * (0.4 + glow)})`);
        gradient.addColorStop(1, `rgba(${pr | 0},${pg | 0},${pb | 0},0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
        const channels = [pr, pg, pb];
        for (let c = 0; c < 3; c++) {
          const e = channels[c] / 255;
          const rr = 255 * (c === 0 ? 1 : 0), gg = 255 * (c === 1 ? 1 : 0), bb = 255 * (c === 2 ? 1 : 0);
          ctx.fillStyle = `rgba(${rr},${gg},${bb},${clamp01(0.9 * e)})`;
          ctx.fillRect(cx + (c - 1) * gap - 0.5 * stripeWidth, cy - 0.5 * halo, stripeWidth, halo);
        }
        continue;
      }
      let cr = ledColor[0], cg = ledColor[1], cb = ledColor[2];
      if (sourceMode) {
        const luma = lumaOf(pr, pg, pb);
        const tone = 0.5 + 0.5 * smooth(clamp01(value / 0.9));
        cr = (luma + 1.25 * (pr - luma)) * tone;
        cg = (luma + 1.25 * (pg - luma)) * tone;
        cb = (luma + 1.25 * (pb - luma)) * tone;
      }
      const ir = cr | 0, ig = cg | 0, ib = cb | 0;
      const square = energy * energy;
      const hr = cr + (255 - cr) * square * 0.7;
      const hg = cg + (255 - cg) * square * 0.7;
      const hb = cb + (255 - cb) * square * 0.7;
      const radius = cell * (0.9 + 2.2 * glow) * (0.55 + 0.45 * energy);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${hr | 0},${hg | 0},${hb | 0},${0.95 * energy})`);
      gradient.addColorStop(0.28, `rgba(${ir},${ig},${ib},${0.72 * energy})`);
      gradient.addColorStop(0.6, `rgba(${ir},${ig},${ib},${0.28 * energy * (0.4 + glow)})`);
      gradient.addColorStop(1, `rgba(${ir},${ig},${ib},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      if (type === 'square') {
        const t = cell * (0.34 + 0.46 * energy);
        ctx.fillStyle = `rgba(${hr | 0},${hg | 0},${hb | 0},${0.85 * energy})`;
        ctx.fillRect(cx - t, cy - t, 2 * t, 2 * t);
      } else if (type === 'bulb') {
        const t = cell * (0.42 + 0.48 * energy);
        ctx.fillStyle = `rgba(${hr | 0},${hg | 0},${hb | 0},${0.8 * energy})`;
        ctx.beginPath(); ctx.arc(cx, cy, t, 0, Math.PI * 2); ctx.fill();
        const gx = cx - 0.28 * t, gy = cy - 0.3 * t, gr = Math.max(0.5, 0.38 * t);
        const glint = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        glint.addColorStop(0, `rgba(255,255,255,${0.85 * energy})`);
        glint.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glint;
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
      } else {
        const t = cell * (0.3 + 0.5 * energy);
        ctx.fillStyle = `rgba(${hr | 0},${hg | 0},${hb | 0},${0.85 * energy})`;
        ctx.beginPath(); ctx.arc(cx, cy, t, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function td(scale: number, width: number) {
  return Math.max(3, Math.round((width / 900) * (4 + (scale / 100) * 24)));
}

export function renderBeacon(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  if (coverage <= 0) { drawSource(ctx, pixels, w, h); return; }
  const scale = Math.max(4, 1.4 * td(num(r, 'beaconScale', 8), w));
  const bloomIntensity = num(r, 'beaconBloomIntensity', 45) / 100;
  const bloomRadius = num(r, 'beaconBloomRadius', 0) / 100;
  const bloomOpacity = num(r, 'beaconBloomOpacity', 14) / 100;
  const decayLength = Math.max(4, (num(r, 'beaconDecay', 36) / 100) * 40 + 4);
  const colorMode = r.beaconColorMode as string || 'source';
  const angle = num(r, 'beaconAngle', 0);
  const spacing = num(r, 'beaconSpacing', 0);
  const cols = Math.max(1, Math.ceil(w / scale)), rows = Math.max(1, Math.ceil(h / scale));
  const total = cols * rows;
  const [smallCanvas, smallCtx] = canvasOf(cols, rows);
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.clearRect(0, 0, cols, rows);
  const [srcCanvas, srcCtx] = canvasOf(w, h);
  drawSource(srcCtx, pixels, w, h);
  smallCtx.drawImage(srcCanvas, 0, 0, w, h, 0, 0, cols, rows);
  const small = smallCtx.getImageData(0, 0, cols, rows).data;
  const cr = new Float32Array(total), cg = new Float32Array(total), cb = new Float32Array(total);
  const cl = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const p = 4 * i;
    cr[i] = small[p]; cg[i] = small[p + 1]; cb[i] = small[p + 2];
    cl[i] = lumaOf(small[p], small[p + 1], small[p + 2]) / 255;
  }
  let lightAngle = angle;
  if (r.beaconAuto) {
    let gx = 0, gy = 0;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        const dx = cl[i + 1] - cl[i - 1], dy = cl[i + cols] - cl[i - cols];
        gx += -dx * cl[i]; gy += -dy * cl[i];
      }
    }
    if (gx !== 0 || gy !== 0) lightAngle = (180 * Math.atan2(gy, gx)) / Math.PI;
  }
  const rad = (lightAngle * Math.PI) / 180;
  const dirX = Math.cos(rad), dirY = Math.sin(rad);
  const doBloom = bloomIntensity > 0.001 && bloomOpacity > 0.001;
  let bloomScale = 0.5 + 1.4 * bloomIntensity;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (doBloom) {
    const steps = Math.round(decayLength);
    const accR = new Float32Array(total), accG = new Float32Array(total), accB = new Float32Array(total);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let sr = 0, sg = 0, sb = 0;
        for (let step = 0; step < steps; step++) {
          const tx = Math.round(x - dirX * step), ty = Math.round(y - dirY * step);
          if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) break;
          const q = ty * cols + tx;
          const weight = Math.pow(cl[q], 2.2) * Math.exp(-step / (0.5 * decayLength));
          sr += cr[q] * weight; sg += cg[q] * weight; sb += cb[q] * weight;
        }
        const self = 0.6 * Math.pow(cl[i], 2.2);
        accR[i] = sr + cr[i] * self;
        accG[i] = sg + cg[i] * self;
        accB[i] = sb + cb[i] * self;
      }
    }
    const bloomImage = smallCtx.createImageData(cols, rows);
    for (let i = 0; i < total; i++) {
      const er = accR[i] * bloomScale, eg = accG[i] * bloomScale, eb = accB[i] * bloomScale;
      bloomImage.data[4 * i] = (235 * er) / (er + 210);
      bloomImage.data[4 * i + 1] = (235 * eg) / (eg + 210);
      bloomImage.data[4 * i + 2] = (235 * eb) / (eb + 210);
      bloomImage.data[4 * i + 3] = 255;
    }
    smallCtx.putImageData(bloomImage, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.8 * bloomOpacity;
    ctx.filter = `blur(${(scale * (0.35 + 1.4 * bloomRadius)).toFixed(2)}px)`;
    ctx.drawImage(smallCanvas, 0, 0, cols, rows, 0, 0, w, h);
    ctx.globalAlpha = bloomOpacity * Math.min(1, 0.25 + 1.1 * bloomIntensity);
    ctx.filter = `blur(${(scale * (0.8 + 11 * bloomRadius)).toFixed(2)}px)`;
    ctx.drawImage(smallCanvas, 0, 0, cols, rows, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
  }
  const glyphs = ['\u25a0', '8', 'X', '*', '+', '\u00b7'];
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontScale = 1.12 - (spacing / 100) * 0.52;
  ctx.font = `${Math.round(scale * fontScale)}px "Courier New", Courier, monospace`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const value = cl[i];
      if (value < 0.06) continue;
      const glyph = glyphs[Math.min(glyphs.length - 1, Math.floor((1 - value) * glyphs.length))];
      let pr = cr[i], pg = cg[i], pb = cb[i];
      if (colorMode === 'white') { pr = pg = pb = 255; }
      else {
        const boost = 0.5 + 0.7 * value;
        pr = clampByte(pr * (1 + boost));
        pg = clampByte(pg * (1 + boost));
        pb = clampByte(pb * (1 + boost));
        if (value > 0.82) {
          const t = (value - 0.82) / 0.18;
          pr += (255 - pr) * t; pg += (255 - pg) * t; pb += (255 - pb) * t;
        }
      }
      const cx = x * scale + scale / 2, cy = y * scale + scale / 2;
      if (value > 0.78) {
        ctx.shadowColor = `rgb(${pr | 0},${pg | 0},${pb | 0})`;
        ctx.shadowBlur = 0.35 * scale;
      } else ctx.shadowBlur = 0;
      ctx.fillStyle = `rgb(${pr | 0},${pg | 0},${pb | 0})`;
      ctx.fillText(glyph, cx, cy);
    }
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function clampByte(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width); canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return [canvas, ctx];
}
