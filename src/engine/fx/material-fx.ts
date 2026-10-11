import { lumaOf, num, clamp01 } from './context';
import type { FxRecipe } from './context';

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function putData(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number) {
  const copy = new Uint8ClampedArray(w * h * 4);
  copy.set(data.subarray(0, copy.length));
  ctx.putImageData(new ImageData(copy, w, h), 0, 0);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function hashPos(x: number, y: number) {
  let h = (Math.imul(x, 0x165667b1) + Math.imul(y, 0x27d4eb2f)) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 0x4bf19f61) ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

export function renderPixelSort(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const vertical = String(r.psortDir ?? 'horizontal') === 'vertical';
  const low = num(r, 'psortLow', 25) / 100;
  const high = Math.max(low, num(r, 'psortHigh', 80) / 100);
  const descending = String(r.psortOrder ?? 'asc') === 'desc';
  const key = String(r.psortKey ?? 'brightness');
  const maxLen = num(r, 'psortMaxLen', 0) / 100;
  const out = new Uint8ClampedArray(pixels.length);
  out.set(pixels);
  const lumaAt = (index: number) => lumaOf(pixels[index], pixels[index + 1], pixels[index + 2]) / 255;
  const keyAt = (index: number) => {
    const rr = pixels[index], gg = pixels[index + 1], bb = pixels[index + 2];
    if (key === 'red') return rr;
    if (key === 'hue' || key === 'saturation') {
      const max = Math.max(rr, gg, bb);
      const delta = max - Math.min(rr, gg, bb);
      if (key === 'saturation') return max === 0 ? 0 : (delta / max) * 255;
      if (delta === 0) return 0;
      let hue: number;
      if (max === rr) hue = ((gg - bb) / delta) % 6;
      else if (max === gg) hue = (bb - rr) / delta + 2;
      else hue = (rr - gg) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
      return hue;
    }
    return lumaOf(rr, gg, bb);
  };
  const outer = vertical ? w : h;
  const inner = vertical ? h : w;
  const maxLength = maxLen > 0 ? Math.max(2, Math.round(maxLen * inner)) : inner;
  const indexAt = (a: number, b: number) => (vertical ? b * w + a : a * w + b) * 4;
  for (let line = 0; line < outer; line++) {
    let cursor = 0;
    while (cursor < inner) {
      const value = lumaAt(indexAt(line, cursor));
      if (value < low || value > high) { cursor++; continue; }
      let end = cursor;
      while (end < inner && end - cursor < maxLength) {
        const v = lumaAt(indexAt(line, end));
        if (v < low || v > high) break;
        end++;
      }
      if (end - cursor > 1) {
        const span: { k: number; r: number; g: number; b: number }[] = [];
        for (let i = cursor; i < end; i++) {
          const p = indexAt(line, i);
          span.push({ k: keyAt(p), r: pixels[p], g: pixels[p + 1], b: pixels[p + 2] });
        }
        span.sort((a, b) => (descending ? b.k - a.k : a.k - b.k));
        for (let i = cursor; i < end; i++) {
          const p = indexAt(line, i);
          const s = span[i - cursor];
          out[p] = s.r; out[p + 1] = s.g; out[p + 2] = s.b; out[p + 3] = 255;
        }
      }
      cursor = end > cursor ? end : cursor + 1;
    }
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

export function renderOilPaint(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const brush = Math.max(1, Math.min(15, Math.round(num(r, 'oilBrush', 6))));
  const detail = Math.max(0, Math.min(1, num(r, 'oilDetail', 100) / 100));
  const levels = Math.max(0, Math.min(8, Math.round(num(r, 'oilLevels', 0))));
  const total = w * h;
  const luma = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4)
    luma[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]);
  const stride = w + 1;
  const sumR = new Float64Array(stride * (h + 1));
  const sumG = new Float64Array(stride * (h + 1));
  const sumB = new Float64Array(stride * (h + 1));
  const sumL = new Float64Array(stride * (h + 1));
  const sumL2 = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
    const row = y * stride, next = (y + 1) * stride, src = y * w;
    for (let x = 0; x < w; x++) {
      const p = (src + x) << 2;
      sr += pixels[p]; sg += pixels[p + 1]; sb += pixels[p + 2];
      const l = luma[src + x];
      sl += l; sl2 += l * l;
      const c = x + 1;
      sumR[next + c] = sumR[row + c] + sr;
      sumG[next + c] = sumG[row + c] + sg;
      sumB[next + c] = sumB[row + c] + sb;
      sumL[next + c] = sumL[row + c] + sl;
      sumL2[next + c] = sumL2[row + c] + sl2;
    }
  }
  const area = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    table[(y1 + 1) * stride + (x1 + 1)] - table[y0 * stride + (x1 + 1)] -
    table[(y1 + 1) * stride + x0] + table[y0 * stride + x0];
  const quantStep = levels >= 2 ? 255 / (levels - 1) : 0;
  const out = new Uint8ClampedArray(total * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = 1e18, bx0 = x, by0 = y, bx1 = x, by1 = y, bestArea = 1;
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const x0 = quadrant & 1 ? x : Math.max(0, x - brush);
        const x1 = quadrant & 1 ? Math.min(w - 1, x + brush) : x;
        const y0 = quadrant & 2 ? y : Math.max(0, y - brush);
        const y1 = quadrant & 2 ? Math.min(h - 1, y + brush) : y;
        const cellCount = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (cellCount <= 0) continue;
        const meanL = area(sumL, x0, y0, x1, y1) / cellCount;
        const variance = area(sumL2, x0, y0, x1, y1) / cellCount - meanL * meanL;
        if (variance < best) {
          best = variance;
          bx0 = x0; by0 = y0; bx1 = x1; by1 = y1;
          bestArea = cellCount;
        }
      }
      let mr = area(sumR, bx0, by0, bx1, by1) / bestArea;
      let mg = area(sumG, bx0, by0, bx1, by1) / bestArea;
      let mb = area(sumB, bx0, by0, bx1, by1) / bestArea;
      if (quantStep) {
        mr = Math.round(mr / quantStep) * quantStep;
        mg = Math.round(mg / quantStep) * quantStep;
        mb = Math.round(mb / quantStep) * quantStep;
      }
      const p = (y * w + x) << 2;
      if (detail < 1) {
        out[p] = pixels[p] + (mr - pixels[p]) * detail;
        out[p + 1] = pixels[p + 1] + (mg - pixels[p + 1]) * detail;
        out[p + 2] = pixels[p + 2] + (mb - pixels[p + 2]) * detail;
      } else {
        out[p] = mr; out[p + 1] = mg; out[p + 2] = mb;
      }
      out[p + 3] = 255;
    }
  }
  const smoothed = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4)
    smoothed[i] = lumaOf(out[p], out[p + 1], out[p + 2]);
  separableBox(smoothed, w, h, 1);
  putData(ctx, out, w, h);
}

