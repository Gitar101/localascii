import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import path from 'node:path';
import { readFile, writeFile, stat, rm } from 'node:fs/promises';
import { RenderError, RenderRequest, RenderResult, limits } from '../engine/recipe';
import { inspectImage } from '../engine/image';
import { connect } from 'node:net';
import { receiveFrames, sendFrame } from './pipe';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FrameRequest, FrameResult, mediaSettings } from '../engine/media-recipe';
import { prepareMedia, renderMedia, stopMediaProcesses } from './media';
import { z } from 'zod';

const mcp = process.argv.includes('--render-worker');
app.commandLine.appendSwitch('disable-logging');
if (mcp || process.argv.includes('--test')) app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'localascii-')));
let window: BrowserWindow | null = null;
let queue: Promise<unknown> = Promise.resolve();
const previewDirectories = new Set<string>();
let mediaAbort: AbortController | null = null;

async function createWindow() {
  const win = new BrowserWindow({ width: 1540, height: 930, minWidth: 760, minHeight: 560,
    show: false, backgroundColor: '#000000', title: 'LocalAscii', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, backgroundThrottling: false, webSecurity: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone', () => { win.destroy(); });
  await win.loadFile(path.join(__dirname, 'index.html'), { query: { surface: mcp ? 'worker' : 'desktop' } });
  window = win;
  win.on('closed', () => { if (window === win) window = null; });
  if (!mcp) win.show();
  return win;
}

function render<T extends RenderResult | FrameResult>(request: RenderRequest | FrameRequest,
  method: 'render' | 'renderFrame' = 'render'): Promise<T> {
  const task = queue.then(async () => {
    const win = window ?? await createWindow();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        win.webContents.executeJavaScript(`window.localAscii.${method}(${JSON.stringify(request)})`),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => {
          win.destroy(); reject(new RenderError('RENDER_TIMEOUT', 'Rendering exceeded 30 seconds.'));
        }, 30_000); })
      ]);
      if (!result.ok) throw new RenderError(result.error.code, result.error.message);
      return result.value as T;
    } finally { clearTimeout(timeout); }
  });
  queue = task.catch(() => undefined);
  return task;
}

async function main() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['file:', 'data:', 'blob:'].some(prefix => details.url.startsWith(prefix)) });
  });
  await createWindow();
  if (mcp) {
    const pipe = process.env.LOCALASCII_WORKER_PIPE, token = process.env.LOCALASCII_WORKER_TOKEN;
    if (!pipe || !token) throw new Error('Render worker must be started through the MCP launcher.');
    const socket = connect(pipe, () => sendFrame(socket, { type: 'hello', token }));
    socket.on('error', error => { process.stderr.write(`${error.message}\n`); app.exit(1); });
    socket.on('close', () => app.quit());
    receiveFrames(socket, message => {
      if (!['render', 'frame'].includes(message?.type) || typeof message.id !== 'string') { socket.destroy(); return; }
      void render(message.request, message.type === 'frame' ? 'renderFrame' : 'render').then(value => sendFrame(socket, { type: 'result', id: message.id, ok: true, value }),
        error => sendFrame(socket, { type: 'result', id: message.id, ok: false, error: {
          code: error instanceof RenderError ? error.code : 'RENDER_FAILED',
          message: error instanceof Error ? error.message : String(error)
        } }));
    });
  } else {
    ipcMain.handle('image:open', async event => {
      if (event.sender !== window?.webContents) throw new Error('Invalid sender.');
      const selected = await dialog.showOpenDialog(window!, { properties: ['openFile'],
        filters: [{ name: 'Images, videos and GIFs', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'] }] });
      if (selected.canceled) return null;
      const file = selected.filePaths[0], info = await stat(file);
      if (['.gif', '.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].includes(path.extname(file).toLowerCase())) {
        const media = await prepareMedia(file);
        if (media.cleanup) previewDirectories.add(media.cleanup);
        return { media };
      }
      if (info.size > limits.maxInputBytes) throw new Error('Input limit is 32 MiB.');
      const extension = path.extname(file).toLowerCase();
      const type = extension === '.png' ? 'png' : extension === '.webp' ? 'webp' : 'jpeg';
      const image = `data:image/${type};base64,${(await readFile(file)).toString('base64')}`;
      inspectImage(image);
      return { image, name: path.basename(file) };
    });
    ipcMain.handle('image:save', async (event, image: unknown) => {
      if (event.sender !== window?.webContents || typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
        throw new Error('Invalid PNG export.');
      }
      inspectImage(image);
      const selected = await dialog.showSaveDialog(window!, { defaultPath: 'localascii.png',
        filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (selected.canceled || !selected.filePath) return null;
      await writeFile(selected.filePath, Buffer.from(image.split(',')[1], 'base64'));
      return selected.filePath;
    });
    ipcMain.handle('media:open', async (event, file: unknown) => {
      if (event.sender !== window?.webContents || typeof file !== 'string') throw new Error('Invalid sender or media path.');
      const media = await prepareMedia(file);
      if (media.cleanup) previewDirectories.add(media.cleanup);
      return media;
    });
    ipcMain.handle('media:export', async (event, input: unknown) => {
      if (event.sender !== window?.webContents) throw new Error('Invalid sender.');
      const request = z.object({ inputPath: z.string().min(1).max(4096), ...mediaSettings }).strict().parse(input);
      if (mediaAbort) throw new Error('A media export is already running.');
      const controller = new AbortController(); mediaAbort = controller;
      try {
        const selected = await dialog.showSaveDialog(window!, { defaultPath: `localascii.${request.format}`,
          filters: [{ name: `${request.format.toUpperCase()} media`, extensions: [request.format] }] });
        if (selected.canceled || !selected.filePath) return null;
        return await renderMedia({ ...request, outputPath: selected.filePath },
          frame => render<FrameResult>(frame, 'renderFrame'), {
            signal: controller.signal,
            progress: progress => { if (!event.sender.isDestroyed()) event.sender.send('media:progress', progress); }
          });
      } finally { mediaAbort = null; }
    });
    ipcMain.handle('media:cancel', event => {
      if (event.sender !== window?.webContents) throw new Error('Invalid sender.');
      mediaAbort?.abort();
    });
  }
}
app.on('window-all-closed', () => { if (!mcp) app.quit(); });
app.on('activate', () => { if (!window && !mcp) void createWindow(); });
app.on('before-quit', () => {
  mediaAbort?.abort(); stopMediaProcesses();
  for (const directory of previewDirectories) void rm(directory, { recursive: true, force: true });
});
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); app.exit(1); });
