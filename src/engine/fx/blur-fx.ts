import { lumaOf, num } from './context';
import type { FxRecipe } from './context';

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function hashNoise(x: number, y: number) {
  let h = (0x165667b1 * x + 0x27d4eb2f * y) | 0;
  h = ((h ^ (h >>> 13)) * 0x4bf19f61) ^ (h >>> 16);
  return (h >>> 0) / 0x100000000;
}

function separableBox(src: Float32Array, w: number, h: number, radius: number) {
  if (radius < 1) return src.slice();
  const dst = new Float32Array(w * h);
  const out = new Float32Array(w * h);
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
      out[y * w + x] = sum * scale;
      sum += dst[Math.min(h - 1, y + radius + 1) * w + x] - dst[Math.max(0, y - radius) * w + x];
    }
  }
  return out;
}

function samplePixels(source: CanvasImageSource, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function putData(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number) {
  const copy = new Uint8ClampedArray(w * h * 4);
  copy.set(data.subarray(0, copy.length));
  ctx.putImageData(new ImageData(copy, w, h), 0, 0);
}

export function renderFrostedGlass(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe) {
  const pixels = samplePixels(source, w, h);
  const scatter = num(r, 'frostScatter', 45);
  const haze = num(r, 'frostHaze', 40);
  const milk = num(r, 'frostMilk', 14) / 100;
  const grain = num(r, 'frostGrain', 18) / 100;
  const tintHex = r.frostTint as string || '#ffffff';
  const tr = parseInt(tintHex.slice(1, 3), 16) || 0;
  const tg = parseInt(tintHex.slice(3, 5), 16) || 0;
  const tb = parseInt(tintHex.slice(5, 7), 16) || 0;
  const maxDim = Math.max(w, h);
  const scale = num(r, 'frostScale', 100) / 100;
  const scatterPx = Math.round((scatter / 100) * maxDim * 0.02 * scale);
  const hazePx = Math.round((haze / 100) * maxDim * 0.015 * scale);
  const out = new ImageData(w, h);
  const outData = out.data;
  if (scatterPx > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (2 * hashNoise(x, y) - 1) * scatterPx;
        const dy = (2 * hashNoise(x, y + 9871) - 1) * scatterPx;
        const sx = x + dx | 0, sy = y + dy | 0;
        const cx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
        const cy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
        const from = (cy * w + cx) * 4, to = (y * w + x) * 4;
        outData[to] = pixels[from];
        outData[to + 1] = pixels[from + 1];
        outData[to + 2] = pixels[from + 2];
        outData[to + 3] = 255;
      }
    }
  } else outData.set(pixels);
  if (hazePx >= 1) {
    const copy = new Uint8ClampedArray(outData.length);
    const window = 2 * hazePx + 1;
    for (let y = 0; y < h; y++) {
      let sr = 0, sg = 0, sb = 0;
      const row = y * w;
      for (let i = -hazePx; i <= hazePx; i++) {
        const p = (row + Math.min(w - 1, Math.max(0, i))) * 4;
        sr += outData[p]; sg += outData[p + 1]; sb += outData[p + 2];
      }
      for (let x = 0; x < w; x++) {
        const p = (row + x) * 4;
        copy[p] = sr / window; copy[p + 1] = sg / window; copy[p + 2] = sb / window;
        const behind = (row + (x - hazePx < 0 ? 0 : x - hazePx)) * 4;
        const ahead = (row + (x + hazePx + 1 >= w ? w - 1 : x + hazePx + 1)) * 4;
        sr += outData[ahead] - outData[behind];
        sg += outData[ahead + 1] - outData[behind + 1];
        sb += outData[ahead + 2] - outData[behind + 2];
      }
    }
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let i = -hazePx; i <= hazePx; i++) {
        const p = (Math.min(h - 1, Math.max(0, i)) * w + x) * 4;
        sr += copy[p]; sg += copy[p + 1]; sb += copy[p + 2];
      }
      for (let y = 0; y < h; y++) {
        const p = (y * w + x) * 4;
        outData[p] = sr / window; outData[p + 1] = sg / window; outData[p + 2] = sb / window;
        outData[p + 3] = 255;
        const behind = (Math.max(0, y - hazePx) * w + x) * 4;
        const ahead = (Math.min(h - 1, y + hazePx + 1) * w + x) * 4;
        sr += copy[ahead] - copy[behind];
        sg += copy[ahead + 1] - copy[behind + 1];
        sb += copy[ahead + 2] - copy[behind + 2];
      }
    }
  }
  if (milk > 0 || grain > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (milk > 0) {
          outData[p] += (tr - outData[p]) * milk;
          outData[p + 1] += (tg - outData[p + 1]) * milk;
          outData[p + 2] += (tb - outData[p + 2]) * milk;
        }
        if (grain > 0) {
          const noise = (hashNoise(3 * x + 17, 7 * y) - 0.5) * 255 * grain;
          outData[p] = clampByte(outData[p] + noise);
          outData[p + 1] = clampByte(outData[p + 1] + noise);
          outData[p + 2] = clampByte(outData[p + 2] + noise);
        }
      }
    }
  }
  putData(ctx, outData, w, h);
}

