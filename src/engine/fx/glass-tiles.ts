import { FxRecipe, num, str, clamp01, lumaOf, hexRgb, putPixels } from './context';

const noise = (n: number) => {
  const value = 43758.5453 * Math.sin(127.1 * n); return value - Math.floor(value);
};

export function renderShatter(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const cx = w * num(r, 'shFocusX', 50) / 100, cy = h * num(r, 'shFocusY', 42) / 100;
  const cracks = clamp01(num(r, 'shCracks', 45) / 100), spokes = Math.round(8 + 40 * cracks), rings = Math.round(2 + 10 * cracks);
  const spread = num(r, 'shSpread', 30) / 100 * 0.03 * Math.min(w, h), seam = 1 + num(r, 'shSeam', 45) / 100 * 4;
  const reach = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
  const ringSize = reach / (rings + 0.5), angleSize = Math.PI * 2 / spokes;
  const sine = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(Math.PI * 2 * i / 2048));
  const sin = (angle: number) => sine[((angle * 2048 / (Math.PI * 2) % 2048 + 2048) % 2048) | 0];
  const hash = (seed: number) => {
    const n = (0x165667b1 * seed + 0x27d4eb2f) >>> 0;
    return (Math.imul(n ^ n >>> 13, 0x4bf19f61) >>> 0) / 0x100000000;
  };
  const angle = (y: number, x: number) => {
    const ax = Math.abs(x), ay = Math.abs(y), ratio = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-12), q = ratio * ratio;
    let value = ((-0.0464964749 * q + 0.15931422) * q - 0.327622764) * q * ratio + ratio;
    if (ay > ax) value = Math.PI / 2 - value;
    if (x < 0) value = Math.PI - value;
    return y < 0 ? -value : value;
  };
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const distance = Math.hypot(x - cx, y - cy) || 0.001;
    const theta = angle(y - cy, x - cx) + 0.15 * sin(0.02 * distance + 1.3);
    const angular = theta / angleSize, spoke = Math.floor(angular), af = angular - spoke;
    const radial = distance / ringSize + 0.35 * sin(3 * theta), ring = Math.floor(radial), rf = radial - ring;
    const seed = 131 * spoke + 17 * ring + 1000;
    const sx = Math.max(0, Math.min(w - 1, x + (2 * hash(seed) - 1) * spread));
    const sy = Math.max(0, Math.min(h - 1, y + (2 * hash(seed + 7) - 1) * spread));
    const source = ((sy | 0) * w + (sx | 0)) * 4, edge = Math.min(Math.min(af, 1 - af) * angleSize * distance, Math.min(rf, 1 - rf) * ringSize);
    let gain = 0.82 + 0.34 * hash(seed + 13);
    if (edge < seam) {
      const v = edge / seam; gain *= v < 0.4 ? 1 - 0.85 * (1 - v / 0.4) : 1 + 0.9 * (1 - (v - 0.4) / 0.6);
    }
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = pixels[source + c] * gain;
    out[i + 3] = 255;
  }
  putPixels(ctx, out, w, h);
}

