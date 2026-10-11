import { lumaOf, num, clamp01 } from './context';
import type { FxRecipe } from './context';

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export const gradientPalettes: Record<string, number[][]> = {
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
    [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [183, 55, 121],
    [240, 110, 120], [254, 180, 130], [252, 253, 191]],
  sunset: [[20, 16, 54], [86, 32, 104], [173, 54, 105], [240, 110, 80], [255, 190, 90]],
  tealorange: [[8, 30, 44], [18, 74, 92], [150, 150, 140], [224, 150, 90], [250, 210, 140]],
  noir: [[8, 10, 20], [60, 66, 86], [150, 156, 172], [235, 238, 245]],
  cyberpunk: [[12, 4, 30], [120, 10, 120], [220, 20, 140], [80, 200, 230], [200, 255, 255]],
  gold: [[16, 10, 4], [70, 42, 20], [150, 100, 44], [214, 166, 92], [250, 232, 180]],
};

export const warholPalettes: Record<string, number[][]> = {
  pop: [[236, 64, 122], [255, 214, 64], [38, 198, 218], [124, 77, 255], [255, 112, 67],
    [15, 15, 22], [255, 245, 225], [139, 195, 74], [3, 169, 244], [233, 30, 99]],
};

function parseHex(hex: string): number[] {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

function putData(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number) {
  const copy = new Uint8ClampedArray(w * h * 4);
  copy.set(data.subarray(0, copy.length));
  ctx.putImageData(new ImageData(copy, w, h), 0, 0);
}

export function renderGradientMap(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const paletteName = String(r.gmPalette ?? 'inferno');
  let palette = gradientPalettes[paletteName] || gradientPalettes.inferno;
  const customStops = r.gmStops as string | undefined;
  if (customStops) {
    try {
      const parsed = JSON.parse(customStops);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        const stops = parsed
          .map((s: { p: number; c: string }) => ({ p: clamp01(Number(s.p)), rgb: parseHex(String(s.c)) }))
          .sort((a: { p: number }, b: { p: number }) => a.p - b.p);
        const ramp: number[][] = [];
        for (let i = 0; i < 64; i++) {
          const t = i / 63;
          let lo = stops[0], hi = stops[stops.length - 1];
          for (let s = 0; s < stops.length - 1; s++) {
            if (t >= stops[s].p && t <= stops[s + 1].p) { lo = stops[s]; hi = stops[s + 1]; break; }
          }
          const span = hi.p - lo.p || 1;
          const f = clamp01((t - lo.p) / span);
          ramp.push([lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f,
            lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f,
            lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f]);
        }
        palette = ramp;
      }
    } catch { /* custom stops stay unparsed */ }
  }
  const mix = clamp01(num(r, 'gmMix', 100) / 100);
  const contrast = 1 + (num(r, 'gmContrast', 30) / 100) * 2;
  const midpoint = num(r, 'gmMidpoint', 50);
  const gamma = midpoint <= 50 ? 0.4 + (midpoint / 50) * 0.6 : 1 + ((midpoint - 50) / 50) * 2;
  const bands = Math.max(0, Math.min(32, Math.round(num(r, 'gmBands', 0))));
  const last = palette.length - 1;
  const out = new Uint8ClampedArray(w * h * 4);
  const curve = new Float32Array(16386);
  for (let i = 0; i <= 16385; i++) {
    let e = (Math.min(1, i / 16384) - 0.5) * contrast + 0.5;
    e = clamp01(e);
    e = Math.pow(e, gamma);
    curve[i] = e;
  }
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const raw = (lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255) * 16384;
    const idx = raw | 0;
    const frac = raw - idx;
    let value = curve[idx] + (curve[idx + 1] - curve[idx]) * frac;
    if (bands > 1) value = Math.round(value * (bands - 1)) / (bands - 1);
    const pos = value * last;
    const pi = Math.min(last - 1, Math.floor(pos));
    const pf = pos - pi;
    const c0 = palette[pi], c1 = palette[pi + 1];
    const cr = c0[0] + (c1[0] - c0[0]) * pf;
    const cg = c0[1] + (c1[1] - c0[1]) * pf;
    const cb = c0[2] + (c1[2] - c0[2]) * pf;
    out[p] = pixels[p] + (cr - pixels[p]) * mix;
    out[p + 1] = pixels[p + 1] + (cg - pixels[p + 1]) * mix;
    out[p + 2] = pixels[p + 2] + (cb - pixels[p + 2]) * mix;
    out[p + 3] = 255;
  }
  putData(ctx, out, w, h);
}

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

