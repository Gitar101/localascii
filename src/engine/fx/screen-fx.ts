import { Recipe } from '../recipe';
import { contrastFactor, hexRgb } from './context';

const sampling = `
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec3 uTone;
out vec4 outColor;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
vec3 sourceAt(vec2 uv) {
  vec3 color = clamp((texture(uSrc, clamp(uv, 0.0, 1.0)).rgb - 128.0 / 255.0) * uTone.x + 128.0 / 255.0 + uTone.y, 0.0, 1.0);
  return uTone.z > 0.5 ? 1.0 - color : color;
}
float hash1(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash2(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
`;

export const datamoshFragment = `#version 300 es
precision highp float;
${sampling}
uniform vec4 uBlocks;
uniform vec4 uGrade;
uniform vec2 uMaster;
uniform float uSeed;
uniform int uInkCount;
uniform vec3 uInk0, uInk1, uInk2, uInk3, uInk4;
vec3 ink(int i) {
  if (i == 0) return uInk0; if (i == 1) return uInk1; if (i == 2) return uInk2; if (i == 3) return uInk3; return uInk4;
}
vec3 graded(vec3 color) {
  float value = clamp(dot(color, LUMA), 0.0, 1.0) * float(uInkCount - 1);
  int segment = min(int(floor(value)), uInkCount - 2);
  vec3 mapped = mix(ink(segment), ink(segment + 1), smoothstep(0.0, 1.0, value - float(segment)));
  return mix(color, mapped, uGrade.z);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, px = uv * uRes;
  float size = mix(18.0, 130.0, uBlocks.x), row = floor(px.y / size);
  vec2 dimensions = vec2(size * 1.25 * (0.7 + 0.6 * hash1(row * 1.7 + uSeed)), size);
  vec2 cell = vec2(floor(px.x / dimensions.x), row), local = fract(px / dimensions);
  float r = hash2(cell + uSeed * 3.1), r2 = hash2(cell.yx * 1.7 + uSeed * 2.3);
  float torn = step(1.0 - uBlocks.z, r);
  vec2 signs = vec2(hash1(r * 57.1) < 0.5 ? -1.0 : 1.0, hash1(r * 23.9) < 0.5 ? -1.0 : 1.0);
  vec2 offset = signs * vec2(floor(hash1(r * 91.7) * (2.0 + 12.0 * uBlocks.y)) + 1.0, floor(hash1(r * 13.3) * (1.0 + 6.0 * uBlocks.y)));
  vec2 samplePx = px + offset * dimensions * torn, quantum = dimensions * 0.25;
  samplePx = mix(samplePx, (floor(samplePx / quantum) + 0.5) * quantum, uMaster.x);
  float smear = step(0.62, r2) * torn * uBlocks.w;
  if (smear > 0.5) samplePx.x = (cell.x + offset.x) * dimensions.x + dimensions.x * 0.06;
  vec2 at = samplePx / uRes;
  float split = uGrade.x * (0.014 * (0.35 + torn) + 0.002);
  vec3 color = vec3(sourceAt(at + vec2(split, 0.0)).r, sourceAt(at).g, sourceAt(at - vec2(split, 0.0)).b);
  float lum = dot(color, LUMA);
  color = graded(color) + ink(uInkCount - 1) * smear * 0.22 * smoothstep(0.25, 0.9, lum);
  float edge = min(min(local.x * dimensions.x, (1.0 - local.x) * dimensions.x), min(local.y * dimensions.y, (1.0 - local.y) * dimensions.y));
  float marquee = (1.0 - step(1.4, edge)) * step(0.5, fract((px.x + px.y) / 7.0)) * step(0.74, r2) * torn;
  color = mix(color, vec3(0.92), marquee * 0.55 * uMaster.x);
  color += (hash2(px + vec2(fract(uSeed) * 137.0, fract(uSeed * 0.7) * 79.0)) - 0.5) * uGrade.y * 0.34;
  outColor = vec4(clamp(color * uMaster.y, 0.0, 1.0), 1.0);
}`;

export function datamoshUniforms(r: Recipe, coverage: number) {
  const amount = coverage / 100, colors = r.dmPalette;
  const inks = Array.from({ length: 5 }, (_, i) => hexRgb(colors[Math.min(i, colors.length - 1)]).map(c => c / 255));
  return {
    uTone: [contrastFactor(r.contrast), r.brightness / 100, Number(r.invert)],
    uBlocks: [r.dmBlock / 100, r.dmDisplace / 100 * amount, r.dmScatter / 100 * amount, r.dmSmear / 100 * amount],
    uGrade: [r.dmSplit / 100 * amount, r.dmGrain / 100 * amount, r.dmDuotone / 100 * amount, 0],
    uMaster: [amount, r.dmIntensity / 100], uSeed: r.dmSeed * 1.7, uInkCount: colors.length,
    uInk0: inks[0], uInk1: inks[1], uInk2: inks[2], uInk3: inks[3], uInk4: inks[4]
  };
}

