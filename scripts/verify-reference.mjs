import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchApp, fixture } from '../tests/helpers.mjs';
import { implementedModes, defaults } from '../app/recipe.mjs';
import reference from '../research/catalog.json' with { type: 'json' };

const browser = await chromium.launch();
const { app, page: local } = await launchApp();
const upstream = await browser.newPage();
const results = [];
try {
  await upstream.goto(reference.source, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const text = await upstream.locator('body').innerText();
  if (/verify you are human|checking your browser|captcha/i.test(text)) {
    throw new Error('Human verification requires user takeover. Reference checks stopped.');
  }
  await upstream.waitForFunction(() => window.__AM?.ready(), null, { timeout: 60_000 });
  const image = await fixture(local, 256, 192);
  for (const mode of implementedModes) {
    const recipe = { ...defaults, renderMode: mode, fontSize: 11 };
    const actual = await upstream.evaluate(async ({ image, recipe, baseline }) => {
      const result = await window.__AM.renderOnce({ image, recipe: { ...baseline, ...recipe }, scale: 1,
        time: 0, enhance: false, autoLevels: false, embedRecipe: false });
      return { ...result, effectiveRecipe: Object.fromEntries(Object.keys(recipe).map(key => [key, window.__AM.state[key]])) };
    }, { image, recipe, baseline: reference.recipeDefaults });
    if (actual.modeGated || actual.mode !== mode) {
      results.push({ mode, status: 'reference-gated', detail: actual.modeGated }); continue;
    }
    const own = await local.evaluate(request => window.localAscii.render(request), { image, recipe: actual.effectiveRecipe, scale: 1 });
    if (!own.ok) throw new Error(JSON.stringify(own.error));
    const metrics = await local.evaluate(async ({ a, b }) => {
      const decode = async data => { const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height); };
      const [left, right] = await Promise.all([decode(a), decode(b)]);
      if (left.width !== right.width || left.height !== right.height) return { dimensionMismatch: true };
      let changed = 0, total = 0, maximum = 0;
      for (let i = 0; i < left.data.length; i++) { const delta = Math.abs(left.data[i] - right.data[i]);
        if (delta) changed++; total += delta; maximum = Math.max(maximum, delta); }
      return { changedChannels: changed, meanAbsoluteError: total / left.data.length, maximumError: maximum };
    }, { a: own.value.image, b: actual.png });
    results.push({ mode, status: metrics.changedChannels === 0 ? 'exact-for-fixture' : 'mismatch',
      recipe: actual.effectiveRecipe, ...metrics });
    await mkdir(`test-results/reference/${mode}`, { recursive: true });
    await writeFile(`test-results/reference/${mode}/local.png`, Buffer.from(own.value.image.split(',')[1], 'base64'));
    await writeFile(`test-results/reference/${mode}/reference.png`, Buffer.from(actual.png.split(',')[1], 'base64'));
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await mkdir('test-results/reference', { recursive: true });
  await writeFile('test-results/reference/report.json', JSON.stringify({ checkedAt: new Date().toISOString(),
    source: reference.source, input: '256 x 192 deterministic RGB fixture', results }, null, 2));
  await app.close(); await browser.close();
}
