import { GpuPass, TexturePlane } from '../gpu';
import { Recipe, RenderError } from '../recipe';
import { num, sampleFrame, solveCoverage, clamp01 as clampCoverage } from './context';
import { moltenFragment, moltenUniforms } from './molten-fx';
import { liquidGlassFragment, liquidGlassUniforms } from './liquid-glass';
import { lensFragment, lensUniforms } from './lens-fx';
import { formsFragment, formsUniforms } from './forms-fx';
import { vitrineFragment, vitrineMask, vitrineUniforms } from './vitrine-fx';
import { risographFragment, risographUniforms } from './risograph-fx';
import { halftoneFragment, halftoneUniforms } from './halftone-fx';
import { sourceCoverage } from './coverage-fx';
import { datamoshFragment, datamoshUniforms, glitchFragment, glitchUniforms } from './screen-fx';
import { subjectMask } from './subject-mask';
import { blueprintFragment, blueprintUniforms } from './blueprint-fx';
import { sourceRankField } from './rank-field';

const toneHelper = `
vec3 tone(in vec3 c, float contrast, float bright, float invert) {
  c = (c - 0.501961) * contrast + 0.501961 + bright;
  c = clamp(c, 0.0, 1.0);
  if (invert > 0.5) c = 1.0 - c;
  return c;
}`;

const lofiFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uBlur;
uniform float uGrain;
uniform float uBloom;
uniform float uSat;
uniform float uWarmth;
uniform float uVignette;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
uniform float uCovT;
uniform sampler2D uCoverage;
out vec4 outColor;
const int SAMPLES = 32;
const float GOLDEN = 2.399963229728653;
${toneHelper}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float covGateAt(float f, float t) {
  if (t < -1.0) return 1.0;
  float g = clamp((f - t) * 25.0 + 1.0, 0.0, 1.0);
  return g * g * (3.0 - 2.0 * g);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  vec3 bloomAcc = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float t = (fi + 0.5) / float(SAMPLES);
    float rad = sqrt(t) * uBlur;
    float ang = fi * GOLDEN;
    vec2 off = vec2(cos(ang), sin(ang)) * rad / asp;
    vec3 s = tone(texture(uSrc, uv + off).rgb, uContrast, uBright, uInvert);
    float w = exp(-2.2 * t);
    acc += s * w;
    wsum += w;
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    bloomAcc += s * lum * lum * w;
  }
  vec3 col = acc / max(wsum, 1e-4);
  vec3 bloom = bloomAcc / max(wsum, 1e-4);
  col += bloom * uBloom * 0.9;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  col.r = clamp(col.r + uWarmth * 0.09, 0.0, 1.0);
  col.b = clamp(col.b - uWarmth * 0.09, 0.0, 1.0);
  col.g = clamp(col.g + uWarmth * 0.02, 0.0, 1.0);
  float frame = 0.0;
  vec2 fo = vec2(frame * 1.7, frame * 2.3);
  vec2 gpF = floor(uv * uRes / 1.4);
  vec2 gpC = floor(uv * uRes / 3.0);
  float hF = hash21(gpF + fo);
  float hC = hash21(gpC + fo * 1.31 + 7.0);
  float thr = mix(0.965, 0.86, clamp(uGrain / 0.6, 0.0, 1.0));
  float fine = smoothstep(thr, 1.0, hF) - smoothstep(thr, 1.0, 1.0 - hF);
  float coarse = smoothstep(thr + 0.02, 1.0, hC) - smoothstep(thr + 0.02, 1.0, 1.0 - hC);
  float speck = fine * 0.85 + coarse * 0.45;
  float base = (hash21(gpF + fo + 3.0) - 0.5) * 0.05;
  vec3 cn = vec3(hash21(gpF + fo + 11.0), hash21(gpF + fo + 23.0), hash21(gpF + fo + 41.0)) - 0.5;
  vec3 grain = vec3(speck + base) + cn * abs(speck) * 0.5;
  float lumNow = dot(col, vec3(0.299, 0.587, 0.114));
  float grainMod = smoothstep(0.0, 0.12, lumNow) * mix(1.0, 0.55, smoothstep(0.4, 1.0, lumNow));
  col += grain * grainMod * uGrain;
  vec2 d = uv - 0.5;
  float r = length(d * asp);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.1, r);
  vec3 plain = tone(texture(uSrc, uv).rgb, uContrast, uBright, uInvert);
  float lumGate = texture(uCoverage, uv).r;
  col = mix(plain, col, covGateAt(lumGate, uCovT));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const starburstFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uLength;