export function renderStainedGlass(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const size = Math.max(8, Math.min(80, Math.round(num(r, 'sgCells', 26))));
  const lead = Math.max(1, Math.min(6, Math.round(num(r, 'sgLead', 2))));
  const saturation = 1 + num(r, 'sgSaturation', 60) / 100 * 1.2, glow = 1 + 0.35 * num(r, 'sgGlow', 40) / 100;
  const jitter = clamp01(num(r, 'sgJitter', 70) / 100), pattern = str(r, 'sgPattern', 'shards');
  const ids = new Int32Array(w * h), cols = Math.ceil(w / size) + 2, rows = Math.ceil(h / size) + 2;
  const seedsX = new Float32Array(cols * rows), seedsY = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    seedsX[i] = (x - 0.5 + (noise(2 * i) - 0.5) * jitter) * size;
    seedsY[i] = (y - 0.5 + (noise(2 * i + 1) - 0.5) * jitter) * size;
  }
  let maxId = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let id = 0;
    if (pattern === 'rose') {
      const radius = Math.hypot(w, h) / 2, rings = Math.max(3, Math.round(radius / size)), wedges = Math.max(8, Math.min(64, Math.round(Math.PI * radius / size)));
      const ring = Math.min(rings - 1, Math.hypot(x - w / 2, y - h / 2) / (radius / rings) | 0);
      const angle = (Math.atan2(y - h / 2, x - w / 2) + Math.PI * 2) % (Math.PI * 2);
      id = ring * wedges + ((angle / (Math.PI * 2) * wedges + (ring & 1 ? 0.5 : 0)) | 0) % wedges;
    } else if (pattern === 'lattice') id = (y / size | 0) * Math.ceil(w / size) + (x / size | 0);
    else if (pattern === 'diamond') {
      const step = size * 0.86; id = ((x - y + h) / step | 0) * (Math.ceil((w + h) / step) + 2) + ((x + y) / step | 0);
    } else if (pattern === 'hexagon') {
      const step = size * 0.62, offset = Math.ceil(h / step) + 10, stride = Math.ceil(w / step) + offset + 2;
      const q = (Math.sqrt(3) * x - y) / (3 * step), s = 2 * y / (3 * step), t = -q - s;
      let rq = Math.round(q), rs = Math.round(s); const rt = Math.round(t);
      const dq = Math.abs(rq - q), ds = Math.abs(rs - s), dt = Math.abs(rt - t);
      if (dq > dt && dq > ds) rq = -rt - rs; else if (dt > ds) rs = -rq - rt;
      id = (rs + offset) * stride + rq + offset;
    } else if (pattern === 'triangle') {
      const cx = x / size | 0, cy = y / size | 0, fx = x / size - cx, fy = y / size - cy;
      id = (cy * Math.ceil(w / size) + cx) * 2 + ((cx + cy) & 1 ? Number(fx + fy >= 1) : Number(fx >= fy));
    } else if (pattern === 'chevron') {
      const row = y / size | 0, shift = (row & 1 ? -1 : 1) * (y - row * size) + size;
      id = row * (Math.ceil((w + size) / size) + 4) + ((x + shift) / size | 0);
    } else if (pattern === 'fan') {
      const row = y / (size * 0.5) | 0, stride = Math.ceil(w / size) + 6;
      let highest = -Infinity, closest = Infinity, nearest = 0, selected = -1;
      for (let sy = row - 1; sy <= row + 1; sy++) {
        const offset = sy & 1 ? size * 0.5 : 0, cy = sy * size * 0.5, col = Math.round((x - offset) / size);
        for (let sx = col - 1; sx <= col + 1; sx++) {
          const distance = (x - sx * size - offset) ** 2 + (y - cy) ** 2, seed = (sy + 2) * stride + sx + 2;
          if (distance <= (size * 0.86) ** 2 && cy > highest) { highest = cy; selected = seed; }
          if (distance < closest) { closest = distance; nearest = seed; }
        }
      }
      id = selected >= 0 ? selected : nearest;
    } else {
      const cx = (x / size | 0) + 1, cy = (y / size | 0) + 1; let best = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const sx = cx + dx, sy = cy + dy; if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
        const i = sy * cols + sx, distance = (x - seedsX[i]) ** 2 + (y - seedsY[i]) ** 2;
        if (distance < best) { best = distance; id = i; }
      }
    }
    ids[y * w + x] = id; maxId = Math.max(maxId, id);
  }
  const count = new Float64Array(maxId + 1), colors = Array.from({ length: 3 }, () => new Float64Array(maxId + 1));
  for (let i = 0; i < ids.length; i++) {
    count[ids[i]]++; for (let c = 0; c < 3; c++) colors[c][ids[i]] += pixels[i * 4 + c];
  }
  let stops = [{ p: 0, c: '#12235c' }, { p: 0.3, c: '#7a1f6b' }, { p: 0.55, c: '#c0392b' }, { p: 0.78, c: '#e08a1e' }, { p: 1, c: '#f6d55c' }];
  if (r.sgColorMode === 'palette' && r.sgPalette) {
    try {
      const value = JSON.parse(String(r.sgPalette));
      if (Array.isArray(value) && value.length >= 2 && value.every(v => Number.isFinite(v.p) && /^#[0-9a-f]{6}$/i.test(v.c))) stops = value;
    } catch { /* The reference falls back to its five-stop palette for malformed JSON. */ }
  }
  stops = stops.map(s => ({ p: clamp01(s.p), c: s.c })).sort((a, b) => a.p - b.p);
  for (let i = 0; i < count.length; i++) if (count[i]) {
    let color = colors.map(channel => channel[i] / count[i]);
    if (r.sgColorMode === 'palette') {
      const value = Math.round(clamp01(lumaOf(color[0], color[1], color[2]) / 255) * 63) / 63;
      let low = stops[0], high = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) if (value >= stops[s].p && value <= stops[s + 1].p) { low = stops[s]; high = stops[s + 1]; break; }
      const a = hexRgb(low.c), b = hexRgb(high.c), t = clamp01((value - low.p) / (high.p - low.p || 1));
      color = a.map((v, c) => v + (b[c] - v) * t);
    }
    const lum = lumaOf(color[0], color[1], color[2]);
    for (let c = 0; c < 3; c++) colors[c][i] = (lum + (color[c] - lum) * saturation) * glow;
  }
  const edges = new Uint8Array(w * h), out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if ((x > 0 && ids[i - 1] !== ids[i]) || (x < w - 1 && ids[i + 1] !== ids[i]) ||
      (y > 0 && ids[i - w] !== ids[i]) || (y < h - 1 && ids[i + w] !== ids[i])) {
      for (let dy = 1 - lead; dy < lead; dy++) for (let dx = 1 - lead; dx < lead; dx++) {
        if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) edges[(y + dy) * w + x + dx] = 1;
      }
    }
  }
  for (let i = 0; i < ids.length; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = edges[i] ? [12, 10, 14][c] : colors[c][ids[i]];
    out[i * 4 + 3] = 255;
  }
  putPixels(ctx, out, w, h);
}
