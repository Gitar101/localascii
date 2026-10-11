import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/engine/fx/context.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { gradePixel, sampleFrame } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('CPU tone inverts before contrast and applies brightness once', () => {
  assert.equal(gradePixel(100, 2, 10, true), 207.5);
  assert.equal(gradePixel(100, 1, 10, false), 125.5);
});

test('sampling cache distinguishes sources, dimensions and tone', () => {
  let current;
  globalThis.document = { createElement: () => ({
    getContext: () => ({ clearRect() {}, drawImage(source) { current = source; },
      getImageData: () => ({ data: new Uint8ClampedArray(current.pixels) }) })
  }) };
  try {
    const source = { pixels: [100, 100, 100, 255] };
    assert.deepEqual([...sampleFrame(source, 1, 1, 'same', { contrast: 0, brightness: 10, invert: false })],
      [126, 126, 126, 255]);
    assert.deepEqual([...sampleFrame(source, 1, 1, 'same', { contrast: 0, brightness: 0, invert: false })],
      [100, 100, 100, 255]);
    const second = { pixels: [25, 25, 25, 255] };
    assert.deepEqual([...sampleFrame(second, 1, 1, 'same')], [25, 25, 25, 255]);
    source.pixels = [100, 100, 100, 255, 120, 120, 120, 255];
    assert.equal(sampleFrame(source, 2, 1, 'same').length, 8);
  } finally { delete globalThis.document; }
});
