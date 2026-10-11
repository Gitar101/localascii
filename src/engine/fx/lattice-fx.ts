import { FxRecipe, clamp01, num, requireCanvas } from './context';
import { subjectMask } from './subject-mask';

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function drawBlurredPlate(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, blurPx: number, filter: string) {
  if (blurPx <= 0) {
    if (filter !== 'none') { ctx.save(); ctx.filter = filter; ctx.drawImage(source, 0, 0, w, h); ctx.restore(); }
    else ctx.drawImage(source, 0, 0, w, h);
    return;
  }
  const pad = Math.ceil(2 * blurPx);
  const iw = Math.max(1, Math.round(w) + 2 * pad), ih = Math.max(1, Math.round(h) + 2 * pad);
  const [plate, pctx] = requireCanvas(iw, ih);
  pctx.save();
  if (filter !== 'none') pctx.filter = filter;
  pctx.drawImage(source, pad, pad, w, h);
  pctx.filter = 'none';
  pctx.drawImage(plate, pad, pad, 1, h, 0, pad, pad, h);
  pctx.drawImage(plate, iw - pad - 1, pad, 1, h, iw - pad, pad, pad, h);
  pctx.drawImage(plate, 0, pad, iw, 1, 0, 0, iw, pad);
  pctx.drawImage(plate, 0, ih - pad - 1, iw, 1, 0, ih - pad, iw, pad);
  pctx.restore();
  ctx.save();
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(plate, -pad, -pad);
  ctx.restore();
}

