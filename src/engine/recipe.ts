import { z } from 'zod';
import reference from '../../research/catalog.json';

export class RenderError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'RenderError'; }
}

export const cellModes = [
  'characters', 'block-chars', 'dots', 'mixed', 'pixel', 'mosaic', 'braille',
  'cross', 'diamond', 'lines', 'diagonal', 'disco'
] as const;
export const warpModes = ['pinch', 'spherize', 'twirl', 'ripple', 'zigzag', 'polar', 'shear'] as const;
export const distortionAmountLimits = { pinch: [-150, 150], spherize: [-150, 150], twirl: [-300, 300],
  ripple: [0, 100], zigzag: [0, 100], polar: [0, 100], shear: [-150, 150] } as const;
export const colorModes = ['duotone', 'scanline', 'emboss', 'rgbsplit'] as const;

export const proModes = [
  'asciiStudio', 'dither', 'frostedglass', 'motionblur', 'lego', '3d', 'stippling', 'waves',
  'risograph', 'crt', 'specimen', 'smudge', 'pixelsort', 'oilpaint', 'lowpoly', 'comic',
  'sketch', 'watercolor', 'chrome', 'hexmosaic', 'stainedglass', 'anaglyph', 'tiltshift',
  'gaussianblur', 'radialblur', 'thinfilm', 'truchet', 'isoextrude', 'flowfield', 'engraving',
  'gradientmap', 'warhol', 'shatter', 'lattice', 'blueprint', 'topography', 'prism', 'marble',
  'dreamdust', 'forms', 'halftone', 'schematic', 'forensics', 'glitch', 'datamosh', 'ukiyoe',
  'molten', 'vitrine', 'lightwind', 'starburst', 'warpbloom', 'lofi', 'edgeglow', 'posterize',
  'crystallize', 'mezzotint', 'pointillize', 'crosshatch', 'neongrid', 'ledmatrix', 'thermal',
  'beacon', 'halftonecmyk', 'lens', 'glassorb', 'flutedglass', 'liquidglass', 'cutout'
] as const;
export const glassStyles = ['cross', 'hammered', 'diamond', 'hexagon', 'ripple', 'crackle',
  'chevron', 'seedy', 'pixel', 'jello', 'liquid'] as const;
export const gpuImageModes = [...warpModes, 'droste', ...colorModes] as const;
export const implementedProModes = [
  'frostedglass', 'motionblur', 'smudge', 'pixelsort', 'oilpaint', 'lowpoly', 'comic', 'sketch',
  'anaglyph', 'tiltshift', 'gaussianblur', 'radialblur', 'thinfilm', 'engraving', 'gradientmap',
  'warhol', 'topography', 'prism', 'marble', 'lightwind', 'starburst', 'warpbloom', 'lofi',
  'edgeglow', 'posterize', 'crystallize', 'mezzotint', 'pointillize', 'crosshatch', 'ledmatrix',
  'thermal', 'beacon', 'hexmosaic', 'truchet', 'chrome', 'watercolor', 'flowfield', 'isoextrude', 'glassorb',
  'shatter', 'stainedglass', 'dither', 'molten', 'liquidglass', '3d', 'lego', 'lens', 'forms', 'stippling', 'vitrine', 'risograph', 'halftone',
  'glitch', 'datamosh', 'blueprint', 'waves', 'lattice'
] as const;
export const implementedModes = [...cellModes, ...gpuImageModes, ...implementedProModes] as const;
export const blends = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity', 'lighter'] as const;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six digit hex color');
const percent = z.number().finite().min(0).max(100);
const d = reference.recipeDefaults as Record<string, unknown>;
const dNum = (key: string, fallback: number) => (typeof d[key] === 'number' ? d[key] as number : fallback);
const dStr = <T extends string>(key: string, fallback: T) => (typeof d[key] === 'string' ? d[key] as T : fallback);
const dColor = (key: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(String(d[key])) ? d[key] as string : fallback);
const dBool = (key: string, fallback: boolean) => (typeof d[key] === 'boolean' ? d[key] as boolean : fallback);

