import { z } from 'zod';
import { recipeSchema, RenderError } from './recipe';

export const mediaLimits = { maxInputBytes: 512 * 1024 * 1024, maxDuration: 120,
  maxFrames: 3600, maxFramePixels: 1920 * 1080, timeoutMs: 30 * 60 * 1000 };
export const mediaSettings = {
  recipe: recipeSchema.default({}),
  format: z.enum(['mp4', 'webm', 'gif']).default('mp4'),
  fps: z.number().finite().min(1).max(60).default(24),
  scale: z.number().finite().min(0.1).max(4).default(1),
  start: z.number().finite().min(0).default(0),
  duration: z.number().finite().min(0.05).max(mediaLimits.maxDuration).optional(),
  audio: z.boolean().default(true)
};
export const mediaRequestSchema = z.object({
  inputPath: z.string().min(1).max(4096), outputPath: z.string().min(1).max(4096),
  ...mediaSettings
}).strict();
export type MediaRequest = z.infer<typeof mediaRequestSchema>;
export type MediaInfo = { width: number; height: number; duration: number; fps: number; hasAudio: boolean };
export type MediaResult = MediaInfo & { outputPath: string; frames: number; format: MediaRequest['format'];
  parity: 'unverified' };
export type MediaSource = { inputPath: string; url: string; name: string; info: MediaInfo };
export type FrameRequest = { data: string; width: number; height: number; recipe: unknown };
export type FrameResult = { data: string; width: number; height: number };
export function parseMediaRequest(value: unknown) {
  const result = mediaRequestSchema.safeParse(value);
  if (!result.success) throw new RenderError('INVALID_REQUEST', result.error.message);
  return result.data;
}
