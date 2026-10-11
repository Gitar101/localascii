import { FxRecipe, num, str, lumaOf, clamp01, putPixels, boxBlurFloat } from './context';

export function renderHexMosaic(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const size = Math.max(4, Math.min(60, Math.round(num(r, 'hexSize', 16))));
  const flat = r.hexOrient === 'flat', root3 = Math.sqrt(3);
  const ids = new Int32Array(w * h), out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = flat ? 2 * x / (3 * size) : (root3 * x - y) / (3 * size);
    const s = flat ? (-x + root3 * y) / (3 * size) : 2 * y / (3 * size);
    const t = -q - s;
    let rq = Math.round(q), rs = Math.round(s), rt = Math.round(t);
    const dq = Math.abs(rq - q), ds = Math.abs(rs - s), dt = Math.abs(rt - t);
    if (dq > dt && dq > ds) rq = -rt - rs;
    else if (dt > ds) rt = -rq - rs;
    else rs = -rq - rt;
    const cx = flat ? 1.5 * rq * size : size * root3 * (rq + rs / 2);
    const cy = flat ? size * root3 * (rq / 2 + rs) : 1.5 * rs * size;
    const i = y * w + x, source = (Math.max(0, Math.min(h - 1, cy | 0)) * w +
      Math.max(0, Math.min(w - 1, cx | 0))) * 4;
    ids[i] = (rq + 2048) * 65536 + rs + 2048;
    out.set(pixels.subarray(source, source + 3), i * 4); out[i * 4 + 3] = 255;
  }
  const grout = clamp01(num(r, 'hexGrout', 0) / 100);
  if (grout > 0.02) {
    const edge = new Uint8Array(w * h), radius = Math.max(1, Math.round(grout * 3)) - 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((x > 0 && ids[i - 1] !== ids[i]) || (x < w - 1 && ids[i + 1] !== ids[i]) ||
        (y > 0 && ids[i - w] !== ids[i]) || (y < h - 1 && ids[i + w] !== ids[i])) {
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) edge[(y + dy) * w + x + dx] = 1;
        }
      }
    }
    const color = r.hexGroutColor === 'white' ? 255 : 0;
    for (let i = 0; i < edge.length; i++) if (edge[i]) out.fill(color, i * 4, i * 4 + 3);
  }
  putPixels(ctx, out, w, h);
}

