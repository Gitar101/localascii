import { Recipe } from '../recipe';
import { num, hexRgb, clamp01 } from './context';

export const moltenFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec4 uFlowParams;
uniform vec4 uSurfaceParams;
uniform vec4 uToneParams;
uniform vec3 uLighting;
uniform vec3 uPalA, uPalB, uPalC, uPalD;
out vec4 outColor;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
vec3 photo(vec2 uv) {
  vec3 color = texture(uSrc, clamp(uv, 0.0, 1.0)).rgb;
  color = clamp((color - 0.501961) * uToneParams.x + 0.501961 + uToneParams.y, 0.0, 1.0);
  return uToneParams.z > 0.5 ? 1.0 - color : color;
}
float hash(vec2 point) {
  vec2 p = fract(point * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 point) {
  vec2 cell = floor(point), f = fract(point);
  vec2 t = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), t.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), t.x), t.y);
}
float fractal(vec2 point) {
  float value = 0.0, weight = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    value += weight * noise(point);
    point = point * 2.02 + vec2(37.1, 17.7); weight *= 0.5;
  }
  return value;
}
vec3 palette(float value) {
  value = clamp(value, 0.0, 1.0);
  if (value < 0.4) return mix(uPalA, uPalB, value / 0.4);
  if (value < 0.75) return mix(uPalB, uPalC, (value - 0.4) / 0.35);
  return mix(uPalC, uPalD, (value - 0.75) / 0.25);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes, aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 world = uv * aspect * uFlowParams.y;
  vec2 first = vec2(fractal(world), fractal(world + vec2(5.2, 1.3)));
  vec2 second = vec2(fractal(world + 3.5 * first + vec2(1.7, 9.2)),
    fractal(world + 3.5 * first + vec2(8.3, 2.8)));
  vec2 offset = second - 0.5;
  offset.y -= uFlowParams.z * (second.x * 0.6 + 0.2);
  vec2 warped = uv + offset / aspect * (uFlowParams.x * 0.5);
  float tone = pow(clamp(dot(photo(warped), LUMA), 0.0, 1.0), uToneParams.w);
  vec3 normal = normalize(vec3(-dFdx(tone) * uRes.x, -dFdy(tone) * uRes.y,
    900.0 / mix(0.4, 3.0, uSurfaceParams.x)));
  vec3 light = normalize(uLighting), halfVector = normalize(light + vec3(0.0, 0.0, 1.0));
  float diffuse = max(dot(normal, light), 0.0);
  float specular = pow(max(dot(normal, halfVector), 0.0), mix(8.0, 90.0, uFlowParams.w));
  float sweep = 0.5 + 0.5 * sin(dot(uv - 0.5, uLighting.xy) * 3.2);
  float sheen = sweep * sweep;
  vec3 color = palette(tone * 0.82 + diffuse * 0.14 * uSurfaceParams.x + sheen * 0.16 * uFlowParams.w);
  color += mix(vec3(1.0), uPalD, 0.35) * specular * (0.55 + 0.45 * sheen) * (0.35 + 0.9 * uFlowParams.w);
  float sourceTone = dot(photo(uv), LUMA);
  float edge = length(vec2(dFdx(sourceTone), dFdy(sourceTone))) * (uRes.x + uRes.y) * 0.5;
  float rim = pow(clamp(edge * 0.08, 0.0, 1.0), 0.7);
  color += mix(uPalB, uPalD, 0.35) * 1.6 * rim * uSurfaceParams.y * (0.5 + 0.5 * tone);
  float streak = 0.5 + 0.5 * sin((warped.x + warped.y) * uRes.y * 0.09 + (warped.y - uv.y) * 40.0);
  color *= 1.0 - 0.05 * uFlowParams.w + 0.05 * uFlowParams.w * streak;
  color *= 1.0 + (hash(gl_FragCoord.xy) - 0.5) * uSurfaceParams.z * (0.35 + 0.65 * tone) * 0.9;
  outColor = vec4(clamp(mix(photo(uv), color, uSurfaceParams.w), 0.0, 1.0), 1.0);
}`;

const palettes: Record<string, string[]> = {
  gold: ['#160a06', '#8a1e10', '#e8a01e', '#fff2c8'], copper: ['#0f0806', '#5e2410', '#c8712e', '#ffe0b0'],
  mercury: ['#0a0c10', '#3a4756', '#9fb0c0', '#ffffff'], obsidian: ['#050507', '#241a2e', '#7d6a8f', '#e8dcff'],
  crimson: ['#0c0304', '#5a0a12', '#d21f2a', '#ff9d86']
};
export function moltenUniforms(r: Recipe, coverage: number) {
  const amount = coverage / 100, percent = (key: string, fallback: number) => clamp01(num(r, key, fallback) / 100);
  let colors = (palettes[r.moltenPalette] || palettes.gold).map(hex => hexRgb(hex).map(v => v / 255));
  if (r.moltenPalette === 'custom') {
    const a = hexRgb(r.moltenColorA).map(v => v / 255), b = hexRgb(r.moltenColorB).map(v => v / 255);
    colors = [a, a.map((v, c) => v + (b[c] - v) * 0.35), a.map((v, c) => v + (b[c] - v) * 0.72), b];
  }
  const light = num(r, 'moltenLight', 135) * Math.PI / 180;
  return {
    uFlowParams: [percent('moltenFlow', 55) * amount, 1.5 + 4.5 * percent('moltenViscosity', 45),
      percent('moltenDrip', 45) * amount, percent('moltenSheen', 70)],
    uSurfaceParams: [percent('moltenRelief', 55), percent('moltenHeat', 55) * amount, percent('moltenGrain', 40) * amount, amount],
    uToneParams: [259 * (r.contrast + 255) / (255 * (259 - r.contrast)), r.brightness / 100, Number(r.invert), 0.6 + 1.8 * percent('moltenContrast', 55)],
    uLighting: [Math.cos(light), Math.sin(light), 0.75], uPalA: colors[0], uPalB: colors[1], uPalC: colors[2], uPalD: colors[3]
  };
}
