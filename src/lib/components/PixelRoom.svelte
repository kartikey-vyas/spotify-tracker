<script lang="ts">
  import { onMount } from 'svelte';
  import { shouldRunPixelRoom } from '$lib/pixel-person/availability';
  import { pixelPersonController, pixelRoomCount } from '$lib/pixel-person/controller';
  import { roomSession } from '$lib/pixel-person/residents';
  import type { ShelfSide } from '$lib/pixel-person/room';

  /** Names this room, for debugging and styling hooks. */
  export let station: string;
  /** Where the record shelf stands; the lounge goes beside it and the door is always on the right. */
  export let shelf: ShelfSide = 'right';

  let host: HTMLDivElement;
  let stage: (typeof import('./PixelRoomStage.svelte'))['default'] | null = null;
  let loading: Promise<void> | null = null;

  // The simulation, sprites and renderer are a sizeable module graph; they are
  // only fetched once this room can actually have someone in it.
  function loadStage(): void {
    loading ??= import('./PixelRoomStage.svelte').then((module) => {
      stage = module.default;
    });
  }

  onMount(() => {
    pixelRoomCount.update((count) => count + 1);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let summoned = roomSession.manualPopulation > 0;

    const refresh = () => {
      if (shouldRunPixelRoom(window.innerWidth, reducedMotion.matches, summoned)) {
        loadStage();
      } else if (reducedMotion.matches) {
        stage = null;
        loading = null;
      }
    };
    // A summon is as explicit as it gets: it wakes a room the viewport gate
    // had left empty. The stage drains the command once it has loaded.
    const offCommand = pixelPersonController.onCommand(() => {
      summoned = true;
      refresh();
    });

    refresh();
    window.addEventListener('resize', refresh);
    reducedMotion.addEventListener('change', refresh);
    return () => {
      offCommand();
      window.removeEventListener('resize', refresh);
      reducedMotion.removeEventListener('change', refresh);
      pixelRoomCount.update((count) => count - 1);
    };
  });
</script>

<!--
  The pixel people's room: a band of page they live in and never leave. Its
  bottom rule is the floor. Everything inside — people, the record shelf, the
  door — is drawn on the stage's canvas, so the band itself stays empty markup.
-->
<div class="pixel-room" bind:this={host} data-pixel-room={station} aria-hidden="true">
  {#if stage && host}
    <svelte:component this={stage} {host} shelfSide={shelf} />
  {/if}
  <span class="room-bracket bracket-left"></span>
  <span class="room-bracket bracket-right"></span>
</div>

<style>
  .pixel-room {
    position: relative;
    height: 84px;
    border-bottom: 1px solid var(--line);
  }

  /* Brackets live below the floor rule. They make the rule read as a plank
     the room stands on, and keep the room's own box clear. */
  .room-bracket {
    position: absolute;
    top: 100%;
    width: var(--space-3);
    height: var(--space-2);
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    pointer-events: none;
  }

  .bracket-left {
    left: clamp(var(--space-4), 5vw, 64px);
  }

  .bracket-right {
    right: clamp(var(--space-4), 5vw, 64px);
    transform: scaleX(-1);
  }

  @media (max-width: 800px) {
    .pixel-room {
      height: 72px;
    }
  }
</style>
