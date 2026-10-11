import { FxRecipe, clamp01, contrastFactor, lumaOf, num, str } from './context';

const noise = (seed: number) => {
  let h = (0x9e3779b1 * seed) >>> 0; h ^= h >>> 13; h = (0x4bf19f61 * h) >>> 0;
  return (h ^ (h >>> 16)) / 0x100000000;
};
const regular = (sides: number, radius: number, angle = -Math.PI / 2) => Float32Array.from(
  Array.from({ length: sides * 2 }, (_, i) => {
    const a = angle + Math.floor(i / 2) / sides * 2 * Math.PI;
    return (i % 2 ? Math.sin(a) : Math.cos(a)) * radius;
  }));
const shapes: Record<string, Float32Array> = {
  triangle: regular(3, 1.55), square: regular(4, 1.25, -Math.PI / 4), diamond: regular(4, 1.25), hexagon: regular(6, 1.1),
  cross: Float32Array.from([.36,.36,.36,1,-.36,1,-.36,.36,-1,.36,-1,-.36,-.36,-.36,-.36,-1,.36,-1,.36,-.36,1,-.36,1,.36], x => x * 1.25),
  star: Float32Array.from(Array.from({ length: 20 }, (_, i) => {
    const vertex = Math.floor(i / 2), angle = -Math.PI / 2 + vertex / 10 * 2 * Math.PI;
    return (i % 2 ? Math.sin(angle) : Math.cos(angle)) * (vertex % 2 ? .62 : 1.45);
  }))
};

export function renderStippling(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number) {
  const pitch = Math.max(3, .85 * (num(r, 'fontSize', 11) || 11) * scale);
  const count = Math.min(140000, Math.ceil(w * h / (pitch * pitch)));
  const sampling = document.createElement('canvas'); sampling.width = w; sampling.height = h;
  const sc = sampling.getContext('2d', { willReadFrequently: true })!;
  sc.filter = `blur(${Math.max(1, Math.round(pitch / 4))}px)`; sc.drawImage(source, 0, 0, w, h);
  const pixels = sc.getImageData(0, 0, w, h).data, luminance = new Float32Array(w * h);
  const factor = contrastFactor(r.contrast), offset = r.brightness * 2.55;
  for (let i = 0; i < luminance.length; i++) {
    const rgb = [0, 1, 2].map(c => Math.max(0, Math.min(255, factor * (pixels[i * 4 + c] - 128) + 128 + offset)));
    const luma = lumaOf(rgb[0], rgb[1], rgb[2]) / 255; luminance[i] = r.invert ? 1 - luma : luma;
  }
  const ink = document.createElement('canvas'); ink.width = w; ink.height = h;
  const ic = ink.getContext('2d')!, colored = num(r, 'grayscale', 0) < 100;
  ic.fillStyle = colored ? '#000000' : r.invert ? '#ece5d6' : '#211c15'; ic.beginPath();
  const density = r.coverage / 85, edge = num(r, 'edgeEmphasis', 0) / 100 * 2.2;
  const edgeStep = Math.max(1, Math.round(pitch / 3)), baseRadius = .36 * pitch * ((num(r, 'stippleDotSize', 100) || 100) / 100);
  const jitter = num(r, 'stippleSizeJitter', 30) / 100, shape = str(r, 'stippleShape', 'circle'), polygon = shapes[shape];
  let batch = 0;
  for (let i = 0; i < count; i++) {
    let x = ((.5 + (i + 1) * .7548776662466927) % 1) * w + (noise(2 * i + 11) - .5) * .55 * pitch;
    let y = ((.5 + (i + 1) * .5698402909980532) % 1) * h + (noise(2 * i + 12) - .5) * .55 * pitch;
    if (x < 0) x += w; else if (x >= w) x -= w;
    if (y < 0) y += h; else if (y >= h) y -= h;
    x = Math.fround(x); y = Math.fround(y);
    const px = Math.min(w - 1, Math.max(0, x | 0)), py = Math.min(h - 1, Math.max(0, y | 0));
    let darkness = 1 - luminance[py * w + px];
    if (edge > 0) {
      const dx = luminance[py * w + Math.min(w - 1, px + edgeStep)] - luminance[py * w + Math.max(0, px - edgeStep)];
      const dy = luminance[Math.min(h - 1, py + edgeStep) * w + px] - luminance[Math.max(0, py - edgeStep) * w + px];
      darkness += edge * Math.hypot(dx, dy);
    }
    darkness = clamp01(darkness);
    if (darkness <= 0 || (i + .5) / count >= Math.pow(darkness, 1.5) * density) continue;
    const radius = Math.fround(baseRadius * (.55 + .55 * darkness) * (1 + (Math.fround(noise(5 * i + 3)) - .5) * .9 * jitter));
    if (polygon) {
      const angle = Math.fround(Math.fround(noise(3 * i + 7)) * 2 * Math.PI), c = Math.cos(angle), s = Math.sin(angle);
      for (let j = 0; j < polygon.length; j += 2) {
        const vx = polygon[j] * radius, vy = polygon[j + 1] * radius;
        if (j === 0) ic.moveTo(x + vx * c - vy * s, y + vx * s + vy * c); else ic.lineTo(x + vx * c - vy * s, y + vx * s + vy * c);
      }
      ic.closePath();
    } else if (shape === 'ring') {
      ic.moveTo(x + radius * 1.25, y); ic.arc(x, y, radius * 1.25, 0, 2 * Math.PI);
      ic.moveTo(x + radius * .75, y); ic.arc(x, y, radius * .75, 0, 2 * Math.PI, true);
    } else { ic.moveTo(x + radius, y); ic.arc(x, y, radius, 0, 2 * Math.PI); }
    if (++batch >= 4000) { ic.fill(); ic.beginPath(); batch = 0; }
  }
  if (batch) ic.fill();
  if (colored) { ic.globalCompositeOperation = 'source-in'; ic.filter = 'saturate(140%) brightness(92%)'; ic.drawImage(source, 0, 0, w, h); }
  const paper = clamp01(density);
  if (paper < 1) ctx.drawImage(source, 0, 0, w, h);
  ctx.globalAlpha = paper; ctx.fillStyle = r.invert ? '#14110d' : '#f5f0e6'; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1; ctx.drawImage(ink, 0, 0);
}
