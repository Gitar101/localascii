import reference from '../../../research/catalog.json';
import { FxRecipe, num, str, lumaOf, hexRgb, requireCanvas } from './context';
import { hashNoise } from './blur-fx';

const palettes: Record<string, number[][] | null> = reference.ditherPalettes;
const kernels = reference.diffusionKernels as Record<string, number[][]>;
const halftone = [[24,10,12,26,35,47,49,37],[8,0,2,14,45,59,61,51],[22,6,4,16,43,57,63,53],
  [30,20,18,28,33,41,55,39],[34,46,48,36,25,11,13,27],[44,58,60,50,9,1,3,15],[42,56,62,52,23,7,5,17],[32,40,54,38,31,21,19,29]];
const bayer = (size: number): number[][] => {
  if (size === 1) return [[0]];
  const sub = bayer(size / 2), result = Array.from({ length: size }, () => new Array<number>(size));
  for (let y = 0; y < size / 2; y++) for (let x = 0; x < size / 2; x++) {
    const value = sub[y][x] * 4;
    result[y][x] = value; result[y][x + size / 2] = value + 2;
    result[y + size / 2][x] = value + 3; result[y + size / 2][x + size / 2] = value + 1;
  }
  return result;
};
const matrices: Record<string, number[][]> = { bayer2: bayer(2), bayer4: bayer(4), bayer8: bayer(8), bayer16: bayer(16), halftone };
let blue: Uint8Array | null = null;
function blueNoise() {
  if (blue) return blue;
  const source = Float32Array.from({ length: 128 * 128 }, (_, i) => hashNoise(i % 128 + 173, (i / 128 | 0) + 89));
  const high = new Float32Array(source.length); let low = Infinity, peak = -Infinity;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let average = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) average += source[((y + dy + 128) % 128) * 128 + (x + dx + 128) % 128];
    const i = y * 128 + x; high[i] = source[i] - average / 25; low = Math.min(low, high[i]); peak = Math.max(peak, high[i]);
  }
  blue = Uint8Array.from(high, v => Math.round((v - low) / (peak - low || 1) * 255));
  return blue;
}