export function renderAnaglyph(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const disparity = (num(r, 'agDisparity', 40) / 100) * 32;
  const focus = num(r, 'agFocus', 50) / 100;
  const depthBlur = 1 + Math.round((num(r, 'agDepthBlur', 60) / 100) * 15);
  const scheme = String(r.agScheme ?? 'redcyan');
  const total = w * h;
  const lum = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4)
    lum[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]) / 255;
  const depth = separableBox(lum.slice(), w, h, depthBlur);
  const out = new Uint8ClampedArray(total * 4);
  if (scheme === 'chromadepth') {
    for (let i = 0; i < total; i++) {
      const hue = (1 - depth[i]) * 240;
      const sat = 0.35 + 0.65 * lum[i];
      const value = 0.85 * sat;
      const sector = hue / 60;
      const tri = value * (1 - Math.abs((sector % 2) - 1));
      const base = sat - value;
      let rr = 0, gg = 0, bb = 0;
      if (sector < 1) { rr = value; gg = tri; }
      else if (sector < 2) { rr = tri; gg = value; }
      else if (sector < 3) { gg = value; bb = tri; }
      else if (sector < 4) { gg = tri; bb = value; }
      else if (sector < 5) { rr = tri; bb = value; }
      else { rr = value; bb = tri; }
      const p = i << 2;
      out[p] = (rr + base) * 255;
      out[p + 1] = (gg + base) * 255;
      out[p + 2] = (bb + base) * 255;
      out[p + 3] = 255;
    }
  } else {
    const greenMagenta = scheme === 'greenmagenta';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const shift = disparity * (depth[i] - focus);
        let right = Math.round(x + shift);
        if (right < 0) right = 0; else if (right > w - 1) right = w - 1;
        let left = Math.round(x - shift);
        if (left < 0) left = 0; else if (left > w - 1) left = w - 1;
        const pr = (y * w + right) * 4;
        const pl = (y * w + left) * 4;
        const q = i << 2;
        if (greenMagenta) {
          out[q] = pixels[pl];
          out[q + 1] = pixels[pr + 1];
        } else {
          out[q] = pixels[pr];
          out[q + 1] = pixels[pl + 1];
        }
        out[q + 2] = pixels[pl + 2];
        out[q + 3] = 255;
      }
    }
  }
  putData(ctx, out, w, h);
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothRange = (lo: number, hi: number, v: number) => {
  const t = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
  return smooth(t);
};