export function renderGaussianBlur(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, pixelScale: number) {
  const pixels = samplePixels(source, w, h);
  const radius = Math.round((num(r, 'gbAmount', 40) / 100) * 60 * pixelScale);
  const total = w * h;
  if (radius < 1) { putData(ctx, new Uint8ClampedArray(pixels), w, h); return; }
  const channels: Float32Array[] = [new Float32Array(total), new Float32Array(total), new Float32Array(total)];
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    channels[0][i] = pixels[p]; channels[1][i] = pixels[p + 1]; channels[2][i] = pixels[p + 2];
  }
  const boxRadius = Math.max(1, Math.round(radius / 3));
  for (let pass = 0; pass < 3; pass++)
    for (let c = 0; c < 3; c++) channels[c] = separableBox(channels[c], w, h, boxRadius);
  const out = new Uint8ClampedArray(total * 4);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    out[p] = channels[0][i]; out[p + 1] = channels[1][i]; out[p + 2] = channels[2][i]; out[p + 3] = 255;
  }
  putData(ctx, out, w, h);
}

export function renderMotionBlur(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe) {
  const pixels = samplePixels(source, w, h);
  const amount = num(r, 'motionAmount', 35);
  const path = (r.motionPath as number[] | undefined) || [];
  const strength = (amount / 100) * Math.max(w, h) * 0.12;
  if (strength < 0.5) { putData(ctx, new Uint8ClampedArray(pixels), w, h); return; }
  let segment = path;
  if (segment.length < 4) {
    const angle = (num(r, 'motionAngle', 0) * Math.PI) / 180;
    segment = [-Math.cos(angle), -Math.sin(angle), Math.cos(angle), Math.sin(angle)];
  }
  const steps = Math.max(3, Math.min(32, Math.round(strength)));
  const points = resamplePath(segment, steps);
  let cx = 0, cy = 0;
  for (let i = 0; i < steps; i++) { cx += points[2 * i]; cy += points[2 * i + 1]; }
  cx /= steps; cy /= steps;
  const offsetX = new Int32Array(steps), offsetY = new Int32Array(steps);
  for (let i = 0; i < steps; i++) {
    offsetX[i] = Math.round((points[2 * i] - cx) * strength);
    offsetY[i] = Math.round((points[2 * i + 1] - cy) * strength);
  }
  const out = new ImageData(w, h);
  const outData = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < steps; i++) {
        let sx = x + offsetX[i], sy = y + offsetY[i];
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
        const p = (sy * w + sx) * 4;
        sr += pixels[p]; sg += pixels[p + 1]; sb += pixels[p + 2];
      }
      const q = (y * w + x) * 4;
      outData[q] = clampByte(sr / steps);
      outData[q + 1] = clampByte(sg / steps);
      outData[q + 2] = clampByte(sb / steps);
      outData[q + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function resamplePath(path: number[], count: number) {
  const points = path.length >> 1;
  if (points < 2 || count < 2) return path.slice();
  const cumulative = new Float64Array(points);
  for (let i = 1; i < points; i++) {
    cumulative[i] = cumulative[i - 1] +
      Math.hypot(path[2 * i] - path[(i - 1) * 2], path[2 * i + 1] - path[(i - 1) * 2 + 1]);
  }
  const total = cumulative[points - 1];
  if (total <= 0) return Array.from({ length: count * 2 }, (_, i) => path[i % 2]);
  const out: number[] = [];
  let cursor = 1;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (cursor < points - 1 && cumulative[cursor] < target) cursor++;
    const before = cumulative[cursor - 1], after = cumulative[cursor];
    const t = after > before ? (target - before) / (after - before) : 0;
    out.push(path[(cursor - 1) * 2] + (path[2 * cursor] - path[(cursor - 1) * 2]) * t,
      path[(cursor - 1) * 2 + 1] + (path[2 * cursor + 1] - path[(cursor - 1) * 2 + 1]) * t);
  }
  return out;
}

