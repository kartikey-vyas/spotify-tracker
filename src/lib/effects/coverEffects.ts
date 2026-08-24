/**
 * The image filters from @paper-design/shaders that can be pointed at an album
 * cover, with the parameters worth exposing and defaults that actually render.
 *
 * Two things here are hard-won and easy to get wrong:
 *
 * - Most of these shaders end with `mix(color, image.rgb, frame)`, so the
 *   cover's own colours ARE the output and `colorFront`/`colorBack` only show
 *   outside the image. Push the overlay terms (`highlights`, `shadows`) too far
 *   and `opacity` saturates, the image contribution goes to zero, and the tile
 *   washes out to flat colour. Keep them low and move `distortion` instead.
 * - `halftoneCmyk`'s `u_size` is inverted from what you would guess: ink
 *   coverage falls off as it rises, and anything above ~1.5 renders a blank
 *   card. The useful range is 0.2–1.5.
 */
import {
  DitheringTypes,
  GlassDistortionShapes,
  GlassGridShapes,
  HalftoneCmykTypes,
  HalftoneDotsGrids,
  HalftoneDotsTypes,
  LiquidMetalShapes,
  ShaderFitOptions,
  flutedGlassFragmentShader,
  halftoneCmykFragmentShader,
  halftoneDotsFragmentShader,
  heatmapFragmentShader,
  imageDitheringFragmentShader,
  lensDistortionFragmentShader,
  liquidMetalFragmentShader,
  paperTextureFragmentShader,
  waterFragmentShader
} from '@paper-design/shaders';

export type Rgba = [number, number, number, number];

export interface ThemeColors {
  bg: Rgba;
  accent: Rgba;
  text: Rgba;
  surface2: Rgba;
}

export interface EffectControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Present when the control is a discrete enum rather than a slider. */
  options?: { label: string; value: number }[];
}

export interface CoverEffect {
  label: string;
  /** True when the cover keeps its own colours rather than being re-tinted. */
  keepsColour: boolean;
  shader: string;
  /** Whether the shader samples the shared noise texture. */
  needsNoise: boolean;
  controls: EffectControl[];
  defaults: Record<string, number>;
  build(params: Record<string, number>, colors: ThemeColors): Record<string, unknown>;
}

const slider = (key: string, label: string, min: number, max: number, step: number): EffectControl =>
  ({ key, label, min, max, step });

const choice = (key: string, label: string, e: Record<string, number>): EffectControl => ({
  key,
  label,
  min: 0,
  max: 0,
  step: 1,
  options: Object.entries(e).map(([label, value]) => ({ label, value }))
});

/** Sizing shared by every effect: fill the square tile, no pan or zoom. */
export const COVER_SIZING = {
  u_fit: ShaderFitOptions.cover,
  u_scale: 1,
  u_rotation: 0,
  u_offsetX: 0,
  u_offsetY: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_worldWidth: 0,
  u_worldHeight: 0,
  u_imageAspectRatio: 1
};

