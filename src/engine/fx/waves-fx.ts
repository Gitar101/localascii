import { FxRecipe, clamp01, contrastFactor, num } from './context';

const hash3 = (x: number, y: number, z: number) => {
  let value = (0x165667b1 * x + 0x27d4eb2f * y + 0x55fdc781 * z) >>> 0;
  value = ((value ^ (value >>> 13)) * 0x4bf19f61) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
};

const tileNoise = (() => {
  const table = new Float32Array(65536);
  for (const [period, amplitude, seed] of [[2, 0.68, 71], [4, 0.32, 89]] as const) {
    const mask = period - 1, cell = 256 / period;
    for (let y = 0; y < 256; y++) {
      const gy = y / cell, iy = gy | 0; let fy = gy - iy; fy = fy * fy * (3 - 2 * fy);
      const row0 = iy & mask, row1 = (iy + 1) & mask, base = 256 * y;
      for (let x = 0; x < 256; x++) {
        const gx = x / cell, ix = gx | 0; let fx = gx - ix; fx = fx * fx * (3 - 2 * fx);
        const col0 = ix & mask, col1 = (ix + 1) & mask;
        const a = hash3(col0, row0, seed), b = hash3(col1, row0, seed), c = hash3(col0, row1, seed), d = hash3(col1, row1, seed);
        table[base + x] += amplitude * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
      }
    }
  }
  return table;
})();

const noise = (x: number, y: number) => {
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const gx = fx * 256, gy = fy * 256;
  const ix = gx | 0, iy = gy | 0;
  const tx = gx - ix, ty = gy - iy;
  const nx = (ix + 1) & 255;
  const row = (iy & 255) * 256, next = ((iy + 1) & 255) * 256;
  const col = ix & 255;
  const a = tileNoise[row + col], b = tileNoise[row + nx], c = tileNoise[next + col], d = tileNoise[next + nx];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
};

const angleOffsets = [0, 0.16, -0.22, 0.1];
const frequencies = [1.55, 1, 0.62, 0.38];
const amplitudes = [0.4, 0.116, 0.035, 0.011];
const gatePhases = [0.17, 0.53, 0.81, 0.37];

