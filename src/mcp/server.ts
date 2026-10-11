import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { capabilities, limits, recipeSchema, RenderError, RenderRequest, RenderResult } from '../engine/recipe';
import { inspectImage } from '../engine/image';
import { mediaLimits, mediaSettings, FrameRequest, FrameResult } from '../engine/media-recipe';
import { renderMedia } from '../desktop/media';
import { pathToFileURL } from 'node:url';

export async function serveMcp(render: (request: RenderRequest) => Promise<RenderResult>,
  renderFrame: (request: FrameRequest) => Promise<FrameResult>) {
  const server = new McpServer({ name: 'localascii', version: '0.1.0' });
  server.registerTool('list_filters', {
    description: 'List available filters, reference inventory, controls, presets and honest parity status.',
    inputSchema: z.object({}).strict()
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ ...capabilities(),
    media: { inputs: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'gif'],
      outputs: ['mp4', 'webm', 'gif'], limits: mediaLimits, offline: true } }) }] }));
  server.registerTool('render_image', {
    description: 'Render an image locally with the same engine as LocalAscii desktop. Unsupported filters and controls are errors. Reference parity is not yet verified.',
    inputSchema: z.object({
      image: z.string().max(48 * 1024 * 1024).optional().describe('PNG, JPEG or WebP base64 data URL'),
      inputPath: z.string().max(4096).optional().describe('Absolute path to a local PNG, JPEG or WebP file'),
      recipe: recipeSchema.default({}),
      scale: z.number().finite().min(0.1).max(4).default(1),
      outputPath: z.string().max(4096).optional().describe('Optional absolute PNG output path; no overwriting')
    }).strict()
  }, async ({ image, inputPath, recipe, scale, outputPath }) => {
    try {
      if (Boolean(image) === Boolean(inputPath)) throw new RenderError('INVALID_REQUEST',
        'Provide exactly one of image or inputPath.');
      if (inputPath) {
        if (!path.isAbsolute(inputPath)) throw new RenderError('INVALID_PATH', 'inputPath must be absolute.');
        const info = await stat(inputPath);
        if (!info.isFile() || info.size > limits.maxInputBytes) throw new RenderError('IMAGE_TOO_LARGE', 'Input must be a file up to 32 MiB.');
        const types: Record<string, string> = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };
        const type = types[path.extname(inputPath).toLowerCase()];
        if (!type) throw new RenderError('INVALID_IMAGE', 'Supported extensions: .png, .jpg, .jpeg, .webp.');
        image = `data:image/${type};base64,${(await readFile(inputPath)).toString('base64')}`;
      }
      inspectImage(image!);
      if (outputPath && (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.png')) {
        throw new RenderError('INVALID_PATH', 'outputPath must be an absolute PNG path.');
      }
      const result = await render({ image: image!, recipe, scale });
      const data = result.image.slice(result.image.indexOf(',') + 1);
      if (outputPath) await writeFile(outputPath, Buffer.from(data, 'base64'), { flag: 'wx' });
      return { content: [
        { type: 'image' as const, data, mimeType: 'image/png' },
        { type: 'text' as const, text: JSON.stringify({ ...result, image: undefined, outputPath }) }
      ] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({
        code: error instanceof RenderError ? error.code : 'RENDER_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }) }] };
    }
  });
  server.registerTool('render_media', {
    description: 'Filter a local video or animated GIF frame by frame, entirely offline. Export MP4, WebM or animated GIF to a new absolute output path. Video audio is preserved by default. FPS resamples timing; GIF timing has centisecond precision. Limits: 120 seconds, 3600 frames, 1080p pixel budget.',
    inputSchema: z.object({ inputPath: z.string().min(1).max(4096),
      outputPath: z.string().min(1).max(4096), ...mediaSettings }).strict()
  }, async (request, extra) => {
    try {
      const result = await renderMedia(request, renderFrame, { signal: extra.signal });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) },
        { type: 'resource_link' as const, uri: pathToFileURL(result.outputPath).href,
          name: path.basename(result.outputPath), mimeType: result.format === 'gif' ? 'image/gif' : `video/${result.format}` }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({
        code: error instanceof RenderError ? error.code : 'MEDIA_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }) }] };
    }
  });
  await server.connect(new StdioServerTransport());
  return server;
}