export function renderRadialBlur(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe) {
  const pixels = samplePixels(source, w, h);
  const mode = String(r.rbMode ?? 'zoom');
  const amount = num(r, 'rbAmount', 40) / 100;
  const cx = (num(r, 'rbCenterX', 50) / 100) * w;
  const cy = (num(r, 'rbCenterY', 50) / 100) * h;
  const spin = mode === 'spin';
  const zoomFactors = new Float32Array(14);
  const cosAngles = new Float32Array(14);
  const sinAngles = new Float32Array(14);
  for (let i = 0; i < 14; i++) {
    const t = i / 13 - 0.5;
    if (spin) {
      const angle = t * amount * 0.6;
      cosAngles[i] = Math.cos(angle);
      sinAngles[i] = Math.sin(angle);
    } else zoomFactors[i] = 1 - t * amount * 0.5;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < 14; i++) {
        let sx: number, sy: number;
        if (spin) {
          sx = cx + dx * cosAngles[i] - dy * sinAngles[i];
          sy = cy + dx * sinAngles[i] + dy * cosAngles[i];
        } else {
          sx = cx + dx * zoomFactors[i];
          sy = cy + dy * zoomFactors[i];
        }
        let ix = sx | 0, iy = sy | 0;
        if (ix < 0) ix = 0; else if (ix >= w) ix = w - 1;
        if (iy < 0) iy = 0; else if (iy >= h) iy = h - 1;
        const p = (iy * w + ix) << 2;
        sr += pixels[p]; sg += pixels[p + 1]; sb += pixels[p + 2];
      }
      const q = (y * w + x) << 2;
      out[q] = sr / 14; out[q + 1] = sg / 14; out[q + 2] = sb / 14; out[q + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}

export function renderTiltShift(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe) {
  const pixels = samplePixels(source, w, h);
  const focusY = (num(r, 'tsFocus', 50) / 100) * h;
  const halfWidth = Math.max(2, (num(r, 'tsWidth', 28) / 100) * h) / 2;
  const maxBlur = Math.max(1, Math.min(48, Math.round((num(r, 'tsBlur', 45) / 100) * 48)));
  const angle = (num(r, 'tsAngle', 0) * Math.PI) / 180;
  const saturation = Math.max(0, Math.min(2, num(r, 'tsSat', 145) / 100));
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const total = w * h;
  const r0 = new Float32Array(total), g0 = new Float32Array(total), b0 = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    r0[i] = pixels[p]; g0[i] = pixels[p + 1]; b0[i] = pixels[p + 2];
  }
  const halfW = (w + 1) >> 1, halfH = (h + 1) >> 1;
  const halfCount = halfW * halfH;
  const downR = new Float32Array(halfCount), downG = new Float32Array(halfCount), downB = new Float32Array(halfCount);
  for (let y = 0; y < halfH; y++) {
    const y0 = y << 1, y1 = y0 + 1 < h ? y0 + 1 : h - 1;
    for (let x = 0; x < halfW; x++) {
      const x0 = x << 1, x1 = x0 + 1 < w ? x0 + 1 : w - 1;
      const i = y * halfW + x;
      downR[i] = (r0[y0 * w + x0] + r0[y0 * w + x1] + r0[y1 * w + x0] + r0[y1 * w + x1]) * 0.25;
      downG[i] = (g0[y0 * w + x0] + g0[y0 * w + x1] + g0[y1 * w + x0] + g0[y1 * w + x1]) * 0.25;
      downB[i] = (b0[y0 * w + x0] + b0[y0 * w + x1] + b0[y1 * w + x0] + b0[y1 * w + x1]) * 0.25;
    }
  }
  const blur1 = Math.max(1, (maxBlur >> 1) >> 1);
  const blur2 = Math.max(1, maxBlur >> 1);
  const r1h = separableBox(downR, halfW, halfH, blur1);
  const g1h = separableBox(downG, halfW, halfH, blur1);
  const b1h = separableBox(downB, halfW, halfH, blur1);
  const r2h = separableBox(downR, halfW, halfH, blur2);
  const g2h = separableBox(downG, halfW, halfH, blur2);
  const b2h = separableBox(downB, halfW, halfH, blur2);
  const falloff = 0.42 * h;
  const out = new Uint8ClampedArray(4 * total);
  const lastX = halfW - 1, lastY = halfH - 1;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(lastY, Math.max(0, 0.5 * y - 0.25));
    const iy = fy | 0, iy2 = iy < lastY ? iy + 1 : iy;
    const ty = fy - iy;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const distance = Math.abs((x - w / 2) * sinA + (y - focusY) * cosA);
      let blur = Math.min(1, Math.max(0, distance - halfWidth) / falloff);
      blur *= blur;
      const fx = Math.min(lastX, Math.max(0, 0.5 * x - 0.25));
      const ix = fx | 0, ix2 = ix < lastX ? ix + 1 : ix;
      const tx = fx - ix;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const a = iy * halfW + ix, b = iy * halfW + ix2, c = iy2 * halfW + ix, d = iy2 * halfW + ix2;
      const sharpR = r0[i], sharpG = g0[i], sharpB = b0[i];
      let or: number, og: number, ob: number;
      if (blur < 0.5) {
        const t = 2 * blur;
        const midR = r1h[a] * w00 + r1h[b] * w10 + r1h[c] * w01 + r1h[d] * w11;
        const midG = g1h[a] * w00 + g1h[b] * w10 + g1h[c] * w01 + g1h[d] * w11;
        const midB = b1h[a] * w00 + b1h[b] * w10 + b1h[c] * w01 + b1h[d] * w11;
        or = sharpR + (midR - sharpR) * t;
        og = sharpG + (midG - sharpG) * t;
        ob = sharpB + (midB - sharpB) * t;
      } else {
        const t = (blur - 0.5) * 2;
        const midR = r1h[a] * w00 + r1h[b] * w10 + r1h[c] * w01 + r1h[d] * w11;
        const midG = g1h[a] * w00 + g1h[b] * w10 + g1h[c] * w01 + g1h[d] * w11;
        const midB = b1h[a] * w00 + b1h[b] * w10 + b1h[c] * w01 + b1h[d] * w11;
        const farR = r2h[a] * w00 + r2h[b] * w10 + r2h[c] * w01 + r2h[d] * w11;
        const farG = g2h[a] * w00 + g2h[b] * w10 + g2h[c] * w01 + g2h[d] * w11;
        const farB = b2h[a] * w00 + b2h[b] * w10 + b2h[c] * w01 + b2h[d] * w11;
        or = midR + (farR - midR) * t;
        og = midG + (farG - midG) * t;
        ob = midB + (farB - midB) * t;
      }
      const luma = 0.299 * or + 0.587 * og + 0.114 * ob;
      const p = i << 2;
      out[p] = luma + (or - luma) * saturation;
      out[p + 1] = luma + (og - luma) * saturation;
      out[p + 2] = luma + (ob - luma) * saturation;
      out[p + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}

export const lumaOfExport = lumaOf;