uniform float uCore;
uniform float uStreaks;
uniform float uChroma;
uniform float uSpin;
uniform float uVignette;
uniform float uCov;
uniform float uTime;
uniform float uAnim;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
out vec4 outColor;
const float TAU = 6.28318530718;
${toneHelper}
vec2 mirrorUV(vec2 uv) {
  uv = abs(uv);
  uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  return uv;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 c = uCenter;
  vec2 d = (uv - c) * asp;
  float r = length(d);
  float ang = atan(d.y, d.x);
  float ph = uTime * TAU;
  float N = max(2.0, floor(uCore + 0.5));
  float seg = TAU / N;
  float wedges = max(1.0, floor(N / TAU + 0.5));
  ang += uSpin + step(0.0001, uAnim) * wedges * seg * uTime;
  ang += (uStreaks + uAnim * 0.7 * sin(ph)) * r;
  float halfSeg = seg * 0.5;
  float aw = mod(ang, seg);
  aw = abs(aw - halfSeg);
  float zr = r * uLength * (1.0 + uAnim * 0.10 * sin(ph + 2.1));
  vec2 sd = vec2(cos(aw), sin(aw)) * zr;
  vec2 base = mix(uv, c + sd / asp, uCov);
  vec3 col;
  float chroma = uChroma * 0.22 * (1.0 + uAnim * 0.6 * sin(ph + 1.0)) * uCov;
  if (chroma > 0.0005) {
    float a1 = aw + chroma, a2 = aw - chroma;
    vec2 bR = mix(uv, c + vec2(cos(a1), sin(a1)) * zr / asp, uCov);
    vec2 bB = mix(uv, c + vec2(cos(a2), sin(a2)) * zr / asp, uCov);
    col = vec3(texture(uSrc, mirrorUV(bR)).r, texture(uSrc, mirrorUV(base)).g, texture(uSrc, mirrorUV(bB)).b);
    col = tone(col, uContrast, uBright, uInvert);
  } else {
    col = tone(texture(uSrc, mirrorUV(base)).rgb, uContrast, uBright, uInvert);
  }
  float seamDist = aw / halfSeg;
  float breathe = 1.0 + uAnim * 0.12 * sin(ph + 4.2);
  float baseThickness = mix(1.3, 0.4, uVignette);
  float thickness = mix(baseThickness, 0.08, smoothstep(0.0, 1.0, r)) * breathe;
  float gap = smoothstep(thickness - 0.15, thickness + 0.05, seamDist);
  col *= clamp(1.0 - gap * uCov, 0.0, 1.0);
  float ripple = 0.5 + 0.5 * sin(r * 9.0 - ph * 2.0);
  col += col * uAnim * 0.22 * ripple * (1.0 - gap) * uCov;
  col *= 1.0 - uVignette * uCov * 0.6 * smoothstep(0.55, 1.3, r);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const warpbloomFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uStrength;
uniform float uFocus;
uniform float uBloom;
uniform float uTwist;
uniform float uTime;
uniform float uAnim;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
out vec4 outColor;
const int MAX_SAMPLES = 64;
${toneHelper}
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 c = uCenter;
  vec2 d = uv - c;
  float r = length(d * asp);
  float pull = min(uStrength * (1.0 + uAnim * 0.35 * sin(uTime)), 0.95);
  float swirl = uTwist * r;
  float cs = cos(swirl), sn = sin(swirl);
  mat2 rot = mat2(cs, -sn, sn, cs);
  float streakPx = pull * r * uRes.y;
  int n = int(clamp(streakPx * 0.85, 8.0, float(MAX_SAMPLES)));
  float jitter = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  vec3 bloomAcc = vec3(0.0);
  float bsum = 0.0;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= n) break;
    float t = (float(i) + jitter) / float(n);
    float scale = 1.0 - pull * t;
    vec2 off = rot * (d * scale);
    vec2 suv = c + off;
    vec3 s = tone(texture(uSrc, suv).rgb, uContrast, uBright, uInvert);
    float w = mix(1.0, 0.35, smoothstep(0.0, 1.0, t));
    acc += s * w;
    wsum += w;
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    bloomAcc += s * lum * lum * w;
    bsum += w;
  }
  vec3 col = acc / max(wsum, 1e-4);
  vec3 bloom = bloomAcc / max(bsum, 1e-4);
  if (uFocus > 0.001) {
    vec3 sharp = tone(texture(uSrc, uv).rgb, uContrast, uBright, uInvert);
    float eye = 1.0 - smoothstep(uFocus * 0.15, uFocus, r);
    col = mix(col, sharp, eye * 0.7);
  }
  col += bloom * uBloom * 0.9 * (1.0 + uAnim * 0.4 * sin(uTime));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const contrastOf = (r: Recipe) => 259 * (r.contrast + 255) / (255 * (259 - r.contrast));