export function renderDither(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number) {
  const block = Math.max(1, num(r, 'ditherScale', 2) | 0) * (scale > 0 ? scale : 1);
  const cols = Math.max(1, Math.round(w / block)), rows = Math.max(1, Math.round(h / block));
  const [canvas, sample] = requireCanvas(cols, rows); sample.imageSmoothingEnabled = true; sample.imageSmoothingQuality = 'high';
  sample.drawImage(source, 0, 0, cols, rows);
  const image = sample.getImageData(0, 0, cols, rows), pixels = image.data;
  const algo = str(r, 'ditherAlgo', 'floyd'), paletteName = str(r, 'ditherPalette', 'mono'), original = paletteName === 'original';
  const palette = paletteName === 'custom' && Array.isArray(r.ditherCustomPalette) && r.ditherCustomPalette.length ?
    (r.ditherCustomPalette as string[]).map(hexRgb) : palettes[paletteName] || reference.ditherPalettes.mono;
  const mode = str(r, 'ditherChromaMode', 'standard'), contrast = num(r, 'ditherContrast', 110) / 100;
  const strength = num(r, 'ditherStrength', 100) / 100, offset = (num(r, 'ditherThreshold', 50) - 50) * 2.54;
  const cell = num(r, 'ditherCellSize', 8), ox = num(r, 'ditherOffsetX', 0) | 0, oy = num(r, 'ditherOffsetY', 0) | 0;
  for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) pixels[i + c] = ((pixels[i + c] / 255 - 0.5) * contrast + 0.5) * 255;
  const nearest = (color: number[]) => {
    let result = palette[0], best = Infinity;
    for (const rgb of palette) {
      const distance = (color[0] - rgb[0]) ** 2 + (color[1] - rgb[1]) ** 2 + (color[2] - rgb[2]) ** 2;
      if (distance < best) { best = distance; result = rgb; }
    }
    return result;
  };
  const kernel = kernels[algo];
  if (!kernel) {
    const matrix = matrices[algo], period = Math.max(2, cell | 0);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4, px = x + ox, py = y + oy;
      let threshold = 128;
      if (matrix) {
        const ix = Math.floor(px / (Math.max(0.1, cell) / 8)) & (matrix.length - 1);
        const iy = Math.floor(py / (Math.max(0.1, cell) / 8)) & (matrix.length - 1);
        threshold = (matrix[iy][ix] + 0.5) / (matrix.length ** 2) * 255;
      } else if (algo === 'radial') {
        const angle = num(r, 'ditherAngle', 0) * Math.PI / 180;
        const rx = px * Math.cos(angle) - py * Math.sin(angle), ry = px * Math.sin(angle) + py * Math.cos(angle);
        threshold = Math.min(255, Math.hypot((rx % period + period) % period - period / 2,
          (ry % period + period) % period - period / 2) / (0.707 * period) * 255);
      } else if (algo.startsWith('lines')) {
        const value = algo === 'linesH' ? py : algo === 'linesV' ? px : px + py;
        threshold = (value % period + period) % period * 255 / period;
      } else if (algo === 'whiteNoise') {
        let value = (0x466f45d * px) ^ (0x127409f * py);
        value = (value ^ value >>> 13) * 0x4bf19f61; threshold = ((value ^ value >>> 16) >>> 0) & 255;
      } else if (algo === 'blueNoise') threshold = blueNoise()[(py & 127) * 128 + (px & 127)];
      threshold = Math.max(0, Math.min(255, (threshold - 128) * strength + 128 - offset));
      const color = [pixels[i], pixels[i + 1], pixels[i + 2]], lum = lumaOf(color[0], color[1], color[2]);
      let result: number[];
      if (original || mode === 'luminance') {
        const level = lum > threshold ? 255 : 0;
        result = original ? color.map(c => lum > 0.5 ? Math.min(255, c * level / lum) : level) : nearest([level, level, level]);
      } else if (mode === 'perChannel') result = color.map(c => c > threshold ? 255 : 0);
      else result = nearest(color.map(c => c + (threshold - 128) * 0.5));
      for (let c = 0; c < 3; c++) pixels[i + c] = result[c];
    }
  } else {
    const channels = Array.from({ length: 3 }, (_, c) => Float32Array.from({ length: cols * rows }, (_, i) => pixels[i * 4 + c]));
    const luminance = Float32Array.from({ length: cols * rows }, (_, i) => lumaOf(channels[0][i], channels[1][i], channels[2][i]));
    const baseLum = luminance.slice();
    if (offset) for (let i = 0; i < luminance.length; i++) { luminance[i] += offset; for (const channel of channels) channel[i] += offset; }
    for (let y = 0; y < rows; y++) {
      const direction = y & 1 ? -1 : 1;
      for (let x = direction === 1 ? 0 : cols - 1; x >= 0 && x < cols; x += direction) {
        const i = y * cols + x, color = channels.map(c => c[i]);
        if (original || mode === 'luminance') {
          const level = original ? (luminance[i] < 128 ? 0 : 255) : nearest([luminance[i], luminance[i], luminance[i]])[0];
          const error = (luminance[i] - level) * strength;
          for (let c = 0; c < 3; c++) pixels[i * 4 + c] = original && baseLum[i] > 0.5 ? Math.min(255, color[c] * level / baseLum[i]) : level;
          luminance[i] = level;
          for (const [dx, dy, gain] of kernel) {
            const nx = x + dx * direction, ny = y + dy;
            if (nx >= 0 && nx < cols && ny < rows) luminance[ny * cols + nx] += error * gain;
          }
        } else {
          const result = mode === 'perChannel' ? color.map(c => c < 128 ? 0 : 255) : nearest(color);
          for (let c = 0; c < 3; c++) {
            const error = (color[c] - result[c]) * strength;
            channels[c][i] = pixels[i * 4 + c] = result[c];
            for (const [dx, dy, gain] of kernel) {
              const nx = x + dx * direction, ny = y + dy;
              if (nx >= 0 && nx < cols && ny < rows) channels[c][ny * cols + nx] += error * gain;
            }
          }
        }
      }
    }
  }
  sample.putImageData(image, 0, 0); ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h); ctx.drawImage(canvas, 0, 0, cols, rows, 0, 0, w, h); ctx.restore();
}