export function renderCrystallize(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const size = Math.max(3, Math.round(num(r, 'crystalCells', 24)));
  const jitter = Math.max(0, Math.min(1, num(r, 'crystalJitter', 70) / 100));
  const outline = Math.max(0, Math.min(1, num(r, 'crystalOutline', 0) / 100));
  const seed = (num(r, 'crystalSeed', 0) | 0) as number;
  const rand = (n: number) => {
    const v = 43758.5453 * Math.sin((n + 0.61803399 * seed) * 127.1);
    return v - Math.floor(v);
  };
  const cols = Math.ceil(w / size) + 2;
  const rows = Math.ceil(h / size) + 2;
  const count = cols * rows;
  const px = new Float32Array(count), py = new Float32Array(count);
  const sr = new Float64Array(count), sg = new Float64Array(count), sb = new Float64Array(count);
  const counts = new Float64Array(count);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      px[i] = (x - 1 + 0.5 + (rand(2 * i) - 0.5) * jitter) * size;
      py[i] = (y - 1 + 0.5 + (rand(2 * i + 1) - 0.5) * jitter) * size;
    }
  }
  const owner = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const baseRow = ((y / size) | 0) + 1;
    for (let x = 0; x < w; x++) {
      const baseCol = ((x / size) | 0) + 1;
      let bestDist = 1e12, bestIdx = baseRow * cols + baseCol;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = baseRow + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = baseCol + dx;
          if (xx < 0 || xx >= cols) continue;
          const i = yy * cols + xx;
          const ddx = x - px[i], ddy = y - py[i];
          const dist = ddx * ddx + ddy * ddy;
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
      }
      const p = (y * w + x) * 4;
      sr[bestIdx] += pixels[p]; sg[bestIdx] += pixels[p + 1]; sb[bestIdx] += pixels[p + 2];
      counts[bestIdx]++;
      owner[y * w + x] = bestIdx;
    }
  }
  for (let i = 0; i < count; i++) {
    if (counts[i]) { sr[i] /= counts[i]; sg[i] /= counts[i]; sb[i] /= counts[i]; }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cell = owner[i];
      const p = i << 2;
      let rr = sr[cell], gg = sg[cell], bb = sb[cell];
      if (outline > 0 &&
        ((x > 0 && owner[i - 1] !== cell) || (x < w - 1 && owner[i + 1] !== cell) ||
          (y > 0 && owner[i - w] !== cell) || (y < h - 1 && owner[i + w] !== cell))) {
        const keep = 1 - outline;
        rr *= keep; gg *= keep; bb *= keep;
      }
      out[p] = rr; out[p + 1] = gg; out[p + 2] = bb; out[p + 3] = 255;
    }
  }
  putData(ctx, out, w, h);
}

type Point = [number, number];
type Triangle = [number, number, number];

