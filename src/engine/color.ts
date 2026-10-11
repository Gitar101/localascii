import { GpuPass, TexturePlane } from './gpu';
import { Recipe, colorModes } from './recipe';
import { coverageField, coverageThreshold } from './coverage';

const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform sampler2D uCoverage;
uniform vec2 uSize;
uniform int uMode;
uniform vec3 uTone;
uniform vec4 uFactors;
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec4 uCoverageState;
out vec4 result;

vec3 colorAt(ivec2 point) {
  vec3 value = texelFetch(uSource, clamp(point, ivec2(0), ivec2(uSize) - 1), 0).rgb * 255.0;
  if (uTone.z > 0.5) value = 255.0 - value;
  return roundEven(clamp(uTone.x * (value - 128.0) + 128.0 + uTone.y, 0.0, 255.0));
}
float brightnessAt(ivec2 point) { return dot(colorAt(point), vec3(0.299, 0.587, 0.114)) / 255.0; }
ivec2 jsRound(vec2 value) { return ivec2(floor(value + 0.5)); }

void main() {
  ivec2 pixel = ivec2(int(gl_FragCoord.x), int(uSize.y) - 1 - int(gl_FragCoord.y));
  vec3 original = colorAt(pixel), processed = original;
  if (uMode == 0) {
    float value = clamp((brightnessAt(pixel) - uFactors.x) * uFactors.y + uFactors.x, 0.0, 1.0);
    if (uCoverageState.x >= 1.0) processed = mix(uDark, uLight, value);
    else if (uCoverageState.x > 0.0) {
      float field = texelFetch(uCoverage, pixel, 0).r;
      float gate = uCoverageState.y < -1.0 ? 1.0 : smoothstep(0.0, 1.0,
        (field - uCoverageState.y + 0.03) / 0.03);
      processed = mix(mix(original, uDark, uCoverageState.z), uLight, gate * value);
    }
  } else if (uMode == 1) {
    float multiplier = mod(float(pixel.y), uFactors.x) < uFactors.y ? uFactors.z : uFactors.w;
    processed = mix(original, roundEven(clamp(original * multiplier * uLight / 255.0, 0.0, 255.0)), uCoverageState.x);
  } else if (uMode == 2) {
    int spacing = int(uFactors.x);
    vec2 slope = vec2(brightnessAt(pixel + ivec2(spacing, 0)) - brightnessAt(pixel - ivec2(spacing, 0)),
      brightnessAt(pixel + ivec2(0, spacing)) - brightnessAt(pixel - ivec2(0, spacing))) / float(spacing);
    vec3 normal = normalize(vec3(slope, uFactors.y));
    float lighting = dot(normal, uDark);
    float relief = clamp(0.5 + 0.9 * lighting, 0.0, 1.0);
    float shine = pow(max(0.0, lighting), 14.0) * uFactors.z * 255.0;
    processed = (uFactors.w > 0.5 ? original * 1.5 : uLight) * relief + shine;
  } else {
    vec2 displacement = uFactors.xy;
    float falloff = 1.0 - uFactors.z + uFactors.z * dot(vec2(pixel) - uSize / 2.0, vec2(pixel) - uSize / 2.0)
      / max(1.0, dot(uSize / 2.0, uSize / 2.0));
    ivec2 red = jsRound(displacement * falloff * uFactors.w);
    ivec2 blue = jsRound(displacement * falloff * (2.0 - uFactors.w));
    processed = vec3(colorAt(pixel + red).r, original.g, colorAt(pixel - blue).b);
  }
  result = vec4(roundEven(clamp(processed, 0.0, 255.0)) / 255.0, 1.0);
}`;

const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const fullCoverage: TexturePlane = { width: 1, height: 1, data: new Float32Array([1]) };

export class ColorFilter {
  private readonly pass = new GpuPass(fragment);
  private field: TexturePlane = fullCoverage;
  private fieldKey = '';

  draw(source: HTMLCanvasElement, r: Recipe, sourceKey: string) {
    const w = source.width, h = source.height, amount = r.coverage / 100;
    const factors = [0, 0, 0, 0]; let dark = [0, 0, 0], light = [0, 0, 0];
    let threshold = -2, field = fullCoverage;
    const contrast = 259 * (r.contrast + 255) / (255 * (259 - r.contrast));
    if (r.renderMode === 'duotone') {
      factors[0] = r.duoMidpoint / 100; factors[1] = r.duoContrast / 100;
      dark = rgb(r.duoShadow); light = rgb(r.duoHighlight);
      if (amount > 0 && amount < 1) {
        const key = `${sourceKey}|${contrast}|${r.brightness}|${r.invert}`;
        if (key !== this.fieldKey) {
          const pixels = source.getContext('2d')!.getImageData(0, 0, w, h).data;
          const graded = new Uint8ClampedArray(pixels.length), luma = new Float32Array(w * h);
          for (let i = 0; i < pixels.length; i += 4) {
            for (let c = 0; c < 3; c++) graded[i + c] = contrast * ((r.invert ? 255 - pixels[i + c] : pixels[i + c]) - 128)
              + 128 + r.brightness * 2.55;
            luma[i / 4] = (0.299 * graded[i] + 0.587 * graded[i + 1] + 0.114 * graded[i + 2]) / 255;
          }
          this.field = coverageField(luma, w, h); this.fieldKey = key;
        }
        field = this.field; threshold = coverageThreshold(field, Math.min(1, amount * 2));
      }
    } else if (r.renderMode === 'scanline') {
      factors[0] = r.scanSpacing; factors[1] = r.scanThickness;
      factors[2] = 1 - r.scanDarkness / 100 * 0.9; factors[3] = 1 + r.scanBloom / 100 * 0.6;
      light = rgb(r.scanTint);
    } else if (r.renderMode === 'emboss') {
      const angle = r.embossSweep * Math.PI / 180, length = Math.hypot(1, 0.6);
      dark = [Math.cos(angle) / length, Math.sin(angle) / length, 0.6 / length];
      light = rgb(r.embossTint);
      factors[0] = r.embossDetail; factors[1] = 1 / (1 + r.embossDepth / 100 * 7);
      factors[2] = r.embossShine / 100; factors[3] = Number(r.embossColor === 'source');
    } else if (r.renderMode === 'rgbsplit') {
      const angle = r.rgbAngle * Math.PI / 180, shift = Math.max(1, r.rgbAmount / 100 * w * 0.03) * amount;
      factors[0] = Math.cos(angle) * shift; factors[1] = Math.sin(angle) * shift;
      factors[2] = r.rgbFalloff / 100; factors[3] = r.rgbBalance / 50;
    }
    return this.pass.draw(source, w, h, { uMode: colorModes.indexOf(r.renderMode as typeof colorModes[number]),
      uTone: [contrast, r.brightness * 2.55, Number(r.invert)], uFactors: factors, uDark: dark, uLight: light,
      uCoverageState: [amount, threshold, Math.max(0, amount * 2 - 1), 0] }, { uCoverage: field });
  }
}
