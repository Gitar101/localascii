import { FxRecipe, clamp01, contrastFactor, lumaOf, num, str } from './context';

export function renderVoxels(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number) {
  renderSolidCells(ctx, source, w, h, r, scale, false);
}

export function renderLego(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number) {
  renderSolidCells(ctx, source, w, h, r, scale, true);
}

function renderSolidCells(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number, lego: boolean) {
  const sample = document.createElement('canvas'); sample.width = w; sample.height = h;
  const sampling = sample.getContext('2d', { willReadFrequently: true })!;
  sampling.drawImage(source, 0, 0, w, h);
  const pixels = sampling.getImageData(0, 0, w, h).data;
  const background = str(r, 'bgMode', 'blur');
  const blend = str(r, 'blendMode', 'source-over') as GlobalCompositeOperation;
  const solidBlend = background === 'solid' && blend !== 'source-over';
  if (!solidBlend && background === 'solid') {
    ctx.fillStyle = str(r, 'bgSolidColor', '#000000'); ctx.fillRect(0, 0, w, h);
  } else if (background !== 'none' && background !== 'solid') {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = num(r, 'bgOpacity', 100) / 100;
    ctx.filter = background === 'blur' ? `blur(${num(r, 'bgBlur', 8)}px)` : 'none';
    ctx.drawImage(source, 0, 0, w, h); ctx.restore();
  }
  const legoMinimum = Math.max(5, Math.ceil(Math.sqrt(r.sourceW * r.sourceH / (.6 * 130000))));
  const cellHeight = Math.max(lego ? legoMinimum : 0, num(r, 'fontSize', 11)) * scale, cellWidth = cellHeight * .6;
  const cols = Math.ceil(w / cellWidth), rows = Math.ceil(h / cellHeight);
  const indexAt = (x: number, y: number) =>
    (Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)))) * 4;
  let low = 255, high = 0;
  const stride = Math.max(1, Math.floor(Math.min(cols, rows) / 40));
  for (let y = 0; y < rows; y += stride) for (let x = 0; x < cols; x += stride) {
    const i = indexAt((x + .5) * cellWidth, (y + .5) * cellHeight);
    const value = lumaOf(pixels[i], pixels[i + 1], pixels[i + 2]);
    low = Math.min(low, value); high = Math.max(high, value);
  }
  const factor = contrastFactor(r.contrast), brightness = r.brightness * 2.55;
  if (lego) {
    const supersample = Math.max(1, Math.min(4, Math.ceil(16 / Math.max(1, Math.min(cellWidth, cellHeight)))));
    const tileWidth = Math.max(2, Math.round(cellWidth * supersample)), tileHeight = Math.max(2, Math.round(cellHeight * supersample));
    const tileLimit = Math.max(1, Math.min(64, Math.floor(4000000 / (tileWidth * tileHeight))));
    const tiles = new Map<string, HTMLCanvasElement>();
    ctx.globalCompositeOperation = blend;
    ctx.globalAlpha = num(r, 'charOpacity', 100) / 100;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const i = indexAt((col + .5) * cellWidth, (row + .5) * cellHeight);
      let value = clamp01((lumaOf(pixels[i], pixels[i + 1], pixels[i + 2]) - low) / (high - low || 1));
      if (r.invert) value = 1 - value;
      if (r.coverage < 100 && value < 1 - r.coverage / 100) continue;
      const color = [0, 1, 2].map(c => {
        let value = Math.max(0, Math.min(255, factor * (pixels[i + c] - 128) + 128 + brightness));
        if (r.invert) value = 255 - value;
        return Math.round(255 * Math.round(value / 255 * 7) / 7);
      });
      const key = color.join(','); let tile = tiles.get(key);
      if (!tile) {
        tile = document.createElement('canvas'); tile.width = tileWidth; tile.height = tileHeight;
        const tc = tile.getContext('2d')!, x = tileWidth / 2, y = tileHeight / 2;
        const size = Math.min(tileWidth, tileHeight), stud = size * .35;
        tc.fillStyle = `rgb(${key})`; tc.fillRect(0, 0, tileWidth, tileHeight);
        tc.fillStyle = 'rgba(0,0,0,.25)'; tc.beginPath(); tc.arc(x + .04 * size, y + .06 * size, stud, 0, 2 * Math.PI); tc.fill();
        tc.fillStyle = `rgb(${color.map(value => Math.min(255, value + 20)).join(',')})`;
        const circle = () => { tc.beginPath(); tc.arc(x, y, stud, 0, 2 * Math.PI); tc.fill(); };
        circle();
        const rim = tc.createRadialGradient(x - .3 * stud, y - .3 * stud, .2 * stud, x, y, stud);
        rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(.7, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,0,0,.3)');
        tc.fillStyle = rim; circle();
        const highlight = tc.createRadialGradient(x - .3 * stud, y - .35 * stud, .05 * stud, x - .1 * stud, y - .1 * stud, .7 * stud);
        highlight.addColorStop(0, 'rgba(255,255,255,.5)'); highlight.addColorStop(1, 'rgba(255,255,255,0)');
        tc.fillStyle = highlight; circle();
        if (tiles.size >= tileLimit) tiles.delete(tiles.keys().next().value!);
        tiles.set(key, tile);
      }
      ctx.drawImage(tile, col * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (solidBlend) {
      ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    return;
  }
  const radius = Math.max(2, (num(r, 'shape3dCellSize', 12) || 12) * scale) / 2;
  const dx = Math.sqrt(3) * radius * ((num(r, 'shape3dHSpacing', 100) || 100) / 100);
  const dy = 1.5 * radius * ((num(r, 'shape3dVSpacing', 100) || 100) / 100);
  const top = (num(r, 'shape3dTopShade', 135) || 135) / 100;
  const light = (num(r, 'shape3dLightShade', 100) || 100) / 100;
  const dark = (num(r, 'shape3dDarkShade', 55) || 55) / 100;
  const outline = num(r, 'shape3dOutline', 0) / 100, alpha = num(r, 'charOpacity', 100) / 100;
  const halfWidth = .8660254 * radius, halfHeight = .5 * radius;
  ctx.globalCompositeOperation = blend;
  for (let row = 0; row < Math.ceil(h / dy) + 2; row++) {
    for (let col = 0; col < Math.ceil(w / dx) + 2; col++) {
      const x = col * dx + (row % 2 ? .5 * dx : 0), y = row * dy + radius;
      if (x > w + Math.sqrt(3) * radius || y > h + radius) continue;
      const i = indexAt(x, y);
      const color = [0, 1, 2].map(c => Math.max(0, Math.min(255, factor * (pixels[i + c] - 128) + 128 + brightness)));
      const normalized = (lumaOf(color[0], color[1], color[2]) - low) / (high - low || 1);
      if (r.coverage < 100 && normalized < 1 - r.coverage / 100) continue;
      if (r.invert) for (let c = 0; c < 3; c++) color[c] = 255 - color[c];
      const points = [[x, y - radius], [x + halfWidth, y - halfHeight], [x + halfWidth, y + halfHeight],
        [x, y + radius], [x - halfWidth, y + halfHeight], [x - halfWidth, y - halfHeight], [x, y]];
      const polygon = (indices: number[]) => {
        ctx.beginPath(); indices.forEach((index, step) => {
          const point = points[index]; if (step === 0) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]);
        }); ctx.closePath();
      };
      const faces = [[top, [0, 1, 6, 5]], [r.shape3dFlip ? dark : light, [1, 2, 3, 6]],
        [r.shape3dFlip ? light : dark, [5, 6, 3, 4]]] as const;
      for (const [shade, indices] of faces) {
        ctx.fillStyle = `rgba(${color.map(value => Math.round(clamp01(value * shade / 255) * 255)).join(',')},${alpha})`;
        polygon([...indices]); ctx.fill();
      }
      if (outline > 0) {
        ctx.strokeStyle = `rgba(0,0,0,${outline * alpha})`; ctx.lineWidth = Math.max(.5, .05 * radius);
        polygon([0, 1, 2, 3, 4, 5]);
        for (const corner of [0, 1, 5]) { ctx.moveTo(x, y); ctx.lineTo(points[corner][0], points[corner][1]); }
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (solidBlend) {
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
}
