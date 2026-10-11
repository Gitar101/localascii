import { Recipe, RenderError } from '../recipe';
import { clamp01, contrastFactor, sampleFrame, smooth } from './context';

export function sourceCoverage(source: CanvasImageSource, w: number, h: number, r: Recipe,
  amount: number, staged: boolean, revision: string) {
  const sub = staged ? Math.max(0, 2 * amount - 1) : 1;
  if (amount <= 0 || amount >= 1) return {
    uCovCenter: [.5, .5], uCovGeometry: [1, 0, 0, 1], uCovThreshold: amount >= 1 ? -2 : 1.04, uCovSub: sub
  };
  const ratio = 128 / Math.max(w, h), cols = Math.max(2, Math.round(w * ratio)), rows = Math.max(2, Math.round(h * ratio));
  const pixels = sampleFrame(source, cols, rows, `source-coverage|${revision}`);
  if (!pixels) throw new RenderError('IMAGE_SAMPLE_FAILED', 'Could not prepare spatial effect coverage.');
  const field = new Float32Array(cols * rows), factor = contrastFactor(r.contrast);
  let cx = 0, cy = 0, weight = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x; let luma = 0;
    for (let c = 0; c < 3; c++) {
      let value = Math.max(0, Math.min(255, factor * (pixels[4 * i + c] - 128) + 128 + r.brightness * 2.55));
      if (r.invert) value = 255 - value;
      luma += value / 255 * [.299, .587, .114][c];
    }
    field[i] = luma; cx += x * luma; cy += y * luma; weight += luma;
  }
  cx = weight > 0 ? cx / weight : (cols - 1) / 2; cy = weight > 0 ? cy / weight : (rows - 1) / 2;
  const distance = Math.max(Math.hypot(cx, cy), Math.hypot(cols - 1 - cx, cy),
    Math.hypot(cx, rows - 1 - cy), Math.hypot(cols - 1 - cx, rows - 1 - cy));
  let lowRank = Infinity, highRank = -Infinity;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    field[i] = .6 * field[i] + .4 * (1 - Math.hypot(x - cx, y - cy) / distance);
    lowRank = Math.min(lowRank, field[i]); highRank = Math.max(highRank, field[i]);
  }
  const span = highRank > lowRank ? 1 / (highRank - lowRank) : 0, histogram = new Uint32Array(1024);
  for (let i = 0; i < field.length; i++) {
    field[i] = (field[i] - lowRank) * span;
    histogram[Math.max(0, Math.min(1023, Math.floor(field[i] * 1024)))]++;
  }
  let low = -.04, high = 1.04;
  const target = (staged ? Math.min(1, 2 * amount) : amount) * field.length;
  for (let step = 0; step < 24; step++) {
    const threshold = (low + high) / 2; let covered = 0;
    for (let bin = 0; bin < 1024; bin++) covered += histogram[bin] * smooth(clamp01(((bin + .5) / 1024 - threshold + .04) / .04));
    if (covered > target) low = threshold; else high = threshold;
  }
  return { uCovCenter: [(cx + .5) / cols, 1 - (cy + .5) / rows],
    uCovGeometry: [cols / rows, rows / distance, lowRank, span], uCovThreshold: (low + high) / 2, uCovSub: sub };
}

export const spatialCoverage = `
uniform vec2 uCovCenter;
uniform vec4 uCovGeometry;
uniform float uCovThreshold;
uniform float uCovSub;
float spatialGate(vec2 uv,float luma) {
  if(uCovThreshold < -1.) return 1.;
  float proximity=1.-length((uv-uCovCenter)*vec2(uCovGeometry.x,1.))*uCovGeometry.y;
  float rank=(luma*.6+proximity*.4-uCovGeometry.z)*uCovGeometry.w;
  float value=clamp((rank-uCovThreshold)*25.+1.,0.,1.);
  return value*value*(3.-2.*value);
}`;
