<script lang="ts">
  import type { DitheringShapes, DitheringTypes } from '@paper-design/shaders';
  import DitherField, { DITHER_FIELD_DEFAULTS } from './DitherField.svelte';

  /**
   * An animated dither field behind whatever is slotted in — the record
   * mark's own shader, so the frame and the loading mark are one voice.
   * Slotted `.panel`s get the page ground automatically (see below); any
   * other content that should mask the field needs its own opaque background.
   */
  export let shape: keyof typeof DitheringShapes = DITHER_FIELD_DEFAULTS.shape;
  export let dither: keyof typeof DitheringTypes = DITHER_FIELD_DEFAULTS.dither;
  export let scale: number = DITHER_FIELD_DEFAULTS.scale;
  export let pxSize: number = DITHER_FIELD_DEFAULTS.pxSize;
  export let speed: number = DITHER_FIELD_DEFAULTS.speed;
</script>

<div class="frame">
  <DitherField {shape} {dither} {scale} {pxSize} {speed} />
  <div class="frame-content"><slot /></div>
</div>

<style>
  .frame {
    position: relative;
  }

  /* The padding is the frame: it is how much field shows around the content. */
  .frame-content {
    position: relative;
    padding: var(--space-6);
  }

  /* Panels are transparent by default; floating on the field they need the
     page ground behind their text. Owned here so every consumer gets it
     instead of rediscovering the rule. */
  .frame-content :global(.panel) {
    background: var(--bg);
  }
</style>
