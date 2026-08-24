<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import RecordMark from '$lib/components/RecordMark.svelte';
  import { isCurrentUserAdmin } from '$lib/queries/admin';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import { THEME_KEY, applyTheme, themes, type Theme } from '$lib/theme';

  const SHAPES = ['simplex', 'warp', 'dots', 'wave', 'ripple', 'swirl', 'sphere'] as const;
  const DITHERS = ['2x2', '4x4', '8x8', 'random'] as const;

  let isAdmin = false;
  let loading = true;

  /* Defaults mirror RecordMark's own, so the panel opens on what ships. */
  let shape: (typeof SHAPES)[number] = 'simplex';
  let dither: (typeof DITHERS)[number] = '8x8';
  let scale = 0.3;
  let pxSize = 1.5;
  let speed = 2.5;
  let labelPct = 34;
  let holePct = 5;
  let diameter = 190;

  $: snippet = `shape: '${shape}'   scale: ${scale}   pxSize: ${pxSize}
type: '${dither}'   speed: ${speed}
label: ${labelPct}% / hole ${holePct}%
size: ${diameter}px`;

  function pickTheme(next: Theme): void {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Private browsing can refuse writes; the theme still applies. */
    }
  }

  onMount(async () => {
    isAdmin = await isCurrentUserAdmin();
    loading = false;
  });
</script>

<svelte:head><title>musik — mark playground</title></svelte:head>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">admin</span>
    <h1>Mark playground</h1>
    <p class="lede">
      Tune the loading mark against the real component. Nothing here is persisted — copy the
      values into RecordMark.svelte to keep them.
    </p>
  </div>

  {#if !publicSupabaseConfigured}
    <section class="panel">
      <h2>Supabase is not configured</h2>
      <p class="muted">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.</p>
    </section>
  {:else if loading}
    <section class="panel panel-loading"><RecordMark label="Checking access..." /></section>
  {:else if !isAdmin}
    <section class="panel auth-panel">
      <h2>Admin sign-in required</h2>
      <p class="muted">Sign in from the app page with an account listed in admin_users.</p>
      <a href="{base}/app/">go to login</a>
    </section>
  {:else}
    <div class="bench">
      <div class="stage">
        <RecordMark
          {shape}
          {dither}
          {scale}
          {pxSize}
          {speed}
          {labelPct}
          {holePct}
          {diameter}
        />
      </div>

      <div class="panel controls">
        <div class="field">
          <label for="mk-theme">theme</label>
          <div class="themes" id="mk-theme">
            {#each themes as option}
              <button type="button" on:click={() => pickTheme(option.value)}>{option.label}</button>
            {/each}
          </div>
        </div>

        <div class="field">
          <label for="mk-shape">shape</label>
          <select id="mk-shape" bind:value={shape}>
            {#each SHAPES as s}<option value={s}>{s}</option>{/each}
          </select>
        </div>

        <div class="field">
          <label for="mk-dither">dither</label>
          <select id="mk-dither" bind:value={dither}>
            {#each DITHERS as d}<option value={d}>{d}</option>{/each}
          </select>
        </div>

        <div class="field">
          <label for="mk-scale">scale · {scale}</label>
          <input id="mk-scale" type="range" min="0.1" max="2" step="0.05" bind:value={scale} />
        </div>

        <div class="field">
          <label for="mk-px">pxSize · {pxSize}</label>
          <input id="mk-px" type="range" min="0.5" max="5" step="0.5" bind:value={pxSize} />
        </div>

        <div class="field">
          <label for="mk-speed">speed · {speed}</label>
          <input id="mk-speed" type="range" min="0" max="12" step="0.5" bind:value={speed} />
        </div>

        <div class="field">
          <label for="mk-label">label % · {labelPct}</label>
          <input id="mk-label" type="range" min="0" max="60" step="1" bind:value={labelPct} />
        </div>

        <div class="field">
          <label for="mk-hole">hole % · {holePct}</label>
          <input id="mk-hole" type="range" min="0" max="20" step="1" bind:value={holePct} />
        </div>

        <div class="field">
          <label for="mk-size">size · {diameter}px</label>
          <input id="mk-size" type="range" min="48" max="280" step="2" bind:value={diameter} />
        </div>

        <pre class="snippet">{snippet}</pre>
      </div>
    </div>

    <div class="sizes section-gap">
      <div class="section-heading">
        <h2>At the sizes it ships in</h2>
        <span class="muted">sm 72 · md 120 · lg 190</span>
      </div>
      <div class="row">
        <RecordMark {shape} {dither} {scale} {pxSize} {speed} {labelPct} {holePct} size="sm" />
        <RecordMark {shape} {dither} {scale} {pxSize} {speed} {labelPct} {holePct} size="md" />
        <RecordMark {shape} {dither} {scale} {pxSize} {speed} {labelPct} {holePct} size="lg" />
      </div>
    </div>
  {/if}
</section>

<style>
  .bench {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-12);
  }

  .stage {
    display: flex;
    flex: 1 1 320px;
    align-items: center;
    justify-content: center;
    min-height: 300px;
  }

  .controls {
    display: grid;
    flex: 0 1 340px;
    gap: var(--space-3);
  }

  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .themes button {
    min-height: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }

  .field {
    display: grid;
    gap: var(--space-1);
  }

  .field label {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .snippet {
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--line);
    color: var(--muted);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }

  .section-gap {
    margin-top: var(--space-12);
  }

  .section-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    margin-bottom: var(--space-4);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-12);
  }
</style>
