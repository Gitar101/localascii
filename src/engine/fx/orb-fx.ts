import { FxRecipe, num, putPixels, bilinearChannel } from './context';

export function renderGlassOrb(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) {
  const cx = w * num(r, 'orbX', 50) / 100, cy = h * num(r, 'orbY', 50) / 100;
  const size = num(r, 'orbSize', 55) / 100, base = Math.min(w, h) * (0.18 + 0.34 * size);
  const growth = Math.max(0, (size - 0.55) / 0.45);
  const radius = base + Math.max(0, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.03 - base) * growth * growth;
  const refraction = num(r, 'orbRefraction', 55) / 100, chroma = num(r, 'orbChroma', 80) / 100;
  const rim = 0.4 + 0.9 * num(r, 'orbRim', 60) / 100, dim = 1 - 0.36 * coverage;
  const out = new Uint8ClampedArray(pixels.length), shadowX = cx + radius * 0.05, shadowY = cy + radius * 0.05;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = (x - cx) / radius, py = (y - cy) / radius, distance = px * px + py * py;
    const theta = Math.atan2(py, px), boundary = 1 + 0.01 * Math.sin(4 * theta) + 0.006 * Math.cos(7 * theta);
    const inside = distance <= (1 - 0.0165) ** 2 || (distance < (1 + 0.0165) ** 2 && distance <= boundary * boundary);
    const i = (y * w + x) * 4;
    if (inside) {
      const d = Math.min(1, distance), nz = Math.sqrt(1 - d);
      const rippleX = 0.6 * Math.sin(9 * px) + 0.4 * Math.cos(6 * py) + 0.3 * Math.sin(5 * px - 5 * py);
      const rippleY = 0.6 * Math.cos(9 * py) + 0.4 * Math.sin(6 * px) + 0.3 * Math.cos(5 * px + 5 * py);
      const nx = px + rippleX * 0.2 * refraction, ny = py + rippleY * 0.2 * refraction;
      const norm = Math.hypot(nx, ny, nz) || 1, normalX = nx / norm, normalY = ny / norm, normalZ = nz / norm;
      const reflectedX = 2 * normalZ * normalX, reflectedY = 2 * normalZ * normalY;
      const reach = radius * (0.9 + 0.6 * refraction) * coverage;
      const sx = cx * coverage + x * (1 - coverage) + reflectedX * reach;
      const sy = cy * coverage + y * (1 - coverage) + reflectedY * reach;
      const dispersion = chroma * radius * 0.34 * coverage * d;
      const light = Math.max(0, normalX * -0.3 / Math.sqrt(0.45) + normalY * -0.6 / Math.sqrt(0.45) + normalZ * 0.74);
      const glow = (light ** 6 * 0.32 + (1 - normalZ) ** 3 * rim) * 255 * coverage;
      for (let c = 0; c < 3; c++) {
        const shift = c === 0 ? dispersion : c === 2 ? -dispersion : 0;
        const color = bilinearChannel(pixels, w, h, sx + reflectedX * shift, sy + reflectedY * shift, c);
        const offset = c === 1 ? 2 * coverage : c === 2 ? 12 * coverage : 0;
        out[i + c] = (color - 128) * (1 + 0.35 * coverage) + 128 + offset + glow;
      }
    } else {
      const shadow = ((x - shadowX) / radius) ** 2 + ((y - shadowY) / radius) ** 2;
      let gain = dim;
      if (shadow < 1.3225) gain *= 1 - 0.5 * coverage * (shadow > 1 ? Math.max(0, (1.15 - Math.sqrt(shadow)) / 0.15) : 1);
      for (let c = 0; c < 3; c++) out[i + c] = pixels[i + c] * gain;
    }
    out[i + 3] = 255;
  }
  putPixels(ctx, out, w, h);
}
