import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { _electron } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve('releases/LocalAscii-win32-x64');
const executable = path.join(root, 'LocalAscii.exe');
const modules = path.join(root, 'resources/app.asar.unpacked/node_modules');
const ffmpeg = path.join(modules, 'ffmpeg-static/ffmpeg.exe');
const ffprobe = path.join(modules, 'ffprobe-static/bin/win32/x64/ffprobe.exe');
await Promise.all([executable, ffmpeg, ffprobe].map(file => access(file)));
const directory = await mkdtemp(path.join(tmpdir(), 'localascii-package-test-'));
const inputPath = path.join(directory, 'input.mp4');
function codec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
function count(file) {
  const info = JSON.parse(codec(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file]));
  assert.equal(Number(info.streams.find(stream => stream.codec_type === 'video').nb_read_frames), 4);
  return info;
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, client;
try {
  codec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=4:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', inputPath]);
  app = await _electron.launch({ executablePath: executable, args: ['--test'], env, timeout: 30_000 });
  const page = await app.firstWindow();
  await page.context().setOffline(true);
  await page.waitForFunction(() => Boolean(window.localAscii));
  await page.locator('#file-input').setInputFiles(inputPath);
  await page.locator('#media-timeline').waitFor({ state: 'visible' });
  const gifPath = path.join(directory, 'desktop.gif');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, gifPath);
  await page.locator('#media-format').selectOption('gif');
  await page.locator('#media-fps').fill('4');
  await page.locator('#export').click();
  await page.locator('#status').filter({ hasText: 'GIF exported: 4 frames' }).waitFor();
  count(gifPath);
  await app.close(); app = undefined;

  client = new Client({ name: 'packaged-media-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: executable, args: ['--mcp'], env, stderr: 'pipe' }));
  const outputPath = path.join(directory, 'mcp.mp4');
  const result = await client.callTool({ name: 'render_media', arguments: { inputPath, outputPath, fps: 4,
    recipe: { renderMode: 'thermal', contrast: 0 } } });
  assert(!result.isError, JSON.stringify(result.content));
  assert(count(outputPath).streams.some(stream => stream.codec_type === 'audio'));
  console.log('Packaged desktop GIF and MCP MP4 exports passed with bundled codecs.');
} finally { await client?.close(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
