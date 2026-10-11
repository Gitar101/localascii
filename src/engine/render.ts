import { Recipe, RenderError, RenderRequest, RenderResult, renderRequestSchema, gpuImageModes,
  colorModes, implementedModes, implementedProModes, parseRecipe } from './recipe';
import { FrameRequest, FrameResult } from './media-recipe';
import { inspectImage, validateDimensions } from './image';
import { GlyphBatch } from './glyphs';
import { WarpFilter } from './warp';
import { ColorFilter } from './color';
import { ProFilter } from './fx/dispatch';

const ramps: Record<string, string> = { 'block-chars': '\u2588\u2593\u2592\u2591 ',
  lines: '\u258c\u258d\u258e\u258f', diagonal: '\u2573\u2572\u27cd\\\u22f1',
  cross: '\u254b\u253c+\u00d7 ', diamond: '\u2b25\u25c6\u25c7\u22c4 ' };
const mixed = ['\u2592\u2591\u00b7', '\u2551\u2503\u2502\u250a', '\u2573\u2572\u27cd\u22f1',
  '\u254b\u271a\u253c+', '\u25c6\u2b25\u25c7\u22c4'];
const bitmaps: Record<string, number> = { ' ': 0, '.': 128, ':': 131200, '-': 14336,
  '=': 459200, '+': 4357252, '*': 4897444, '#': 0xafabea, '@': 0xefefee };
const clamp = (n: number, max = 1) => Math.max(0, Math.min(max, n));
const rgba = (rgb: number[], alpha: number) => `rgba(${rgb.map(Math.round).join(',')},${alpha})`;
const luma = (pixels: Uint8ClampedArray, index: number) =>
  0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];

export class Renderer {
  readonly output = document.createElement('canvas');
  private sampling = document.createElement('canvas');
  private source: HTMLImageElement | HTMLCanvasElement | null = null;
  private glyphs: GlyphBatch | null = null;
  private warp: WarpFilter | null = null;
  private color: ColorFilter | null = null;
  private pro: ProFilter | null = null;
  private sourceRevision = 0;
  private frame = document.createElement('canvas');
  private imageKey = '';
  private queue: Promise<unknown> = Promise.resolve();

  render(input: RenderRequest): Promise<RenderResult> {
    const task = this.queue.then(() => this.perform(input));
    this.queue = task.catch(() => undefined);
    return task;
  }