export const COVER_EFFECTS: Record<string, CoverEffect> = {
  dithering: {
    label: 'dithering',
    keepsColour: false,
    shader: imageDitheringFragmentShader,
    needsNoise: false,
    controls: [
      slider('pxSize', 'pixel size', 1, 6, 0.5),
      slider('colorSteps', 'colour steps', 1, 7, 1),
      choice('type', 'matrix', DitheringTypes),
      slider('originalColors', 'keep cover colours', 0, 1, 1),
      slider('inverted', 'invert', 0, 1, 1)
    ],
    defaults: { pxSize: 2, colorSteps: 3, type: DitheringTypes['8x8'], originalColors: 0, inverted: 0 },
    build: (p, c) => ({
      u_type: p.type,
      u_pxSize: p.pxSize,
      u_colorSteps: p.colorSteps,
      u_originalColors: p.originalColors > 0.5,
      u_inverted: p.inverted > 0.5,
      u_colorBack: c.bg,
      u_colorFront: c.accent,
      u_colorHighlight: c.text
    })
  },

  flutedGlass: {
    label: 'fluted glass',
    keepsColour: true,
    shader: flutedGlassFragmentShader,
    needsNoise: false,
    controls: [
      slider('size', 'rib size', 2, 40, 1),
      slider('distortion', 'distortion', 0, 1, 0.05),
      slider('shadows', 'shadows', 0, 1, 0.02),
      slider('highlights', 'highlights', 0, 1, 0.02),
      slider('angle', 'angle', 0, 180, 5),
      slider('blur', 'blur', 0, 1, 0.05),
      slider('grain', 'grain', 0, 1, 0.05),
      choice('shape', 'grid', GlassGridShapes),
      choice('dshape', 'lens', GlassDistortionShapes)
    ],
    defaults: {
      size: 8, distortion: 0.5, shadows: 0.18, highlights: 0.12, angle: 0, blur: 0,
      grain: 0, shape: GlassGridShapes.lines, dshape: GlassDistortionShapes.prism
    },
    build: (p, c) => ({
      u_size: p.size,
      u_distortion: p.distortion,
      u_shadows: p.shadows,
      u_highlights: p.highlights,
      u_angle: p.angle,
      u_blur: p.blur,
      u_grainOverlay: p.grain,
      u_shape: p.shape,
      u_distortionShape: p.dshape,
      u_stretch: 0,
      u_shift: 0,
      u_edges: 0,
      u_marginLeft: 0,
      u_marginRight: 0,
      u_marginTop: 0,
      u_marginBottom: 0,
      u_grainMixer: 0,
      u_colorBack: c.bg,
      u_colorShadow: [0, 0, 0, 1] as Rgba,
      u_colorHighlight: [1, 1, 1, 1] as Rgba
    })
  },

  paperTexture: {
    label: 'paper texture',
    keepsColour: true,
    shader: paperTextureFragmentShader,
    needsNoise: true,
    controls: [
      slider('contrast', 'relief', 0, 1, 0.05),
      slider('roughness', 'roughness', 0, 1, 0.05),
      slider('fiber', 'fibre', 0, 1, 0.05),
      slider('fiberSize', 'fibre size', 0.2, 3, 0.1),
      slider('crumples', 'crumples', 0, 1, 0.05),
      slider('crumpleSize', 'crumple size', 0.5, 3, 0.1),
      slider('folds', 'folds', 0, 1, 0.05),
      slider('foldCount', 'fold count', 0, 8, 1),
      slider('drops', 'drops', 0, 1, 0.05)
    ],
    defaults: {
      contrast: 1, roughness: 0.5, fiber: 0.3, fiberSize: 1,
      crumples: 0.5, crumpleSize: 1.5, folds: 0, foldCount: 0, drops: 0
    },
    build: (p, c) => ({
      u_contrast: p.contrast,
      u_roughness: p.roughness,
      u_fiber: p.fiber,
      u_fiberSize: p.fiberSize,
      u_crumples: p.crumples,
      u_crumpleSize: p.crumpleSize,
      u_folds: p.folds,
      u_foldCount: p.foldCount,
      u_drops: p.drops,
      u_seed: 2,
      u_fade: 0,
      u_colorFront: c.bg,
      u_colorBack: c.bg
    })
  },

  water: {
    label: 'water',
    keepsColour: true,
    shader: waterFragmentShader,
    needsNoise: false,
    controls: [
      slider('size', 'scale', 0.5, 10, 0.5),
      slider('waves', 'waves', 0, 1, 0.05),
      slider('caustic', 'caustics', 0, 1, 0.05),
      slider('highlights', 'highlights', 0, 1, 0.05),
      slider('layering', 'layering', 0, 1, 0.05)
    ],
    defaults: { size: 3, waves: 0.4, caustic: 0.5, highlights: 0.3, layering: 0.3 },
    build: (p, c) => ({
      u_size: p.size,
      u_waves: p.waves,
      u_caustic: p.caustic,
      u_highlights: p.highlights,
      u_layering: p.layering,
      u_edges: 0,
      u_colorBack: c.bg,
      u_colorHighlight: [1, 1, 1, 1] as Rgba
    })
  },

  halftoneDots: {
    label: 'halftone dots',
    keepsColour: true,
    shader: halftoneDotsFragmentShader,
    needsNoise: false,
    controls: [
      slider('size', 'dot pitch', 0.5, 8, 0.25),
      slider('radius', 'dot radius', 0, 1, 0.05),
      slider('contrast', 'contrast', 0, 1, 0.05),
      slider('originalColors', 'keep cover colours', 0, 1, 1),
      slider('inverted', 'invert', 0, 1, 1),
      choice('type', 'dot style', HalftoneDotsTypes),
      choice('grid', 'grid', HalftoneDotsGrids)
    ],
    defaults: {
      size: 3, radius: 0.5, contrast: 0.5, originalColors: 1, inverted: 0,
      type: HalftoneDotsTypes.classic, grid: HalftoneDotsGrids.square
    },
    build: (p, c) => ({
      u_size: p.size,
      u_radius: p.radius,
      u_contrast: p.contrast,
      u_originalColors: p.originalColors > 0.5,
      u_inverted: p.inverted > 0.5,
      u_type: p.type,
      u_grid: p.grid,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_grainSize: 1,
      u_colorFront: c.accent,
      u_colorBack: c.bg
    })
  },

  halftoneCmyk: {
    label: 'halftone CMYK',
    keepsColour: true,
    shader: halftoneCmykFragmentShader,
    needsNoise: true,
    controls: [
      /* Inverted: coverage falls off as size rises, blank above ~1.5. */
      slider('size', 'screen (lower = coarser)', 0.2, 1.5, 0.05),
      slider('contrast', 'contrast', 0, 1, 0.05),
      slider('minDot', 'min dot', 0, 0.5, 0.02),
      slider('softness', 'softness', 0, 1, 0.05),
      slider('gridNoise', 'grid noise', 0, 1, 0.05),
      choice('type', 'ink style', HalftoneCmykTypes)
    ],
    defaults: {
      size: 0.5, contrast: 0.5, minDot: 0, softness: 0, gridNoise: 0,
      type: HalftoneCmykTypes.dots
    },
    build: (p) => ({
      u_size: p.size,
      u_contrast: p.contrast,
      u_minDot: p.minDot,
      u_softness: p.softness,
      u_gridNoise: p.gridNoise,
      u_type: p.type,
      u_colorBack: [0.953, 0.925, 0.878, 1] as Rgba,
      u_colorC: [0, 0.682, 0.937, 1] as Rgba,
      u_colorM: [0.925, 0, 0.549, 1] as Rgba,
      u_colorY: [1, 0.949, 0, 1] as Rgba,
      u_colorK: [0.102, 0.102, 0.102, 1] as Rgba,
      u_grainSize: 1,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_floodC: 0, u_floodM: 0, u_floodY: 0, u_floodK: 0,
      u_gainC: 1, u_gainM: 1, u_gainY: 1, u_gainK: 1
    })
  },

  lensDistortion: {
    label: 'lens distortion',
    keepsColour: true,
    shader: lensDistortionFragmentShader,
    needsNoise: false,
    controls: [
      slider('bulge', 'bulge', -1, 1, 0.05),
      slider('spread', 'spread', 0, 1, 0.05),
      slider('dispersion', 'dispersion', 0, 1, 0.05),
      slider('focusEdges', 'edge focus', 0, 1, 0.05),
      slider('swirl', 'swirl', -1, 1, 0.05)
    ],
    defaults: { bulge: 0.25, spread: 0.1, dispersion: 0.15, focusEdges: 0.3, swirl: 0 },
    build: (p) => ({
      u_lensBulge: p.bulge,
      u_spread: p.spread,
      u_dispersion: p.dispersion,
      u_focusEdges: p.focusEdges,
      u_swirl: p.swirl,
      u_bias: 0,
      u_angle: 0,
      u_perspective: 0,
      u_count: 8,
      u_dispersionShift: 0,
      u_dispersionColor: 0.6,
      u_focusCenter: 1,
      u_noise: 0,
      u_noiseFrequency: 1,
      u_noiseOffset: 0,
      u_lensCircle: 0,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_imageX: 0.5,
      u_imageY: 0.5
    })
  },

  liquidMetal: {
    label: 'liquid metal',
    keepsColour: false,
    shader: liquidMetalFragmentShader,
    needsNoise: false,
    controls: [
      slider('softness', 'softness', 0, 1, 0.05),
      slider('repetition', 'repetition', 1, 8, 0.5),
      slider('contour', 'contour', 0, 1, 0.05),
      slider('distortion', 'distortion', 0, 1, 0.05),
      slider('shiftRed', 'shift red', 0, 1, 0.05),
      slider('shiftBlue', 'shift blue', 0, 1, 0.05)
    ],
    defaults: {
      softness: 0.4, repetition: 2, contour: 0.5, distortion: 0.2, shiftRed: 0.1, shiftBlue: 0.1
    },
    build: (p, c) => ({
      u_softness: p.softness,
      u_repetition: p.repetition,
      u_contour: p.contour,
      u_distortion: p.distortion,
      u_shiftRed: p.shiftRed,
      u_shiftBlue: p.shiftBlue,
      u_angle: 0,
      u_shape: LiquidMetalShapes.none,
      u_isImage: true,
      u_colorBack: c.bg,
      u_colorTint: c.accent
    })
  },

  heatmap: {
    label: 'heatmap',
    keepsColour: false,
    shader: heatmapFragmentShader,
    needsNoise: false,
    controls: [
      slider('contour', 'contour', 0, 1, 0.05),
      slider('innerGlow', 'inner glow', 0, 1, 0.05),
      slider('outerGlow', 'outer glow', 0, 1, 0.05),
      slider('noise', 'noise', 0, 1, 0.05),
      slider('angle', 'angle', 0, 180, 5)
    ],
    defaults: { contour: 1, innerGlow: 0, outerGlow: 0, noise: 0, angle: 0 },
    build: (p, c) => ({
      u_contour: p.contour,
      u_innerGlow: p.innerGlow,
      u_outerGlow: p.outerGlow,
      u_noise: p.noise,
      u_angle: p.angle,
      u_colorBack: c.bg,
      u_colors: [c.bg, c.surface2, c.accent, c.text],
      u_colorsCount: 4
    })
  }
};

export const EFFECT_KEYS = Object.keys(COVER_EFFECTS);