export const glitchFragment = `#version 300 es
precision highp float;
${sampling}
uniform sampler2D uSubject;
uniform vec4 uBand;
uniform vec4 uDamage;
uniform vec3 uFinish;
uniform float uSeed;
vec3 spectrum(float hue, float saturation, float value) {
  vec3 p = abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return value * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), saturation);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float full = smoothstep(0.72, 1.0, uBand.x), row = floor(uv.y * 90.0);
  float height = 0.04 + uBand.x * 0.55 + pow(uBand.x, 4.0) * 1.75;
  float band = 1.0 - smoothstep(height * 0.5 - 0.015, height * 0.5 + 0.03, abs(uv.y - uBand.y));
  band *= mix(0.55 + 0.45 * step(0.25, hash1(row * 1.7 + uSeed)), 1.0, full);
  band *= mix(1.0, texture(uSubject, uv).r, 1.0 - full);
  float field = clamp(band, 0.0, 1.0) * uBand.z;
  float sliceHeight = mix(46.0, 7.0, uDamage.x), slice = floor(uv.y * uRes.y / sliceHeight);
  float sliceActive = step(0.55, hash1(slice * 1.13 + uSeed * 0.7));
  vec2 at = uv + vec2((hash1(slice * 2.31 + uSeed) - 0.5) * uDamage.x * 0.22 * field * sliceActive, 0.0);
  at.y = mix(at.y, slice * sliceHeight / uRes.y, step(0.72, hash1(slice * 3.7 + uSeed)) * field);
  float corrupt = 0.0, blockRandom = 0.0;
  if (uDamage.z > 0.001) {
    vec2 blockSize = vec2(mix(0.24, 0.05, uDamage.z), mix(0.14, 0.032, uDamage.z));
    vec2 cell = floor(vec2(uv.x, uv.y - uBand.y) / blockSize);
    blockRandom = hash2(cell + uSeed * 3.37);
    float blockActive = step(1.0 - uDamage.z * 0.7, blockRandom) * step(0.12, band);
    at += (vec2(hash1(blockRandom * 11.3), hash1(blockRandom * 17.1)) - 0.5) * vec2(0.30, 0.06) * uDamage.z * blockActive;
    corrupt = blockActive * step(0.45, hash1(blockRandom * 5.0));
  }
  float split = uDamage.y * (0.02 * field + 0.003);
  vec3 color = vec3(sourceAt(at + vec2(split, 0.0)).r, sourceAt(at).g, sourceAt(at - vec2(split, 0.0)).b);
  float lum = dot(color, LUMA);
  color = mix(color, vec3(lum), uFinish.y * (1.0 - field * 0.7));
  if (corrupt > 0.5) {
    vec3 swapped = hash1(blockRandom * 9.0) > 0.5 ? color.gbr : color.brg;
    vec3 quantized = floor(swapped * 5.0) / 5.0 + 0.05;
    vec3 injected = spectrum(fract(blockRandom * 2.3 + uSeed * 0.11), 0.9, 0.55 + 0.45 * lum);
    color = mix(color, mix(quantized, injected, step(0.68, hash1(blockRandom * 4.0))), 0.85);
  }
  float spectral = uDamage.w * band * step(0.8, hash1(row * 3.1 + uSeed));
  color = mix(color, spectrum(fract(uv.x * 3.0 + uSeed * 0.17), 0.85, 1.0) * (0.8 + 0.5 * lum), spectral);
  color += (hash2(uv * uRes + vec2(fract(uSeed) * 137.0, fract(uSeed * 0.7) * 79.0)) - 0.5) * uFinish.x * 0.25 * (0.3 + 0.7 * field);
  color *= 1.0 - 0.12 * field * step(0.5, fract(uv.y * uRes.y * 0.5));
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

export function glitchUniforms(r: Recipe, coverage: number) {
  const amount = coverage / 100;
  return {
    uTone: [contrastFactor(r.contrast), r.brightness / 100 + 0.25 * amount, Number(r.invert)],
    uBand: [r.glitchCoverage / 100, r.glitchPosition / 100, amount, 0],
    uDamage: [r.glitchDisplace / 100 * amount, r.glitchSplit / 100 * amount, r.glitchBlocks / 100 * amount, r.glitchSpectrum / 100 * amount],
    uFinish: [r.glitchNoise / 100 * amount, r.glitchDesat / 100 * amount, 0], uSeed: r.glitchSeed * 1.7
  };
}
