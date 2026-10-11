import { Recipe, RenderError } from '../recipe';
import { FxRecipe, imageFromData, sampleFrame } from './context';
import { renderThermal, renderPosterize, renderEdgeGlow, renderLedMatrix, renderBeacon } from './pixel-fx';
import { renderGradientMap, renderAnaglyph, renderWarhol, renderThinFilm } from './color-fx';
import { renderPixelSort, renderOilPaint, renderCrystallize, renderLowPoly } from './material-fx';
import { renderComic, renderSketch, renderEngraving, renderMezzotint, renderPointillize, renderCrosshatch } from './print-fx';
import { renderFrostedGlass, renderGaussianBlur, renderMotionBlur, renderRadialBlur, renderTiltShift } from './blur-fx';
import { renderSmudge } from './smudge';
import { FxPass } from './gl-fx';
import { renderHexMosaic, renderTruchet, renderChrome, renderWatercolor } from './surface-fx';
import { renderFlowField, renderIsoExtrude } from './geometry-fx';
import { renderGlassOrb } from './orb-fx';
import { renderShatter, renderStainedGlass } from './glass-tiles';
import { renderDither } from './dither-fx';
import { renderVoxels, renderLego } from './voxel-fx';
import { renderStippling } from './stippling-fx';
import { renderWaves } from './waves-fx';
import { renderLattice } from './lattice-fx';

type PixelEffect = (ctx: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
  w: number, h: number, r: FxRecipe, coverage: number) => void;
const pixelEffects: Record<string, PixelEffect> = {
  thermal: renderThermal, posterize: renderPosterize, edgeglow: renderEdgeGlow,
  ledmatrix: renderLedMatrix, beacon: renderBeacon, gradientmap: renderGradientMap,
  anaglyph: renderAnaglyph, warhol: renderWarhol, thinfilm: renderThinFilm,
  pixelsort: renderPixelSort, oilpaint: renderOilPaint, crystallize: renderCrystallize,
  lowpoly: renderLowPoly, comic: renderComic, sketch: renderSketch,
  engraving: renderEngraving, mezzotint: renderMezzotint,
  pointillize: renderPointillize, crosshatch: renderCrosshatch,
  hexmosaic: renderHexMosaic, truchet: renderTruchet, chrome: renderChrome, watercolor: renderWatercolor,
  flowfield: renderFlowField, isoextrude: renderIsoExtrude, glassorb: renderGlassOrb,
  shatter: renderShatter, stainedglass: renderStainedGlass
};
type CanvasEffect = (ctx: CanvasRenderingContext2D, source: CanvasImageSource,
  w: number, h: number, r: FxRecipe, scale: number) => void;
const canvasEffects: Record<string, CanvasEffect> = {
  frostedglass: renderFrostedGlass, gaussianblur: renderGaussianBlur,
  motionblur: renderMotionBlur, radialblur: renderRadialBlur, tiltshift: renderTiltShift
};
const gpuEffects = {
  lofi: FxPass.prototype.drawLofi, starburst: FxPass.prototype.drawStarburst,
  warpbloom: FxPass.prototype.drawWarpbloom, prism: FxPass.prototype.drawPrism,
  marble: FxPass.prototype.drawMarble, lightwind: FxPass.prototype.drawLightwind,
  topography: FxPass.prototype.drawTopography, molten: FxPass.prototype.drawMolten,
  liquidglass: FxPass.prototype.drawLiquidGlass, lens: FxPass.prototype.drawLens, forms: FxPass.prototype.drawForms,
  vitrine: FxPass.prototype.drawVitrine, risograph: FxPass.prototype.drawRisograph, halftone: FxPass.prototype.drawHalftone,
  glitch: FxPass.prototype.drawGlitch, datamosh: FxPass.prototype.drawDatamosh, blueprint: FxPass.prototype.drawBlueprint
};

export class ProFilter {
  private readonly canvas = document.createElement('canvas');
  private gpu: FxPass | null = null;

  draw(source: HTMLImageElement | HTMLCanvasElement, w: number, h: number, r: Recipe, key: string, scale: number) {
    const glEffect = gpuEffects[r.renderMode as keyof typeof gpuEffects];
    if (glEffect) {
      this.gpu ??= new FxPass();
      this.gpu.sourceRevision = key;
      return glEffect.call(this.gpu, source, w, h, r, r.coverage);
    }
    this.canvas.width = w; this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new RenderError('CANVAS_UNAVAILABLE', 'Canvas 2D is unavailable.');
    const fx: FxRecipe = { ...r, source, sourceW: source.width, sourceH: source.height };
    if (r.renderMode === 'smudge') {
      renderSmudge(ctx, source, w, h, fx);
    } else if (r.renderMode === 'dither') {
      renderDither(ctx, source, w, h, fx, scale);
    } else if (r.renderMode === '3d') {
      renderVoxels(ctx, source, w, h, fx, scale);
    } else if (r.renderMode === 'lego') {
      renderLego(ctx, source, w, h, fx, scale);
    } else if (r.renderMode === 'stippling') {
      renderStippling(ctx, source, w, h, fx, scale);
    } else if (r.renderMode === 'waves') {
      renderWaves(ctx, source, w, h, fx, scale);
    } else if (r.renderMode === 'lattice') {
      renderLattice(ctx, source, w, h, fx, scale);
    } else {
      const pixels = sampleFrame(source, w, h, key, r);
      if (!pixels) throw new RenderError('IMAGE_SAMPLE_FAILED', 'Could not sample the input image.');
      const pixelEffect = pixelEffects[r.renderMode];
      const canvasEffect = canvasEffects[r.renderMode];
      if (pixelEffect) pixelEffect(ctx, pixels, w, h, fx, r.coverage / 100);
      else if (canvasEffect) canvasEffect(ctx, imageFromData(pixels, w, h), w, h, fx, scale);
      else throw new RenderError('INVALID_MODE', `${r.renderMode} is not implemented locally yet.`);
    }
    return this.canvas;
  }
}