function delaunay(points: Point[], w: number, h: number): Triangle[] {
  const n = points.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const vertices: Point[] = points.slice();
  vertices.push([midX - 20 * span, midY - span]);
  vertices.push([midX, midY + 20 * span]);
  vertices.push([midX + 20 * span, midY - span]);
  const orient = (a: number, b: number, c: number): Triangle =>
    (vertices[b][0] - vertices[a][0]) * (vertices[c][1] - vertices[a][1]) -
    (vertices[b][1] - vertices[a][1]) * (vertices[c][0] - vertices[a][0]) < 0 ?
      [a, c, b] : [a, b, c];
  const inCircumcircle = (tri: Triangle, x: number, y: number) => {
    const ax = vertices[tri[0]][0] - x, ay = vertices[tri[0]][1] - y;
    const bx = vertices[tri[1]][0] - x, by = vertices[tri[1]][1] - y;
    const cx = vertices[tri[2]][0] - x, cy = vertices[tri[2]][1] - y;
    return (ax * ax + ay * ay) * (bx * cy - by * cx) -
      (bx * bx + by * by) * (ax * cy - ay * cx) +
      (cx * cx + cy * cy) * (ax * by - ay * bx) > 0;
  };
  const hasEdge = (tri: Triangle, a: number, b: number) =>
    (tri[0] === a && tri[1] === b) || (tri[1] === a && tri[2] === b) ||
    (tri[2] === a && tri[0] === b) || (tri[0] === b && tri[1] === a) ||
    (tri[1] === b && tri[2] === a) || (tri[2] === b && tri[0] === a);
  let tris: Triangle[] = [orient(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const x = vertices[i][0], y = vertices[i][1];
    const bad: Triangle[] = [];
    for (const tri of tris) if (inCircumcircle(tri, x, y)) bad.push(tri);
    const badSet = new Set(bad);
    const edges: [number, number][] = [];
    for (const tri of bad) {
      for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as [number, number][]) {
        let shared = false;
        for (const other of bad) {
          if (other !== tri && hasEdge(other, a, b)) { shared = true; break; }
        }
        if (!shared) edges.push([a, b]);
      }
    }
    tris = tris.filter(t => !badSet.has(t));
    for (const [a, b] of edges) tris.push(orient(a, b, i));
  }
  return tris.filter(t => t[0] < n && t[1] < n && t[2] < n);
}

export function renderLowPoly(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const density = Math.max(120, Math.min(3000, Math.round(num(r, 'lpDensity', 900))));
  const edgeBias = Math.max(0, Math.min(1, num(r, 'lpEdgeBias', 60) / 100));
  const stroke = Math.max(0, Math.min(1, num(r, 'lpStroke', 0) / 100));
  const seed = ((num(r, 'lpSeed', 0) | 0) * 0x9e3779b1 + 1) >>> 0;
  const total = w * h;
  const luma = new Float32Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4)
    luma[i] = lumaOf(pixels[p], pixels[p + 1], pixels[p + 2]);
  const grad = new Float32Array(total);
  let maxGrad = 0.001;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1] +
        luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1];
      const gy = -luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1] +
        luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      grad[i] = mag;
      if (mag > maxGrad) maxGrad = mag;
    }
  }
  const rand = mulberry32(seed || 1);
  const points: Point[] = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [(w / 2) | 0, 0], [(w / 2) | 0, h - 1], [0, (h / 2) | 0], [w - 1, (h / 2) | 0],
  ];
  const step = Math.max(6, Math.sqrt((w * h) / Math.max(1, Math.floor(0.4 * density))));
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      const px = Math.min(w - 1, Math.max(0, (x + (rand() - 0.5) * step * 0.8) | 0));
      const py = Math.min(h - 1, Math.max(0, (y + (rand() - 0.5) * step * 0.8) | 0));
      points.push([px, py]);
    }
  }
  const biasExponent = 0.4 + 4 * edgeBias;
  let attempts = 0;
  const maxAttempts = 60 * density;
  while (points.length < density && attempts < maxAttempts) {
    attempts++;
    const x = (rand() * w) | 0, y = (rand() * h) | 0;
    const normalized = grad[y * w + x] / maxGrad;
    if (rand() < 0.03 + 0.97 * Math.pow(normalized, biasExponent)) points.push([x, y]);
  }
  const tris = delaunay(points, w, h);
  const fills: string[] = [];
  const rgbs: number[][] = [];
  for (const tri of tris) {
    const cx = Math.min(w - 1, Math.max(0, ((points[tri[0]][0] + points[tri[1]][0] + points[tri[2]][0]) / 3) | 0));
    const cy = Math.min(h - 1, Math.max(0, ((points[tri[0]][1] + points[tri[1]][1] + points[tri[2]][1]) / 3) | 0));
    const p = (cy * w + cx) * 4;
    fills.push(`rgb(${pixels[p]},${pixels[p + 1]},${pixels[p + 2]})`);
    rgbs.push([pixels[p], pixels[p + 1], pixels[p + 2]]);
  }
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  for (let t = 0; t < tris.length; t++) {
    const [a, b, c] = tris[t];
    const fill = fills[t];
    ctx.beginPath();
    ctx.moveTo(points[a][0], points[a][1]);
    ctx.lineTo(points[b][0], points[b][1]);
    ctx.lineTo(points[c][0], points[c][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (stroke > 0) {
      ctx.strokeStyle = `rgba(0,0,0,${stroke})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

export { clamp01 };