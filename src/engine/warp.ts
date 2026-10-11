import { GpuPass } from './gpu';
import { Recipe, warpModes } from './recipe';

const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform vec2 uSize;
uniform int uMode;
uniform vec4 uFocus;
uniform vec4 uWave;
uniform vec3 uTone;
uniform bool uToRect;
out vec4 result;
const float PI = 3.141592653589793;

vec2 sourcePosition(vec2 pixel) {
  vec2 offset = pixel - uFocus.xy;
  float distance = length(offset);
  float radial = distance / uFocus.z;
  if (uMode < 2) {
    if (distance < 0.001 || radial >= 1.0) return pixel;
    float exponent = uMode == 0 ? 1.0 + uFocus.w : 1.0 - 0.7 * uFocus.w;
    return uFocus.xy + offset * (pow(radial, exponent) * uFocus.z / distance);
  }
  if (uMode == 2) {
    if (radial >= 1.0) return pixel;
    float angle = atan(offset.y, offset.x) - uFocus.w * (1.0 - radial);
    return uFocus.xy + distance * vec2(cos(angle), sin(angle));
  }
  if (uMode == 3) return pixel + uWave.x * sin(pixel.yx * uWave.y);
  if (uMode == 4) {
    if (distance < 0.001) return pixel;
    return uFocus.xy + offset * (1.0 + uWave.x * sin(radial * PI * uWave.y) / distance);
  }
  if (uMode == 5) {
    vec2 extent = max(vec2(1.0), uSize - 1.0);
    if (uToRect) {
      float angle = pixel.x / extent.x * 2.0 * PI - PI - uFocus.w;
      return uFocus.xy + (1.0 - pixel.y / extent.y) * uFocus.z * vec2(cos(angle), sin(angle));
    }
    float angle = mod(atan(offset.y, offset.x) + uFocus.w + PI, 2.0 * PI);
    return vec2(angle / (2.0 * PI), 1.0 - min(1.0, radial)) * extent;
  }
  if (uMode == 7) {
    float logarithm = log(max(0.0001, radial));
    float angle = atan(offset.y, offset.x) + uWave.x * logarithm + uWave.y;
    float radius = exp(mod(logarithm, uFocus.w) - uFocus.w) * uFocus.z;
    return uFocus.xy + radius * vec2(cos(angle), sin(angle));
  }
  return pixel - vec2(uWave.x * sin(pixel.y / uSize.y * 2.0 * PI * uWave.y), 0.0);
}

vec3 sampleColor(ivec2 position) {
  vec3 color = texelFetch(uSource, position, 0).rgb * 255.0;
  if (uTone.z > 0.5) color = 255.0 - color;
  color = clamp(uTone.x * (color - 128.0) + 128.0 + uTone.y, 0.0, 255.0);
  return roundEven(color) / 255.0;
}

void main() {
  vec2 pixel = vec2(floor(gl_FragCoord.x), uSize.y - 1.0 - floor(gl_FragCoord.y));
  if (uMode == 7) {
    ivec2 point = ivec2(clamp(sourcePosition(pixel), vec2(0.0), uSize - 1.0));
    result = vec4(sampleColor(point), 1.0); return;
  }
  vec2 mapped = clamp(sourcePosition(pixel), vec2(0.0), max(vec2(0.0), uSize - 1.001));
  ivec2 first = ivec2(floor(mapped));
  ivec2 last = min(first + 1, ivec2(uSize) - 1);
  vec2 fraction = fract(mapped);
  vec3 top = mix(sampleColor(first), sampleColor(ivec2(last.x, first.y)), fraction.x);
  vec3 bottom = mix(sampleColor(ivec2(first.x, last.y)), sampleColor(last), fraction.x);
  result = vec4(mix(top, bottom, fraction.y), 1.0);
}`;

export class WarpFilter {
  private readonly pass = new GpuPass(fragment);

  draw(source: HTMLCanvasElement, r: Recipe) {
    const w = source.width, h = source.height, shortest = Math.min(w, h), strength = r.distortAmount / 100;
    const focus = [w * r.distortCenterX / 100, h * r.distortCenterY / 100,
      shortest * r.distortRadius / 200, strength];
    const wave = [0, 0, 0, 0];
    switch (r.renderMode) {
      case 'twirl': focus[3] *= Math.PI * 1.5; break;
      case 'ripple': wave[0] = strength * shortest * 0.04;
        wave[1] = 2 * Math.PI / Math.max(6, r.distortWavelength / 100 * shortest * 0.25); break;
      case 'zigzag': wave[0] = strength * 22; wave[1] = r.distortRidges; break;
      case 'polar': focus[0] = w / 2; focus[1] = h / 2; focus[2] = shortest / 2; focus[3] *= 2 * Math.PI; break;
      case 'shear': wave[0] = strength * w * 0.18; wave[1] = r.distortPeriod / 100; break;
      case 'droste': focus[0] = w * r.drCenterX / 100; focus[1] = h * r.drCenterY / 100;
        focus[2] = shortest / 2; focus[3] = Math.log(r.drZoom);
        wave[0] = r.drTwist / 100 * 3; wave[1] = r.drSpin * Math.PI / 180; break;
    }
    return this.pass.draw(source, w, h, {
      uMode: r.renderMode === 'droste' ? 7 : warpModes.indexOf(r.renderMode as typeof warpModes[number]), uFocus: focus, uWave: wave,
      uTone: [259 * (r.contrast + 255) / (255 * (259 - r.contrast)), r.brightness * 2.55, Number(r.invert)],
      uToRect: Number(r.distortPolarMode === 'polar2rect')
    });
  }
}
