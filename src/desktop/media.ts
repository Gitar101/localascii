import { spawn, execFile, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RenderError, implementedModes } from '../engine/recipe';
import { validateDimensions } from '../engine/image';
import { FrameRequest, FrameResult, MediaInfo, MediaSource, MediaResult,
  mediaLimits, parseMediaRequest } from '../engine/media-recipe';

const executablePath = (file: string) => file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
const ffmpegBinary = require('ffmpeg-static') as string | null;
const ffmpeg = ffmpegBinary ? executablePath(ffmpegBinary) : null;
const ffprobe = executablePath(require('ffprobe-static').path as string);
const exec = promisify(execFile);
const processes = new Set<ChildProcessWithoutNullStreams>();
let busy = false;

async function codecs() {
  if (!ffmpeg) throw new RenderError('CODEC_UNAVAILABLE', 'Bundled FFmpeg is missing. Run setup before launching.');
  try { await Promise.all([access(ffmpeg), access(ffprobe)]); }
  catch { throw new RenderError('CODEC_UNAVAILABLE', 'Bundled media codecs are missing. No runtime downloads are performed.'); }
}

export async function inspectMedia(inputPath: string, signal?: AbortSignal): Promise<MediaInfo> {
  if (!path.isAbsolute(inputPath) || !['.mp4', '.webm', '.mov', '.mkv', '.avi', '.gif', '.m4v'].includes(path.extname(inputPath).toLowerCase())) {
    throw new RenderError('INVALID_PATH', 'Use an absolute local MP4, WebM, MOV, MKV, AVI, M4V or GIF path.');
  }
  const file = await stat(inputPath);
  if (!file.isFile() || file.size > mediaLimits.maxInputBytes) {
    throw new RenderError('MEDIA_TOO_LARGE', 'Media input must be a file up to 512 MiB.');
  }
  await codecs();
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
    '-show_streams', '-show_format', '-of', 'json', inputPath],
  { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, signal });
  const info = JSON.parse(stdout);
  const video = info.streams?.find((stream: any) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video) throw new RenderError('INVALID_MEDIA', 'No video or GIF frames were found.');
  const rotation = Number(video.tags?.rotate || video.side_data_list?.find((data: any) => data.rotation !== undefined)?.rotation || 0);
  const sideways = Math.abs(rotation) % 180 === 90;
  const width = sideways ? video.height : video.width, height = sideways ? video.width : video.height;
  validateDimensions(width, height);
  let duration = Number(info.format?.duration || video.duration);
  if ((!Number.isFinite(duration) || duration <= 0) && video.codec_name === 'gif') {
    const packets = await exec(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
      '-read_intervals', '%+121', '-select_streams', 'v:0', '-show_packets',
      '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', inputPath],
    { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, signal });
    duration = 0;
    for (const packet of JSON.parse(packets.stdout).packets || []) {
      const end = Number(packet.pts_time) + Number(packet.duration_time);
      if (Number.isFinite(end)) duration = Math.max(duration, end);
    }
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new RenderError('INVALID_MEDIA', 'Media duration could not be determined.');
  const [a, b] = String(video.avg_frame_rate || video.r_frame_rate || '24/1').split('/').map(Number);
  return { width, height, duration,
    fps: Number.isFinite(a / b) && a / b > 0 ? a / b : 24,
    hasAudio: Boolean(info.streams?.some((stream: any) => stream.codec_type === 'audio')) };
}

function startCodec(args: string[], signal?: AbortSignal) {
  const child = spawn(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-nostdin',
    '-threads', '2', ...args], { windowsHide: true, stdio: 'pipe', signal });
  processes.add(child);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
  child.stdin.on('error', () => { /* The completion promise reports codec exit or cancellation. */ });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      processes.delete(child);
      if (code === 0) resolve();
      else reject(new RenderError(signal?.aborted ? 'MEDIA_CANCELLED' : 'CODEC_FAILED',
        signal?.aborted ? 'Media job cancelled.' : stderr || `Media codec exited with code ${code}.`));
    });
  });
  void done.catch(() => undefined);
  return { child, done };
}

