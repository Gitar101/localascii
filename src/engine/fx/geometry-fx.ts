import { FxRecipe, num, str, lumaOf, clamp01 } from './context';

const random = (seed: number) => {
  const value = 43758.5453 * Math.sin(127.1 * seed);
  return value - Math.floor(value);
};
const seeded = (seed: number) => () => {
  seed = seed + 0x6d2b79f5 | 0;
  let value = Math.imul(seed ^ seed >>> 15, seed | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 0x100000000;
};

export function renderFlowField(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const count = Math.max(200, Math.min(6000, Math.round(num(r, 'ffDensity', 1800))));
  const length = Math.max(4, Math.min(120, Math.round(num(r, 'ffLength', 34))));
  const weight = Math.max(0.4, num(r, 'ffWeight', 30) / 100 * 3.5);
  const swirl = num(r, 'ffSwirl', 0) / 100 * Math.PI / 2, mode = str(r, 'ffColor', 'source');
  const lum = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const magnitude = new Float32Array(w * h); let peak = 0.001;
  for (let i = 0; i < lum.length; i++) lum[i] = lumaOf(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    gx[i] = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
    gy[i] = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
    magnitude[i] = Math.hypot(gx[i], gy[i]); peak = Math.max(peak, magnitude[i]);
  }
  const frequency = 2.5 / Math.min(w, h), cols = Math.ceil(w * frequency * 18) + 2, rows = Math.ceil(h * frequency * 18) + 2;
  const noiseX = new Float32Array(cols * rows), noiseY = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = x / 18, py = y / 18, ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = random(ix + 57.7 * iy), b = random(ix + 1 + 57.7 * iy), c = random(ix + 57.7 * (iy + 1));
    const angle = (a + (b - a) * sx + (c - a) * sy + (a - b - c + random(ix + 1 + 57.7 * (iy + 1))) * sx * sy) * 2 * Math.PI;
    noiseX[y * cols + x] = Math.cos(angle); noiseY[y * cols + x] = Math.sin(angle);
  }
  const interpolate = (grid: Float32Array, x: number, y: number) => {
    const px = Math.min(cols - 1.001, Math.max(0, x * 18)), py = Math.min(rows - 1.001, Math.max(0, y * 18));
    const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy, i = iy * cols + ix;
    const a = grid[i], b = grid[i + 1], c = grid[i + cols];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + grid[i + cols + 1]) * fx * fy;
  };
  const fieldX = new Float32Array(w * h), fieldY = new Float32Array(w * h), cs = Math.cos(swirl), sn = Math.sin(swirl);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, norm = Math.hypot(gx[i], gy[i]) || 1, blend = Math.min(1, magnitude[i] / peak * 6);
    const dx = (1 - blend) * interpolate(noiseX, x * frequency, y * frequency) - blend * gy[i] / norm;
    const dy = (1 - blend) * interpolate(noiseY, x * frequency, y * frequency) + blend * gx[i] / norm;
    const size = Math.hypot(dx, dy) || 1;
    fieldX[i] = (dx * cs - dy * sn) / size; fieldY[i] = (dx * sn + dy * cs) / size;
  }
  const rng = seeded(0x9e3779b1 * count >>> 0 || 1), spacing = Math.max(3, Math.sqrt(w * h / count));
  ctx.save(); ctx.fillStyle = mode === 'ink' ? '#efe9dc' : mode === 'mono' ? '#0b0b0e' : '#0d0d12';
  ctx.fillRect(0, 0, w, h); ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = weight; ctx.globalAlpha = 0.82;
  for (let y = spacing / 2; y < h; y += spacing) for (let x = spacing / 2; x < w; x += spacing) {
    let px = x + (rng() - 0.5) * spacing, py = y + (rng() - 0.5) * spacing;
    if (px < 0 || px >= w || py < 0 || py >= h) continue;
    const i = (py | 0) * w + (px | 0), color = pixels.subarray(i * 4, i * 4 + 3);
    ctx.strokeStyle = mode === 'ink' ? '#14110d' : mode === 'mono' ? '#f2f2f6' : `rgb(${Array.from(color)})`;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let step = 0; step < length; step++) {
      const index = (py | 0) * w + (px | 0); px += 1.4 * fieldX[index]; py += 1.4 * fieldY[index];
      if (px < 0 || px >= w || py < 0 || py >= h) break;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function renderIsoExtrude(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const cols = Math.max(12, Math.min(110, Math.round(88 - num(r, 'ceCell', 55) / 100 * 72)));
  const rows = Math.max(6, Math.round(cols * h / w)), elevation = 6 * num(r, 'ceHeight', 55) / 100;
  const half = 0.5 * (1 - Math.min(0.6, num(r, 'ceGap', 12) / 100 * 0.6));
  const light = clamp01(num(r, 'ceLight', 55) / 100), mode = str(r, 'ceColor', 'source');
  const yaw = num(r, 'ceRotate', 45) * Math.PI / 180, pitch = Math.max(6, Math.min(89, num(r, 'cePitch', 32))) * Math.PI / 180;
  const zoom = Math.max(0.35, Math.min(3, num(r, 'ceZoom', 100) / 100));
  const cx = (cols - 1) / 2, cz = (rows - 1) / 2;
  const rotate = (x: number, y: number, z: number) => {
    const depth = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [x * Math.cos(yaw) + z * Math.sin(yaw), y * Math.cos(pitch) - depth * Math.sin(pitch), y * Math.sin(pitch) + depth * Math.cos(pitch)];
  };
  const bounds = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const point = rotate(corner & 1 ? cx : -cx, corner & 4 ? elevation : 0, corner & 2 ? cz : -cz);
    for (let c = 0; c < 3; c++) { bounds[c * 2] = Math.min(bounds[c * 2], point[c]); bounds[c * 2 + 1] = Math.max(bounds[c * 2 + 1], point[c]); }
  }
  const center = [0, 1, 2].map(c => (bounds[c * 2] + bounds[c * 2 + 1]) / 2);
  const fit = Math.min(w * 0.92 / Math.max(0.001, bounds[1] - bounds[0]), h * 0.92 / Math.max(0.001, bounds[3] - bounds[2])) * zoom;
  const distance = (bounds[5] - bounds[4]) * 1.7 + 0.001;
  const project = (point: number[]) => {
    const perspective = r.ceProject === 'persp' ? Math.max(0.4, Math.min(2.4, distance / (distance + point[2] - center[2]))) : 1;
    return [w * num(r, 'ceOffX', 50) / 100 + (point[0] - center[0]) * perspective * fit,
      h * num(r, 'ceOffY', 50) / 100 - (point[1] - center[1]) * perspective * fit];
  };
  const shade = (x: number, y: number, z: number) => Math.max(0.16, Math.min(1.08,
    0.62 - 0.12 * light + (0.5 + 0.4 * light) * (-0.427 * x + 0.854 * y - 0.299 * z)));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], normals = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const cells: { depth: number; faces: { points: number[][]; depth: number; color: number[] }[] }[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let color = [0, 0, 0];
    for (const [dx, dy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const i = (Math.min(h - 1, ((y + dy) * h / rows) | 0) * w + Math.min(w - 1, ((x + dx) * w / cols) | 0)) * 4;
      for (let c = 0; c < 3; c++) color[c] += pixels[i + c] / 5;
    }
    const value = lumaOf(color[0], color[1], color[2]) / 255, height = elevation * value;
    if (mode === 'mono') color = [value * 255, value * 255, value * 255];
    if (mode === 'heat') color = [clamp01(1.6 * value - 0.5), clamp01(1 - 2.2 * Math.abs(value - 0.5)), clamp01(1.4 - 2.4 * value)].map(v => v * 255);
    const top = corners.map(([dx, dz]) => project(rotate(x - cx + dx * half, height, y - cz + dz * half)));
    const bottom = corners.map(([dx, dz]) => project(rotate(x - cx + dx * half, 0, y - cz + dz * half)));
    const faces = [];
    if (height > 0.001) for (let c = 0; c < 4; c++) {
      const next = (c + 1) % 4, n = normals[c];
      const depth = (rotate(x - cx + corners[c][0] * half, height / 2, y - cz + corners[c][1] * half)[2] +
        rotate(x - cx + corners[next][0] * half, height / 2, y - cz + corners[next][1] * half)[2]) / 2;
      faces.push({ points: [top[c], top[next], bottom[next], bottom[c]], depth, color: color.map(v => v * shade(n[0], n[1], n[2])) });
    }
    faces.sort((a, b) => a.depth - b.depth);
    faces.push({ points: top, depth: Infinity, color: color.map(v => v * shade(0, 1, 0)) });
    cells.push({ depth: rotate(x - cx, 0, y - cz)[2], faces });
  }
  cells.sort((a, b) => a.depth - b.depth);
  ctx.save(); ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, w, h); ctx.lineJoin = 'round';
  for (const cell of cells) for (const face of cell.faces) {
    ctx.fillStyle = `rgb(${face.color.map(v => v | 0)})`; ctx.beginPath(); ctx.moveTo(face.points[0][0], face.points[0][1]);
    for (const point of face.points.slice(1)) ctx.lineTo(point[0], point[1]);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
