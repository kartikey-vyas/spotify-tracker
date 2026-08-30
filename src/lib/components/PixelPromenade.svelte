<script lang="ts">
  export let station: string;
  export let marker: 'left' | 'centre' | 'right' = 'right';
</script>

<!--
  A deliberately empty strip of page for the pixel person. The component's
  bottom edge is the walking plane; the little brackets sit below it so the
  full height above the rule remains clear of copy and controls.
-->
<div
  class="pixel-promenade"
  class:marker-left={marker === 'left'}
  class:marker-centre={marker === 'centre'}
  data-pixel-promenade="rail"
  data-pixel-station={station}
  aria-hidden="true"
>
  <span class="station-mark"></span>
  <span class="rail-bracket bracket-left"></span>
  <span class="rail-bracket bracket-right"></span>
</div>

<style>
  .pixel-promenade {
    position: relative;
    height: 76px;
    border-bottom: 1px solid var(--line);
  }

  /* A short accent in the rail reads as a stopping point without putting a
     sign, prop, or label in the character's walking space. */
  .station-mark {
    position: absolute;
    right: clamp(var(--space-6), 9vw, 104px);
    bottom: -1px;
    width: clamp(48px, 8vw, 84px);
    height: 3px;
    background: var(--accent);
  }

  .marker-left .station-mark {
    right: auto;
    left: clamp(var(--space-6), 9vw, 104px);
  }

  .marker-centre .station-mark {
    right: auto;
    left: 50%;
    transform: translateX(-50%);
  }

  /* Shelf brackets live outside the rail's DOM rect. They make the rule feel
     like page furniture while keeping its bottom edge unambiguous to geometry. */
  .rail-bracket {
    position: absolute;
    top: 100%;
    width: var(--space-3);
    height: var(--space-2);
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .bracket-left {
    left: clamp(var(--space-4), 5vw, 64px);
  }

  .bracket-right {
    right: clamp(var(--space-4), 5vw, 64px);
    transform: scaleX(-1);
  }

  @media (max-width: 800px) {
    .pixel-promenade {
      height: 68px;
    }
  }
</style>