export function stopMediaProcesses() {
  for (const child of processes) child.kill();
}

export async function prepareMedia(inputPath: string): Promise<MediaSource & { cleanup?: string }> {
  const info = await inspectMedia(inputPath);
  if (info.duration > mediaLimits.maxDuration) throw new RenderError('MEDIA_TOO_LONG', 'Desktop preview supports clips up to 120 seconds.');
  let preview = inputPath, cleanup: string | undefined;
  // Normalize GIFs and less widely supported containers for local Chromium playback.
  if (!['.mp4', '.webm', '.m4v'].includes(path.extname(inputPath).toLowerCase())) {
    cleanup = await mkdtemp(path.join(tmpdir(), 'localascii-preview-'));
    preview = path.join(cleanup, 'preview.mp4');
    try {
      const codec = startCodec([...(path.extname(inputPath).toLowerCase() === '.gif' ? ['-ignore_loop', '1'] : []),
        '-protocol_whitelist', 'file,pipe', '-i', inputPath, '-t', String(info.duration),
        '-map', '0:V:0', '-an', '-vf', "scale='max(2,trunc(min(1280,iw)/2)*2)':-2",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', preview],
      AbortSignal.timeout(120_000));
      codec.child.stdout.resume(); await codec.done;
    } catch (error) { await rm(cleanup, { recursive: true, force: true }); throw error; }
  }
  return { inputPath, name: path.basename(inputPath), info, url: pathToFileURL(preview).href, cleanup };
}

export async function renderMedia(value: unknown, renderFrame: (frame: FrameRequest) => Promise<FrameResult>,
  options: { signal?: AbortSignal; progress?: (value: { frames: number; total: number }) => void } = {}): Promise<MediaResult> {
  const r = parseMediaRequest(value);
  if (!(implementedModes as readonly string[]).includes(r.recipe.renderMode)) throw new RenderError('INVALID_MODE', 'This effect is not implemented locally.');
  if (r.recipe.animated) throw new RenderError('INVALID_REQUEST', 'Animated effect parameters are not supported yet.');
  if (!path.isAbsolute(r.outputPath) || path.extname(r.outputPath).toLowerCase() !== `.${r.format}` || r.outputPath === r.inputPath) {
    throw new RenderError('INVALID_PATH', 'Use a separate absolute output path matching the selected format.');
  }
  if (busy) throw new RenderError('MEDIA_BUSY', 'A media export is already running.');
  busy = true;
  const abort = new AbortController();
  const externalAbort = () => abort.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) abort.abort();
  const timer = setTimeout(() => abort.abort(), mediaLimits.timeoutMs);
  let directory: string | undefined;
  let decoder: ReturnType<typeof startCodec> | undefined, encoder: ReturnType<typeof startCodec> | undefined;
  try {
    const info = await inspectMedia(r.inputPath, abort.signal);
    const duration = r.duration === undefined ? info.duration - r.start : Math.min(r.duration, info.duration - r.start);
    if (duration <= 0 || duration > mediaLimits.maxDuration) throw new RenderError('INVALID_REQUEST', 'Select a valid segment up to 120 seconds.');
    const total = Math.ceil(duration * r.fps);
    if (total > mediaLimits.maxFrames) throw new RenderError('MEDIA_TOO_LONG', 'Export limit is 3600 frames. Reduce FPS or duration.');
    const width = Math.max(1, Math.round(info.width * r.scale)), height = Math.max(1, Math.round(info.height * r.scale));
    validateDimensions(width, height);
    if (width * height > mediaLimits.maxFramePixels) throw new RenderError('MEDIA_TOO_LARGE', 'Video frame limit is 2,073,600 pixels. Reduce scale.');
    try { await access(r.outputPath); throw new RenderError('OUTPUT_EXISTS', 'Output exists. Choose a new filename.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    directory = await mkdtemp(path.join(tmpdir(), 'localascii-export-'));
    const staged = path.join(directory, `output.${r.format}`);
    const audio = r.audio && info.hasAudio && r.format !== 'gif';
    const encoding = ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
      '-framerate', String(r.fps), '-i', 'pipe:0'];
    if (audio) encoding.push('-ss', String(r.start), '-t', String(duration), '-protocol_whitelist', 'file,pipe', '-i', r.inputPath);
    encoding.push('-map', r.format === 'gif' ? '[out]' : '0:v:0');
    if (audio) encoding.push('-map', '1:a:0', '-c:a', r.format === 'mp4' ? 'aac' : 'libopus');
    else encoding.push('-an');
    if (r.format === 'gif') encoding.push('-filter_complex',
      '[0:v]split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1[out]', '-loop', '0');
    else encoding.push('-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-c:v',
      r.format === 'mp4' ? 'libx264' : 'libvpx-vp9',
      ...(r.format === 'mp4' ? ['-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart'] :
        ['-deadline', 'realtime', '-cpu-used', '5', '-crf', '30', '-b:v', '0']));
    encoding.push('-t', String(duration), staged);
    encoder = startCodec(encoding, abort.signal); encoder.child.stdout.resume();
    decoder = startCodec(['-ss', String(r.start), ...(path.extname(r.inputPath).toLowerCase() === '.gif' ? ['-ignore_loop', '1'] : []),
      '-protocol_whitelist', 'file,pipe', '-i', r.inputPath,
      '-t', String(duration), '-map', '0:V:0', '-an', '-vf', `fps=${r.fps},scale=${width}:${height}`,
      '-frames:v', String(total), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], abort.signal);
    decoder.child.stdin.end();
    const frameBytes = width * height * 4;
    let pending = Buffer.alloc(0), frames = 0;
    for await (const chunk of decoder.child.stdout) {
      abort.signal.throwIfAborted();
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameBytes) {
        const frame = pending.subarray(0, frameBytes); pending = pending.subarray(frameBytes);
        const filtered = await renderFrame({ data: frame.toString('base64'), width, height, recipe: r.recipe });
        abort.signal.throwIfAborted();
        const pixels = Buffer.from(filtered.data, 'base64');
        if (filtered.width !== width || filtered.height !== height || pixels.length !== frameBytes) {
          throw new RenderError('INVALID_FRAME', 'Renderer returned an invalid media frame.');
        }
        await new Promise<void>((resolve, reject) => encoder!.child.stdin.write(pixels,
          error => error ? reject(error) : resolve()));
        frames++; options.progress?.({ frames, total });
      }
    }
    await decoder.done;
    if (pending.length || frames === 0) throw new RenderError('INVALID_MEDIA', 'Media decoding returned incomplete frames.');
    encoder.child.stdin.end(); await encoder.done;
    abort.signal.throwIfAborted();
    try { await copyFile(staged, r.outputPath, constants.COPYFILE_EXCL); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RenderError('OUTPUT_EXISTS', 'Output exists. Choose a new filename.');
      throw error;
    }
    return { outputPath: r.outputPath, width: r.format === 'gif' ? width : Math.ceil(width / 2) * 2,
      height: r.format === 'gif' ? height : Math.ceil(height / 2) * 2, duration: frames / r.fps,
      fps: r.fps, frames, hasAudio: audio, format: r.format, parity: 'unverified' };
  } catch (error) {
    if (abort.signal.aborted) throw new RenderError('MEDIA_CANCELLED', 'Media export cancelled or exceeded its time limit.');
    throw error;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', externalAbort);
    decoder?.child.kill(); encoder?.child.kill();
    await Promise.allSettled([decoder?.done, encoder?.done]);
    if (directory) await rm(directory, { recursive: true, force: true });
    busy = false;
  }
}
