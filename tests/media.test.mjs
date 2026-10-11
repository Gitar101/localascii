import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchApp } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path;
const { renderMedia, inspectMedia } = require('../app/media.cjs');
function codec(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
function probe(file) {
  return JSON.parse(codec(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]));
}

test('local GIF/video frames, audio, desktop playback and MCP export', { timeout: 180_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'localascii-media-test-'));
  const inputPath = path.join(directory, 'input.mp4'), gifPath = path.join(directory, 'input.gif');
  codec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=4:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', inputPath]);
  codec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', inputPath, '-an', '-vf', 'fps=4', gifPath]);
  const { app, page } = await launchApp();
  let client;
  try {
    const remote = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
    await page.context().setOffline(true);
    const render = async frame => {
      const result = await page.evaluate(frame => window.localAscii.renderFrame(frame), frame);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    const recipe = { renderMode: 'thermal', contrast: 0, thermalNoise: 0 };
    await t.test('raw frames share image rendering and invalidate GPU coverage caches', async () => {
      for (const renderMode of ['characters', 'thermal', 'lofi', 'marble', 'topography']) {
        const result = await page.evaluate(async renderMode => {
          const source = document.createElement('canvas'); source.width = 12; source.height = 8;
          const ctx = source.getContext('2d'), outputs = [];
          for (const color of ['#113355', '#aabbcc']) {
            ctx.fillStyle = color; ctx.fillRect(0, 0, 12, 8);
            const pixels = ctx.getImageData(0, 0, 12, 8).data;
            const recipe = { renderMode, contrast: 0, coverage: 60, fontSize: 4 };
            const data = btoa(String.fromCharCode(...pixels));
            const frame = await window.localAscii.renderFrame({ data, width: 12, height: 8, recipe });
            const image = await window.localAscii.render({ image: source.toDataURL(), recipe });
            if (!frame.ok || !image.ok) return { error: frame.error || image.error };
            const decoded = new Image(); decoded.src = image.value.image; await decoded.decode();
            ctx.drawImage(decoded, 0, 0);
            outputs.push({ raw: frame.value.data, png: btoa(String.fromCharCode(...ctx.getImageData(0, 0, 12, 8).data)) });
          }
          return { outputs };
        }, renderMode);
        assert(!result.error, JSON.stringify(result.error));
        for (const output of result.outputs) assert.equal(output.raw, output.png, renderMode);
        assert.notEqual(result.outputs[0].raw, result.outputs[1].raw, `${renderMode} must render the new frame`);
      }
      const invalid = await page.evaluate(() => window.localAscii.renderFrame({ data: 'a', width: 1, height: 1, recipe: {} }));
      assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'INVALID_FRAME');
    });
    await t.test('MP4 preserves audio, dimensions, FPS and multiple changing frames', async () => {
      const outputPath = path.join(directory, 'filtered.mp4');
      const hashes = new Set(), progress = [];
      const result = await renderMedia({ inputPath, outputPath, recipe, fps: 4 }, async frame => {
        const result = await render(frame); hashes.add(result.data); return result;
      }, { progress: value => progress.push(value.frames) });
      assert.equal(result.frames, 4); assert.equal(hashes.size, 4);
      assert.equal(result.width, 64); assert.equal(result.height, 48); assert.equal(result.hasAudio, true);
      assert.deepEqual(progress, [1, 2, 3, 4]);
      const info = probe(outputPath), video = info.streams.find(stream => stream.codec_type === 'video');
      assert.equal(Number(video.nb_read_frames), 4); assert.equal(video.avg_frame_rate, '4/1');
      assert(info.streams.some(stream => stream.codec_type === 'audio'));
      assert(Math.abs(Number(info.format.duration) - 1) < 0.1);
    });
    await t.test('animated GIF input exports a multiframe GIF and silent WebM', async () => {
      for (const format of ['gif', 'webm']) {
        const outputPath = path.join(directory, `filtered.${format}`);
        const result = await renderMedia({ inputPath: gifPath, outputPath, format, recipe, fps: 4,
          audio: false, scale: 0.5 }, render);
        assert.equal(result.frames, 4); assert.equal(result.hasAudio, false);
        const info = probe(outputPath), video = info.streams.find(stream => stream.codec_type === 'video');
        assert.equal(Number(video.nb_read_frames), 4); assert.equal(video.width, 32); assert.equal(video.height, 24);
        assert(!info.streams.some(stream => stream.codec_type === 'audio'));
      }
    });
    await t.test('trim and scale are applied and existing outputs are protected', async () => {
      const outputPath = path.join(directory, 'trimmed.webm');
      const result = await renderMedia({ inputPath, outputPath, format: 'webm', fps: 4,
        start: 0.25, duration: 0.5, scale: 0.5, audio: false, recipe }, render);
      assert.equal(result.frames, 2); assert.equal(result.width, 32);
      await assert.rejects(renderMedia({ inputPath, outputPath, format: 'webm', recipe }, render),
        error => error.code === 'OUTPUT_EXISTS');
      await assert.rejects(renderMedia({ inputPath, outputPath: path.join(directory, 'wrong.gif'), recipe }, render),
        error => error.code === 'INVALID_PATH');
      await assert.rejects(inspectMedia('https://example.com/video.mp4'), error => error.code === 'INVALID_PATH');
    });
    await t.test('portrait rotation metadata retains the displayed aspect ratio', async () => {
      const rotated = path.join(directory, 'portrait.mp4'), outputPath = path.join(directory, 'portrait-filtered.mp4');
      codec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-display_rotation', '90', '-i', inputPath, '-c', 'copy', rotated]);
      const info = await inspectMedia(rotated);
      assert.equal(info.width, 48); assert.equal(info.height, 64);
      const result = await renderMedia({ inputPath: rotated, outputPath, fps: 4, recipe }, render);
      assert.equal(result.width, 48); assert.equal(result.height, 64);
      const video = probe(outputPath).streams.find(stream => stream.codec_type === 'video');
      assert.equal(video.width, 48); assert.equal(video.height, 64);
    });
    await t.test('cancellation removes partial output and permits a later export', async () => {
      const outputPath = path.join(directory, 'cancelled.mp4'), abort = new AbortController();
      await assert.rejects(renderMedia({ inputPath, outputPath, fps: 4, recipe }, async frame => {
        const result = await render(frame); abort.abort(); return result;
      }, { signal: abort.signal }), error => error.code === 'MEDIA_CANCELLED');
      await assert.rejects(stat(outputPath), error => error.code === 'ENOENT');
      const result = await renderMedia({ inputPath, outputPath, fps: 4, recipe }, render);
      assert.equal(result.frames, 4);
    });
    await t.test('desktop plays, seeks and exports media through the real IPC path', async () => {
      await page.locator('#file-input').setInputFiles(inputPath);
      await page.locator('#media-timeline').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#video-preview').width > 1);
      const before = await page.locator('#video-preview').evaluate(canvas => canvas.toDataURL());
      await page.getByRole('button', { name: 'Play media' }).click();
      await page.waitForFunction(() => document.querySelector('#media-source').currentTime > 0.2);
      await page.getByRole('button', { name: 'Pause media' }).click();
      await page.locator('#media-seek').fill('0.75');
      await page.locator('#media-seek').dispatchEvent('input');
      await page.waitForFunction(() => Math.abs(document.querySelector('#media-source').currentTime - 0.75) < 0.01);
      await page.waitForFunction(before => document.querySelector('#video-preview').toDataURL() !== before, before);
      const outputPath = path.join(directory, 'desktop.mp4');
      await app.evaluate(({ dialog }, outputPath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: outputPath });
      }, outputPath);
      await page.locator('#media-fps').fill('4');
      await page.getByRole('button', { name: 'Export media', exact: true }).click();
      await page.locator('#status').filter({ hasText: 'MP4 exported: 4 frames' }).waitFor();
      assert.equal(Number(probe(outputPath).streams.find(stream => stream.codec_type === 'video').nb_read_frames), 4);
      await page.locator('#file-input').setInputFiles(gifPath);
      await page.waitForFunction(() => document.querySelector('#image-name').textContent === 'input.gif');
      assert(await page.locator('#media-timeline').isVisible());
      assert.equal(await page.locator('#media-audio').isDisabled(), true);
    });
    await t.test('MCP renders video with typed settings and returns a local media resource', async () => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['scripts/launch.cjs', '--mcp'], cwd: process.cwd(), env, stderr: 'pipe' });
      client = new Client({ name: 'media-test', version: '1.0.0' });
      await client.connect(transport);
      const tools = await client.listTools(), tool = tools.tools.find(tool => tool.name === 'render_media');
      assert(tool); assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.inputSchema.properties.fps.maximum, 60);
      const outputPath = path.join(directory, 'mcp.mp4');
      const result = await client.callTool({ name: 'render_media', arguments: { inputPath, outputPath, recipe, fps: 4 } });
      assert(!result.isError, JSON.stringify(result.content));
      assert.equal(JSON.parse(result.content.find(item => item.type === 'text').text).frames, 4);
      assert(result.content.some(item => item.type === 'resource_link' && item.mimeType === 'video/mp4'));
      assert.equal(Number(probe(outputPath).streams.find(stream => stream.codec_type === 'video').nb_read_frames), 4);
    });
    assert.deepEqual(remote, [], 'Media playback and export must remain offline');
  } finally { await client?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