// Only controls consumed by the renderer belong in this schema.
export const controls = {
  fontSize: z.number().finite().min(3).max(200).default(11).describe('Cell height in source pixels'),
  charSet: z.string().min(1).max(256).default(reference.recipeDefaults.charSet),
  coverage: percent.default(100).describe('Cell coverage, 0 to 100'),
  darkThreshold: percent.default(30),
  bgMode: z.enum(['blur', 'solid', 'original', 'none']).default('blur'),
  bgSolidColor: color.default('#000000'),
  bgBlur: z.number().finite().min(0).max(100).default(8),
  bgOpacity: percent.default(100),
  charOpacity: percent.default(100),
  brightness: z.number().finite().min(-100).max(100).default(0),
  contrast: z.number().finite().min(-100).max(255).default(100),
  invert: z.boolean().default(false),
  blendMode: z.enum(blends).default('source-over'),
  overlayColor: color.default('#ff0000'),
  overlayOpacity: percent.default(0),
  overlayBlend: z.enum(blends).default('multiply'),
  grayscale: percent.default(0),
  mosaicShape: z.enum(['square', 'wide', 'tall']).default('square'),
  discoUniformity: percent.default(80),
  discoSeed: z.number().int().min(0).max(4294967295).default(1),
  distortAmount: z.number().finite().min(-300).max(300).default(50),
  distortRadius: z.number().finite().min(10).max(150).default(100),
  distortCenterX: percent.default(50),
  distortCenterY: percent.default(50),
  distortWavelength: z.number().finite().min(5).max(100).default(40),
  distortRidges: z.number().int().min(1).max(20).default(20),
  distortPeriod: z.number().finite().min(25).max(300).default(100),
  distortPolarMode: z.enum(['rect2polar', 'polar2rect']).default('rect2polar'),
  drZoom: z.number().finite().min(2).max(8).default(3),
  drTwist: z.number().finite().min(-100).max(100).default(20),
  drSpin: z.number().finite().min(0).max(360).default(0),
  drCenterX: percent.default(50), drCenterY: percent.default(50),
  duoShadow: color.default(reference.recipeDefaults.duoShadow),
  duoHighlight: color.default(reference.recipeDefaults.duoHighlight),
  duoMidpoint: percent.default(50),
  duoContrast: z.number().finite().min(0).max(200).default(100),
  scanSpacing: z.number().int().min(2).max(16).default(4),
  scanDarkness: percent.default(55),
  scanDrift: percent.default(dNum('scanDrift', 15)),
  scanThickness: z.number().int().min(1).max(6).default(1),
  scanBloom: percent.default(0), scanTint: color.default('#ffffff'),
  embossDepth: percent.default(reference.recipeDefaults.embossDepth),
  embossSweep: z.number().finite().min(-180).max(180).default(reference.recipeDefaults.embossSweep),
  embossShine: percent.default(reference.recipeDefaults.embossShine),
  embossDetail: z.number().int().min(1).max(6).default(1),
  embossColor: z.enum(['metal', 'source']).default('metal'),
  embossTint: color.default('#c9cdd6'),
  rgbAmount: percent.default(40),
  rgbAngle: z.number().finite().min(0).max(360).default(0),
  rgbFalloff: percent.default(0), rgbBalance: percent.default(50),
  animated: z.boolean().default(false),
  animSpeed: z.number().finite().min(300).max(60000).default(3000),
  animIntensity: percent.default(60),
  animRandomness: percent.default(50),
  animPreset: z.string().default('right'),
  depthEnabled: z.boolean().default(false),

  // asciiStudio
  asciiColorMode: z.enum(['band', 'source', 'mono']).default(dStr('asciiColorMode', 'band')),
  asciiPalette: z.string().default(dStr('asciiPalette', 'acidPop')),
  asciiBandSpread: z.number().finite().min(0).max(100).default(dNum('asciiBandSpread', 0)),
  asciiExtractK: z.number().finite().min(0).max(16).default(dNum('asciiExtractK', 5)),
  asciiSat: percent.default(dNum('asciiSat', 0)),
  asciiVibrance: percent.default(dNum('asciiVibrance', 0)),
  asciiHue: z.number().finite().min(-180).max(180).default(dNum('asciiHue', 0)),
  asciiTint: color.default(dColor('asciiTint', '#ff2da0')),
  asciiTintAmt: percent.default(dNum('asciiTintAmt', 0)),
  asciiBlack: percent.default(dNum('asciiBlack', 0)),
  asciiWhite: percent.default(dNum('asciiWhite', 100)),
  asciiGamma: z.number().finite().min(0.1).max(4).default(dNum('asciiGamma', 1)),
  asciiLvContrast: z.number().finite().min(-100).max(100).default(dNum('asciiLvContrast', 0)),
  asciiPosterize: percent.default(dNum('asciiPosterize', 0)),
  asciiGlyphKind: z.enum(['chars', 'blocks', 'arrows', 'runes']).default(dStr('asciiGlyphKind', 'chars')),

  // dither
  ditherAlgo: z.enum(['bayer2', 'bayer4', 'bayer8', 'bayer16', 'halftone', 'floyd', 'atkinson',
    'stucki', 'sierra', 'sierraTwo', 'sierraLite', 'burkes', 'jjn', 'whiteNoise', 'blueNoise',
    'radial', 'linesH', 'linesV', 'linesD'])
    .default(dStr('ditherAlgo', 'floyd')),
  ditherPalette: z.enum(['mono', 'grey4', 'grey8', 'rgb3', 'gameboy', 'cga0', 'cga1', 'pico8',
    'c64', 'nes16', 'cyberpunk', 'pastel', 'riso', 'sepia', 'original', 'custom'])
    .default(dStr('ditherPalette', 'mono')),
  ditherScale: z.number().finite().min(1).max(16).default(dNum('ditherScale', 2)),
  ditherStrength: percent.default(dNum('ditherStrength', 100)),
  ditherContrast: z.number().finite().min(0).max(300).default(dNum('ditherContrast', 110)),
  ditherThreshold: percent.default(dNum('ditherThreshold', 50)),
  ditherCellSize: z.number().finite().min(2).max(64).default(dNum('ditherCellSize', 8)),
  ditherAngle: z.number().finite().min(-180).max(180).default(dNum('ditherAngle', 0)),
  ditherChromaMode: z.enum(['standard', 'perChannel', 'weighted', 'luminance']).default(dStr('ditherChromaMode', 'standard')),
  ditherOffsetX: z.number().finite().min(-10000).max(10000).default(0),
  ditherOffsetY: z.number().finite().min(-10000).max(10000).default(0),
  ditherCustomPalette: z.array(color).min(1).max(256).default(['#000000', '#ffffff']),
  ditherAnimate: z.boolean().default(false),

  // 3d voxel
  shape3dCellSize: z.number().finite().min(4).max(64).default(dNum('shape3dCellSize', 12)),
  shape3dHSpacing: percent.default(dNum('shape3dHSpacing', 20)),
  shape3dVSpacing: percent.default(dNum('shape3dVSpacing', 20)),
  shape3dTopShade: z.number().finite().min(0).max(200).default(dNum('shape3dTopShade', 100)),
  shape3dLightShade: percent.default(dNum('shape3dLightShade', 70)),
  shape3dDarkShade: percent.default(dNum('shape3dDarkShade', 45)),
  shape3dOutline: percent.default(dNum('shape3dOutline', 0)),
  shape3dFlip: z.boolean().default(dBool('shape3dFlip', false)),

  // stippling
  stippleShape: z.enum(['circle', 'ring', 'square', 'diamond', 'cross', 'triangle', 'star', 'hexagon']).default(dStr('stippleShape', 'circle')),
  stippleDotSize: z.number().finite().min(10).max(400).default(dNum('stippleDotSize', 170)),
  stippleSizeJitter: percent.default(dNum('stippleSizeJitter', 30)),

  // waves
  waveSheen: percent.default(dNum('waveSheen', 65)),
  waveGrain: percent.default(dNum('waveGrain', 45)),
  waveAngle: z.number().finite().min(-180).max(180).default(dNum('waveAngle', 30)),
  waveWeave: percent.default(dNum('waveWeave', 0)),
  waveChop: percent.default(dNum('waveChop', 50)),

  // risograph
  risoRegOffset: percent.default(dNum('risoRegOffset', 35)),
  risoLevels: z.number().int().min(2).max(8).default(dNum('risoLevels', 6)),
  risoAngle: z.number().finite().min(-90).max(90).default(dNum('risoAngle', 0)),
  risoChroma: z.number().finite().min(0).max(300).default(dNum('risoChroma', 200)),

  // halftone
  htTexture: z.enum(['dots', 'checker', 'stripesV', 'stripesH', 'diagonal', 'crosshatch', 'grid', 'brick', 'triangle', 'dash', 'rings', 'plus']).default(dStr('htTexture', 'dots')),
  htShape: z.enum(['circle', 'ellipse', 'square', 'diamond', 'triangle', 'ring', 'plus', 'xmark', 'hexagon', 'star5', 'sparkle4', 'heart', 'petal', 'dash']).default(dStr('htShape', 'square')),
  htAngle: z.number().finite().min(-90).max(90).default(dNum('htAngle', 15)),
  htContrast: percent.default(dNum('htContrast', 50)),
  htSpread: percent.default(dNum('htSpread', 0)),
  htSharpness: percent.default(dNum('htSharpness', 70)),
  htColorMode: z.enum(['mono', 'color']).default(dStr('htColorMode', 'mono')),
  htInk: color.default(dColor('htInk', '#141414')),
  htPaper: color.default(dColor('htPaper', '#f4f1e8')),

  // forms
  formShape: z.enum(['soft', 'dot', 'heart', 'triangle', 'hourglass', 'ring', 'flower']).default(dStr('formShape', 'flower')),
  formPower: percent.default(dNum('formPower', 60)),
  formScale: z.number().finite().min(5).max(200).default(dNum('formScale', 100)),
  formRadius: percent.default(dNum('formRadius', 50)),
  formRays: z.number().int().min(2).max(16).default(dNum('formRays', 6)),
  formMouse: z.boolean().default(dBool('formMouse', true)),
  formSpring: z.number().finite().min(0).max(100).default(dNum('formSpring', 5)),
  formSeed: z.number().int().min(0).max(4294967295).default(dNum('formSeed', 1)),
  formJitter: percent.default(dNum('formJitter', 0)),
  formOriginX: percent.default(dNum('formOriginX', 50)),
  formOriginY: percent.default(dNum('formOriginY', 50)),

  // frosted glass
  frostScale: percent.default(dNum('frostScale', 100)),
  frostScatter: percent.default(dNum('frostScatter', 45)),
  frostHaze: percent.default(dNum('frostHaze', 40)),
  frostMilk: percent.default(dNum('frostMilk', 14)),
  frostGrain: percent.default(dNum('frostGrain', 18)),
  frostTint: color.default(dColor('frostTint', '#ffffff')),

  // motion blur
  motionPath: z.array(z.number().finite()).max(4096)
    .refine(path => path.length === 0 || (path.length >= 4 && path.length % 2 === 0),
      'Use an empty path or at least two x/y pairs').default([]),
  motionAmount: percent.default(dNum('motionAmount', 35)),
  motionAngle: z.number().finite().min(-180).max(180).default(dNum('motionAngle', 0)),

  // pixel sort
  psortDir: z.enum(['horizontal', 'vertical']).default('horizontal'),
  psortLow: percent.default(dNum('psortLow', 25)),
  psortHigh: percent.default(dNum('psortHigh', 80)),
  psortKey: z.enum(['brightness', 'red', 'hue', 'saturation']).default('brightness'),
  psortOrder: z.enum(['asc', 'desc']).default('asc'),
  psortMaxLen: percent.default(dNum('psortMaxLen', 0)),

  // oil paint
  oilBrush: z.number().int().min(1).max(15).default(dNum('oilBrush', 6)),
  oilDetail: percent.default(dNum('oilDetail', 100)),
  oilLevels: z.number().int().min(0).max(8).default(dNum('oilLevels', 0)),

  // low poly
  lpDensity: z.number().int().min(120).max(3000).default(dNum('lpDensity', 900)),
  lpEdgeBias: percent.default(dNum('lpEdgeBias', 60)),
  lpStroke: percent.default(dNum('lpStroke', 0)),
  lpSeed: z.number().int().min(0).max(4294967295).default(dNum('lpSeed', 0)),

  // comic
  cmLevels: z.number().int().min(2).max(8).default(dNum('cmLevels', 5)),
  cmInk: percent.default(dNum('cmInk', 90)),
  cmThreshold: percent.default(dNum('cmThreshold', 45)),
  cmThickness: z.number().int().min(1).max(3).default(dNum('cmThickness', 1)),
  cmSmooth: percent.default(dNum('cmSmooth', 40)),

  // sketch
  skScale: z.number().int().min(1).max(10).default(dNum('skScale', 3)),
  skTau: percent.default(dNum('skTau', 97)),
  skPhi: z.number().finite().min(1).max(60).default(dNum('skPhi', 15)),
  skThreshold: percent.default(dNum('skThreshold', 50)),
  skShading: percent.default(dNum('skShading', 55)),
  skPen: z.boolean().default(true),

  // watercolor
  wcWash: percent.default(dNum('wcWash', 45)),
  wcWobble: percent.default(dNum('wcWobble', 40)),
  wcEdge: percent.default(dNum('wcEdge', 55)),
  wcGrain: percent.default(dNum('wcGrain', 30)),
  wcPigment: percent.default(dNum('wcPigment', 60)),

  // chrome
  chBands: z.number().int().min(2).max(16).default(dNum('chBands', 6)),
  chSmooth: percent.default(dNum('chSmooth', 50)),
  chLight: z.number().finite().min(0).max(255).default(dNum('chLight', 135)),
  chShine: percent.default(dNum('chShine', 60)),
  chTint: z.enum(['steel', 'gold', 'copper', 'cobalt']).default(dStr('chTint', 'steel')),

  // hexmosaic
  hexSize: z.number().finite().min(4).max(64).default(dNum('hexSize', 16)),
  hexOrient: z.enum(['pointy', 'flat']).default(dStr('hexOrient', 'pointy')),
  hexGrout: percent.default(dNum('hexGrout', 0)),
  hexGroutColor: z.enum(['black', 'white']).default(dStr('hexGroutColor', 'black')),

  // stainedglass
  sgCells: z.number().int().min(6).max(120).default(dNum('sgCells', 26)),
  sgLead: z.number().int().min(1).max(10).default(dNum('sgLead', 2)),
  sgSaturation: percent.default(dNum('sgSaturation', 60)),
  sgGlow: percent.default(dNum('sgGlow', 40)),
  sgJitter: percent.default(dNum('sgJitter', 70)),
  sgPattern: z.enum(['shards', 'mosaic', 'rounds', 'rose', 'lattice', 'diamond', 'hexagon', 'triangle', 'fan', 'chevron']).default(dStr('sgPattern', 'shards')),
  sgColorMode: z.enum(['source', 'palette']).default(dStr('sgColorMode', 'source')),
  sgPalette: z.string().default(dStr('sgPalette', '')),

  // anaglyph
  agDisparity: percent.default(dNum('agDisparity', 40)),
  agFocus: percent.default(dNum('agFocus', 50)),
  agDepthBlur: percent.default(dNum('agDepthBlur', 60)),
  agScheme: z.enum(['redcyan', 'greenmagenta', 'chromadepth']).default(dStr('agScheme', 'redcyan')),

  // tiltshift
  tsFocus: percent.default(dNum('tsFocus', 50)),
  tsWidth: percent.default(dNum('tsWidth', 28)),
  tsBlur: percent.default(dNum('tsBlur', 45)),
  tsAngle: z.number().finite().min(-90).max(90).default(dNum('tsAngle', 0)),
  tsSat: z.number().finite().min(0).max(300).default(dNum('tsSat', 145)),

  // gaussian / radial blur
  gbAmount: percent.default(dNum('gbAmount', 40)),
  rbMode: z.enum(['zoom', 'spin']).default(dStr('rbMode', 'zoom')),
  rbAmount: percent.default(dNum('rbAmount', 40)),
  rbCenterX: percent.default(dNum('rbCenterX', 50)),
  rbCenterY: percent.default(dNum('rbCenterY', 50)),

  // thin film
  tfThickness: percent.default(dNum('tfThickness', 40)),
  tfBands: percent.default(dNum('tfBands', 45)),
  tfSwirl: percent.default(dNum('tfSwirl', 55)),
  tfSheen: percent.default(dNum('tfSheen', 80)),
  tfHue: z.number().finite().min(0).max(360).default(dNum('tfHue', 0)),

  // truchet
  trTile: percent.default(dNum('trTile', 0)),
  trStyle: z.enum(['arcs', 'lines', 'mixed', 'crazy']).default(dStr('trStyle', 'arcs')),
  trWeight: percent.default(dNum('trWeight', 30)),
  trTone: percent.default(dNum('trTone', 0)),
  trColor: z.enum(['source', 'ink', 'duo']).default(dStr('trColor', 'source')),

  // isoextrude
  ceCell: percent.default(dNum('ceCell', 55)),
  ceHeight: percent.default(dNum('ceHeight', 55)),
  ceGap: percent.default(dNum('ceGap', 12)),
  ceLight: percent.default(dNum('ceLight', 55)),
  ceColor: z.enum(['source', 'ink']).default(dStr('ceColor', 'source')),
  ceRotate: z.number().finite().min(-180).max(180).default(dNum('ceRotate', 45)),
  cePitch: z.number().finite().min(0).max(100).default(dNum('cePitch', 32)),
  ceZoom: percent.default(dNum('ceZoom', 100)),
  ceProject: z.enum(['iso', 'oblique']).default(dStr('ceProject', 'iso')),
  ceOffX: percent.default(dNum('ceOffX', 50)),
  ceOffY: percent.default(dNum('ceOffY', 50)),

  // cutout
  coThreshold: percent.default(dNum('coThreshold', 45)),
  coBlur: percent.default(dNum('coBlur', 40)),
  coStyle: z.enum(['smooth', 'poster', 'hard']).default(dStr('coStyle', 'smooth')),
  coOutline: percent.default(dNum('coOutline', 30)),
  coFeather: percent.default(dNum('coFeather', 20)),
  coColor: color.default(dColor('coColor', '#ffffff')),
  coBg: color.default(dColor('coBg', '#111318')),
  coInvertMask: z.boolean().default(dBool('coInvertMask', false)),

  // flowfield
  ffDensity: z.number().int().min(200).max(40000).default(dNum('ffDensity', 6000)),
  ffLength: percent.default(dNum('ffLength', 46)),
  ffWeight: percent.default(dNum('ffWeight', 100)),
  ffSwirl: z.number().finite().min(-300).max(300).default(dNum('ffSwirl', 0)),
  ffColor: z.enum(['source', 'ink', 'gradient']).default(dStr('ffColor', 'source')),

  // engraving
  enSpacing: z.number().int().min(2).max(32).default(dNum('enSpacing', 6)),
  enWave: percent.default(dNum('enWave', 30)),
  enRelief: percent.default(dNum('enRelief', 40)),
  enContrast: percent.default(dNum('enContrast', 45)),
  enColor: z.enum(['ink', 'mono', 'blueprint', 'currency']).default(dStr('enColor', 'ink')),

  // gradient map
  gmPalette: z.enum(['inferno', 'viridis', 'magma', 'sunset', 'tealorange', 'noir', 'cyberpunk', 'gold'])
    .default(dStr('gmPalette', 'inferno')),
  gmMix: percent.default(dNum('gmMix', 100)),
  gmContrast: percent.default(dNum('gmContrast', 30)),
  gmMidpoint: percent.default(dNum('gmMidpoint', 50)),
  gmBands: z.number().int().min(0).max(32).default(dNum('gmBands', 0)),
  gmStops: z.string().default(''),

  // warhol
  whGrid: z.number().int().min(2).max(6).default(dNum('whGrid', 3)),
  whLevels: z.number().int().min(2).max(5).default(dNum('whLevels', 4)),
  whContrast: percent.default(dNum('whContrast', 43)),
  whGap: percent.default(dNum('whGap', 13)),
  whPalette: z.enum(['pop', 'acid', 'candy']).default(dStr('whPalette', 'pop')),

  // shatter
  shFocusX: percent.default(dNum('shFocusX', 50)),
  shFocusY: percent.default(dNum('shFocusY', 42)),
  shCracks: percent.default(dNum('shCracks', 100)),
  shSpread: percent.default(dNum('shSpread', 30)),
  shSeam: percent.default(dNum('shSeam', 14)),

  // crosshatch
  hatchScale: percent.default(dNum('hatchScale', 50)),
  hatchInk: color.default(dColor('hatchInk', '#172044')),
  hatchPaper: color.default(dColor('hatchPaper', '#f2efe7')),
  hatchWeight: z.number().finite().min(0.5).max(8).default(dNum('hatchWeight', 1)),
  hatchDarkness: percent.default(dNum('hatchDarkness', 50)),
  hatchAngle: z.number().finite().min(-90).max(90).default(dNum('hatchAngle', 0)),

  // neongrid
  gridScale: percent.default(dNum('gridScale', 45)),
  gridGlow: percent.default(dNum('gridGlow', 60)),
  gridColor: color.default(dColor('gridColor', '#69ffeb')),
  gridWarp: percent.default(dNum('gridWarp', 35)),
  gridSolve: percent.default(dNum('gridSolve', 70)),
  gridConfine: percent.default(dNum('gridConfine', 65)),

  // led matrix
  ledScale: z.number().finite().min(1).max(100).default(dNum('ledScale', 8)),
  ledGlow: percent.default(dNum('ledGlow', 60)),
  ledColor: color.default(dColor('ledColor', '#ff7a18')),
  ledBg: color.default(dColor('ledBg', '#000000')),
  ledBrightness: percent.default(dNum('ledBrightness', 100)),
  ledColorMode: z.enum(['solid', 'source']).default(dStr('ledColorMode', 'solid')),
  ledType: z.enum(['round', 'square', 'bulb', 'stripe']).default(dStr('ledType', 'round')),

  // thermal
  thermalPalette: z.enum(['rainbow', 'ironbow', 'whitehot', 'blackhot', 'lava', 'arctic'])
    .default(dStr('thermalPalette', 'rainbow')),
  thermalSensitivity: percent.default(dNum('thermalSensitivity', 50)),
  thermalBleed: percent.default(dNum('thermalBleed', 35)),
  thermalNoise: percent.default(dNum('thermalNoise', 20)),
  thermalScale: percent.default(dNum('thermalScale', 0)),
  thermalSolarize: percent.default(dNum('thermalSolarize', 0)),

  // beacon
  beaconScale: percent.default(dNum('beaconScale', 8)),
  beaconBloomIntensity: percent.default(dNum('beaconBloomIntensity', 45)),
  beaconBloomRadius: percent.default(dNum('beaconBloomRadius', 0)),
  beaconBloomOpacity: percent.default(dNum('beaconBloomOpacity', 14)),
  beaconDecay: percent.default(dNum('beaconDecay', 36)),
  beaconAngle: z.number().finite().min(-180).max(180).default(dNum('beaconAngle', 0)),
  beaconAuto: z.boolean().default(dBool('beaconAuto', false)),
  beaconColorMode: z.enum(['source', 'white']).default(dStr('beaconColorMode', 'source')),
  beaconSpacing: percent.default(dNum('beaconSpacing', 0)),

  // halftonecmyk
  cmykAngle: percent.default(dNum('cmykAngle', 15)),
  cmykGain: percent.default(dNum('cmykGain', 0)),
  hcType: z.enum(['sharp', 'soft', 'euclidean']).default(dStr('hcType', 'sharp')),
  hcSize: z.number().finite().min(0.02).max(2).default(dNum('hcSize', 0.2)),
  hcMinDot: percent.default(dNum('hcMinDot', 0)),
  hcContrast: z.number().finite().min(0).max(4).default(dNum('hcContrast', 1.25)),
  hcSoftness: z.number().finite().min(0).max(1).default(dNum('hcSoftness', 0.4)),
  hcGridNoise: z.number().finite().min(0).max(1).default(dNum('hcGridNoise', 0.45)),

  // lens
  lensBulge: percent.default(dNum('lensBulge', 40)),
  lensDispersion: percent.default(dNum('lensDispersion', 30)),
  lensSwirl: z.number().finite().min(-300).max(300).default(dNum('lensSwirl', 0)),
  lensZoom: z.number().finite().min(-100).max(300).default(dNum('lensZoom', 0)),
  lensdSpread: z.number().finite().min(0).max(4).default(dNum('lensdSpread', 0.6)),
  lensdBias: z.number().finite().min(-4).max(4).default(dNum('lensdBias', 1)),
  lensdAngle: z.number().finite().min(-180).max(180).default(dNum('lensdAngle', 0)),
  lensdPerspective: z.number().finite().min(0).max(1).default(dNum('lensdPerspective', 0.1)),
  lensdCount: z.number().int().min(1).max(50).default(dNum('lensdCount', 35)),
  lensdDispersion: z.number().finite().min(0).max(4).default(dNum('lensdDispersion', 1)),
  lensdDispShift: z.number().finite().min(-1).max(1).default(dNum('lensdDispShift', 0)),
  lensdDispColor: z.number().finite().min(0).max(1).default(dNum('lensdDispColor', 0.6)),
  lensdFocusCenter: z.number().finite().min(0).max(1).default(dNum('lensdFocusCenter', 0.8)),
  lensdFocusEdges: z.number().finite().min(0).max(2).default(dNum('lensdFocusEdges', 1)),
  lensdSwirl: z.number().finite().min(-4).max(4).default(dNum('lensdSwirl', 0.35)),
  lensdNoise: z.number().finite().min(0).max(1).default(dNum('lensdNoise', 0)),
  lensdNoiseFreq: z.number().finite().min(0).max(1).default(dNum('lensdNoiseFreq', 0.25)),
  lensdNoiseOffset: z.number().finite().min(0).max(4).default(dNum('lensdNoiseOffset', 0)),
  lensdBulge: z.number().finite().min(-1).max(1).default(dNum('lensdBulge', 0)),
  lensdCircle: z.number().finite().min(0).max(1).default(dNum('lensdCircle', 0)),
  lensdGrainMix: z.number().finite().min(0).max(1).default(dNum('lensdGrainMix', 0)),
  lensdGrainOverlay: z.number().finite().min(0).max(1).default(dNum('lensdGrainOverlay', 0)),
  lensdImageX: z.number().finite().min(-1).max(1).default(dNum('lensdImageX', 0)),
  lensdImageY: z.number().finite().min(-1).max(1).default(dNum('lensdImageY', 0)),
  lensdScale: z.number().finite().min(0.1).max(4).default(dNum('lensdScale', 1)),

  // glassorb
  orbSize: percent.default(dNum('orbSize', 55)),
  orbX: percent.default(dNum('orbX', 50)),
  orbY: percent.default(dNum('orbY', 50)),
  orbRefraction: percent.default(dNum('orbRefraction', 55)),
  orbChroma: percent.default(dNum('orbChroma', 80)),
  orbBg: percent.default(dNum('orbBg', 45)),
  orbRim: percent.default(dNum('orbRim', 60)),

  // dissolve (flutedglass family helper)
  dissolveScale: percent.default(dNum('dissolveScale', 45)),
  dissolveX: percent.default(50),
  dissolveY: percent.default(50),
  dissolveAmount: percent.default(dNum('dissolveAmount', 100)),
  dissolveSpread: percent.default(50),
  dissolveGap: percent.default(0),
  dissolveDirection: z.enum(['out', 'in']).default('out'),
  dissolveDetect: percent.default(50),
  dissolveSeed: z.number().int().min(0).max(4294967295).default(1),

  // crt
  crtPalette: z.enum(['phosphor', 'rgb']).default(dStr('crtPalette', 'rgb')),
  crtHue: z.number().finite().min(-180).max(180).default(dNum('crtHue', 0)),
  crtMask: z.enum(['dots', 'slot']).default(dStr('crtMask', 'dots')),
  crtPitch: percent.default(dNum('crtPitch', 30)),
  crtScanlines: percent.default(dNum('crtScanlines', 30)),
  crtGlow: percent.default(dNum('crtGlow', 60)),
  crtCurvature: percent.default(dNum('crtCurvature', 0)),
  crtVignette: percent.default(dNum('crtVignette', 45)),
  crtNoise: percent.default(dNum('crtNoise', 30)),
  crtAberration: percent.default(dNum('crtAberration', 20)),
  crtIntensity: percent.default(dNum('crtIntensity', 100)),
  crtPersistence: percent.default(dNum('crtPersistence', 55)),

  // specimen
  specimenGridSize: percent.default(dNum('specimenGridSize', 35)),
  specimenGap: percent.default(dNum('specimenGap', 25)),
  specimenRadius: percent.default(dNum('specimenRadius', 24)),
  specimenSwatchCount: z.number().int().min(4).max(512).default(dNum('specimenSwatchCount', 100)),
  specimenOverlay: z.enum(['both', 'dots', 'swatches', 'none']).default(dStr('specimenOverlay', 'both')),
  specimenDots: percent.default(dNum('specimenDots', 0)),
  specimenGridLines: percent.default(dNum('specimenGridLines', 25)),
  specimenConnectors: percent.default(dNum('specimenConnectors', 35)),
  specimenBoxSize: z.number().finite().min(0).max(300).default(dNum('specimenBoxSize', 133)),
  specimenBoxWeight: z.number().int().min(100).max(900).default(dNum('specimenBoxWeight', 400)),
  specimenSeed: z.number().int().min(0).max(4294967295).default(dNum('specimenSeed', 0)),
  specimenLabelSize: percent.default(dNum('specimenLabelSize', 100)),
  specimenBoxColor: color.default(dColor('specimenBoxColor', '#b4dc64')),
  specimenBlur: percent.default(dNum('specimenBlur', 0)),
  specimenManual: z.boolean().default(false),
  specimenBoxes: z.array(z.object({ x: percent, y: percent, w: percent, h: percent,
    label: z.string().max(40).default('') }).strict()).default([]),

  // smudge
  smudgeStrength: percent.default(dNum('smudgeStrength', 100)),
  smudgeRadius: percent.default(dNum('smudgeRadius', 18)),
  smudgeColor: percent.default(dNum('smudgeColor', 0)),
  smudgeReveal: percent.default(dNum('smudgeReveal', 40)),
  smudgeColorA: color.default(dColor('smudgeColorA', '#1a0602')),
  smudgeColorB: color.default(dColor('smudgeColorB', '#ff9a1e')),

  // forensics
  forensicsIntensity: percent.default(dNum('forensicsIntensity', 100)),
  forensicsContrast: percent.default(dNum('forensicsContrast', 60)),
  forensicsEdge: percent.default(dNum('forensicsEdge', 45)),
  forensicsNoise: percent.default(dNum('forensicsNoise', 20)),
  forensicsChroma: percent.default(dNum('forensicsChroma', 35)),
  forensicsScanSpeed: percent.default(dNum('forensicsScanSpeed', 15)),
  forensicsRegions: z.number().int().min(1).max(12).default(dNum('forensicsRegions', 2)),
  forensicsShape: z.enum(['mixed', 'box', 'oval']).default(dStr('forensicsShape', 'mixed')),
  forensicsSize: percent.default(dNum('forensicsSize', 45)),
  forensicsSoftness: percent.default(dNum('forensicsSoftness', 12)),
  forensicsSeed: z.number().int().min(0).max(4294967295).default(dNum('forensicsSeed', 1)),
  forensicsOverlay: percent.default(dNum('forensicsOverlay', 55)),
  forensicsAscii: percent.default(dNum('forensicsAscii', 0)),
  forensicsManual: z.boolean().default(false),
  forensicsBoxes: z.array(z.object({ x: percent, y: percent, w: percent, h: percent,
    label: z.string().max(40).default('') }).strict()).default([]),

  // glitch
  glitchCoverage: percent.default(dNum('glitchCoverage', 70)),
  glitchPosition: percent.default(dNum('glitchPosition', 30)),
  glitchDisplace: percent.default(dNum('glitchDisplace', 55)),
  glitchSplit: percent.default(dNum('glitchSplit', 60)),
  glitchBlocks: percent.default(dNum('glitchBlocks', 55)),
  glitchSpectrum: percent.default(dNum('glitchSpectrum', 70)),
  glitchNoise: percent.default(dNum('glitchNoise', 20)),
  glitchDesat: percent.default(dNum('glitchDesat', 85)),
  glitchSeed: z.number().int().min(0).max(4294967295).default(dNum('glitchSeed', 3)),

  // datamosh
  dmBlock: percent.default(dNum('dmBlock', 22)),
  dmDisplace: percent.default(dNum('dmDisplace', 65)),
  dmScatter: percent.default(dNum('dmScatter', 22)),
  dmSmear: percent.default(dNum('dmSmear', 45)),
  dmSplit: percent.default(dNum('dmSplit', 45)),
  dmGrain: percent.default(dNum('dmGrain', 30)),
  dmDuotone: percent.default(dNum('dmDuotone', 90)),
  dmPalette: z.array(color).min(2).max(5).default((d.dmPalette as string[]) || ['#100a1e', '#7a2ea8', '#ff6a3d', '#ffe9c7']),
  dmSeed: z.number().int().min(0).max(4294967295).default(dNum('dmSeed', 4)),
  dmIntensity: percent.default(dNum('dmIntensity', 100)),

  // ukiyoe
  ukPalette: z.string().default(dStr('ukPalette', 'sunsetMountain')),
  ukColorSteps: z.number().int().min(2).max(12).default(dNum('ukColorSteps', 6)),
  ukInkStrength: percent.default(dNum('ukInkStrength', 60)),
  ukEdgeThickness: percent.default(dNum('ukEdgeThickness', 45)),
  ukGradient: percent.default(dNum('ukGradient', 55)),
  ukPaperGrain: percent.default(dNum('ukPaperGrain', 20)),
  ukHalftone: percent.default(dNum('ukHalftone', 35)),
  ukInkBleed: percent.default(dNum('ukInkBleed', 40)),
  ukPrintOffset: percent.default(dNum('ukPrintOffset', 30)),
  ukTextureScale: percent.default(dNum('ukTextureScale', 31)),

  // molten
  moltenPalette: z.enum(['gold', 'copper', 'obsidian', 'mercury', 'crimson', 'custom']).default(dStr('moltenPalette', 'gold')),
  moltenFlow: percent.default(dNum('moltenFlow', 55)),
  moltenViscosity: percent.default(dNum('moltenViscosity', 45)),
  moltenDrip: percent.default(dNum('moltenDrip', 45)),
  moltenSheen: percent.default(dNum('moltenSheen', 70)),
  moltenRelief: percent.default(dNum('moltenRelief', 55)),
  moltenHeat: percent.default(dNum('moltenHeat', 55)),
  moltenGrain: percent.default(dNum('moltenGrain', 40)),
  moltenContrast: percent.default(dNum('moltenContrast', 55)),
  moltenLight: z.number().finite().min(0).max(255).default(dNum('moltenLight', 135)),
  moltenColorA: color.default(dColor('moltenColorA', '#160a06')),
  moltenColorB: color.default(dColor('moltenColorB', '#fff2c8')),

  // vitrine
  vitrinePanel: percent.default(dNum('vitrinePanel', 45)),
  vitrineSeam: percent.default(dNum('vitrineSeam', 55)),
  vitrineRefract: percent.default(dNum('vitrineRefract', 50)),
  vitrineFlow: percent.default(dNum('vitrineFlow', 55)),
  vitrineViscosity: percent.default(dNum('vitrineViscosity', 40)),
  vitrineSheen: percent.default(dNum('vitrineSheen', 60)),
  vitrineLight: z.number().finite().min(0).max(360).default(dNum('vitrineLight', 135)),

  // starburst / warpbloom / lofi
  starburstCenterX: percent.default(dNum('starburstCenterX', 50)),
  starburstCenterY: percent.default(dNum('starburstCenterY', 50)),
  starburstLength: percent.default(dNum('starburstLength', 62)),
  starburstCore: percent.default(dNum('starburstCore', 22)),
  starburstStreaks: percent.default(dNum('starburstStreaks', 55)),
  starburstSpin: percent.default(dNum('starburstSpin', 50)),
  starburstVignette: percent.default(dNum('starburstVignette', 42)),
  starburstChroma: percent.default(dNum('starburstChroma', 0)),
  warpbloomCenterX: percent.default(dNum('warpbloomCenterX', 50)),
  warpbloomCenterY: percent.default(dNum('warpbloomCenterY', 50)),
  warpbloomStrength: percent.default(dNum('warpbloomStrength', 58)),
  warpbloomFocus: percent.default(dNum('warpbloomFocus', 28)),
  warpbloomBloom: percent.default(dNum('warpbloomBloom', 45)),
  warpbloomTwist: percent.default(dNum('warpbloomTwist', 0)),
  lofiBlur: percent.default(dNum('lofiBlur', 42)),
  lofiGrain: percent.default(dNum('lofiGrain', 55)),
  lofiBloom: percent.default(dNum('lofiBloom', 30)),
  lofiSaturation: percent.default(dNum('lofiSaturation', 55)),
  lofiWarmth: percent.default(dNum('lofiWarmth', 50)),
  lofiVignette: percent.default(dNum('lofiVignette', 48)),

  // retrostitch
  stitchWeave: percent.default(dNum('stitchWeave', 55)),
  stitchScreen: percent.default(dNum('stitchScreen', 45)),
  stitchRegister: percent.default(dNum('stitchRegister', 35)),
  stitchInk: percent.default(dNum('stitchInk', 60)),
  stitchFade: percent.default(dNum('stitchFade', 45)),
  stitchGrain: percent.default(dNum('stitchGrain', 40)),
  stitchVignette: percent.default(dNum('stitchVignette', 45)),

  // lattice
  latticeResolution: percent.default(dNum('latticeResolution', 69)),
  latticeThreshold: percent.default(dNum('latticeThreshold', 60)),
  latticeNodeSize: percent.default(dNum('latticeNodeSize', 20)),
  latticeWireThickness: percent.default(dNum('latticeWireThickness', 15)),
  latticeWireOpacity: percent.default(dNum('latticeWireOpacity', 70)),
  latticeConnections: z.enum(['both', 'ortho', 'diag']).default(dStr('latticeConnections', 'both')),
  latticeColorMode: z.enum(['source', 'mono', 'vivid']).default(dStr('latticeColorMode', 'source')),
  latticeBloom: percent.default(dNum('latticeBloom', 50)),
  latticeDimming: percent.default(dNum('latticeDimming', 40)),
  latticeConfine: percent.default(dNum('latticeConfine', 55)),
  latticeBlur: percent.default(dNum('latticeBlur', 0)),

  // schematic
  schematicColorMode: z.enum(['source', 'accent']).default(dStr('schematicColorMode', 'source')),
  schematicColor: color.default(dColor('schematicColor', '#7fd4ff')),
  schematicInvertImage: z.boolean().default(dBool('schematicInvertImage', false)),

  // blueprint
  blueprintTheme: z.enum(['cyanotype', 'draft', 'dark', 'light']).default(dStr('blueprintTheme', 'cyanotype')),
  blueprintSensitivity: percent.default(dNum('blueprintSensitivity', 57)),
  blueprintThickness: percent.default(dNum('blueprintThickness', 0)),
  blueprintSpeckle: percent.default(dNum('blueprintSpeckle', 55)),
  blueprintGrid: percent.default(dNum('blueprintGrid', 49)),

  // topography
  topographyTheme: z.enum(['gold', 'cyberpunk', 'topsecret', 'monochrome', 'relief', 'custom'])
    .default(dStr('topographyTheme', 'gold')),
  topographyColor: color.default(dColor('topographyColor', '#ffb922')),
  topographyElevation: percent.default(dNum('topographyElevation', 15)),
  topographyDensity: percent.default(dNum('topographyDensity', 45)),
  topographyFlow: percent.default(dNum('topographyFlow', 0)),

  // prism
  prismTheme: z.enum(['clear', 'iridescent', 'jewel']).default(dStr('prismTheme', 'clear')),
  prismFacets: percent.default(dNum('prismFacets', 15)),
  prismRefraction: percent.default(dNum('prismRefraction', 60)),
  prismDispersion: percent.default(dNum('prismDispersion', 70)),

  // marble
  marbleTheme: z.enum(['source', 'monochrome', 'oilspill', 'goldvein']).default(dStr('marbleTheme', 'source')),
  marbleTurbulence: percent.default(dNum('marbleTurbulence', 50)),
  marbleViscosity: percent.default(dNum('marbleViscosity', 40)),
  marbleDetail: percent.default(dNum('marbleDetail', 60)),

  // dreamdust
  dreamDensity: percent.default(dNum('dreamDensity', 100)),
  dreamThreshold: percent.default(dNum('dreamThreshold', 15)),
  dreamSoftness: percent.default(dNum('dreamSoftness', 66)),
  dreamGrain: percent.default(dNum('dreamGrain', 40)),
  dreamDispersion: percent.default(dNum('dreamDispersion', 14)),
  dreamSwirl: percent.default(dNum('dreamSwirl', 22)),
  dreamGlow: percent.default(dNum('dreamGlow', 72)),
  dreamColorMode: z.enum(['source', 'palette']).default(dStr('dreamColorMode', 'source')),
  dreamPalette: z.enum(['moonlight', 'rose', 'amber', 'mint', 'violet']).default(dStr('dreamPalette', 'moonlight')),

  // lightwind
  lightwindLength: percent.default(dNum('lightwindLength', 70)),
  lightwindAngle: z.number().finite().min(-180).max(180).default(dNum('lightwindAngle', 0)),
  lightwindThreshold: percent.default(dNum('lightwindThreshold', 40)),
  lightwindGlow: percent.default(dNum('lightwindGlow', 55)),
  lightwindDecay: percent.default(dNum('lightwindDecay', 35)),
  lightwindWave: percent.default(dNum('lightwindWave', 25)),

  // liquidglass family
  glassStyle: z.enum(glassStyles).default(dStr('glassStyle', 'liquid')),
  glassRefraction: z.number().finite().min(0).max(300).default(dNum('glassRefraction', 110)),
  glassReflection: percent.default(dNum('glassReflection', 60)),
  glassDispersion: percent.default(dNum('glassDispersion', 25)),
  glassFrost: percent.default(dNum('glassFrost', 0)),
  glassFog: percent.default(dNum('glassFog', 0)),
  glassAngle: z.number().finite().min(-180).max(180).default(dNum('glassAngle', 0)),
  glassDepth: percent.default(dNum('glassDepth', 100)),
  glassSplay: percent.default(dNum('glassSplay', 100)),
  glassReedWave: percent.default(dNum('glassReedWave', 0)),

  // shapes
  shapesKind: z.enum(['square', 'circle', 'triangle', 'diamond', 'cross', 'star', 'hexagon'])
    .default(dStr('shapesKind', 'square')),
  shapesMods: z.array(z.string()).default([]),
  shapesColorMode: z.enum(['mono', 'source']).default(dStr('shapesColorMode', 'mono')),
  shapesJitter: percent.default(dNum('shapesJitter', 30)),
  shapesThreshold: percent.default(dNum('shapesThreshold', 50)),
  shapesPosterize: z.number().int().min(2).max(8).default(dNum('shapesPosterize', 4)),
  shapesHSpacing: percent.default(100),
  shapesVSpacing: percent.default(100),

  // pixel-fx extras
  posterizeLevels: z.number().int().min(2).max(16).default(dNum('posterizeLevels', 6)),
  edgeEmphasis: percent.default(reference.recipeDefaults.edgeEmphasis ?? 0),
  egThreshold: percent.default(dNum('egThreshold', 30)),
  egIntensity: z.number().finite().min(0).max(300).default(dNum('egIntensity', 120)),
  egBg: percent.default(dNum('egBg', 80)),
  egFalloff: percent.default(dNum('egFalloff', 100)),
  egWidth: z.number().int().min(0).max(20).default(dNum('egWidth', 0)),
  mezzoType: z.enum(['grain', 'dots', 'coarse', 'lines', 'strokes']).default(dStr('mezzoType', 'lines')),
  mezzoDensity: percent.default(dNum('mezzoDensity', 40)),
  mezzoContrast: percent.default(dNum('mezzoContrast', 80)),
  mezzoColor: z.enum(['source', 'mono', 'saturated']).default(dStr('mezzoColor', 'source')),
  pointCell: z.number().int().min(3).max(64).default(dNum('pointCell', 10)),
  pointFill: percent.default(dNum('pointFill', 60)),
  pointJitter: percent.default(dNum('pointJitter', 60)),
  pointShape: z.enum(['circle', 'square']).default(dStr('pointShape', 'circle')),
  pointBg: z.enum(['white', 'black', 'cream', 'charcoal']).default(dStr('pointBg', 'white')),
  crystalCells: z.number().int().min(3).max(128).default(dNum('crystalCells', 24)),
  crystalJitter: percent.default(dNum('crystalJitter', 70)),
  crystalOutline: percent.default(dNum('crystalOutline', 0)),
  crystalSeed: z.number().int().min(0).max(4294967295).default(dNum('crystalSeed', 0))
};

