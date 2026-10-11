import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, parseRecipe, catalog, implementedModes, proModes, RenderError, renderRequestSchema,
  distortionAmountLimits } from '../app/recipe.mjs';

test('reference inventory is distinct from implemented filter support', () => {
  assert.equal(catalog.length, 100);
  assert.equal(new Set(catalog.map(item => item.id)).size, 100);
  assert.equal(implementedModes.length, 81);
  assert.equal(catalog.filter(item => item.implemented).length, 90);
  assert.equal(catalog.find(item => item.id === 'crt').implemented, false);
  assert.equal(catalog.find(item => item.id === 'glass-cross').implemented, true);
  assert(catalog.every(item => item.parity === 'unverified'));
});
test('distortion amount bounds are validated separately for every mode', () => {
  for (const [renderMode, [min, max]] of Object.entries(distortionAmountLimits)) {
    assert.equal(parseRecipe({ renderMode, distortAmount: min }).distortAmount, min);
    assert.equal(parseRecipe({ renderMode, distortAmount: max }).distortAmount, max);
    assert.throws(() => parseRecipe({ renderMode, distortAmount: min - 1 }), RenderError);
    assert.throws(() => parseRecipe({ renderMode, distortAmount: max + 1 }), RenderError);
  }
  for (const recipe of [{ renderMode: 'polar', distortPolarMode: 'wrong' },
    { renderMode: 'zigzag', distortRidges: 2.5 }, { renderMode: 'pinch', distortRadius: 0 }]) {
    assert.throws(() => parseRecipe(recipe), RenderError);
  }
});
test('defaults and limits match the implemented reference recipe', () => {
  assert.equal(defaults.fontSize, 11); assert.equal(defaults.contrast, 100);
  assert.equal(defaults.charSet, '@#S08Xx+=-;:. ');
  assert.equal(defaults.bgMode, 'blur');
  for (const input of [{ fontSize: 0 }, { fontSize: Infinity }, { brightness: 101 },
    { coverage: -1 }, { typo: 1 }, { charSet: '' }, { bgSolidColor: 'red' }, { contrast: 259 }]) {
    assert.throws(() => parseRecipe(input), error => error instanceof RenderError && error.code === 'INVALID_RECIPE');
  }
});
test('partial recipes are defaulted and unknown request arguments rejected', () => {
  assert.equal(parseRecipe({ coverage: 15 }).coverage, 15);
  assert(!renderRequestSchema.safeParse({ image: 'x', unsupported: true }).success);
  assert(!renderRequestSchema.safeParse({ image: 'x', scale: 5 }).success);
});
test('Pro effect ranges are strict and animation controls are not silently ignored', () => {
  for (const recipe of [{ renderMode: 'droste', drZoom: 1 }, { renderMode: 'droste', drSpin: 361 },
    { renderMode: 'duotone', duoContrast: 201 }, { renderMode: 'duotone', duoShadow: 'gold' },
    { renderMode: 'emboss', embossDetail: 7 }, { renderMode: 'emboss', embossColor: 'other' },
    { renderMode: 'scanline', scanSpacing: 17 }, { renderMode: 'rgbsplit', rgbBalance: -1 },
    { renderMode: 'liquidglass', glassStyle: 'nope' }, { renderMode: 'thermal', thermalPalette: 'wrong' },
    { renderMode: 'crt', crtMask: 'weird' }, { renderMode: 'dither', ditherAlgo: 'nope' },
    { renderMode: 'datamosh', dmPalette: [] }, { renderMode: 'datamosh', dmPalette: ['#123456'] },
    { renderMode: 'datamosh', dmPalette: Array(6).fill('#123456') }]) {
    assert.throws(() => parseRecipe(recipe), RenderError);
  }
});
test('every pro mode parses with defaults and honors its control ranges', () => {
  for (const mode of [...implementedModes, ...proModes]) {
    const recipe = parseRecipe({ renderMode: mode });
    assert.equal(recipe.renderMode, mode);
  }
  assert.equal(parseRecipe({ renderMode: 'molten' }).moltenPalette, 'gold');
  assert.equal(parseRecipe({ renderMode: 'lens' }).lensBulge, 40);
  assert.equal(parseRecipe({ renderMode: 'liquidglass' }).glassStyle, 'liquid');
  assert.equal(parseRecipe({ renderMode: 'warhol' }).whGrid, 3);
  assert.equal(parseRecipe({ renderMode: 'posterize' }).posterizeLevels, 6);
  assert.equal(parseRecipe({ renderMode: 'ledmatrix' }).ledScale, 8);
  assert.equal(parseRecipe({ renderMode: 'smudge' }).smudgeColorA, '#1a0602');
  assert.equal(parseRecipe({ renderMode: 'glassorb' }).orbChroma, 35);
  assert.equal(parseRecipe({ renderMode: 'beacon' }).beaconDecay, 36);
});
