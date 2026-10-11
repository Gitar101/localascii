import { _electron } from 'playwright';

export async function launchApp() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: ['.', '--test'], env, timeout: 30_000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.localAscii));
  return { app, page };
}
export async function fixture(page, width = 96, height = 72) {
  return page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels.data[i] = x * 255 / Math.max(1, width - 1);
      pixels.data[i + 1] = y * 255 / Math.max(1, height - 1);
      pixels.data[i + 2] = (x * 71 + y * 47) % 256; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png');
  }, { width, height });
}