export function renderWaves(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, pixelScale: number) {
  const short = Math.min(w, h);
  const cell = Math.max(16 * (pixelScale || 1), short * num(r, 'fontSize', 11) / 132);
  const rawCoverage = num(r, 'coverage', 85) / 85;
  const cov = Math.min(1, rawCoverage);
  const sheen = num(r, 'waveSheen', 65) / 100;
  const grain = num(r, 'waveGrain', 45) / 100;
  const weave = clamp01(num(r, 'waveWeave', 0) / 100);
  const chop = (num(r, 'waveChop', 50) / 100) * 0.44;
  const angle = (num(r, 'waveAngle', 30) * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const blurRadius = Math.min(1.5, Math.max(0.3, 0.008 * cell)) * cov;

  const plate = document.createElement('canvas');
  plate.width = w; plate.height = h;
  const pc = plate.getContext('2d', { willReadFrequently: true })!;
  pc.filter = blurRadius >= 0.05 ? `blur(${blurRadius.toFixed(1)}px)` : 'none';
  pc.clearRect(0, 0, w, h);
  pc.drawImage(source, 0, 0, w, h);
  pc.filter = 'none';
  const pixels = pc.getImageData(0, 0, w, h).data;
  let opaque = true;
  for (let i = 3; i < pixels.length; i += 4) {
    const alpha = pixels[i];
    if (alpha !== 255) {
      opaque = false;
      if (alpha === 0) { pixels[i - 3] = 0; pixels[i - 2] = 0; pixels[i - 1] = 0; }
      else {
        const scale = alpha / 255;
        pixels[i - 3] *= scale; pixels[i - 2] *= scale; pixels[i - 1] *= scale;
      }
    }
  }

  const step = Math.max(1, Math.min(8, Math.round(cell / 18)));
  const cols = Math.ceil(w / step) + 1, rows = Math.ceil(h / step) + 1;
  const field = new Float32Array(cols * rows), gradX = new Float32Array(cols * rows), gradY = new Float32Array(cols * rows);
  const inv = 1 / cell;
  const drift = Math.min(0.12, 0.09 * rawCoverage + 0.03);
  const octaves = weave > 0 ? 5 : 4;
  const fx = new Float64Array(5), fy = new Float64Array(5), amp = new Float64Array(5), gate = new Float64Array(5);
  for (let e = 0; e < 4; e++) {
    const direction = angle + angleOffsets[e], frequency = inv / frequencies[e];
    fx[e] = Math.cos(direction) * frequency;
    fy[e] = Math.sin(direction) * frequency;
    amp[e] = 1.25 * amplitudes[e];
    gate[e] = gatePhases[e];
  }
  if (weave > 0) {
    const weaveAngle = angle + (64 * Math.PI) / 180;
    const weaveCos = Math.cos(weaveAngle), weaveSin = Math.sin(weaveAngle);
    fx[4] = weaveCos * inv; fy[4] = weaveSin * inv;
    amp[4] = 0.3 * weave * 1.25;
    gate[4] = 0;
  }
  const weaveFade = 1 / (1 + 0.55 * weave);
  const tau = Math.PI * 2;

  for (let row = 0; row < rows; row++) {
    const y = row * step, base = row * cols;
    const rotY = y * sin * inv, strY = y * cos * inv;
    for (let col = 0; col < cols; col++) {
      const x = col * step;
      const straight = x * cos * inv + rotY, cross = strY - x * sin * inv;
      const driftNoise = noise(0.045 * cross + 0.31, 0.018 * straight + 0.11);
      const swell = 1 + 0.3 * noise(0.05 * cross + 0.73, 0.02 * straight + 0.57);
      let height = 0;
      for (let e = 0; e < octaves; e++) {
        const phase = x * fx[e] + y * fy[e] + driftNoise * drift;
        let amplitude = amp[e];
        if (gate[e] !== 0) {
          let value = (noise(0.03 * straight + gate[e], 0.05 * cross + 1.7 * gate[e]) + 0.22) * 4.5;
          value = value < 0 ? 0 : value > 1 ? 1 : value;
          amplitude *= 0.4 + 0.6 * value * value * (3 - 2 * value);
          if (amplitude === 0) continue;
        }
        const wave = Math.sin(tau * phase);
        height += amplitude * (wave + chop * wave * wave);
      }
      field[base + col] = 0.5 + height * swell * weaveFade;
    }
  }

  const half = cell / (2 * step);
  for (let row = 0; row < rows; row++) {
    const base = row * cols;
    const above = row > 0 ? base - cols : base, below = row < rows - 1 ? base + cols : base;
    const rowStep = below - above === 2 * cols ? half : 2 * half;
    for (let col = 0; col < cols; col++) {
      const left = col > 0 ? col - 1 : col, right = col < cols - 1 ? col + 1 : col;
      const colStep = right - left === 2 ? half : 2 * half;
      gradX[base + col] = (field[base + right] - field[base + left]) * colStep;
      gradY[base + col] = (field[below + col] - field[above + col]) * rowStep;
    }
  }

  const out = new ImageData(w, h);
  const data = out.data;
  const contrast = contrastFactor(0.3 * (r.contrast ?? 100));
  const brightness = (r.brightness ?? 0) / 100 * 255;
  const keepColor = num(r, 'grayscale', 0) < 100;
  const invert = r.invert;
  const border = Math.min(0.09 * cell, 0.009 * short) * rawCoverage;
  const invBorder = 1 / Math.max(4, border);
  const lx1 = -0.55, ly1 = -0.45, lz1 = 0.72;
  const mag1 = Math.sqrt(lx1 * lx1 + ly1 * ly1 + lz1 * lz1);
  const dx1 = lx1 / mag1, dy1 = ly1 / mag1, dz1 = lz1 / mag1;
  const mag2 = Math.sqrt(dx1 * dx1 + dy1 * dy1 + (dz1 + 1) * (dz1 + 1));
  const lx2 = dx1 / mag2, ly2 = dy1 / mag2, lz2 = (dz1 + 1) / mag2;
  const specWide = 45 * sheen * cov, specNarrow = 12 * sheen * cov;
  const baseLight = 1 - 0.1 * cov;
  const bounce = 0.2 * cov;
  const grainScale = (6 * grain * cov * 2) / 254;
  const grainField = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowBase = y * w, noiseY = 0.007 * y + 0.71;
    for (let x = 0; x < w; x++) grainField[rowBase + x] = 254 * noise(0.007 * x + 0.13, noiseY);
  }
  const edgeX = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const distance = (x < w - 1 - x ? x : w - 1 - x) * invBorder;
    edgeX[x] = distance >= 1 ? 1 : distance * distance * (3 - 2 * distance);
  }
  const maxX = w - 1.001, maxY = h - 1.001, stride = 4 * w;
  const sample = (px: number, py: number, channel: number) => {
    const ix = px | 0, iy = py | 0;
    const tx = px - ix, ty = py - iy;
    const base = (iy * w + ix) * 4, next = base + stride;
    const near = pixels[base + channel];
    const top = near + (pixels[base + 4 + channel] - near) * tx;
    const bottom = pixels[next + channel] + (pixels[next + 4 + channel] - pixels[next + channel]) * tx;
    return top + (bottom - top) * ty;
  };

  for (let row = 0; row < rows - 1; row++) {
    const base = row * cols, next = base + cols;
    for (let sy = 0; sy < step; sy++) {
      const y = row * step + sy;
      if (y >= h) break;
      const ty = sy / step;
      const edgeRaw = (y < h - 1 - y ? y : h - 1 - y) * invBorder;
      const fadeY = edgeRaw >= 1 ? 1 : edgeRaw * edgeRaw * (3 - 2 * edgeRaw);
      const fade = border * fadeY;
      for (let col = 0; col < cols - 1; col++) {
        const x0 = col * step;
        if (x0 >= w) break;
        const ex00 = gradX[base + col], ex10 = gradX[base + col + 1];
        const gxLow = ex00 + (ex10 - ex00) * ty;
        const gxHigh = ex10 + (gradX[next + col + 1] - ex10) * ty;
        const gxSpan = gxHigh - gxLow;
        const ey00 = gradY[base + col];
        const gyLow = ey00 + (gradY[next + col] - ey00) * ty;
        const ey10 = gradY[base + col + 1];
        const gyHigh = ey10 + (gradY[next + col + 1] - ey10) * ty;
        const gySpan = gyHigh - gyLow;
        for (let sx = 0; sx < step; sx++) {
          const x = x0 + sx;
          if (x >= w) break;
          const tx = sx / step;
          const gx = gxLow + gxSpan * tx;
          const gy = gyLow + gySpan * tx;
          const v = fade * edgeX[x];
          const ox = gx * v, oy = gy * v;
          const px = x + ox < 0 ? 0 : x + ox > maxX ? maxX : x + ox;
          const py = y + oy < 0 ? 0 : y + oy > maxY ? maxY : y + oy;
          const u = (y * w + x) * 4;
          let alpha: number;
          if (opaque) alpha = 255;
          else {
            alpha = sample(px, py, 3);
            if (alpha < 1) { data[u] = 0; data[u + 1] = 0; data[u + 2] = 0; data[u + 3] = 0; continue; }
          }
          let red = sample(px, py, 0);
          let green = sample(px, py, 1);
          let blue = sample(px, py, 2);
          if ((0.035 * ox) * (0.035 * ox) + (0.035 * oy) * (0.035 * oy) >= 0.0625) {
            const rx = x + 1.035 * ox < 0 ? 0 : x + 1.035 * ox > maxX ? maxX : x + 1.035 * ox;
            const ry = y + 1.035 * oy < 0 ? 0 : y + 1.035 * oy > maxY ? maxY : y + 1.035 * oy;
            red = sample(rx, ry, 0);
            const bx = x + 0.965 * ox < 0 ? 0 : x + 0.965 * ox > maxX ? maxX : x + 0.965 * ox;
            const by = y + 0.965 * oy < 0 ? 0 : y + 0.965 * oy > maxY ? maxY : y + 0.965 * oy;
            blue = sample(bx, by, 2);
          }
          if (!opaque) {
            const scale = 255 / alpha;
            red = Math.min(255, red * scale);
            green = Math.min(255, green * scale);
            blue = Math.min(255, blue * scale);
          }
          red = contrast * (red - 128) + 128 + brightness;
          let greenGraded = contrast * (green - 128) + 128 + brightness;
          blue = contrast * (blue - 128) + 128 + brightness;
          if (!keepColor) {
            const lum = 0.299 * red + 0.587 * greenGraded + 0.114 * blue;
            red = greenGraded = blue = lum;
          }
          if (invert) { red = 255 - red; greenGraded = 255 - greenGraded; blue = 255 - blue; }
          const invSlope = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          const facing = (dz1 - gx * dx1 - gy * dy1) * invSlope;
          const shade = facing > 0 ? baseLight + bounce * facing : baseLight;
          let highlight = 0;
          const halfVector = (lz2 - gx * lx2 - gy * ly2) * invSlope;
          if (halfVector > 0.35) {
            const square = halfVector * halfVector, fourth = square * square, eighth = fourth * fourth;
            let luminance = (1 / 140) * (0.299 * red + 0.587 * greenGraded + 0.114 * blue);
            if (luminance > 1) luminance = 1;
            const smoothLum = luminance * luminance * (3 - 2 * luminance);
            highlight = (eighth * eighth * specWide + fourth * specNarrow) * (0.15 + 0.85 * smoothLum);
          }
          const alphaScale = opaque ? 1 : alpha / 255;
          const noiseAdd = grainField[y * w + x] * grainScale * alphaScale;
          const specular = highlight * alphaScale;
          data[u] = red * shade + specular * (1 - red / 255) + noiseAdd;
          data[u + 1] = greenGraded * shade + specular * (1 - greenGraded / 255) + noiseAdd;
          data[u + 2] = blue * shade + specular * (1 - blue / 255) + noiseAdd;
          data[u + 3] = alpha;
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}