export class FxPass {
  sourceRevision = '';
  private active: { fragment: string; pass: GpuPass } | null = null;

  private pass(fragment: string, mipmaps = false) {
    if (this.active?.fragment !== fragment) {
      this.active?.pass.dispose();
      this.active = null;
      this.active = { fragment, pass: new GpuPass(fragment, {
        sourceUniform: 'uSrc', sizeUniform: 'uRes', flipY: true, linear: true, mipmaps
      }) };
    }
    return this.active.pass;
  }

  private coverage(source: TexImageSource, w: number, h: number, r: Recipe, amount: number) {
    if (amount >= 1 || amount <= 0) return {
      threshold: amount >= 1 ? -2 : 1.04,
      plane: { width: 1, height: 1, data: new Float32Array([0]) } satisfies TexturePlane
    };
    const pixels = sampleFrame(source as CanvasImageSource, w, h, `gpu-coverage|${this.sourceRevision}`);
    if (!pixels) throw new RenderError('IMAGE_SAMPLE_FAILED', 'Could not prepare effect coverage.');
    const luminance = new Float32Array(w * h), factor = contrastOf(r);
    for (let i = 0; i < luminance.length; i++) {
      let value = 0;
      for (let c = 0; c < 3; c++) {
        let tone = clampCoverage((pixels[4 * i + c] / 255 - 128 / 255) * factor + 128 / 255 + r.brightness / 100);
        if (r.invert) tone = 1 - tone;
        value += tone * [0.299, 0.587, 0.114][c];
      }
      luminance[i] = value;
    }
    const solved = solveCoverage(luminance, w, h, amount);
    // Float planes upload without a Y flip; align their rows with the flipped source texture.
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) data.set(solved.field.subarray(y * w, (y + 1) * w), (h - 1 - y) * w);
    return { threshold: solved.threshold, plane: { width: w, height: h, data } };
  }

  drawMolten(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    return this.pass(moltenFragment).draw(source, w, h, { uRes: [w, h], ...moltenUniforms(r, coverage) });
  }

  drawLiquidGlass(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    return this.pass(liquidGlassFragment).draw(source, w, h, { uRes: [w, h], ...liquidGlassUniforms(r, coverage) });
  }

  drawLens(source: TexImageSource, w: number, h: number, r: Recipe) {
    return this.pass(lensFragment).draw(source, w, h, { uRes: [w, h], ...lensUniforms(r) });
  }

  drawForms(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const scale = w / (source as HTMLImageElement | HTMLCanvasElement).width;
    return this.pass(formsFragment).draw(source, w, h, {
      uRes: [w, h], ...formsUniforms(r, w, h, scale),
      ...sourceCoverage(source as CanvasImageSource, w, h, r, coverage / 100, false, this.sourceRevision)
    });
  }

  drawVitrine(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const values = vitrineUniforms(r), frequency = values.uOptics[0];
    const cols = Math.max(1, Math.ceil(w / h * frequency)), rows = Math.max(1, Math.ceil(frequency));
    const mask = vitrineMask(source as CanvasImageSource, cols, rows, r, this.sourceRevision, coverage / 100);
    return this.pass(vitrineFragment).draw(source, w, h, {
      uRes: [w, h], uGrid: [cols, rows], ...values
    }, { uPaneMask: mask });
  }

  drawRisograph(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const scale = w / (source as HTMLImageElement | HTMLCanvasElement).width;
    return this.pass(risographFragment).draw(source, w, h, {
      uRes: [w, h], ...risographUniforms(r, scale, coverage)
    });
  }

  drawHalftone(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const scale = w / (source as HTMLImageElement | HTMLCanvasElement).width;
    return this.pass(halftoneFragment).draw(source, w, h, {
      uRes: [w, h], ...halftoneUniforms(r, scale),
      ...sourceCoverage(source as CanvasImageSource, w, h, r, coverage / 100, true, this.sourceRevision)
    });
  }

  drawDatamosh(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    return this.pass(datamoshFragment).draw(source, w, h, { uRes: [w, h], ...datamoshUniforms(r, coverage) });
  }

  drawGlitch(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    return this.pass(glitchFragment).draw(source, w, h, { uRes: [w, h], ...glitchUniforms(r, coverage) }, {
      uSubject: subjectMask(source as HTMLImageElement | HTMLCanvasElement)
    });
  }

  drawBlueprint(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100, photo = r.blueprintTheme === 'cyanotype';
    const image = source as HTMLImageElement | HTMLCanvasElement;
    const field = sourceRankField(image, w, h, r, photo ? amount : Math.min(1, amount * 2), photo ? 'coat' : 'nearness', this.sourceRevision);
    return this.pass(blueprintFragment, true).draw(source, w, h, {
      uRes: [w, h], ...blueprintUniforms(r, image.width, image.height, w, h),
      uThreshold: field.threshold, uSubstrate: Math.max(0, amount * 2 - 1)
    }, { uRank: field.plane });
  }

  drawLofi(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    const field = this.coverage(source, w, h, r, amount);
    return this.pass(lofiFragment).draw(source, w, h, {
      uRes: [w, h],
      uBlur: (num(r, 'lofiBlur', 42) / 100) * 0.045,
      uGrain: num(r, 'lofiGrain', 55) / 100 * 0.6,
      uBloom: num(r, 'lofiBloom', 30) / 100,
      uSat: 0.55 + num(r, 'lofiSaturation', 55) / 100,
      uWarmth: (num(r, 'lofiWarmth', 50) / 100 - 0.5) * 2,
      uVignette: num(r, 'lofiVignette', 48) / 100,
      uContrast: contrastOf(r),
      uBright: r.brightness / 100,
      uInvert: Number(r.invert),
      uCovT: field.threshold,
    }, { uCoverage: field.plane });
  }

  drawStarburst(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    return this.pass(starburstFragment).draw(source, w, h, {
      uRes: [w, h],
      uCenter: [num(r, 'starburstCenterX', 50) / 100, 1 - num(r, 'starburstCenterY', 50) / 100],
      uLength: 1 + 14 * clamp01(num(r, 'starburstLength', 62) / 100),
      uCore: Math.round(3 + 13 * clamp01(num(r, 'starburstCore', 22) / 100)),
      uStreaks: -3.5 + 7 * clamp01(num(r, 'starburstStreaks', 55) / 100),
      uChroma: clamp01(num(r, 'starburstChroma', 0) / 100),
      uSpin: -Math.PI + 6.28318 * clamp01(num(r, 'starburstSpin', 50) / 100),
      uVignette: clamp01(num(r, 'starburstVignette', 42) / 100),
      uCov: amount,
      uTime: 0,
      uAnim: 0,
      uContrast: contrastOf(r),
      uBright: r.brightness / 100,
      uInvert: Number(r.invert),
    });
  }

  drawPrism(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    const theme = r.prismTheme === 'iridescent' ? 1 : r.prismTheme === 'jewel' ? 2 : 0;
    return this.pass(prismFragment).draw(source, w, h, {
      uRes: [w, h],
      uTime: 0,
      uTheme: theme,
      uFacets: num(r, 'prismFacets', 15) / 100,
      uRefract: num(r, 'prismRefraction', 60) / 100,
      uDispersion: num(r, 'prismDispersion', 70) / 100,
      uFrost: 0.3,
      uCov: amount,
      uContrast: contrastOf(r),
      uBright: r.brightness / 100,
      uInvert: Number(r.invert),
    });
  }

  drawMarble(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    const field = this.coverage(source, w, h, r, amount);
    const theme = r.marbleTheme === 'monochrome' ? 1 : r.marbleTheme === 'oilspill' ? 2 :
      r.marbleTheme === 'goldvein' ? 3 : 0;
    return this.pass(marbleFragment).draw(source, w, h, {
      uRes: [w, h],
      uTime: 0,
      uTheme: theme,
      uTurbulence: num(r, 'marbleTurbulence', 50) / 100,
      uViscosity: num(r, 'marbleViscosity', 40) / 100,
      uDetail: num(r, 'marbleDetail', 60) / 100,
      uFlow: 1,
      uContrast: contrastOf(r),
      uBright: r.brightness / 100,
      uInvert: Number(r.invert),
      uCovT: field.threshold,
      uCovSub: Math.max(0, amount * 2 - 1),
    }, { uCoverage: field.plane });
  }

  drawLightwind(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    const angle = (num(r, 'lightwindAngle', 0) * Math.PI) / 180;
    return this.pass(lightwindFragment).draw(source, w, h, {
      uRes: [w, h],
      uTime: 0,
      uLength: clamp01(num(r, 'lightwindLength', 70) / 100) * amount,
      uDir: [Math.cos(angle), Math.sin(angle)],
      uThreshold: clamp01(num(r, 'lightwindThreshold', 40) / 100),
      uGlow: 2 * clamp01(num(r, 'lightwindGlow', 55) / 100) * amount,
      uTurb: 0.12,
      uWave: clamp01(num(r, 'lightwindWave', 25) / 100) * amount,
      uDispersion: 0.18,
      uDecay: clamp01(num(r, 'lightwindDecay', 35) / 100),
      uContrast: contrastOf(r),
      uBright: r.brightness / 100,
      uInvert: Number(r.invert),
    });
  }

  drawTopography(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    const field = this.coverage(source, w, h, r, amount);
    const theme = r.topographyTheme === 'cyberpunk' ? 1 : r.topographyTheme === 'topsecret' ? 2 :
      r.topographyTheme === 'monochrome' ? 3 : r.topographyTheme === 'relief' ? 4 :
      r.topographyTheme === 'custom' ? 5 : 0;
    const hex = (r.topographyColor as string || '#ffb922').replace('#', '');
    const rgb = [1, 0.725, 0.133];
    const match = /^([0-9a-f]{6})$/i.exec(hex.trim());
    if (match) {
      const value = parseInt(match[1], 16);
      rgb[0] = ((value >> 16) & 255) / 255;
      rgb[1] = ((value >> 8) & 255) / 255;
      rgb[2] = (value & 255) / 255;
    }
    return this.pass(topographyFragment).draw(source, w, h, {
      uRes: [w, h],
      uTime: 0,
      uTheme: theme,
      uElevation: num(r, 'topographyElevation', 15) / 100,
      uDensity: (num(r, 'topographyDensity', 45) / 100) * amount,
      uFlow: (num(r, 'topographyFlow', 0) / 100) * amount,
      uCov: amount,
      uSmooth: 0.2,
      uContrast: contrastOf(r),
      uBright: r.brightness / 100,
      uInvert: Number(r.invert),
      uColor: rgb,
      uCovT: field.threshold,
    }, { uCoverage: field.plane });
  }

  drawWarpbloom(source: TexImageSource, w: number, h: number, r: Recipe, coverage: number) {
    const amount = coverage / 100;
    return this.pass(warpbloomFragment).draw(source, w, h, {
      uRes: [w, h],
      uCenter: [r.warpbloomCenterX / 100, 1 - r.warpbloomCenterY / 100],
      uStrength: 0.85 * r.warpbloomStrength / 100 * amount,
      uFocus: 0.6 * r.warpbloomFocus / 100,
      uBloom: r.warpbloomBloom / 100 * amount,
      uTwist: r.warpbloomTwist / 100 * 3 * amount,
      uTime: 0, uAnim: 0, uContrast: contrastOf(r),
      uBright: r.brightness / 100, uInvert: Number(r.invert)
    });
  }
}