const cellRecipe = z.object({ ...controls,
  renderMode: z.enum(cellModes).optional().default('characters') }).strict();
const warpRecipes = warpModes.map(mode => z.object({ ...controls, renderMode: z.literal(mode),
  distortAmount: z.number().finite().min(distortionAmountLimits[mode][0])
    .max(distortionAmountLimits[mode][1]).default(50) }).strict());
const colorRecipe = z.object({ ...controls, renderMode: z.enum(colorModes) }).strict();
const drosteRecipe = z.object({ ...controls, renderMode: z.literal('droste') }).strict();
const proRecipes = proModes.map(mode =>
  z.object({ ...controls, renderMode: z.literal(mode) }).strict());
export const recipeSchema = z.discriminatedUnion('renderMode',
  [cellRecipe, colorRecipe, drosteRecipe, ...warpRecipes, ...proRecipes]);
export type Recipe = z.infer<typeof recipeSchema>;
export type Mode = Recipe['renderMode'];
export const defaults = recipeSchema.parse({});
export const presets = reference.characterPresets.flatMap(group => group.items);
export const catalog = [
  ...reference.modes.map(mode => ({ id: mode.mode, ...mode })),
  ...reference.glassVariants.map(mode => ({ ...mode, mode: 'liquidglass' }))
].map(mode => ({ ...mode, set: ('set' in mode ? mode.set : {}) as Partial<Recipe>,
  implemented: (implementedModes as readonly string[]).includes(mode.mode),
  parity: 'unverified' as const }));

export function parseRecipe(input: unknown): Recipe {
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) {
    throw new RenderError('INVALID_RECIPE', parsed.error.issues.map(issue =>
      `${issue.path.join('.') || 'recipe'}: ${issue.message}`).join('; '));
  }
  return parsed.data;
}

export const renderRequestSchema = z.object({
  image: z.string().max(48 * 1024 * 1024).describe('PNG, JPEG or WebP base64 data URL'),
  recipe: recipeSchema.default({}),
  scale: z.number().finite().min(0.1).max(4).default(1)
}).strict();
export type RenderRequest = z.infer<typeof renderRequestSchema>;
export type RenderResult = { image: string; width: number; height: number; recipe: Recipe;
  renderMs: number; parity: 'unverified' };
export const limits = { maxInputBytes: 32 * 1024 * 1024, maxPixels: 16_000_000,
  maxDimension: 8192 };

export function capabilities() {
  return { version: '0.1.0', catalog, implementedModes, controls: Object.keys(controls),
    presets, limits, distortionAmountLimits, gpuImageModes, offline: true,
    referenceKeys: reference.recipeKeys.length,
    parity: 'No filters have passed reference comparison yet.' };
}