export function renderTruchet(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const tile = Math.max(8, Math.round(Math.min(w, h) / 40 * (1 + num(r, 'trTile', 45) / 100 * 6)));
  const weight = 0.5 + num(r, 'trWeight', 30) / 100 * 0.45 * tile;
  const tone = clamp01(num(r, 'trTone', 70) / 100), style = str(r, 'trStyle', 'arcs');
  const mode = str(r, 'trColor', 'mono');
  const bg = mode === 'ink' ? [244, 240, 230] : [11, 11, 11];
  const fg = mode === 'ink' ? [22, 19, 15] : [244, 244, 244];
  ctx.save(); ctx.fillStyle = `rgb(${bg})`; ctx.fillRect(0, 0, w, h); ctx.lineCap = 'round';
  for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) {
    const color = [0, 0, 0];
    for (const [dx, dy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const index = (Math.min(h - 1, (y + dy * tile) | 0) * w + Math.min(w - 1, (x + dx * tile) | 0)) * 4;
      for (let c = 0; c < 3; c++) color[c] += pixels[index + c] / 5;
    }
    const dark = 1 - lumaOf(...color as [number, number, number]) / 255;
    const seed = 43758.5453 * Math.sin(127.1 * ((x / tile | 0) + 57.7 * (y / tile | 0)));
    const flip = seed - Math.floor(seed) < 0.5;
    const ink = mode === 'source' ? color.map(v => v | 0) : fg.map((v, c) => (v + (bg[c] - v) * tone * (1 - dark)) | 0);
    ctx.fillStyle = ctx.strokeStyle = `rgb(${ink})`;
    ctx.lineWidth = Math.max(0.4, weight * (1 + tone * (2 * dark - 1))); ctx.beginPath();
    if (style === 'triangle') {
      ctx.moveTo(flip ? x : x + tile, y); ctx.lineTo(x + tile, flip ? y : y + tile);
      ctx.lineTo(x, y + tile); ctx.closePath(); ctx.fill();
    } else if (style === 'diagonal') {
      ctx.moveTo(flip ? x : x + tile, y); ctx.lineTo(flip ? x + tile : x, y + tile); ctx.stroke();
    } else {
      ctx.arc(flip ? x : x + tile, y, tile / 2, flip ? 0 : Math.PI / 2, flip ? Math.PI / 2 : Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(flip ? x + tile : x, y + tile, tile / 2,
        flip ? Math.PI : Math.PI * 1.5, flip ? Math.PI * 1.5 : Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

const metalPalettes: Record<string, number[][]> = {
  steel: [[25, 35, 55], [210, 225, 255]], gold: [[50, 35, 8], [255, 215, 120]],
  copper: [[50, 20, 10], [245, 150, 90]], mono: [[15, 15, 18], [240, 242, 248]]
};

export function renderChrome(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const bands = Math.max(1, Math.min(20, Math.round(num(r, 'chBands', 6))));
  const radius = 1 + Math.round(num(r, 'chSmooth', 50) / 100 * 12);
  const light = num(r, 'chLight', 135) * Math.PI / 180, shine = 2 + num(r, 'chShine', 60) / 100 * 70;
  const tint = str(r, 'chTint', 'steel'), [low, high] = metalPalettes[tint] || metalPalettes.steel;
  const luminance = new Float32Array(w * h), blurred = new Float32Array(w * h);
  for (let i = 0; i < luminance.length; i++) luminance[i] = lumaOf(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]) / 255;
  boxBlurFloat(luminance, blurred, w, h, radius);
  blurred.set(luminance);
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, value = blurred[i], stripe = Math.abs(Math.sin(value * bands * Math.PI));
    const dx = blurred[y * w + Math.max(0, x - 1)] - blurred[y * w + Math.min(w - 1, x + 1)];
    const dy = blurred[Math.max(0, y - 1) * w + x] - blurred[Math.min(h - 1, y + 1) * w + x];
    const length = Math.sqrt(dx * dx + dy * dy + 0.0225), ny = dy / length;
    const specular = 255 * Math.pow(Math.max(0, dx / length * Math.cos(light) + ny * Math.sin(light)), shine);
    const diffuse = 0.4 + 0.6 * (0.55 + 0.45 * (-0.5 * ny + 0.5));
    let color = low.map((v, c) => v + (high[c] - v) * stripe);
    if (tint === 'oilslick') {
      const hue = ((320 * stripe + 90 * value) % 360) / 60, v = 0.5 + 0.5 * stripe;
      const chroma = 0.7 * v, second = chroma * (1 - Math.abs(hue % 2 - 1)), floor = v - chroma;
      const rgb = hue < 1 ? [chroma, second, 0] : hue < 2 ? [second, chroma, 0] :
        hue < 3 ? [0, chroma, second] : hue < 4 ? [0, second, chroma] : hue < 5 ? [second, 0, chroma] : [chroma, 0, second];
      color = rgb.map(c => 255 * (c + floor));
    }
    for (let c = 0; c < 3; c++) out[i * 4 + c] = color[c] * diffuse + specular;
    out[i * 4 + 3] = 255;
  }
  putPixels(ctx, out, w, h);
}

export function renderWatercolor(ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe) {
  const wash = clamp01(num(r, 'wcWash', 45) / 100), wobble = num(r, 'wcWobble', 40) / 100 * 9;
  const edgeStrength = num(r, 'wcEdge', 55) / 100, grain = num(r, 'wcGrain', 30) / 100 * 0.4;
  const pigment = 0.5 + num(r, 'wcPigment', 60) / 100, radius = Math.max(1, 2 + Math.round(6 * wash));
  const blurred = Array.from({ length: 3 }, () => new Float32Array(w * h));
  for (let c = 0; c < 3; c++) {
    const source = new Float32Array(w * h);
    for (let i = 0; i < source.length; i++) source[i] = pixels[i * 4 + c];
    boxBlurFloat(source, blurred[c], w, h, radius);
    blurred[c].set(source);
  }
  const lum = new Float32Array(w * h), edges = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = lumaOf(blurred[0][i], blurred[1][i], blurred[2][i]);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; edges[i] = Math.min(1, Math.hypot(lum[i + 1] - lum[i - 1], lum[i + w] - lum[i - w]) / 90);
  }
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = wobble * (Math.sin(0.031 * y) * Math.cos(0.011 * x) + Math.cos(0.031 * y) * Math.sin(0.011 * x) + 0.5 * Math.sin(0.07 * y + 1.3));
    const dy = wobble * (Math.cos(0.029 * x) * Math.cos(0.013 * y) - Math.sin(0.029 * x) * Math.sin(0.013 * y) + 0.5 * Math.sin(0.05 * x + 2.1));
    const sample = Math.max(0, Math.min(h - 1, (y + dy) | 0)) * w + Math.max(0, Math.min(w - 1, (x + dx) | 0));
    let hash = (0x165667b1 * x + 0x27d4eb2f * y) >>> 0;
    hash = Math.imul(hash ^ hash >>> 13, 0x4bf19f61) >>> 0;
    const gain = (1 - edges[sample] * edgeStrength) * (1 - hash / 0x100000000 * grain);
    const color = blurred.map(channel => channel[sample] * gain), grey = lumaOf(color[0], color[1], color[2]);
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = grey + (color[c] - grey) * pigment;
    out[i + 3] = 255;
  }
  putPixels(ctx, out, w, h);
}