export function renderLattice(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number) {
  const covRaw = clamp01((r.coverage ?? 100) / 100);
  const resolution = num(r, 'latticeResolution', 40) / 100;
  const threshold = num(r, 'latticeThreshold', 60) / 100;
  const nodeSize = num(r, 'latticeNodeSize', 20) / 100;
  const wireThickness = num(r, 'latticeWireThickness', 15) / 100;
  const wireOpacity = num(r, 'latticeWireOpacity', 70) / 100;
  const connections = String(r.latticeConnections ?? 'both');
  const colorMode = String(r.latticeColorMode ?? 'source');
  const bloom = num(r, 'latticeBloom', 50) / 100;
  const dimming = num(r, 'latticeDimming', 40) / 100;
  const blur = Math.max(0, num(r, 'latticeBlur', 0)) * scale * covRaw;
  let cell = Math.max(4, Math.round((40 - 36 * resolution) * scale));
  while ((Math.floor(h / cell) + 1) * (Math.floor(w / cell) + 1) > 9e4) cell++;
  const cols = Math.floor(w / cell) + 1, rows = Math.floor(h / cell) + 1;
  const factor = 259 * ((r.contrast ?? 0) + 255) / (255 * (259 - (r.contrast ?? 0)));
  const bright = (r.brightness ?? 0) / 100;
  const invert = !!r.invert;
  const filters: string[] = [];
  if ((r.contrast ?? 0) !== 0) filters.push(`contrast(${factor.toFixed(4)})`);
  if (invert) filters.push('invert(1)');
  const toneFilter = filters.length ? filters.join(' ') : 'none';
  ctx.save();
  drawBlurredPlate(ctx, source, w, h, blur, toneFilter);
  ctx.restore();
  if (dimming > 0 && covRaw > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.85 * dimming * covRaw})`;
    ctx.fillRect(0, 0, w, h);
  }
  const capScale = Math.min(1, 600 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * capScale)), sh = Math.max(1, Math.round(h * capScale));
  const [sampleCanvas] = requireCanvas(sw, sh);
  const sctx = sampleCanvas.getContext('2d')!;
  sctx.drawImage(source, 0, 0, sw, sh);
  const sampled = sctx.getImageData(0, 0, sw, sh).data;
  const confine = num(r, 'latticeConfine', 55) / 100;
  const mask = confine > 0
    ? subjectMask(source as HTMLImageElement | HTMLCanvasElement, { tolerance: 24 + 100 * confine, softness: 45 })
    : null;
  const maskAt = (x: number, y: number) => {
    if (!mask) return true;
    const mx = Math.min(mask.width - 1, Math.max(0, ((x / w) * mask.width) | 0));
    const my = Math.min(mask.height - 1, Math.max(0, ((y / h) * mask.height) | 0));
    // Analysis planes are bottom-up for GPU upload; canvas coordinates are top-down.
    return mask.data[(mask.height - 1 - my) * mask.width + mx] > 0.35;
  };
  const nodeAt = (x: number, y: number) => {
    const sx = Math.min(sw - 1, Math.max(0, ((x / w) * sw) | 0));
    const sy = Math.min(sh - 1, Math.max(0, ((y / h) * sh) | 0));
    const i = (sy * sw + sx) * 4;
    let cr = factor * (sampled[i] - 128) + 128;
    let cg = factor * (sampled[i + 1] - 128) + 128;
    let cb = factor * (sampled[i + 2] - 128) + 128;
    if (invert) { cr = 255 - cr; cg = 255 - cg; cb = 255 - cb; }
    cr = clamp255(cr); cg = clamp255(cg); cb = clamp255(cb);
    const lum = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255;
    cr = clamp255((cr + 255 * bright * 1.5) * 1.35);
    cg = clamp255((cg + 255 * bright * 1.5) * 1.35);
    cb = clamp255((cb + 255 * bright * 1.5) * 1.35);
    return { r: cr, g: cg, b: cb, lum };
  };
  type Node = { x: number; y: number; col: number; row: number; r: number; g: number; b: number; lum: number; active: boolean };
  const nodes: Node[] = new Array(cols * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = col * cell, y = row * cell;
    const n = nodeAt(x, y);
    nodes[row * cols + col] = { x, y, col, row, ...n, active: n.lum >= threshold && maskAt(x, y) };
  }
  if (covRaw < 1) {
    const active: number[] = [];
    for (let i = 0; i < nodes.length; i++) if (nodes[i].active) active.push(i);
    const hash = (e: number, t: number) => {
      const v = 43758.5453 * Math.sin(127.1 * e + 311.7 * t);
      return v - Math.floor(v);
    };
    const rank = (i: number) => {
      const n = nodes[i];
      const a = n.col / 6, o = n.row / 6;
      const fi = Math.floor(a), fo = Math.floor(o);
      const fx = a - fi, fy = o - fo;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const u = hash(fi, fo), rh = hash(fi + 1, fo), rf = hash(fi, fo + 1), rd = hash(fi + 1, fo + 1);
      return 0.7 * n.lum + 0.3 * (u + (rh - u) * sx + (rf - u) * sy + (u - rh - rf + rd) * sx * sy);
    };
    active.sort((a, b) => rank(b) - rank(a));
    for (let i = Math.round(active.length * covRaw); i < active.length; i++) nodes[active[i]].active = false;
  }
  const [layer] = requireCanvas(w, h);
  const lctx = layer.getContext('2d')!;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, w, h);
  lctx.lineCap = 'round';
  lctx.lineJoin = 'round';
  lctx.lineWidth = Math.max(0.5, (0.5 + 3 * wireThickness) * scale);
  const colorOf = (r: number, g: number, b: number, alpha: number) => {
    if (colorMode === 'mono') return `rgba(255, 255, 255, ${alpha})`;
    if (colorMode === 'vivid') {
      const max = Math.max(r, g, b);
      if (max > 0) {
        const k = 255 / max;
        return `rgba(${Math.min(255, r * k)}, ${Math.min(255, g * k)}, ${Math.min(255, b * k)}, ${alpha})`;
      }
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  const wire = (a: Node, b: Node) => {
    if (!a.active || !b.active) return;
    lctx.strokeStyle = colorOf((a.r + b.r) / 2, (a.g + b.g) / 2, (a.b + b.b) / 2, wireOpacity);
    lctx.beginPath();
    lctx.moveTo(a.x, a.y);
    lctx.lineTo(b.x, b.y);
    lctx.stroke();
  };
  const ortho = connections === 'ortho' || connections === 'both';
  const diag = connections === 'diag' || connections === 'both';
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const n = nodes[row * cols + col];
    if (!n.active) continue;
    if (ortho && col < cols - 1) wire(n, nodes[row * cols + col + 1]);
    if (ortho && row < rows - 1) wire(n, nodes[(row + 1) * cols + col]);
    if (diag && col < cols - 1 && row < rows - 1) wire(n, nodes[(row + 1) * cols + col + 1]);
    if (diag && col > 0 && row < rows - 1) wire(n, nodes[(row + 1) * cols + col - 1]);
  }
  if (nodeSize > 0) {
    const radius = Math.max(0.5, (0.5 + 4 * nodeSize) * scale);
    for (const n of nodes) {
      if (!n.active) continue;
      lctx.fillStyle = colorOf(n.r, n.g, n.b, 1);
      lctx.beginPath();
      lctx.arc(n.x, n.y, radius * (0.5 + 0.5 * n.lum), 0, Math.PI * 2);
      lctx.fill();
    }
  }
  if (bloom > 0) {
    ctx.save();
    ctx.filter = `blur(${(6 * bloom * scale).toFixed(2)}px)`;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.4 + 0.6 * bloom);
    ctx.drawImage(layer, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  ctx.drawImage(layer, 0, 0);
}