export function renderWarhol(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const grid = Math.max(2, Math.min(6, Math.round(num(r, 'whGrid', 2))));
  const levels = Math.max(2, Math.min(5, Math.round(num(r, 'whLevels', 4))));
  const contrast = 1 + (num(r, 'whContrast', 40) / 100) * 2.2;
  const palette = warholPalettes[String(r.whPalette ?? 'pop')] || warholPalettes.pop;
  const cellW = w / grid, cellH = h / grid;
  const gap = Math.round((num(r, 'whGap', 6) / 100) * (0.12 * Math.min(cellW, cellH)));
  const rand = (seed: number) => {
    const v = 43758.5453 * Math.sin(127.1 * seed);
    return v - Math.floor(v);
  };
  const count = palette.length;
  const stride = Math.max(1, Math.floor(count / 4));
  const cellPalettes: number[][][] = [];
  for (let cell = 0; cell < grid * grid; cell++) {
    const start = Math.floor(rand(cell + 1) * count);
    const quad = [palette[start], palette[(start + stride) % count],
      palette[(start + 2 * stride) % count], palette[(start + 3 * stride) % count]];
    quad.sort((a, b) => lumaOf(a[0], a[1], a[2]) - lumaOf(b[0], b[1], b[2]));
    cellPalettes.push(quad);
  }
  const scanTolerance = Math.max(1.5, 0.012 * cellH);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = (y * w + x) << 2;
      const col = Math.min(grid - 1, (x / cellW) | 0);
      const row = Math.min(grid - 1, (y / cellH) | 0);
      const localX = x - col * cellW, localY = y - row * cellH;
      if (gap > 0 && (localX < gap || localY < gap || localX > cellW - gap || localY > cellH - gap)) {
        out[q] = 248; out[q + 1] = 248; out[q + 2] = 248; out[q + 3] = 255;
        continue;
      }
      const srcX = Math.min(w - 1, ((localX / cellW) * w) | 0);
      const srcY = Math.min(h - 1, ((localY / cellH) * h) | 0);
      const sp = (srcY * w + srcX) << 2;
      const value = clamp01(((lumaOf(pixels[sp], pixels[sp + 1], pixels[sp + 2]) / 255 - 0.5) * contrast) + 0.5);
      const level = Math.min(levels - 1, (value * levels) | 0);
      const quad = cellPalettes[row * grid + col];
      const color = quad[Math.round((level / (levels - 1)) * 3)];
      out[q] = color[0]; out[q + 1] = color[1]; out[q + 2] = color[2]; out[q + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}

export function renderThinFilm(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const thickness = num(r, 'tfThickness', 40) / 100;
  const bands = 0.5 + (num(r, 'tfBands', 45) / 100) * 5.5;
  const swirl = num(r, 'tfSwirl', 55) / 100;
  const sheen = num(r, 'tfSheen', 80) / 100;
  const hueShift = num(r, 'tfHue', 0) / 360;
  const noiseAt = (x: number, y: number) => {
    const v = 43758.5453 * Math.sin(127.1 * x + 311.7 * y);
    return v - Math.floor(v);
  };
  const valueNoise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = smooth(fx), sy = smooth(fy);
    const n00 = noiseAt(ix, iy), n10 = noiseAt(ix + 1, iy);
    const n01 = noiseAt(ix, iy + 1), n11 = noiseAt(ix + 1, iy + 1);
    return n00 + (n10 - n00) * sx + (n01 - n00) * sy + (n00 - n10 - n01 + n11) * sx * sy;
  };
  const fbm = (x: number, y: number) => {
    let sum = 0, amp = 0.5, freq = 1;
    for (let o = 0; o < 3; o++) {
      sum += amp * valueNoise(x * freq, y * freq);
      amp *= 0.5; freq *= 2.03;
    }
    return sum;
  };
  const grid = 3.5 / Math.min(w, h);
  const cols = Math.ceil(20 * (Math.max(w * grid + 3.6, w * grid * 0.6 + 1.7) + 0.6)) + 2;
  const rows = Math.ceil(20 * (Math.max(h * grid + 3.6, h * grid * 0.6 + 9.2) + 0.6)) + 2;
  const field = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const fy = y / 20;
    for (let x = 0; x < cols; x++) field[y * cols + x] = fbm(x / 20, fy);
  }
  const sampleField = (x: number, y: number) => {
    let fx = 20 * x, fy = 20 * y;
    if (fx < 0) fx = 0; else if (fx > cols - 1.001) fx = cols - 1.001;
    if (fy < 0) fy = 0; else if (fy > rows - 1.001) fy = rows - 1.001;
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const base = iy * cols + ix;
    const v00 = field[base], v10 = field[base + 1], v01 = field[base + cols];
    return v00 + (v10 - v00) * tx + (v01 - v00) * ty +
      (v00 - v10 - v01 + field[base + cols + 1]) * tx * ty;
  };
  const cosine = new Float32Array(3072);
  for (let i = 0; i < 3072; i++) cosine[i] = 0.5 + 0.5 * Math.cos((2 * Math.PI * i) / 3072);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) << 2;
      const pr = pixels[p], pg = pixels[p + 1], pb = pixels[p + 2];
      const luma = lumaOf(pr, pg, pb) / 255;
      const gx = x * grid, gy = y * grid;
      const warp1 = sampleField(0.6 * gx + 1.7, 0.6 * gy + 9.2);
      const warp2 = sampleField(gx + 2.4 * swirl * warp1, gy + 2.4 * swirl * warp1);
      const phase = (thickness + 0.55 * luma + swirl * (warp2 - 0.5) * 1.3) * bands + hueShift;
      let idx = ((phase - Math.floor(phase)) * 3072) | 0;
      if (idx < 0) idx = 0; else if (idx >= 3072) idx = 3071;
      const energy = (0.32 + 0.68 * luma) * 255;
      const ir = cosine[idx] * energy;
      const ig = cosine[(idx + 1024) % 3072] * energy;
      const ib = cosine[(idx + 2048) % 3072] * energy;
      out[p] = pr + (ir - pr) * sheen;
      out[p + 1] = pg + (ig - pg) * sheen;
      out[p + 2] = pb + (ib - pb) * sheen;
      out[p + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}