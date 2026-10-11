import { Renderer } from '../engine/render';
import { z } from 'zod';
import { FrameRequest, FrameResult, MediaSource, MediaResult, mediaLimits } from '../engine/media-recipe';
import { capabilities, catalog, controls, defaults, parseRecipe, presets, Recipe, RenderRequest, RenderResult,
  RenderError, warpModes, gpuImageModes, implementedProModes, distortionAmountLimits } from '../engine/recipe';

declare global {
  interface Window {
    desktop?: { openImage: () => Promise<{ image: string; name: string } | { media: MediaSource } | null>;
      saveImage: (image: string) => Promise<string | null>;
      openMediaFile: (file: File) => Promise<MediaSource>;
      exportMedia: (request: unknown) => Promise<MediaResult | null>;
      cancelMedia: () => Promise<void>;
      onMediaProgress: (callback: (value: { frames: number; total: number }) => void) => () => void };
    localAscii: { render: (request: RenderRequest) => Promise<
      { ok: true; value: RenderResult } | { ok: false; error: { code: string; message: string } }>;
       renderFrame: (request: FrameRequest) => Promise<
         { ok: true; value: FrameResult } | { ok: false; error: { code: string; message: string } }>;
       capabilities: typeof capabilities };
  }
}
const renderer = new Renderer();
const exportRenderer = new Renderer();
window.localAscii = {
  capabilities,
  async render(request) {
    try { return { ok: true, value: await renderer.render(request) }; }
    catch (error) { return { ok: false, error: { code: error instanceof RenderError ? error.code : 'RENDER_FAILED',
      message: error instanceof Error ? error.message : String(error) } }; }
  },
  async renderFrame(request) {
    try { return { ok: true, value: await exportRenderer.renderFrame(request) }; }
    catch (error) { return { ok: false, error: { code: error instanceof RenderError ? error.code : 'RENDER_FAILED',
      message: error instanceof Error ? error.message : String(error) } }; }
  }
};

function demoImage() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1280;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 1280);
  sky.addColorStop(0, '#17252f'); sky.addColorStop(0.4, '#558a94');
  sky.addColorStop(0.67, '#efb961'); sky.addColorStop(1, '#d1c394');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1024, 1280);
  ctx.fillStyle = '#ffdf8b'; ctx.beginPath(); ctx.arc(645, 402, 145, 0, Math.PI * 2); ctx.fill();
  for (let layer = 0; layer < 7; layer++) {
    ctx.fillStyle = ['#698f96', '#577f88', '#3c6778', '#2c5266', '#203a50', '#172a3d', '#0c192a'][layer];
    ctx.beginPath(); ctx.moveTo(0, 740 + layer * 60);
    for (let x = 0; x <= 1024; x += 6) {
      const y = 640 + layer * 76 + Math.sin(x / 180 + layer * 1.7) * (110 - layer * 9)
        + Math.sin(x / 53 + layer) * (12 - layer);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(1024, 1280); ctx.lineTo(0, 1280); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#101d2a';
  for (let i = 0; i < 65; i++) {
    const x = i * 19 - 70, y = 995 + Math.sin(i * 0.21) * 36, height = 50 + (i * 31 % 53);
    ctx.beginPath(); ctx.moveTo(x, y - height); ctx.lineTo(x - 18, y); ctx.lineTo(x + 18, y); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 2, y, 4, 15);
  }
  return canvas.toDataURL('image/png');
}

if (new URLSearchParams(location.search).get('surface') !== 'worker') startEditor();

