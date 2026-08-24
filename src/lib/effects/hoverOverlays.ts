/**
 * Animated overlays for the hover state of a cover tile.
 *
 * These are the shaders that carry a `u_time` term but take no `u_image`, so
 * they can run *on top of* a finished cover instead of replacing it. Three
 * facts make the overlay work, and all three are easy to get wrong:
 *
 * - Every one of these ends with `fragColor = vec4(color, opacity)`, a real
 *   alpha channel, and ShaderMount creates its canvas with the default context
 *   attributes (`alpha: true`). So an overlay canvas stacked over the cover
 *   composites against it rather than hiding it — provided `u_colorBack` is
 *   given alpha 0. Give colorBack any opaque value and the cover disappears.
 * - Colours arrive as `u_colors`, a `vec4[]`, paired with `u_colorsCount`.
 *   `setUniforms` flattens a `number[][]` into that array for us, but every
 *   child array has to be the same length or it warns and skips the uniform.
 * - Only ONE of these ever runs. A tile is hovered or it is not, so the
 *   playground keeps a single mount and moves it, rather than one per tile.
 *   Eight covers plus four RecordMarks already sit at 12 of the 16 WebGL
 *   contexts a browser allows; one shared overlay makes 13, eight would not fit.
 */
import {
  DitheringShapes,
  DitheringTypes,
  ShaderFitOptions,
  ditheringFragmentShader,
  godRaysFragmentShader,
  smokeRingFragmentShader,
  swirlFragmentShader
} from '@paper-design/shaders';
import type { Rgba, ThemeColors } from './coverEffects';

export interface OverlayControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface HoverOverlay {
  label: string;
  shader: string;
  needsNoise: boolean;
  controls: OverlayControl[];
  defaults: Record<string, number>;
  build(params: Record<string, number>, colors: ThemeColors): Record<string, unknown>;
}

/** Sizing for a shader with no image: fill the tile, no pan or zoom. */
export const OVERLAY_SIZING = {
  u_fit: ShaderFitOptions.cover,
  u_scale: 1,
  u_rotation: 0,
  u_offsetX: 0,
  u_offsetY: 0,
  u_originX: 0.5,
  u_originY: 0.5,
  u_worldWidth: 0,
  u_worldHeight: 0
};

/** Alpha 0 everywhere, so the cover shows through wherever the shader is dark. */
const CLEAR: Rgba = [0, 0, 0, 0];

const fade = (color: Rgba, alpha: number): Rgba => [color[0], color[1], color[2], alpha];

const slider = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number
): OverlayControl => ({ key, label, min, max, step });

/** Shared by every overlay: how strong, and how fast. */
const COMMON: OverlayControl[] = [
  slider('opacity', 'opacity', 0, 1, 0.01),
  slider('speed', 'speed', 0.1, 3, 0.1)
];

export const HOVER_OVERLAYS: Record<string, HoverOverlay> = {
  ditherWave: {
    label: 'dither wave',
    shader: ditheringFragmentShader,
    needsNoise: false,
    controls: [
      ...COMMON,
      slider('scale', 'scale', 0.1, 2, 0.05),
      slider('pxSize', 'pixel size', 1, 6, 0.25)
    ],
    /* The record mark's own shader, shape `wave`: a travelling sine whose
       dithered falloff reads as a music wave rolling across the cover. This
       is the overlay the cover wall ships. */
    defaults: { opacity: 0.9, speed: 3, scale: 0.5, pxSize: 1.75 },
    build: (p, c) => ({
      u_colorBack: CLEAR,
      u_colorFront: fade(c.accent, p.opacity),
      u_shape: DitheringShapes.wave,
      u_type: DitheringTypes['8x8'],
      u_pxSize: p.pxSize,
      /* Overrides OVERLAY_SIZING's u_scale: spread this AFTER the sizing. */
      u_scale: p.scale
    })
  },

  godRays: {
    label: 'god rays',
    shader: godRaysFragmentShader,
    needsNoise: true,
    controls: [
      ...COMMON,
      slider('density', 'density', 0, 1, 0.01),
      slider('spotty', 'spotty', 0, 1, 0.01),
      slider('intensity', 'intensity', 0, 1, 0.01),
      slider('bloom', 'bloom', 0, 1, 0.01),
      slider('midSize', 'core size', 0, 1, 0.01),
      slider('midIntensity', 'core glow', 0, 1, 0.01)
    ],
    defaults: {
      opacity: 0.35,
      speed: 0.6,
      density: 0.3,
      spotty: 0.3,
      intensity: 0.5,
      bloom: 0.3,
      midSize: 0,
      midIntensity: 0
    },
    build: (p, c) => ({
      u_colorBack: CLEAR,
      u_colorBloom: fade(c.text, p.opacity),
      u_colors: [fade(c.text, p.opacity)],
      u_colorsCount: 1,
      u_density: p.density,
      u_spotty: p.spotty,
      u_midSize: p.midSize,
      u_midIntensity: p.midIntensity,
      u_intensity: p.intensity,
      u_bloom: p.bloom
    })
  },

  swirl: {
    label: 'swirl',
    shader: swirlFragmentShader,
    needsNoise: false,
    controls: [
      ...COMMON,
      slider('bandCount', 'bands', 1, 12, 1),
      slider('twist', 'twist', 0, 1, 0.01),
      slider('center', 'centre', 0, 1, 0.01),
      slider('proportion', 'proportion', 0, 1, 0.01),
      slider('softness', 'softness', 0, 1, 0.01),
      slider('noise', 'noise', 0, 1, 0.01)
    ],
    defaults: {
      opacity: 0.22,
      speed: 0.4,
      bandCount: 3,
      twist: 0.3,
      center: 0.5,
      proportion: 0.5,
      softness: 1,
      noise: 0.2
    },
    build: (p, c) => ({
      u_colorBack: CLEAR,
      u_colors: [fade(c.accent, p.opacity), CLEAR],
      u_colorsCount: 2,
      u_bandCount: p.bandCount,
      u_twist: p.twist,
      u_center: p.center,
      u_proportion: p.proportion,
      u_softness: p.softness,
      u_noise: p.noise,
      u_noiseFrequency: 1
    })
  },

  smokeRing: {
    label: 'smoke ring',
    shader: smokeRingFragmentShader,
    needsNoise: true,
    controls: [
      ...COMMON,
      slider('thickness', 'thickness', 0, 1, 0.01),
      slider('radius', 'radius', 0, 1, 0.01),
      slider('innerShape', 'inner shape', 0, 3, 0.05),
      slider('noiseScale', 'noise scale', 0.1, 3, 0.05)
    ],
    defaults: {
      opacity: 0.3,
      speed: 0.5,
      thickness: 0.4,
      radius: 0.5,
      innerShape: 1,
      noiseScale: 1.4
    },
    build: (p, c) => ({
      u_colorBack: CLEAR,
      u_colors: [fade(c.text, p.opacity)],
      u_colorsCount: 1,
      u_thickness: p.thickness,
      u_radius: p.radius,
      u_innerShape: p.innerShape,
      u_noiseScale: p.noiseScale,
      u_noiseIterations: 6
    })
  }
};

export const OVERLAY_KEYS = Object.keys(HOVER_OVERLAYS);
