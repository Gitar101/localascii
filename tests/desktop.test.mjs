import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchApp, fixture } from './helpers.mjs';
import { implementedModes, proModes, warpModes, catalog } from '../app/recipe.mjs';

test('desktop rendering, invalid inputs and responsive controls', { timeout: 90_000 }, async t => {
  const { app, page } = await launchApp();
  try {
    const remoteRequests = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
    await page.context().setOffline(true);
    const image = await fixture(page); const images = new Set();
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      window.__testGpuContexts = [];
      HTMLCanvasElement.prototype.getContext = function(type, ...options) {
        const context = original.call(this, type, ...options);
        if (type === 'webgl2' && context) window.__testGpuContexts.push(context);
        return context;
      };
    });
    await t.test('GPU filters reject missing WebGL rather than using a CPU fallback', async () => {
      const response = await page.evaluate(async image => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...options) {
          return type === 'webgl2' ? null : original.call(this, type, ...options);
        };
        try { return await window.localAscii.render({ image, recipe: { renderMode: 'pinch' }, scale: 1 }); }
        finally { HTMLCanvasElement.prototype.getContext = original; }
      }, image);
      assert.equal(response.ok, false); assert.equal(response.error.code, 'WEBGL_UNAVAILABLE');
    });
    for (const mode of implementedModes) {
      await t.test(`${mode} renders deterministically`, async () => {
        const request = { image, recipe: { renderMode: mode, fontSize: 8, bgMode: 'solid' }, scale: 1 };
        const a = await page.evaluate(request => window.localAscii.render(request), request);
        const b = await page.evaluate(request => window.localAscii.render(request), request);
        assert.equal(a.ok, true, `${mode}: ${a.error?.message}`);
        assert.equal(b.ok, true, `${mode}: ${b.error?.message}`);
        assert.equal(a.value.width, 96); assert.equal(a.value.height, 72);
        assert.equal(a.value.image, b.value.image); images.add(a.value.image);
      });
    }
    assert.equal(images.size, implementedModes.length, 'Every mode produces distinct output');
    await t.test('lattice confines nodes to the upright subject and exposes real connection modes', async () => {
      const result = await page.evaluate(async () => {
        const source = document.createElement('canvas'); source.width = 96; source.height = 72;
        const ctx = source.getContext('2d'); ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 96, 72);
        ctx.fillStyle = '#ff0000'; ctx.fillRect(24, 4, 48, 24);
        const image = source.toDataURL();
        const base = { renderMode: 'lattice', contrast: 0, latticeResolution: 100, latticeThreshold: 0,
          latticeBloom: 0, latticeDimming: 0, latticeWireOpacity: 0, latticeNodeSize: 100, latticeColorMode: 'mono' };
        async function render(changes) {
          const response = await window.localAscii.render({ image, recipe: { ...base, ...changes } });
          if (!response.ok) throw new Error(response.error.message);
          const decoded = new Image(); decoded.src = response.value.image; await decoded.decode();
          ctx.drawImage(decoded, 0, 0);
          return { image: response.value.image, top: [...ctx.getImageData(32, 12, 1, 1).data],
            bottom: [...ctx.getImageData(32, 60, 1, 1).data] };
        }
        const confined = await render({ latticeConfine: 100 });
        const open = await render({ latticeConfine: 0 });
        const zero = await render({ latticeConfine: 100, coverage: 0 });
        const modes = [];
        for (const latticeConnections of ['ortho', 'diag', 'both']) {
          modes.push((await render({ latticeConfine: 0, latticeConnections, latticeNodeSize: 0,
            latticeWireOpacity: 100, latticeResolution: 80 })).image);
        }
        return { confined, open, zero, modes, original: image };
      });
      assert(result.confined.top[1] > 200, 'Upper subject receives nodes');
      assert.equal(result.confined.bottom[0], 0, 'Lower background remains unmarked');
      assert(result.open.bottom[0] > 200, 'Disabling confinement enables background nodes');
      assert.equal(result.zero.image, result.original, 'Zero coverage preserves the untinted source');
      assert.equal(new Set(result.modes).size, 3, 'All connection modes produce different geometry');
    });
    await t.test('all ten glass presets have distinct optics and zero coverage preserves the source', async () => {
      const variants = new Set();
      for (const item of catalog.filter(item => item.mode === 'liquidglass')) {
        const request = { image, recipe: { renderMode: 'liquidglass', contrast: 0, ...item.set }, scale: 1 };
        const a = await page.evaluate(request => window.localAscii.render(request), request);
        const b = await page.evaluate(request => window.localAscii.render(request), request);
        assert(a.ok && b.ok, `${item.id}: ${a.error?.message}`);
        assert.equal(a.value.image, b.value.image, item.id);
        variants.add(a.value.image);
        const zero = await page.evaluate(async request => {
          request.recipe.coverage = 0;
          const response = await window.localAscii.render(request);
          if (!response.ok) throw new Error(response.error.message);
          async function pixels(data) {
            const source = new Image(); source.src = data; await source.decode();
            const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
            return ctx.getImageData(0, 0, source.width, source.height).data;
          }
          const a = await pixels(request.image), b = await pixels(response.value.image);
          return Math.max(...a.map((value, i) => Math.abs(value - b[i])));
        }, request);
        assert(zero <= 1, `${item.id}: source error ${zero}`);
      }
      assert.equal(variants.size, 10);
      const base = { renderMode: 'liquidglass', glassStyle: 'jello', contrast: 0, fontSize: 58 };
      const original = await page.evaluate(request => window.localAscii.render(request), { image, recipe: base });
      for (const changes of [{ glassAngle: 35 }, { glassDepth: 20 }, { glassSplay: 10 },
        { glassRefraction: 0 }, { glassDispersion: 90 }, { glassFrost: 60 }, { coverage: 35 }]) {
        const result = await page.evaluate(request => window.localAscii.render(request), { image, recipe: { ...base, ...changes } });
        assert(result.ok, result.error?.message); assert.notEqual(result.value.image, original.value.image);
      }
    });
    await t.test('unfinished effects fail explicitly instead of rendering characters', async () => {
      for (const renderMode of proModes.filter(mode => !implementedModes.includes(mode))) {
        const response = await page.evaluate(request => window.localAscii.render(request),
          { image, recipe: { renderMode }, scale: 1 });
        assert.equal(response.ok, false, renderMode);
        assert.equal(response.error.code, 'INVALID_MODE', renderMode);
      }
    });
    await t.test('cell and stamp ports retain independent shading and shape controls', async () => {
      const checks = await page.evaluate(async image => {
        async function output(recipe, input = image) {
          const response = await window.localAscii.render({ image: input, recipe, scale: 1 });
          if (!response.ok) throw new Error(response.error.message);
          return response.value.image;
        }
        const variants = async (base, key, values) => {
          const outputs = new Set();
          for (const value of values) outputs.add(await output({ ...base, [key]: value }));
          return outputs.size;
        };
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(100,150,200)'; ctx.fillRect(0, 0, 64, 48);
        const constant = canvas.toDataURL();
        const cubes = { renderMode: '3d', contrast: 0, shape3dCellSize: 24, shape3dHSpacing: 100,
          shape3dVSpacing: 100, shape3dTopShade: 135, shape3dLightShade: 100, shape3dDarkShade: 55, bgMode: 'solid' };
        const data = await output(cubes, constant), source = new Image(); source.src = data; await source.decode();
        ctx.clearRect(0, 0, 64, 48); ctx.drawImage(source, 0, 0);
        const colors = [[21, 5], [26, 13], [16, 13]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
        return {
          colors,
          cubesFlip: (await output(cubes, constant)) !== (await output({ ...cubes, shape3dFlip: true }, constant)),
          legoSizes: await variants({ renderMode: 'lego', contrast: 0 }, 'fontSize', [6, 12, 24]),
          forms: await variants({ renderMode: 'forms', fontSize: 12, contrast: 0 }, 'formShape', ['soft', 'dot', 'heart', 'triangle', 'hourglass', 'ring', 'flower']),
          stipples: await variants({ renderMode: 'stippling', fontSize: 8, contrast: 0 }, 'stippleShape', ['circle', 'ring', 'square', 'diamond', 'cross', 'triangle', 'star', 'hexagon'])
        };
      }, image);
      assert.deepEqual(checks.colors, [[135, 203, 255, 255], [100, 150, 200, 255], [55, 83, 110, 255]]);
      assert.equal(checks.cubesFlip, true); assert.equal(checks.legoSizes, 3);
      assert.equal(checks.forms, 7); assert.equal(checks.stipples, 8);
    });
    await t.test('bokeh lens factors affect output and invalid tap counts are rejected', async () => {
      const base = { renderMode: 'lens' };
      const original = await page.evaluate(request => window.localAscii.render(request), { image, recipe: base });
      assert(original.ok, original.error?.message);
      for (const changes of [{ lensdSpread: 0 }, { lensdBias: -2 }, { lensdAngle: 90 }, { lensdDispersion: 0 },
        { lensdBulge: -.5 }, { lensdGrainMix: 1 }, { lensdGrainOverlay: 1 }, { lensdImageX: .2 }, { lensdScale: 1.5 }]) {
        const result = await page.evaluate(request => window.localAscii.render(request), { image, recipe: { ...base, ...changes } });
        assert(result.ok, result.error?.message); assert.notEqual(result.value.image, original.value.image, JSON.stringify(changes));
      }
      for (const lensdCount of [0, 51]) {
        const response = await page.evaluate(request => window.localAscii.render(request), { image, recipe: { ...base, lensdCount } });
        assert.equal(response.ok, false); assert.match(response.error.code, /^INVALID_/);
      }
    });
    await t.test('stamp, pane and screen coverage preserve the source at zero and vary at partial coverage', async () => {
      for (const renderMode of ['forms', 'vitrine', 'risograph', 'halftone']) {
        const results = [];
        for (const coverage of [0, 25, 50, 100]) {
          const result = await page.evaluate(request => window.localAscii.render(request), {
            image, recipe: { renderMode, coverage, contrast: 0 }
          });
          assert(result.ok, result.error?.message); results.push(result.value.image);
        }
        assert.equal(new Set(results).size, 4, renderMode);
        const difference = await page.evaluate(async ({ input, output }) => {
          async function pixels(data) {
            const image = new Image(); image.src = data; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, image.width, image.height).data;
          }
          const a = await pixels(input), b = await pixels(output);
          return a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);
        }, { input: image, output: results[0] });
        assert(difference <= 1, `${renderMode}: zero-coverage error ${difference}`);
      }
    });
    await t.test('halftone supports all dot silhouettes and all twelve screen textures', async () => {
      const variants = await page.evaluate(async image => {
        async function count(key, values) {
          const results = new Set();
          for (const value of values) {
            const response = await window.localAscii.render({ image, recipe: { renderMode: 'halftone', contrast: 0, fontSize: 12, [key]: value } });
            if (!response.ok) throw new Error(response.error.message);
            results.add(response.value.image);
          }
          return results.size;
        }
        return {
          shapes: await count('htShape', ['circle', 'ellipse', 'square', 'diamond', 'triangle', 'ring', 'plus', 'xmark', 'hexagon', 'star5', 'sparkle4', 'heart', 'petal', 'dash']),
          textures: await count('htTexture', ['dots', 'checker', 'stripesV', 'stripesH', 'diagonal', 'crosshatch', 'grid', 'brick', 'triangle', 'dash', 'rings', 'plus'])
        };
      }, image);
      assert.equal(variants.shapes, 14); assert.equal(variants.textures, 12);
    });
    await t.test('CPU effects retain tone, border pixels and parameter changes', async () => {
      const checks = await page.evaluate(async image => {
        async function output(recipe, input = image) {
          const response = await window.localAscii.render({ image: input, recipe, scale: 1 });
          if (!response.ok) throw new Error(response.error.message);
          return response.value.image;
        }
        async function pixels(data) {
          const image = new Image(); image.src = data; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          return [...ctx.getImageData(0, 0, image.width, image.height).data];
        }
        const canvas = document.createElement('canvas'); canvas.width = 7; canvas.height = 5;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(100,150,200)'; ctx.fillRect(0, 0, 7, 5);
        const constant = canvas.toDataURL();
        const toned = await pixels(await output({ renderMode: 'gaussianblur', gbAmount: 0,
          contrast: 0, brightness: 10, invert: true }, constant));
        const tilt = await pixels(await output({ renderMode: 'tiltshift', tsSat: 100, contrast: 0 }, constant));
        canvas.width = 1; canvas.height = 1;
        ctx.fillStyle = 'rgb(100,150,200)'; ctx.fillRect(0, 0, 1, 1);
        const tiny = await pixels(await output({ renderMode: 'smudge', contrast: 0 }, canvas.toDataURL()));
        const recipe = { renderMode: 'smudge', smudgeRadius: 3 };
        const a = await output(recipe);
        const b = await output({ ...recipe, smudgeRadius: 45 });
        const c = await output(recipe);
        const motion = await pixels(await output({ renderMode: 'motionblur', contrast: 0,
          motionPath: [0.5, 0.5, 0.5, 0.5] }, constant));
        return { toned, tilt, tiny, radiusChanged: a !== b, restored: a === c, motion };
      }, image);
      const tone = new Uint8ClampedArray([180.5, 130.5, 80.5, 255]);
      for (let p = 0; p < checks.toned.length; p += 4) {
        assert.deepEqual(checks.toned.slice(p, p + 4), [...tone]);
        assert.deepEqual(checks.tilt.slice(p, p + 4), [100, 150, 200, 255]);
        assert.deepEqual(checks.motion.slice(p, p + 4), [100, 150, 200, 255]);
      }
      assert.deepEqual(checks.tiny, [100, 150, 200, 255]);
      assert(checks.radiusChanged); assert(checks.restored);
    });
    await t.test('GPU color formulas match independent pixel calculations', async () => {
      const errors = await page.evaluate(async image => {
        async function pixels(data) {
          const source = new Image(); source.src = data; await source.decode();
          const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
          return ctx.getImageData(0, 0, source.width, source.height).data;
        }
        const input = await pixels(image), w = 96, h = 72;
        const clamp = value => Math.max(0, Math.min(255, value));
        const byte = value => new Uint8ClampedArray([value])[0];
        const at = (x, y, c) => input[(Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4 + c];
        const luma = (x, y) => (at(x, y, 0) * 0.299 + at(x, y, 1) * 0.587 + at(x, y, 2) * 0.114) / 255;
        const cases = [
          { renderMode: 'duotone', duoMidpoint: 35, duoContrast: 175 },
          { renderMode: 'scanline', scanSpacing: 5, scanThickness: 2, scanDarkness: 60, scanBloom: 25, scanTint: '#c880ff', coverage: 65 },
          { renderMode: 'rgbsplit', rgbAmount: 80, rgbAngle: 45, rgbBalance: 30, rgbFalloff: 75, coverage: 80 },
          { renderMode: 'emboss', embossDepth: 75, embossSweep: -60, embossShine: 50, embossDetail: 2, embossColor: 'source' }
        ];
        const errors = {};
        for (const recipe of cases) {
          const response = await window.localAscii.render({ image, recipe: { ...recipe, contrast: 0 }, scale: 1 });
          if (!response.ok) throw new Error(response.error.message);
          const output = await pixels(response.value.image); let maximum = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const original = [at(x, y, 0), at(x, y, 1), at(x, y, 2)]; let expected;
            if (recipe.renderMode === 'duotone') {
              const value = Math.max(0, Math.min(1, (luma(x, y) - 0.35) * 1.75 + 0.35));
              expected = [26, 22, 54].map((low, c) => byte(low + ([245, 197, 66][c] - low) * value));
            } else if (recipe.renderMode === 'scanline') {
              const multiplier = y % 5 < 2 ? 0.46 : 1.15;
              expected = original.map((value, c) => byte(value + (byte(value * multiplier * [200, 128, 255][c] / 255) - value) * 0.65));
            } else if (recipe.renderMode === 'rgbsplit') {
              const distance = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / ((w / 2) ** 2 + (h / 2) ** 2);
              const offset = Math.SQRT1_2 * (0.8 * w * 0.03) * 0.8 * (0.25 + 0.75 * distance);
              const red = Math.round(offset * 0.6), blue = Math.round(offset * 1.4);
              expected = [at(x + red, y + red, 0), original[1], at(x - blue, y - blue, 2)];
            } else {
              const dx = (luma(x + 2, y) - luma(x - 2, y)) / 2;
              const dy = (luma(x, y + 2) - luma(x, y - 2)) / 2;
              const dz = 1 / 6.25, length = Math.hypot(dx, dy, dz), lightLength = Math.hypot(1, 0.6);
              const light = (dx * 0.5 + dy * -Math.sqrt(3) / 2 + dz * 0.6) / (length * lightLength);
              const relief = Math.max(0, Math.min(1, 0.5 + 0.9 * light));
              const shine = Math.max(0, light) ** 14 * 127.5;
              expected = original.map(value => byte(clamp(value * 1.5 * relief + shine)));
            }
            for (let c = 0; c < 3; c++) maximum = Math.max(maximum, Math.abs(output[(y * w + x) * 4 + c] - expected[c]));
          }
          errors[recipe.renderMode] = maximum;
        }
        return errors;
      }, image);
      for (const [mode, maximum] of Object.entries(errors)) assert(maximum <= 1, `${mode}: maximum channel error ${maximum}`);
    });
    await t.test('zero coverage preserves the source for new GPU effects', async () => {
      for (const renderMode of ['lofi', 'marble', 'topography', 'prism', 'starburst', 'warpbloom', 'lightwind']) {
        const response = await page.evaluate(request => window.localAscii.render(request),
          { image, recipe: { renderMode, contrast: 0, coverage: 0 }, scale: 1 });
        assert(response.ok, `${renderMode}: ${response.error?.message}`);
        assert(response.value.image === image, `${renderMode}: zero coverage must preserve input`);
      }
    });
    await t.test('Pro factors and partial coverage change the result', async () => {
      for (const [renderMode, changes] of [ ['duotone', { coverage: 45, duoContrast: 170, duoShadow: '#aa0000' }],
        ['scanline', { scanSpacing: 9, scanTint: '#77dd88' }], ['emboss', { embossSweep: -90, embossColor: 'source' }],
        ['rgbsplit', { rgbAngle: 100, rgbBalance: 20 }], ['droste', { drZoom: 5.5, drTwist: -60, drCenterX: 35 }] ]) {
        const a = await page.evaluate(request => window.localAscii.render(request), { image, recipe: { renderMode }, scale: 1 });
        const b = await page.evaluate(request => window.localAscii.render(request), { image, recipe: { renderMode, ...changes }, scale: 1 });
        assert(a.ok && b.ok); assert.notEqual(a.value.image, b.value.image, renderMode);
      }
    });
    await t.test('distortion factors change GPU output', async () => {
      for (const renderMode of warpModes) {
        const a = await page.evaluate(request => window.localAscii.render(request),
          { image, recipe: { renderMode, distortAmount: 0 }, scale: 1 });
        const b = await page.evaluate(request => window.localAscii.render(request),
          { image, recipe: { renderMode, distortAmount: 75 }, scale: 1 });
        assert(a.ok && b.ok); assert.notEqual(a.value.image, b.value.image, renderMode);
      }
    });
    await t.test('invalid and unsupported requests return typed errors', async () => {
      for (const request of [ { image: 'not an image', recipe: {} }, { image: 'https://www.ascii-magic.com/input.png', recipe: {} },
        { image, recipe: { renderMode: 'not-a-mode' } },
        { image, recipe: { fontSize: 0 } }, { image, recipe: { animated: true } },
        { image, recipe: { motionPath: [0, 0, 1] } },
        { image, recipe: { postEffects: { bloom: { enabled: true } } } } ]) {
        const response = await page.evaluate(request => window.localAscii.render(request), request);
        assert.equal(response.ok, false); assert.match(response.error.code, /^INVALID_/);
      }
    });
    await t.test('scaled output and transparent pixels', async () => {
      const response = await page.evaluate(request => window.localAscii.render(request), {
        image, recipe: { bgMode: 'none', coverage: 0, charOpacity: 0 }, scale: 2 });
      assert.equal(response.ok, true); assert.equal(response.value.width, 192);
      const alpha = await page.evaluate(async data => { const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 1, 1).data[3];
      }, response.value.image);
      assert.equal(alpha, 0);
    });
    await t.test('library, history and mobile panels work', async () => {
      await page.locator('#status').filter({ hasText: 'unverified' }).waitFor();
      assert.equal(await page.locator('.style-card:not(:disabled)').count(), catalog.filter(item => item.implemented).length);
      await page.getByRole('button', { name: 'Thermal', exact: false }).click();
      assert.equal(await page.locator('#mode-name').innerText(), 'Thermal');
      assert.equal(await page.getByRole('slider', { name: 'Sensitivity', exact: true }).count(), 1);
      assert.equal(await page.getByRole('combobox', { name: 'Palette', exact: true }).count(), 1);
      assert.equal(await page.getByRole('combobox', { name: 'Character preset', exact: true }).count(), 0);
      await page.locator('#undo').click();
      assert.equal(await page.locator('#mode-name').innerText(), 'Characters');
      await page.getByRole('button', { name: 'Disco', exact: false }).click();
      assert.equal(await page.locator('#mode-name').innerText(), 'Disco');
      await page.locator('#undo').click(); assert.equal(await page.locator('#mode-name').innerText(), 'Characters');
      await page.locator('#redo').click(); assert.equal(await page.locator('#mode-name').innerText(), 'Disco');
      await page.locator('#show-reference').check(); assert.equal(await page.locator('.style-card').count(), 100);
      assert.equal(await page.locator('.style-card:disabled').count(), catalog.filter(item => !item.implemented).length);
      await page.locator('#show-reference').uncheck();
      await page.getByRole('button', { name: 'Cross Reeded', exact: false }).click();
      assert.equal(await page.locator('#mode-name').innerText(), 'Cross Reeded');
      assert.equal(await page.getByRole('combobox', { name: 'Style', exact: true }).inputValue(), 'cross');
      await page.getByRole('button', { name: 'Jello', exact: false }).click();
      assert.equal(await page.locator('#mode-name').innerText(), 'Jello');
      assert.equal(await page.getByRole('combobox', { name: 'Style', exact: true }).inputValue(), 'jello');
      assert.equal(await page.locator('.style-card[aria-pressed="true"]').count(), 1);
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/desktop.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#toggle-controls').click();
      assert.equal(await page.locator('#inspector').isVisible(), true);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: 'test-results/mobile.png' });
    });
    await t.test('lost GPU contexts fail explicitly', async () => {
      const response = await page.evaluate(async image => {
        for (const gl of window.__testGpuContexts) gl.getExtension('WEBGL_lose_context')?.loseContext();
        await new Promise(resolve => setTimeout(resolve, 0));
        return window.localAscii.render({ image, recipe: { renderMode: 'pinch' }, scale: 1 });
      }, image);
      assert.equal(response.ok, false); assert.equal(response.error.code, 'WEBGL_CONTEXT_LOST');
    });
    assert.deepEqual(remoteRequests, [], 'Desktop must not make any HTTP requests');
  } finally { await app.close(); }
});