const simplexNoise = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

const prismFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uTime;
uniform int uTheme;
uniform float uFacets;
uniform float uRefract;
uniform float uDispersion;
uniform float uFrost;
uniform float uCov;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
out vec4 outColor;
${toneHelper}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec4 voronoi(vec2 x, float animOffset) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      o = 0.5 + 0.5 * sin(animOffset + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      o = 0.5 + 0.5 * sin(animOffset + 6.2831 * o);
      vec2 r = g + o - f;
      if (dot(mr - r, mr - r) > 0.00001)
        md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }
  return vec4(md, mr.x, mr.y, hash22(n + mg).x);
}
vec3 getSample(vec2 uv) {
  vec3 c = texture(uSrc, clamp(uv, 0.0, 1.0)).rgb;
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  if (uInvert > 0.5) c = 1.0 - c;
  return clamp(c, 0.0, 1.0);
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv;
  p.x *= aspect;
  float scale = uFacets < 0.5
    ? mix(2.0, 20.0, uFacets * 2.0)
    : mix(20.0, 35.0, (uFacets - 0.5) * 2.0);
  vec4 v = voronoi(p * scale, uTime * 0.5);
  float edgeDist = v.x;
  vec2 toCenter = v.yz;
  float cellId = v.w;
  vec2 refVec = -toCenter * 0.1 * uRefract;
  float angle = cellId * 6.2831;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  refVec = rot * refVec;
  refVec *= uCov;
  vec3 col = vec3(0.0);
  vec2 slopeDir = rot * (-toCenter);
  vec2 dispDir = slopeDir / max(length(slopeDir), 1e-4);
  float disp = uDispersion * 0.025 * uCov;
  vec2 uvR = uv + refVec + dispDir * disp;
  vec2 uvG = uv + refVec;
  vec2 uvB = uv + refVec - dispDir * disp;
  col.r = getSample(uvR).r;
  col.g = getSample(uvG).g;
  col.b = getSample(uvB).b;
  float frostThresh = mix(0.01, 0.15, uFrost);
  float edgeMask = (1.0 - smoothstep(0.0, frostThresh, edgeDist)) * uCov;
  if (edgeMask > 0.0) {
    vec3 frostCol = vec3(0.0);
    float blurRadius = 0.02 * uFrost;
    frostCol += getSample(uv + vec2(blurRadius, 0.0));
    frostCol += getSample(uv + vec2(-blurRadius, 0.0));
    frostCol += getSample(uv + vec2(0.0, blurRadius));
    frostCol += getSample(uv + vec2(0.0, -blurRadius));
    frostCol *= 0.25;
    col = mix(col, frostCol + vec3(0.1), edgeMask);
  }
  float spec = pow(max(dot(normalize(vec3(refVec, 0.5)), normalize(vec3(0.5, 0.5, 1.0))), 0.0), 32.0) * uCov;
  if (uTheme == 1) {
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (cellId + vec3(0.0, 0.33, 0.67)));
    col = mix(col, col * rainbow * 2.0, 0.5 * uCov);
    col += spec * rainbow;
  } else if (uTheme == 2) {
    vec3 jewelCol = cellId > 0.5 ? vec3(0.9, 0.1, 0.3) : vec3(0.1, 0.8, 0.4);
    col *= mix(vec3(1.0), jewelCol * 1.5, uCov);
    col += spec;
  } else {
    col += spec * 0.8;
  }
  col *= mix(1.0, smoothstep(0.0, 0.02, edgeDist), uCov);
  outColor = vec4(col, 1.0);
}`;

const marbleFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uTime;
uniform float uTurbulence;
uniform float uViscosity;
uniform float uDetail;
uniform float uFlow;
uniform int uTheme;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
uniform float uCovT;
uniform float uCovSub;
uniform sampler2D uCoverage;
out vec4 outColor;
${simplexNoise}
vec3 getSample(vec2 uv) {
  vec3 c = texture(uSrc, clamp(uv, 0.0, 1.0)).rgb;
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  if (uInvert > 0.5) c = 1.0 - c;
  return clamp(c, 0.0, 1.0);
}
mat2 rot(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
float covGateAt(float f, float t) {
  if (t < -1.0) return 1.0;
  float g = clamp((f - t) * 25.0 + 1.0, 0.0, 1.0);
  return g * g * (3.0 - 2.0 * g);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv;
  float speed = uTime * uFlow;
  float scale = mix(1.0, 10.0, uViscosity);
  float amp = mix(0.0, 0.5, uTurbulence);
  int iters = int(mix(1.0, 6.0, uDetail));
  vec2 q = p;
  for (int i = 0; i < 6; i++) {
    if (i >= iters) break;
    float nx = snoise(vec3(q * scale, speed));
    float ny = snoise(vec3((q + vec2(5.2, 1.3)) * scale, speed + 10.0));
    vec2 offset = vec2(nx, ny) * amp;
    offset *= rot(float(i) * 0.5);
    q += offset;
    scale *= 2.0;
    amp *= 0.5;
  }
  vec2 finalUV = mix(uv, q, mix(0.1, 1.0, uTurbulence));
  vec3 plain = getSample(uv);
  float lumaPlain = texture(uCoverage, uv).r;
  float gCov = covGateAt(lumaPlain, uCovT);
  float gSub = uCovSub;
  finalUV = mix(uv, finalUV, gCov);
  vec3 col = getSample(finalUV);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 themed = col;
  if (uTheme == 1) {
    themed = vec3(luma);
  } else if (uTheme == 2) {
    vec3 oilCol = 0.5 + 0.5 * cos(6.2831 * (luma + vec3(0.0, 0.33, 0.67) + speed * 0.2));
    oilCol = smoothstep(0.1, 0.9, oilCol);
    themed = mix(themed, oilCol * 1.5, 0.8);
    float fold = abs(snoise(vec3(q * 10.0, speed)));
    themed += vec3(0.8, 0.9, 1.0) * pow(1.0 - fold, 8.0) * 0.5;
  } else if (uTheme == 3) {
    themed = mix(vec3(0.05, 0.05, 0.08), vec3(0.2, 0.2, 0.25), luma);
    float fold = abs(snoise(vec3(q * 5.0, speed)));
    float veinMask = smoothstep(0.05, 0.0, fold);
    vec3 gold = vec3(1.0, 0.8, 0.3);
    gold += vec3(1.0, 0.9, 0.7) * smoothstep(0.5, 1.0, luma) * 2.0;
    themed = mix(themed, gold, veinMask);
  }
  col = mix(col, themed, gSub);
  const float VIG_MAX = 0.12;
  float d = distance(uv, vec2(0.5)) / 0.70710678;
  col *= mix(1.0, 1.0 - VIG_MAX * smoothstep(0.55, 1.0, d), gSub);
  outColor = vec4(col, 1.0);
}`;

const lightwindFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uTime;
uniform float uLength;
uniform vec2 uDir;
uniform float uThreshold;
uniform float uGlow;
uniform float uTurb;
uniform float uWave;
uniform float uDispersion;
uniform float uDecay;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
out vec4 outColor;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 getSample(vec2 uv) {
  vec3 c = texture(uSrc, clamp(uv, 0.0, 1.0)).rgb;
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  if (uInvert > 0.5) c = 1.0 - c;
  return c;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 base = getSample(uv);
  float aspect = uRes.x / uRes.y;
  vec2 aspFwd = vec2(aspect, 1.0);
  vec2 aspBack = vec2(1.0 / aspect, 1.0);
  vec2 dir = normalize(uDir + vec2(1e-6));
  vec2 perp = vec2(-dir.y, dir.x);
  const int STEPS = 128;
  float maxDist = uLength * 2.2;
  float jitter = hash(uv * uRes + uTime) - 0.5;
  vec3 smear = vec3(0.0);
  float smW = 0.0;
  vec3 glow = vec3(0.0);
  float smearFall = mix(1.0, 5.5, uDecay);
  float glowFall = mix(0.6, 3.8, uDecay);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5 + jitter) / float(STEPS);
    float dist = t * maxDist;
    float flow = vnoise(uv * aspFwd * 2.2 + dir * dist * 2.6 - vec2(uTime * 0.5, uTime * 0.12));
    float sway = (flow - 0.5) * uTurb * dist * 0.4;
    float waveAmp = maxDist * 0.45;
    float wavePhase = dot(uv * aspFwd, perp) * 8.0 + t * 2.6 + uTime * 1.6;
    float wave = sin(wavePhase) * uWave * waveAmp * pow(t, 1.2);
    vec2 off = (-dir * dist + perp * (sway + wave)) * aspBack;
    vec2 dofs = dir * (uDispersion * 0.08 * dist) * aspBack;
    vec3 samp = vec3(
      getSample(uv + off - dofs).r,
      getSample(uv + off).g,
      getSample(uv + off + dofs).b
    );
    float wSmear = exp(-t * smearFall);
    smear += samp * wSmear;
    smW += wSmear;
    float bright = max(max(samp.r, samp.g), samp.b);
    float glowMask = smoothstep(uThreshold, uThreshold + 0.25, bright);
    glow += samp * glowMask * pow(1.0 - t, glowFall);
  }
  smear /= max(smW, 1e-3);
  vec3 windGlow = glow * (uGlow * 6.0 / float(STEPS));
  vec3 sm = clamp(smear, 0.0, 1.0);
  vec3 ext = max(clamp(base, 0.0, 1.0), sm);
  vec3 g = clamp(windGlow, 0.0, 1.0);
  vec3 col = 1.0 - (1.0 - ext) * (1.0 - g);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const topographyFragment = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uTime;
