import { limits, RenderError } from './recipe';

export function inspectImage(image: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match || match[2].length % 4 !== 0) {
    throw new RenderError('INVALID_IMAGE', 'Use a PNG, JPEG or WebP base64 data URL.');
  }
  const size = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (size > limits.maxInputBytes) throw new RenderError('IMAGE_TOO_LARGE', 'Input limit is 32 MiB.');
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  let width = 0, height = 0;
  const tag = (offset: number, text: string) => text.split('').every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (match[1] === 'png' && bytes.length >= 33 && bytes[0] === 137 && tag(1, 'PNG\r\n\x1a\n') && tag(12, 'IHDR')) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (match[1] === 'jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    for (let p = 2; p + 8 < bytes.length;) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 217 || marker === 218) break;
      if (marker >= 208 && marker <= 215) continue;
      const length = view.getUint16(p);
      if (length < 2 || p + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        height = view.getUint16(p + 3); width = view.getUint16(p + 5); break;
      }
      p += length;
    }
  } else if (match[1] === 'webp' && bytes.length >= 30 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
    if (tag(12, 'VP8X')) {
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
    } else if (tag(12, 'VP8 ') && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    } else if (tag(12, 'VP8L') && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
    }
  }
  validateDimensions(width, height);
  return { bytes, width, height, mimeType: `image/${match[1]}` };
}

export function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RenderError('INVALID_IMAGE', 'Invalid image header or unsupported image encoding.');
  }
  if (width > limits.maxDimension || height > limits.maxDimension || width * height > limits.maxPixels) {
    throw new RenderError('IMAGE_TOO_LARGE', 'Limit is 16,000,000 pixels and 8,192 pixels per side.');
  }
}
