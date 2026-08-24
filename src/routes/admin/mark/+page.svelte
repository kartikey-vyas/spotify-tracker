<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { base } from '$app/paths';
  import {
    DitheringTypes,
    ShaderFitOptions,
    ShaderMount,
    imageDitheringFragmentShader
  } from '@paper-design/shaders';
  import RecordMark from '$lib/components/RecordMark.svelte';
  import { getPresetDateRange } from '$lib/dateRanges';
  import { defaultProfileSlug } from '$lib/profileDefaults';
  import { isCurrentUserAdmin } from '$lib/queries/admin';
  import { fetchAlbumImages } from '$lib/queries/images';
  import { getProfileRankings } from '$lib/queries/rankings';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import { THEME_KEY, applyTheme, themes, type Theme } from '$lib/theme';

  const SHAPES = ['simplex', 'warp', 'dots', 'wave', 'ripple', 'swirl', 'sphere'] as const;
  const DITHERS = ['2x2', '4x4', '8x8', 'random'] as const;
  const COVER_LIMIT = 24;
  const COVER_BAKE_SIZE = 192;

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

  /* Cover-wall preview: independent of the RecordMark knobs above. */
  let coverPxSize = 2;
  let coverColorSteps = 3;
  let coverBaking = false;
  let coverBakedCount = 0;
  let coverBakeTotal = 0;
  let coverError = '';
  let coverShowBaked = true;
  let coverOriginalSrcs: string[] = [];
  let coverBakedSrcs: string[] = [];
  let coverTitles: string[] = [];

  let bakeHost: HTMLDivElement | null = null;
  let bakeMount: ShaderMount | null = null;

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

  function readVar(name: string): [number, number, number, number] {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hex = raw.replace('#', '');
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
      1
    ];
  }

  function waitTwoFrames(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  function loadCoverImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.addEventListener('load', () => resolve(img));
      img.addEventListener('error', () => resolve(null));
      img.src = url;
    });
  }

  function teardownBake(): void {
    bakeMount?.dispose();
    bakeMount = null;
    bakeHost?.remove();
    bakeHost = null;
  }

  async function bakeCovers(nextPxSize: number, nextColorSteps: number): Promise<void> {
    if (coverBaking) return;
    coverBaking = true;
    coverError = '';
    coverBakedCount = 0;
    coverBakeTotal = 0;
    coverBakedSrcs = [];
    teardownBake();

    try {
      const range = getPresetDateRange('last_30_days');
      const rows = await getProfileRankings({
        slug: defaultProfileSlug,
        entityType: 'album',
        start: range.start,
        end: range.end,
        metric: 'plays',
        limit: COVER_LIMIT
      });
      const images = await fetchAlbumImages(rows.map((row) => Number(row.entity_id)));

      const urls: Array<{ title: string; url: string }> = [];
      for (const row of rows) {
        if (urls.length >= COVER_LIMIT) break;
        const art = images.get(Number(row.entity_id));
        if (!art?.image_url) continue;
        urls.push({ title: row.entity_name, url: art.image_url });
      }

      const loaded: Array<{ title: string; img: HTMLImageElement }> = [];
      for (const cover of urls) {
        const img = await loadCoverImage(cover.url);
        if (img) loaded.push({ title: cover.title, img });
      }

      coverOriginalSrcs = loaded.map((item) => item.img.src);
      coverTitles = loaded.map((item) => item.title);
      coverBakeTotal = loaded.length;

      const first = loaded[0];
      if (!first) return;

      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.position = 'fixed';
      host.style.left = '-9999px';
      host.style.width = `${COVER_BAKE_SIZE}px`;
      host.style.height = `${COVER_BAKE_SIZE}px`;
      document.body.appendChild(host);
      bakeHost = host;

      const mount = new ShaderMount(
        host,
        imageDitheringFragmentShader,
        {
          u_fit: ShaderFitOptions.cover,
          u_scale: 1,
          u_rotation: 0,
          u_offsetX: 0,
          u_offsetY: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_worldWidth: 0,
          u_worldHeight: 0,
          u_image: first.img,
          u_imageAspectRatio: 1,
          u_type: DitheringTypes['8x8'],
          u_pxSize: nextPxSize,
          u_colorBack: readVar('--bg'),
          u_colorFront: readVar('--accent'),
          u_colorHighlight: readVar('--text'),
          u_originalColors: false,
          u_inverted: false,
          u_colorSteps: nextColorSteps
        },
        { preserveDrawingBuffer: true },
        0,
        0
      );
      bakeMount = mount;

      /* ResizeObserver sizes the canvas asynchronously; wait before the first read. */
      await waitTwoFrames();

      const baked: string[] = [];
      for (const item of loaded) {
        mount.setUniforms({ u_image: item.img });
        await waitTwoFrames();
        const canvas = host.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('shader canvas missing');
        }
        baked.push(canvas.toDataURL());
        coverBakedCount += 1;
      }
      coverBakedSrcs = baked;
    } catch (caught) {
      coverError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      teardownBake();
      coverBaking = false;
    }
  }

  onDestroy(() => {
    teardownBake();
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

    <div class="cover-preview section-gap">
      <div class="section-heading">
        <h2>Cover wall</h2>
        <span class="muted">
          {#if coverBaking}
            baked {coverBakedCount} / {coverBakeTotal}
          {:else}
            last 30 days · {defaultProfileSlug}
          {/if}
        </span>
      </div>

      <div class="cover-toolbar">
        <button
          type="button"
          disabled={coverBaking}
          on:click={() => bakeCovers(coverPxSize, coverColorSteps)}
        >
          bake covers
        </button>
        {#if coverOriginalSrcs.length > 0}
          <label class="cover-toggle" for="cover-baked">
            <input id="cover-baked" type="checkbox" bind:checked={coverShowBaked} />
            {coverShowBaked ? 'baked' : 'original'}
          </label>
        {/if}
      </div>

      <div class="cover-fields">
        <div class="field">
          <label for="cover-px">pxSize · {coverPxSize}</label>
          <input id="cover-px" type="range" min="1" max="4" step="0.5" bind:value={coverPxSize} />
        </div>
        <div class="field">
          <label for="cover-steps">colorSteps · {coverColorSteps}</label>
          <input
            id="cover-steps"
            type="range"
            min="2"
            max="5"
            step="1"
            bind:value={coverColorSteps}
          />
        </div>
      </div>

      {#if coverError}
        <p class="muted">{coverError}</p>
      {/if}

      {#if coverOriginalSrcs.length > 0}
        <div class="cover-wall">
          {#each coverShowBaked && coverBakedSrcs.length > 0 ? coverBakedSrcs : coverOriginalSrcs as src, index}
            <img src={src} alt={coverTitles[index] ?? ''} width="96" height="96" />
          {/each}
        </div>
      {/if}
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

  .cover-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .cover-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .cover-fields {
    display: grid;
    gap: var(--space-3);
    max-width: 340px;
    margin-bottom: var(--space-4);
  }

  .cover-wall {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .cover-wall img {
    width: 96px;
    height: 96px;
    object-fit: cover;
  }
</style>