uniform float uElevation;
uniform float uDensity;
uniform float uFlow;
uniform float uSmooth;
uniform int uTheme;
uniform float uCov;
uniform float uContrast;
uniform float uBright;
uniform float uInvert;
uniform vec3 uColor;
uniform float uCovT;
uniform sampler2D uCoverage;
out vec4 outColor;
${simplexNoise}
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
vec3 srcRGB(vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  if (uInvert > 0.5) c = 1.0 - c;
  return clamp(c, 0.0, 1.0);
}
float getBaseLum(vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  c = (c - 0.5) * uContrast + 0.5 + uBright;
  if (uInvert > 0.5) c = 1.0 - c;
  return clamp(dot(c, LUMA), 0.0, 1.0);
}
float getSmoothLum(vec2 uv) {
  if (uSmooth <= 0.01) return getBaseLum(uv);
  float rad = mix(0.0, 0.02, uSmooth);
  float sum = 0.0;
  float w = 0.0;
  for (float x = -1.0; x <= 1.0; x++) {
    for (float y = -1.0; y <= 1.0; y++) {
      float weight = 1.0 / (1.0 + x * x + y * y);
      sum += getBaseLum(uv + vec2(x, y) * rad) * weight;
      w += weight;
    }
  }
  return sum / w;
}
float getElevation(vec2 uv) {
  float l = getSmoothLum(uv);
  if (uFlow > 0.0) {
    float linesScale = mix(8.0, 160.0, uDensity);
    float amp = 2.4 / linesScale;
    float n1 = snoise(vec3(uv * 3.0, uTime * 0.2));
    float n2 = snoise(vec3(uv * 6.0, uTime * 0.3));
    float n3 = snoise(vec3(uv * 15.0, uTime * 0.1));
    float combinedNoise = (n1 + n2 * 0.5 + n3 * 0.25) * amp;
    l = mix(l, l + combinedNoise, uFlow);
  }
  return pow(clamp(l, 0.0, 1.0), mix(1.0, 3.0, 1.0 - uElevation));
}
float covGateAt(float f, float t) {
  if (t < -1.0) return 1.0;
  float g = clamp((f - t) * 25.0 + 1.0, 0.0, 1.0);
  return g * g * (3.0 - 2.0 * g);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = 1.0 / uRes;
  float h = getElevation(uv);
  float hX = getElevation(uv + vec2(px.x * 2.0, 0.0));
  float hY = getElevation(uv + vec2(0.0, px.y * 2.0));
  vec3 normal = normalize(vec3(h - hX, h - hY, mix(0.01, 0.2, 1.0 - uElevation)));
  vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVector = normalize(lightDir + viewDir);
  float diff = max(dot(normal, lightDir), 0.0);
  float spec = pow(max(dot(normal, halfVector), 0.0), 64.0);
  float linesScale = mix(8.0, 160.0, uDensity);
  float f = h * linesScale;
  float fw = linesScale * length(vec2(hX - h, hY - h));
  float edgeDist = min(fract(f), 1.0 - fract(f));
  float core = uTheme == 4 ? 0.07 : 0.045;
  float aa = min(fw * 1.2, 0.1);
  float line = 1.0 - smoothstep(core, core + aa, edgeDist);
  line *= 1.0 - smoothstep(0.4, 0.9, fw);
  line *= smoothstep(0.0, 0.003, fw);
  line = clamp(line, 0.0, 1.0);
  vec3 bgCol, lineCol, specCol;
  if (uTheme == 0) {
    bgCol = vec3(0.05, 0.04, 0.03);
    lineCol = vec3(1.0, 0.8, 0.3);
    specCol = vec3(1.0, 0.9, 0.5);
  } else if (uTheme == 1) {
    bgCol = vec3(0.05, 0.0, 0.1);
    lineCol = mix(vec3(1.0, 0.0, 0.5), vec3(0.0, 1.0, 1.0), h);
    specCol = vec3(1.0, 0.5, 1.0);
  } else if (uTheme == 2) {
    bgCol = vec3(0.0, 0.05, 0.0);
    lineCol = vec3(0.1, 1.0, 0.2);
    specCol = vec3(0.5, 1.0, 0.5);
  } else if (uTheme == 3) {
    bgCol = vec3(0.02);
    lineCol = vec3(0.95);
    specCol = vec3(1.0);
  } else if (uTheme == 4) {
    bgCol = vec3(mix(0.15, 0.85, h));
    lineCol = vec3(-0.8);
    specCol = vec3(0.4);
  } else {
    bgCol = uColor * 0.05;
    lineCol = uColor;
    specCol = mix(uColor, vec3(1.0), 0.5);
  }
  if (uTheme != 4) bgCol *= mix(0.3, 1.0, h);
  vec3 finalCol = bgCol;
  if (uTheme == 4) {
    finalCol += lineCol * line;
    finalCol += specCol * spec * uElevation;
  } else {
    finalCol += (lineCol * line) * mix(0.5, 1.5, diff);
    finalCol += specCol * spec * uElevation * 2.0;
  }
  float d = distance(uv, vec2(0.5));
  finalCol *= mix(1.0, smoothstep(0.8, 0.2, d), uCov);
  float gCov = covGateAt(texture(uCoverage, uv).r, uCovT);
  finalCol = mix(srcRGB(uv), finalCol, gCov);
  outColor = vec4(finalCol, 1.0);
}`;