  renderSource(source: CanvasImageSource, width: number, height: number, recipe: unknown): Promise<void> {
    const task = this.queue.then(() => {
      const r = parseRecipe(recipe);
      this.validateRecipe(r);
      validateDimensions(width, height);
      this.sampling.width = width; this.sampling.height = height;
      this.sampling.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, width, height);
      this.source = this.sampling; this.imageKey = ''; this.sourceRevision++;
      this.draw(r, 1);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  renderFrame(input: FrameRequest): Promise<FrameResult> {
    const task = this.queue.then(() => {
      const r = parseRecipe(input.recipe);
      this.validateRecipe(r);
      validateDimensions(input.width, input.height);
      const length = input.width * input.height * 4;
      if (typeof input.data !== 'string' || input.data.length !== Math.ceil(length / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) {
        throw new RenderError('INVALID_FRAME', 'Invalid raw RGBA frame.');
      }
      const binary = atob(input.data);
      if (binary.length !== length) throw new RenderError('INVALID_FRAME', 'Raw frame size does not match dimensions.');
      this.sampling.width = input.width; this.sampling.height = input.height;
      this.sampling.getContext('2d', { willReadFrequently: true })!.putImageData(
        new ImageData(Uint8ClampedArray.from(binary, c => c.charCodeAt(0)), input.width, input.height), 0, 0);
      this.source = this.sampling; this.imageKey = ''; this.sourceRevision++;
      this.draw(r, 1);
      const pixels = this.output.getContext('2d')!.getImageData(0, 0, input.width, input.height).data;
      const chunks: string[] = [];
      for (let p = 0; p < pixels.length; p += 16384) chunks.push(String.fromCharCode(...pixels.subarray(p, p + 16384)));
      return { data: btoa(chunks.join('')), width: input.width, height: input.height };
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private validateRecipe(r: Recipe) {
    if (!(implementedModes as readonly string[]).includes(r.renderMode)) {
      throw new RenderError('INVALID_MODE', `${r.renderMode} is not implemented locally yet.`);
    }
    if (r.animated) throw new RenderError('INVALID_REQUEST', 'Effect animation is not supported yet; media frames can still be filtered.');
  }

  private async perform(input: RenderRequest): Promise<RenderResult> {
    const parsed = renderRequestSchema.safeParse(input);
    if (!parsed.success) throw new RenderError('INVALID_REQUEST', parsed.error.message);
    const { image, recipe: r, scale } = parsed.data;
    this.validateRecipe(r);
    const started = performance.now();
    if (image !== this.imageKey) {
      const header = inspectImage(image);
      const next = new Image();
      try { next.src = image; await next.decode(); }
      catch { throw new RenderError('IMAGE_DECODE_FAILED', 'The image could not be decoded.'); }
      validateDimensions(next.width, next.height);
      this.source = next; this.imageKey = image;
      this.sourceRevision++;
      this.sampling.width = next.width; this.sampling.height = next.height;
      this.sampling.getContext('2d', { willReadFrequently: true })!.drawImage(next, 0, 0, next.width, next.height);
    }
    this.draw(r, scale);
    return { image: this.output.toDataURL('image/png'), width: this.output.width, height: this.output.height,
      recipe: r, renderMs: performance.now() - started, parity: 'unverified' };
  }

  private draw(r: Recipe, scale: number) {
    const source = this.source!;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    validateDimensions(width, height);
    this.output.width = width; this.output.height = height;
    const ctx = this.output.getContext('2d');
    if (!ctx) throw new RenderError('CANVAS_UNAVAILABLE', 'Canvas 2D is unavailable.');
    if (r.bgMode === 'solid') { ctx.fillStyle = r.bgSolidColor; ctx.fillRect(0, 0, width, height); }
    else if (r.bgMode !== 'none') {
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = r.bgOpacity / 100;
      ctx.filter = r.bgMode === 'blur' && r.bgBlur > 0 ? `blur(${r.bgBlur}px)` : 'none';
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source, 0, 0, width, height);
      ctx.globalAlpha = 1; ctx.filter = 'none';
    }
    const solidBlend = r.bgMode === 'solid' && r.blendMode !== 'source-over';
    if (solidBlend) ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = r.blendMode;
    if (gpuImageModes.includes(r.renderMode as typeof gpuImageModes[number])) {
      this.frame.width = width; this.frame.height = height;
      this.frame.getContext('2d')!.drawImage(source, 0, 0, width, height);
      ctx.globalCompositeOperation = 'copy';
      if (colorModes.includes(r.renderMode as typeof colorModes[number])) {
        this.color ??= new ColorFilter();
        ctx.drawImage(this.color.draw(this.frame, r, `${this.sourceRevision}|${width}x${height}`), 0, 0);
      } else {
        this.warp ??= new WarpFilter(); ctx.drawImage(this.warp.draw(this.frame, r), 0, 0);
      }
    } else if ((implementedProModes as readonly string[]).includes(r.renderMode)) {
      this.pro ??= new ProFilter();
      const filtered = this.pro.draw(source, width, height, r, String(this.sourceRevision), scale);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(filtered, 0, 0, width, height);
    } else {
    const cellH = r.fontSize * scale, cellW = cellH * 0.6;
    const fillEdges = ['dots', 'pixel', 'mosaic', 'block-chars', 'disco'].includes(r.renderMode);
    const cols = (fillEdges ? Math.ceil : Math.floor)(width / cellW);
    const rows = (fillEdges ? Math.ceil : Math.floor)(height / cellH);
    const pixels = this.sampling.getContext('2d', { willReadFrequently: true })!
      .getImageData(0, 0, source.width, source.height).data;
    const ratioX = source.width / (source.width * scale), ratioY = source.height / (source.height * scale);
    const indexAt = (x: number, y: number) => (Math.min(source.height - 1, Math.floor(y * ratioY)) * source.width
      + Math.min(source.width - 1, Math.floor(x * ratioX))) * 4;
    let low = 255, high = 0;
    const stride = Math.max(1, Math.floor(Math.min(cols, rows) / 40));
    for (let y = 0; y < rows; y += stride) for (let x = 0; x < cols; x += stride) {
      const sx = Math.floor((x + 0.5) * cellW * ratioX), sy = Math.floor((y + 0.5) * cellH * ratioY);
      if (sx >= source.width || sy >= source.height) continue;
      const value = luma(pixels, (sy * source.width + sx) * 4);
      low = Math.min(low, value); high = Math.max(high, value);
    }
    const range = high - low || 1;
    const contrast = 259 * (r.contrast + 255) / (255 * (259 - r.contrast));
    const grade = (value: number) => clamp(contrast * (value - 128) + 128 + 255 * r.brightness / 100, 255);
    const soft = ['braille', 'lines', 'diagonal', 'mixed'].includes(r.renderMode);
    const threshold = (soft ? 0.3 : 0.6) * (1 - r.darkThreshold / 100);
    const opaque = ['pixel', 'mosaic', 'disco'].includes(r.renderMode);
    const batch = !opaque && r.renderMode !== 'dots' && (ramps[r.renderMode] || r.charSet) !== '@#*+=-:. ';
    if (batch) { this.glyphs ??= new GlyphBatch(); this.glyphs.begin(width, height, cellH); }
    ctx.font = `${cellH}px "Courier New", Courier, monospace`; ctx.textBaseline = 'top';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const index = indexAt((x + 0.5) * cellW, (y + 0.5) * cellH);
      let normalized = clamp((luma(pixels, index) - low) / range);
      if (r.invert) normalized = 1 - normalized;
      if (opaque) { if (r.coverage < 100 && normalized < 1 - r.coverage / 100) continue; }
      else if ((r.renderMode !== 'braille' && normalized < threshold) || (r.coverage < 100 &&
        (((0x466f45d * x) ^ (0x127409f * y)) >>> 0) % 1000 > r.coverage * 10)) continue;
      const rgb = [grade(pixels[index]), grade(pixels[index + 1]), grade(pixels[index + 2])];
      ctx.fillStyle = rgba(rgb, r.charOpacity / 100);
      if (r.renderMode === 'dots') {
        const radius = 0.45 * Math.min(cellW, cellH) * (0.15 + 0.85 * normalized);
        if (radius >= 0.3) { ctx.beginPath(); ctx.arc((x + 0.5) * cellW, (y + 0.5) * cellH, radius, 0, Math.PI * 2); ctx.fill(); }
      } else if (r.renderMode === 'pixel') {
        const quantized = rgb.map(value => Math.round(255 * Math.round((r.invert ? 255 - value : value) / 255 * 5) / 5));
        ctx.fillStyle = rgba(quantized, r.charOpacity / 100);
        ctx.fillRect(x * cellW + 0.5, y * cellH + 0.5, cellW - 1, cellH - 1);
      } else if (r.renderMode === 'mosaic' || r.renderMode === 'disco') {
        this.tile(ctx, r, pixels, source.width, source.height, x, y, cellW, cellH, ratioX, ratioY, grade);
      } else {
        let ramp = ramps[r.renderMode] || r.charSet;
        const mapped = clamp((soft ? (normalized - threshold) / (1 - threshold || 1) : normalized) + (r.darkThreshold - 30) / 100);
        if (r.renderMode === 'mixed') ramp = mixed[(((0x466f45d * x) ^ (0x127409f * y)) >>> 0) % mixed.length];
        let glyph = ramp[Math.min(ramp.length - 1, Math.floor((1 - mapped) * ramp.length))];
        if (r.renderMode === 'braille') glyph = this.braille(pixels, source.width, source.height, x, y,
          cellW * ratioX, cellH * ratioY, threshold, low, range, r);
        if (glyph === ' ' || !glyph) continue;
        if (ramp === '@#*+=-:. ' && glyph in bitmaps) {
          const bits = bitmaps[glyph], dx = cellW / 6, dy = cellH / 7;
          for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
            if (!(bits & (1 << ((4 - row) * 5 + 4 - col)))) continue;
            const px = x * cellW + col * dx, py = y * cellH + (row + 1) * dy;
            ctx.fillRect(Math.round(px), Math.round(py), Math.max(1, Math.round(px + dx) - Math.round(px)),
              Math.max(1, Math.round(py + dy) - Math.round(py)));
          }
        } else if (batch) this.glyphs!.push(glyph, x * cellW, y * cellH, rgb, r.charOpacity / 100);
        else ctx.fillText(glyph, x * cellW, y * cellH);
      }
    }
    if (batch) this.glyphs!.flush(ctx);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (solidBlend) { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over'; }
    if (r.overlayOpacity > 0) { ctx.globalAlpha = r.overlayOpacity / 100; ctx.globalCompositeOperation = r.overlayBlend;
      ctx.fillStyle = r.overlayColor; ctx.fillRect(0, 0, width, height); }
    if (r.grayscale > 0) { ctx.globalAlpha = r.grayscale / 100; ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, width, height); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  private tile(ctx: CanvasRenderingContext2D, r: Recipe, pixels: Uint8ClampedArray, width: number,
    height: number, x: number, y: number, cw: number, ch: number, rx: number, ry: number,
    grade: (n: number) => number) {
    const disco = r.renderMode === 'disco';
    const wide = !disco && r.mosaicShape === 'wide', tall = !disco && r.mosaicShape === 'tall';
    if ((wide && x % 2 !== 0) || (tall && y % 2 !== 0)) return;
    const left = Math.floor(x * cw * rx), right = Math.min(width, Math.floor((x + 1) * cw * rx));
    const top = Math.floor(y * ch * ry), bottom = Math.min(height, Math.floor((y + 1) * ch * ry));
    const stride = Math.max(1, Math.floor((right - left) / 3));
    const rgb = [0, 0, 0]; let count = 0;
    for (let sy = top; sy < bottom; sy += stride) for (let sx = left; sx < right; sx += stride) {
      const i = (sy * width + sx) * 4;
      for (let c = 0; c < 3; c++) rgb[c] += grade(pixels[i + c]);
      count++;
    }
    if (count > 0) for (let c = 0; c < 3; c++) rgb[c] /= count;
    if (r.invert) for (let c = 0; c < 3; c++) rgb[c] = 255 - rgb[c];
    const w = cw * (wide ? 2 : 1), h = ch * (tall ? 2 : 1), px = x * cw + 1, py = y * ch + 1;
    if (!disco) {
      ctx.fillStyle = rgba(rgb, r.charOpacity / 100); ctx.beginPath();
      ctx.roundRect(px, py, w - 2, h - 2, 0.2 * Math.min(w, h)); ctx.fill(); return;
    }
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    const variation = 1 + (((((0x165667b1 * x) ^ (0x27d4eb2f * y) ^
      (0x85ebca77 * (r.discoSeed || 1))) >>> 0) % 10000) / 10000 - 0.5) * (1 - r.discoUniformity / 100);
    const lit = rgb.map(value => clamp(Math.min(255, value * (1 + 0.45 * luminance)) * variation, 255));
    const sheen = 0.3 + 0.45 * luminance;
    const gradient = ctx.createLinearGradient(px, py, px, py + h - 2);
    gradient.addColorStop(0, rgba(lit.map(v => v + (255 - v) * sheen), r.charOpacity / 100));
    gradient.addColorStop(0.18, rgba(lit, r.charOpacity / 100));
    gradient.addColorStop(1, rgba(lit.map(v => v * 0.6), r.charOpacity / 100));
    ctx.fillStyle = gradient; ctx.fillRect(px, py, w - 2, h - 2);
    if (luminance > 0.45) { ctx.fillStyle = rgba([255, 255, 255], r.charOpacity / 100 * (luminance - 0.45) * 1.4);
      ctx.fillRect(px, py, w - 2, 1); }
    if (luminance > 0.55) {
      const radius = Math.max(w - 2, h - 2) * 1.6;
      const alpha = 0.55 * r.charOpacity / 100 * Math.min(1, (luminance - 0.55) / 0.45);
      const glow = ctx.createRadialGradient(px + (w - 2) / 2, py + (h - 2) / 2, 0,
        px + (w - 2) / 2, py + (h - 2) / 2, radius);
      glow.addColorStop(0, rgba([255, 255, 255], alpha));
      glow.addColorStop(0.5, rgba([255, 255, 255], alpha * 0.35));
      glow.addColorStop(1, rgba([255, 255, 255], 0));
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = glow;
      ctx.fillRect(px - radius, py - radius, 2 * radius + w - 2, 2 * radius + h - 2); ctx.restore();
    }
  }

  private braille(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number,
    cw: number, ch: number, threshold: number, low: number, range: number,
    r: Recipe) {
    const bits = [0, 1, 2, 6, 3, 4, 5, 7], ranks = [0, 6, 1, 7, 4, 2, 5, 3];
    let glyph = 0;
    for (let col = 0; col < 2; col++) for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let sample = 0; sample < 4; sample++) {
        const sx = Math.min(width - 1, Math.floor(x * cw + (col + 0.25 + (sample & 1) * 0.5) * cw / 2));
        const sy = Math.min(height - 1, Math.floor(y * ch + (row + 0.25 + (sample >> 1) * 0.5) * ch / 4));
        value += luma(pixels, (sy * width + sx) * 4);
      }
      // Braille samples use unclamped tone before normalizing.
      const contrast = 259 * (r.contrast + 255) / (255 * (259 - r.contrast));
      let normalized = clamp((contrast * (value / 4 - 128) + 128 + 255 * r.brightness / 100 - low) / range);
      if (r.invert) normalized = 1 - normalized;
      const i = col * 4 + row;
      if ((normalized - threshold) / (1 - threshold || 1) + (r.darkThreshold - 30) / 100 >
        (ranks[i] + 0.5) / 8) glyph |= 1 << bits[i];
    }
    return glyph ? String.fromCharCode(10240 + glyph) : '';
  }
}