function startEditor() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let recipe = { ...defaults }, image = demoImage(), result: RenderResult | null = null;
  let zoom = 1, compare = false, favoriteTab = false, pending = false, running = false, revision = 0;
  let history: Recipe[] = [{ ...recipe }], historyIndex = 0;
  let favorites = new Set<string>();
  try { favorites = new Set(JSON.parse(localStorage.getItem('localascii:favorites') || '[]')); } catch { /* Corrupt UI preferences do not affect recipes. */ }
  const thumbnailRenderer = new Renderer();
  const thumbnailUrls = new Map<string, string>();
  const preview = $<HTMLImageElement>('preview');
  const video = $<HTMLVideoElement>('media-source');
  const liveCanvas = document.createElement('canvas'); liveCanvas.id = 'video-preview'; liveCanvas.hidden = true;
  $('viewport').append(liveCanvas);
  let media: MediaSource | null = null, exporting = false, animationFrame = 0, lastFrame = 0;
  window.desktop?.onMediaProgress(value => { $('status').textContent = `Exporting locally: ${value.frames} / ${value.total} frames`; });
  function error(cause: unknown) { $('error-message').textContent = cause instanceof Error ? cause.message : String(cause); $('error').hidden = false; }
  function record() {
    if (JSON.stringify(history[historyIndex]) === JSON.stringify(recipe)) return;
    history = history.slice(0, historyIndex + 1); history.push({ ...recipe }); historyIndex++;
    if (history.length > 100) { history.shift(); historyIndex--; }
    updateHistory();
  }
  function updateHistory() { ($('undo') as HTMLButtonElement).disabled = historyIndex === 0;
    ($('redo') as HTMLButtonElement).disabled = historyIndex >= history.length - 1; }
  function requestRender() { revision++; pending = true; if (!running) void draw(); }
  async function draw() {
    running = true;
    while (pending) {
      pending = false; const current = revision; $('status').textContent = 'Rendering locally';
      try {
        if (media) {
          const factor = Math.min(1, 960 / video.videoWidth, 540 / video.videoHeight);
          const w = Math.max(1, Math.round(video.videoWidth * factor)), h = Math.max(1, Math.round(video.videoHeight * factor));
          await renderer.renderSource(video, w, h, recipe);
          if (current !== revision) continue;
          liveCanvas.width = w; liveCanvas.height = h;
          liveCanvas.getContext('2d')!.drawImage(compare ? video : renderer.output, 0, 0, w, h);
          $('dimensions').textContent = `${media.info.width} x ${media.info.height}`;
          $('status').textContent = 'Local media preview. Reference parity unverified.';
          continue;
        }
        const next = await renderer.render({ image, recipe, scale: 1 });
        if (current !== revision) continue;
        result = next; preview.src = compare ? image : next.image;
        $('dimensions').textContent = `${next.width.toLocaleString()} x ${next.height.toLocaleString()}`;
        $('status').textContent = `${Math.round(next.renderMs).toLocaleString()} ms. Reference parity unverified.`;
      } catch (cause) { error(cause); $('status').textContent = 'Render failed. Your recipe has not been replaced.'; }
    }
    running = false;
  }
  function renderLibrary() {
    const search = $<HTMLInputElement>('search').value.toLowerCase();
    const full = $<HTMLInputElement>('show-reference').checked;
    const list = $('style-list'); list.replaceChildren(); let count = 0;
    const categories = [...new Set(catalog.map(item => item.category))];
    const names: Record<string, string> = { ascii: 'ASCII & Text', pixel: 'Pixel & Blocks', geometric: 'Geometric',
      print: 'Print & Paper', glass: 'Glass', distort: 'Distort', blur: 'Blur & Focus', glitch: 'Glitch & Signal', light: 'Light & Color', material: 'Material & Texture' };
    for (const category of categories) {
      const entries = catalog.filter(item => item.category === category && (full || item.implemented)
        && (!favoriteTab || favorites.has(item.id)) && `${item.label} ${item.tags.join(' ')}`.toLowerCase().includes(search));
      if (!entries.length) continue;
      const heading = document.createElement('h2'); heading.className = 'style-group'; heading.textContent = names[category]; list.append(heading);
      const grid = document.createElement('div'); grid.className = 'style-grid'; list.append(grid);
      for (const item of entries) {
        count++; const button = document.createElement('button'); button.className = 'style-card';
        button.disabled = !item.implemented; button.setAttribute('aria-pressed', String(item.id === activeStyleId()));
        if (item.implemented) { const thumb = document.createElement('img'); thumb.src = thumbnailUrls.get(item.id) || image; thumb.alt = ''; button.append(thumb); }
        else { const unavailable = document.createElement('span'); unavailable.className = 'unavailable-preview'; unavailable.textContent = 'Not implemented'; button.append(unavailable); }
        const label = document.createElement('span'); label.className = 'style-label'; label.textContent = item.label; button.append(label);
        const tags = document.createElement('span'); tags.className = 'style-tags'; tags.textContent = item.tags.slice(0, 2).join(' / '); button.append(tags);
        button.addEventListener('click', () => { recipe = parseRecipe({ ...recipe, ...item.set, renderMode: item.mode,
          distortAmount: 50 }); record(); renderControls(); renderLibrary(); requestRender(); });
        grid.append(button);
      }
    }
    $('empty-library').hidden = count > 0;
    $('available-count').textContent = `${catalog.filter(i => i.implemented).length} available`;
    $('mode-name').textContent = activeStyleLabel();
    $('favorite').setAttribute('aria-pressed', String(favorites.has(activeStyleId())));
  }

  function activeStyleId() { return recipe.renderMode === 'liquidglass' ? `glass-${recipe.glassStyle}` : recipe.renderMode; }
  function activeStyleLabel() { return catalog.find(item => item.id === activeStyleId())?.label || 'Liquid Glass'; }

  function renderControls() {
    const host = $('controls'); host.replaceChildren();
    const section = (name: string) => {
      const element = document.createElement('section'); element.className = 'control-section';
      const heading = document.createElement('h2'); heading.textContent = name; element.append(heading); host.append(element); return element;
    };
    function set(key: keyof Recipe, value: unknown) {
      try { recipe = parseRecipe({ ...recipe, [key]: value }); if (key === 'glassStyle') renderLibrary(); requestRender(); }
      catch (cause) { error(cause); }
    }
    const range = (parent: HTMLElement, key: keyof Recipe, name: string, min: number, max: number, suffix = '', step = 1) => {
      const label = document.createElement('label'); label.className = 'control';
      const line = document.createElement('span'); line.className = 'control-line';
      const text = document.createElement('span'); text.textContent = name;
      const output = document.createElement('output'); output.textContent = `${recipe[key]}${suffix}`;
      line.append(text, output); label.append(line);
      const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max);
      input.step = String(step); input.value = String(recipe[key]); input.setAttribute('aria-label', name);
      input.addEventListener('input', () => { output.textContent = `${input.value}${suffix}`; set(key, Number(input.value)); });
      input.addEventListener('change', record); label.append(input); parent.append(label);
    };
    const select = (parent: HTMLElement, key: keyof Recipe, name: string, choices: [string, string][]) => {
      const label = document.createElement('label'); label.className = 'control';
      const line = document.createElement('span'); line.className = 'control-line';
      const title = document.createElement('span'); title.textContent = name;
      const input = document.createElement('select'); input.setAttribute('aria-label', name);
      for (const [value, text] of choices) { const option = document.createElement('option'); option.value = value;
        option.textContent = text; input.append(option); }
      input.value = String(recipe[key]);
      input.addEventListener('change', () => { set(key, input.value); record(); });
      line.append(title, input); label.append(line); parent.append(label);
    };
    const check = (parent: HTMLElement, key: keyof Recipe, name: string) => {
      const label = document.createElement('label'); label.className = 'control control-line'; label.textContent = name;
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(recipe[key]);
      input.addEventListener('change', () => { set(key, input.checked); record(); }); label.append(input); parent.append(label);
    };
    const color = (parent: HTMLElement, key: keyof Recipe, name: string) => {
      const label = document.createElement('label'); label.className = 'control control-line'; label.textContent = name;
      const input = document.createElement('input'); input.type = 'color'; input.value = String(recipe[key]);
      input.addEventListener('input', () => set(key, input.value)); input.addEventListener('change', record); label.append(input); parent.append(label);
    };
    const warped = warpModes.includes(recipe.renderMode as typeof warpModes[number]);
    const proEffect = (implementedProModes as readonly string[]).includes(recipe.renderMode);
    const imageEffect = proEffect || gpuImageModes.includes(recipe.renderMode as typeof gpuImageModes[number]);
    if (warped) {
      const distort = section('Distortion');
      const mode = recipe.renderMode as typeof warpModes[number];
      const [min, max] = distortionAmountLimits[mode];
      range(distort, 'distortAmount', mode === 'polar' ? 'Rotation' : 'Amount', min, max);
      if (['pinch', 'spherize', 'twirl', 'zigzag'].includes(mode)) {
        range(distort, 'distortRadius', 'Radius', 10, 150, '%');
        range(distort, 'distortCenterX', 'Center X', 0, 100, '%');
        range(distort, 'distortCenterY', 'Center Y', 0, 100, '%');
      }
      if (mode === 'ripple') range(distort, 'distortWavelength', 'Wavelength', 5, 100, '%');
      if (mode === 'zigzag') range(distort, 'distortRidges', 'Ridges', 1, 20);
      if (mode === 'shear') range(distort, 'distortPeriod', 'Period', 25, 300, '%');
      if (mode === 'polar') select(distort, 'distortPolarMode', 'Mapping',
        [['rect2polar', 'Rect to polar'], ['polar2rect', 'Polar to rect']]);
      check(distort, 'invert', 'Invert image');
    } else if (imageEffect && !proEffect) {
      const effect = section(activeStyleLabel());
      if (recipe.renderMode === 'droste') {
        range(effect, 'drZoom', 'Zoom', 2, 8, 'x', 0.1);
        range(effect, 'drTwist', 'Twist', -100, 100, '%'); range(effect, 'drSpin', 'Spin', 0, 360);
        range(effect, 'drCenterX', 'Center X', 0, 100, '%'); range(effect, 'drCenterY', 'Center Y', 0, 100, '%');
      } else if (recipe.renderMode === 'duotone') {
        color(effect, 'duoShadow', 'Shadow ink'); color(effect, 'duoHighlight', 'Highlight ink');
        range(effect, 'duoMidpoint', 'Midpoint', 0, 100, '%'); range(effect, 'duoContrast', 'Ink contrast', 0, 200, '%');
      } else if (recipe.renderMode === 'scanline') {
        range(effect, 'scanSpacing', 'Spacing', 2, 16, ' px'); range(effect, 'scanThickness', 'Thickness', 1, 6, ' px');
        range(effect, 'scanDarkness', 'Darkness', 0, 100, '%'); range(effect, 'scanBloom', 'Bloom', 0, 100, '%');
        color(effect, 'scanTint', 'Tint');
      } else if (recipe.renderMode === 'emboss') {
        range(effect, 'embossDepth', 'Depth', 0, 100, '%'); range(effect, 'embossSweep', 'Light angle', -180, 180);
        range(effect, 'embossShine', 'Shine', 0, 100, '%'); range(effect, 'embossDetail', 'Relief detail', 1, 6, ' px');
        select(effect, 'embossColor', 'Color', [['metal', 'Metal'], ['source', 'Source color']]);
        color(effect, 'embossTint', 'Metal tint');
      } else if (recipe.renderMode === 'rgbsplit') {
        range(effect, 'rgbAmount', 'Separation', 0, 100, '%'); range(effect, 'rgbAngle', 'Angle', 0, 360);
        range(effect, 'rgbFalloff', 'Falloff', 0, 100, '%'); range(effect, 'rgbBalance', 'Balance', 0, 100, '%');
      }
      check(effect, 'invert', 'Invert image');
    } else if (proEffect) {
      const prefixes: Record<string, string> = {
        frostedglass: 'frost', motionblur: 'motion', smudge: 'smudge', pixelsort: 'psort',
        oilpaint: 'oil', lowpoly: 'lp', comic: 'cm', sketch: 'sk', anaglyph: 'ag',
        tiltshift: 'ts', gaussianblur: 'gb', radialblur: 'rb', thinfilm: 'tf', engraving: 'en',
        gradientmap: 'gm', warhol: 'wh', topography: 'topography', prism: 'prism', marble: 'marble',
        lightwind: 'lightwind', starburst: 'starburst', warpbloom: 'warpbloom', lofi: 'lofi',
        edgeglow: 'eg', posterize: 'posterize', crystallize: 'crystal', mezzotint: 'mezzo',
        pointillize: 'point', crosshatch: 'hatch', ledmatrix: 'led', thermal: 'thermal', beacon: 'beacon',
        hexmosaic: 'hex', truchet: 'tr', chrome: 'ch', watercolor: 'wc', flowfield: 'ff', isoextrude: 'ce', glassorb: 'orb',
        shatter: 'sh', stainedglass: 'sg', dither: 'dither', molten: 'molten', liquidglass: 'glass', '3d': 'shape3d', lego: 'lego', lens: 'lensd',
        forms: 'form', stippling: 'stipple', vitrine: 'vitrine', risograph: 'riso', halftone: 'ht', glitch: 'glitch', datamosh: 'dm', blueprint: 'blueprint', waves: 'wave', lattice: 'lattice'
      };
      const effect = section(activeStyleLabel());
      const prefix = prefixes[recipe.renderMode];
      for (const key of Object.keys(controls) as (keyof typeof controls)[]) {
        if (!key.startsWith(prefix)) continue;
        const schema = controls[key]._def.innerType;
        const name = key.slice(prefix.length).replace(/([A-Z])/g, ' $1').trim();
        if (schema instanceof z.ZodNumber && schema.minValue !== null && schema.maxValue !== null) {
          range(effect, key, name, schema.minValue, schema.maxValue, '', schema.isInt ? 1 :
            (schema.maxValue - schema.minValue <= 10 ? 0.1 : 1));
        } else if (schema instanceof z.ZodEnum) {
          select(effect, key, name, schema.options.map(value => [value, value]));
        } else if (schema instanceof z.ZodBoolean) check(effect, key, name);
        else if (schema instanceof z.ZodString && /^#[0-9a-f]{6}$/i.test(String(recipe[key]))) {
          color(effect, key, name);
        }
      }
      check(effect, 'invert', 'Invert image');
    } else {
    const glyphs = section('Characters');
    if (!['pixel', 'mosaic', 'disco', 'dots', 'braille'].includes(recipe.renderMode)) {
      select(glyphs, 'charSet', 'Character preset', presets.map(p => [p.chars, p.label]));
      const label = document.createElement('label'); label.className = 'control control-line'; label.textContent = 'Custom ramp';
      const input = document.createElement('input'); input.type = 'text'; input.value = recipe.charSet; input.maxLength = 256;
      input.addEventListener('change', () => { set('charSet', input.value); record(); }); label.append(input); glyphs.append(label);
    }
    range(glyphs, 'fontSize', 'Font size', 3, 100, ' px');
    select(glyphs, 'blendMode', 'Blend mode', controls.blendMode._def.innerType.options.map((v: string) => [v, v.replaceAll('-', ' ')]));
    range(glyphs, 'charOpacity', 'Character opacity', 0, 100, '%');
    check(glyphs, 'invert', 'Invert mapping');
    if (recipe.renderMode === 'mosaic') select(glyphs, 'mosaicShape', 'Tile shape', [['square', 'Square'], ['wide', 'Wide'], ['tall', 'Tall']]);
    if (recipe.renderMode === 'disco') { range(glyphs, 'discoUniformity', 'Uniformity', 0, 100);
      range(glyphs, 'discoSeed', 'Seed', 0, 100); }
    const backdrop = section('Backdrop');
    select(backdrop, 'bgMode', 'Mode', [['blur', 'Blurred image'], ['original', 'Original image'], ['solid', 'Solid color'], ['none', 'Transparent']]);
    color(backdrop, 'bgSolidColor', 'Solid color');
    range(backdrop, 'bgBlur', 'Softness', 0, 100, ' px');
    range(backdrop, 'bgOpacity', 'Opacity', 0, 100, '%');
    }
    if (['lego', '3d', 'liquidglass', 'forms', 'stippling', 'risograph', 'halftone', 'waves'].includes(recipe.renderMode)) {
      const cells = section('Cells');
      if (recipe.renderMode !== '3d') range(cells, 'fontSize', recipe.renderMode === 'liquidglass' ? 'Pattern size' : 'Cell size', 3, 200, ' px');
      if (['lego', '3d'].includes(recipe.renderMode)) {
        range(cells, 'charOpacity', 'Cell opacity', 0, 100, '%');
        select(cells, 'blendMode', 'Blend mode', controls.blendMode._def.innerType.options.map(v => [v, v]));
        const backdrop = section('Backdrop');
        select(backdrop, 'bgMode', 'Mode', [['blur', 'Blurred image'], ['original', 'Original image'], ['solid', 'Solid color'], ['none', 'Transparent']]);
        color(backdrop, 'bgSolidColor', 'Solid color'); range(backdrop, 'bgBlur', 'Softness', 0, 100, ' px');
        range(backdrop, 'bgOpacity', 'Opacity', 0, 100, '%');
      }
    }
    const intensity = section('Intensity');
    if (!imageEffect) {
    range(intensity, 'coverage', 'Coverage', 0, 100, '%');
    range(intensity, 'darkThreshold', 'Dark threshold', 0, 100);
    } else if (['duotone', 'scanline', 'rgbsplit', 'thermal', 'posterize', 'ledmatrix',
       'starburst', 'warpbloom', 'prism', 'marble', 'lightwind', 'topography', 'lofi', 'liquidglass', '3d', 'lego', 'forms', 'stippling', 'vitrine', 'risograph', 'halftone', 'glitch', 'datamosh', 'blueprint', 'waves', 'lattice'].includes(recipe.renderMode)) {
      range(intensity, 'coverage', 'Coverage', 0, 100, '%');
    }
    range(intensity, 'brightness', 'Brightness', -100, 100);
    range(intensity, 'contrast', 'Contrast', -100, 255);
    const overlay = section('Overlay');
    color(overlay, 'overlayColor', 'Color');
    range(overlay, 'overlayOpacity', 'Opacity', 0, 100, '%');
    select(overlay, 'overlayBlend', 'Blend mode', controls.overlayBlend._def.innerType.options.map((v: string) => [v, v.replaceAll('-', ' ')]));
    range(overlay, 'grayscale', 'Grayscale', 0, 100, '%');
    $('mode-name').textContent = activeStyleLabel();
  }

  async function thumbnails() {
    thumbnailUrls.clear();
    const source = new Image(); source.src = image; await source.decode();
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 144;
    const ctx = canvas.getContext('2d')!;
    const factor = Math.max(canvas.width / source.width, canvas.height / source.height);
    ctx.drawImage(source, (200 - source.width * factor) / 2, (144 - source.height * factor) / 2,
      source.width * factor, source.height * factor);
    const thumbnailImage = canvas.toDataURL('image/png');
    for (const item of catalog.filter(i => i.implemented)) {
      const thumb = await thumbnailRenderer.render({ image: thumbnailImage, recipe: parseRecipe({
        renderMode: item.mode, fontSize: 6, bgBlur: 1, ...item.set }), scale: 1 });
      thumbnailUrls.set(item.id, thumb.image);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    renderLibrary();
  }
  function clearMedia() {
    cancelAnimationFrame(animationFrame); video.pause(); video.removeAttribute('src'); video.load(); media = null;
    liveCanvas.hidden = true; preview.hidden = false;
    $('media-timeline').hidden = true; $('media-settings').hidden = true;
    $('export').textContent = 'Export PNG';
  }
  async function setMedia(next: MediaSource) {
    clearMedia(); video.src = next.url;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Media preview timed out.')), 30_000);
      const loaded = () => finish();
      const failed = () => finish(new Error('This video codec cannot play in Chromium. Try MP4 H.264 or WebM.'));
      function finish(error?: Error) {
        clearTimeout(timeout); video.removeEventListener('loadeddata', loaded); video.removeEventListener('error', failed);
        error ? reject(error) : resolve();
      }
      video.addEventListener('loadeddata', loaded); video.addEventListener('error', failed); video.load();
    });
    media = next; image = (() => {
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0); return canvas.toDataURL('image/png');
    })();
    preview.hidden = true; liveCanvas.hidden = false;
    $('media-timeline').hidden = false; $('media-settings').hidden = false;
    $('image-name').textContent = next.name; $('export').textContent = 'Export media';
    $<HTMLInputElement>('media-seek').max = String(next.info.duration);
    $<HTMLInputElement>('media-seek').value = '0';
    $<HTMLInputElement>('media-start').value = '0';
    $<HTMLInputElement>('media-duration').value = String(next.info.duration);
    $<HTMLInputElement>('media-scale').value = String(Math.min(1,
      Math.max(0.1, Math.floor(Math.sqrt(mediaLimits.maxFramePixels / (next.info.width * next.info.height)) * 10) / 10)));
    $<HTMLInputElement>('media-audio').disabled = !next.info.hasAudio;
    requestRender(); void thumbnails().catch(error);
  }
  function playback(now: number) {
    if (!media || video.paused || exporting) return;
    if (!running && now - lastFrame >= 1000 / Math.min(30, Number($<HTMLInputElement>('media-fps').value) || 24)) {
      lastFrame = now; requestRender();
    }
    animationFrame = requestAnimationFrame(playback);
  }
  video.addEventListener('play', () => { $('media-play').textContent = 'Pause';
    $('media-play').setAttribute('aria-label', 'Pause media'); animationFrame = requestAnimationFrame(playback); });
  video.addEventListener('pause', () => { $('media-play').textContent = 'Play';
    $('media-play').setAttribute('aria-label', 'Play media'); cancelAnimationFrame(animationFrame); });
  video.addEventListener('seeked', requestRender);
  video.addEventListener('timeupdate', () => {
    $<HTMLInputElement>('media-seek').value = String(video.currentTime);
    $('media-time').textContent = `${video.currentTime.toFixed(2)} / ${media?.info.duration.toFixed(2) || '0.00'} s`;
  });
  $('media-play').addEventListener('click', () => { if (video.paused) void video.play().catch(error); else video.pause(); });
  $('media-seek').addEventListener('input', () => { video.pause(); video.currentTime = Number($<HTMLInputElement>('media-seek').value); });
  $('media-format').addEventListener('change', () => {
    $<HTMLInputElement>('media-audio').disabled = !media?.info.hasAudio || $<HTMLSelectElement>('media-format').value === 'gif';
  });
  $('media-cancel').addEventListener('click', () => { void window.desktop?.cancelMedia(); });
  function setImage(next: string, name: string) { clearMedia(); image = next; $('image-name').textContent = name;
    preview.alt = `${name}, rendered as ${recipe.renderMode}`; requestRender(); void thumbnails().catch(error); }
  async function readUpload(file: File) {
    if (file.type === 'image/gif' || file.type.startsWith('video/') || /\.(gif|mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name)) {
      if (!window.desktop) throw new Error('Video and GIF input requires the local desktop app.');
      $('status').textContent = 'Preparing local media';
      await setMedia(await window.desktop.openMediaFile(file)); return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Upload a PNG, JPEG or WebP.');
    if (file.size > 32 * 1024 * 1024) throw new Error('Input limit is 32 MiB.');
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('Image read failed.'));
      reader.readAsDataURL(file); });
    setImage(data, file.name);
  }
  $('upload').addEventListener('click', async () => {
    try { if (window.desktop) { const selected = await window.desktop.openImage();
      if (selected && 'media' in selected) await setMedia(selected.media);
      else if (selected) setImage(selected.image, selected.name); }
      else $('file-input').click(); } catch (cause) { error(cause); }
  });
  $('file-input').addEventListener('change', () => { const file = $<HTMLInputElement>('file-input').files?.[0];
    if (file) void readUpload(file).catch(error); });
  $('sample').addEventListener('click', () => setImage(demoImage(), 'Demo landscape'));
  $('reset').addEventListener('click', () => { recipe = { ...defaults, renderMode: recipe.renderMode } as typeof recipe;
    record(); renderControls(); requestRender(); });
  $('compare').addEventListener('click', () => { compare = !compare; $('compare').setAttribute('aria-pressed', String(compare));
    if (media) requestRender(); else preview.src = compare ? image : result?.image || image; });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(0.25, zoom - 0.25); preview.style.transform = liveCanvas.style.transform = `scale(${zoom})`; });
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(4, zoom + 0.25); preview.style.transform = liveCanvas.style.transform = `scale(${zoom})`; });
  $('zoom-reset').addEventListener('click', () => { zoom = 1; preview.style.transform = liveCanvas.style.transform = ''; });
  $('undo').addEventListener('click', () => { if (historyIndex > 0) { recipe = { ...history[--historyIndex] };
    updateHistory(); renderControls(); renderLibrary(); requestRender(); } });
  $('redo').addEventListener('click', () => { if (historyIndex < history.length - 1) { recipe = { ...history[++historyIndex] };
    updateHistory(); renderControls(); renderLibrary(); requestRender(); } });
  $('search').addEventListener('input', renderLibrary); $('show-reference').addEventListener('change', renderLibrary);
  $('favorites').addEventListener('click', () => { favoriteTab = true; $('favorites').classList.add('active');
    $('explore').classList.remove('active'); renderLibrary(); });
  $('explore').addEventListener('click', () => { favoriteTab = false; $('explore').classList.add('active');
    $('favorites').classList.remove('active'); renderLibrary(); });
  $('favorite').addEventListener('click', () => { if (favorites.has(activeStyleId())) favorites.delete(activeStyleId());
    else favorites.add(activeStyleId()); try { localStorage.setItem('localascii:favorites', JSON.stringify([...favorites])); }
    catch (cause) { error(cause); } renderLibrary(); });
  $('export').addEventListener('click', async () => {
    const button = $('export') as HTMLButtonElement; button.disabled = true;
    try {
      if (media && window.desktop) {
        video.pause(); exporting = true; $('media-cancel').hidden = false;
        const exported = await window.desktop.exportMedia({ inputPath: media.inputPath, recipe,
          format: $<HTMLSelectElement>('media-format').value, fps: Number($<HTMLInputElement>('media-fps').value),
          start: Number($<HTMLInputElement>('media-start').value), duration: Number($<HTMLInputElement>('media-duration').value),
          scale: Number($<HTMLInputElement>('media-scale').value), audio: $<HTMLInputElement>('media-audio').checked });
        if (exported) $('status').textContent = `${exported.format.toUpperCase()} exported: ${exported.frames} frames`;
        return;
      }
      const exported = await renderer.render({ image, recipe, scale: 1 });
      if (window.desktop) { const file = await window.desktop.saveImage(exported.image); if (file) $('status').textContent = 'PNG exported'; }
      else { const link = document.createElement('a'); link.href = exported.image; link.download = 'localascii.png'; link.click(); }
    } catch (cause) { error(cause); } finally { button.disabled = false; exporting = false; $('media-cancel').hidden = true; }
  });
  $('dismiss-error').addEventListener('click', () => { $('error').hidden = true; });
  $('toggle-styles').addEventListener('click', () => { $('styles').classList.toggle('open'); $('inspector').classList.remove('open'); });
  $('toggle-controls').addEventListener('click', () => { $('inspector').classList.toggle('open'); $('styles').classList.remove('open'); });
  const viewport = $('viewport');
  viewport.addEventListener('dragover', event => { event.preventDefault(); $('drop-target').hidden = false; });
  viewport.addEventListener('dragleave', event => { if (!viewport.contains(event.relatedTarget as Node)) $('drop-target').hidden = true; });
  viewport.addEventListener('drop', event => { event.preventDefault(); $('drop-target').hidden = true;
    const file = event.dataTransfer?.files[0]; if (file) void readUpload(file).catch(error); });
  renderControls(); renderLibrary(); updateHistory(); requestRender(); void thumbnails().catch(error);
}
