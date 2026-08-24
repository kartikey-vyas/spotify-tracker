<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { base } from '$app/paths';
  import {
    ShaderMount,
    getShaderNoiseTexture,
    type ShaderMountUniforms
  } from '@paper-design/shaders';
  import RecordMark from '$lib/components/RecordMark.svelte';
  import {
    COVER_EFFECTS,
    COVER_SIZING,
    EFFECT_KEYS,
    type CoverEffect,
    type ThemeColors
  } from '$lib/effects/coverEffects';
  import { getPresetDateRange } from '$lib/dateRanges';
  import { defaultProfileSlug } from '$lib/profileDefaults';
  import { isCurrentUserAdmin } from '$lib/queries/admin';
  import { fetchAlbumImages } from '$lib/queries/images';
  import { getProfileRankings } from '$lib/queries/rankings';
  import { publicSupabaseConfigured } from '$lib/supabase';
  import { THEME_KEY, applyTheme, themes, type Theme } from '$lib/theme';

  const SHAPES = ['simplex', 'warp', 'dots', 'wave', 'ripple', 'swirl', 'sphere'] as const;
  const DITHERS = ['2x2', '4x4', '8x8', 'random'] as const;
  const COVER_PREVIEW = 8;
  const COVER_FETCH = 16;
  const NOISE_TIMEOUT_MS = 1500;

  let isAdmin = false;
  let loading = true;
  let pageDestroyed = false;

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

  const initialEffectKey = EFFECT_KEYS[0] ?? 'dithering';
  let effectKey = initialEffectKey;
  let effectParams: Record<string, number> = { ...COVER_EFFECTS[initialEffectKey].defaults };
  let coverShowOriginals = false;
  let coverLoading = false;
  let coverError = '';
  let coverImages: HTMLImageElement[] = [];
  let coverTitles: string[] = [];
  let coverHosts: Array<HTMLDivElement | undefined> = [];
  let coverMounts: ShaderMount[] = [];
  let noiseTexture: HTMLImageElement | undefined;

  $: coverSnippet = formatCoverSnippet(effectKey, effectParams);
  $: selectedEffect = COVER_EFFECTS[effectKey] ?? COVER_EFFECTS[initialEffectKey];

  function pickTheme(next: Theme): void {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Private browsing can refuse writes; the theme still applies. */
    }
    applyCoverUniforms(effectKey, effectParams);
  }

  onMount(async () => {
    isAdmin = await isCurrentUserAdmin();
    loading = false;
    if (isAdmin && publicSupabaseConfigured) {
      await loadCovers();
    }
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

  function themeColors(): ThemeColors {
    return {
      bg: readVar('--bg'),
      accent: readVar('--accent'),
      text: readVar('--text'),
      surface2: readVar('--surface-2')
    };
  }

  function formatCoverSnippet(key: string, params: Record<string, number>): string {
    const lines = Object.entries(params).map(([name, value]) => `${name}: ${value}`);
    return `effect: '${key}'\n${lines.join('\n')}`;
  }

  function controlValueLabel(effect: CoverEffect, key: string, value: number): string {
    const control = effect.controls.find((item) => item.key === key);
    const option = control?.options?.find((item) => item.value === value);
    return option?.label ?? String(value);
  }

  function bindCoverHost(node: HTMLDivElement, index: number) {
    coverHosts[index] = node;
    return {
      destroy() {
        if (coverHosts[index] === node) coverHosts[index] = undefined;
      }
    };
  }

  function awaitImage(img: HTMLImageElement, timeoutMs: number): Promise<void> {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, timeoutMs);
    });
  }

  async function loadNoiseTexture(): Promise<HTMLImageElement | undefined> {
    const noise = getShaderNoiseTexture();
    if (!noise) return undefined;
    await awaitImage(noise, NOISE_TIMEOUT_MS);
    return noise;
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

  function disposeCoverMounts(): void {
    /* Capture the canvases BEFORE disposing — dispose() detaches them from the
       host, so querying afterwards finds nothing.

       Chromium frees a WebGL context lazily, so re-mounting overlaps the
       outgoing and incoming contexts. With 4 RecordMarks already on this page
       that pushes past the 16 contexts browsers allow, and the oldest canvases
       get killed — which is the RecordMarks. Forcing the loss releases them
       immediately instead. */
    const canvases = coverHosts
      .map((host) => host?.querySelector('canvas'))
      .filter((c): c is HTMLCanvasElement => Boolean(c));

    for (const mount of coverMounts) {
      mount.dispose();
    }
    for (const canvas of canvases) {
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    coverMounts = [];
  }

  function builtUniforms(effect: CoverEffect, params: Record<string, number>): ShaderMountUniforms {
    return effect.build(params, themeColors()) as ShaderMountUniforms;
  }

  function remountCovers(key: string, params: Record<string, number>): void {
    disposeCoverMounts();
    if (pageDestroyed) return;

    const effect = COVER_EFFECTS[key];
    if (!effect) return;

    const built = builtUniforms(effect, params);
    const count = Math.min(COVER_PREVIEW, coverImages.length);

    for (let i = 0; i < count; i++) {
      if (coverMounts.length >= COVER_PREVIEW) break;
      const host = coverHosts[i];
      const img = coverImages[i];
      if (!host || !img) continue;
      try {
        coverMounts.push(
          new ShaderMount(
            host,
            effect.shader,
            {
              ...COVER_SIZING,
              u_image: img,
              ...(effect.needsNoise && noiseTexture ? { u_noiseTexture: noiseTexture } : {}),
              ...built
            },
            undefined,
            0,
            0
          )
        );
      } catch (caught) {
        coverError = caught instanceof Error ? caught.message : String(caught);
        disposeCoverMounts();
        return;
      }
    }
  }

  function applyCoverUniforms(key: string, params: Record<string, number>): void {
    if (coverMounts.length === 0) return;
    const effect = COVER_EFFECTS[key];
    if (!effect) return;
    const uniforms = builtUniforms(effect, params);
    for (const mount of coverMounts) {
      mount.setUniforms(uniforms);
    }
  }

  function selectEffect(key: string): void {
    const params = { ...COVER_EFFECTS[key].defaults };
    effectKey = key;
    effectParams = params;
    remountCovers(key, params);
  }

  function setParam(key: string, value: number): void {
    const params = { ...effectParams, [key]: value };
    effectParams = params;
    applyCoverUniforms(effectKey, params);
  }

  function resetEffect(key: string): void {
    const params = { ...COVER_EFFECTS[key].defaults };
    effectParams = params;
    applyCoverUniforms(key, params);
  }

  async function loadCovers(): Promise<void> {
    if (coverLoading) return;
    coverLoading = true;
    coverError = '';
    disposeCoverMounts();

    try {
      const noisePromise = loadNoiseTexture();
      const range = getPresetDateRange('last_30_days');
      const rows = await getProfileRankings({
        slug: defaultProfileSlug,
        entityType: 'album',
        start: range.start,
        end: range.end,
        metric: 'plays',
        limit: COVER_FETCH
      });
      const images = await fetchAlbumImages(rows.map((row) => Number(row.entity_id)));

      const urls: Array<{ title: string; url: string }> = [];
      for (const row of rows) {
        if (urls.length >= COVER_PREVIEW) break;
        const art = images.get(Number(row.entity_id));
        if (!art?.image_url) continue;
        urls.push({ title: row.entity_name, url: art.image_url });
      }

      const loaded: Array<{ title: string; img: HTMLImageElement }> = [];
      for (const cover of urls) {
        if (loaded.length >= COVER_PREVIEW) break;
        const img = await loadCoverImage(cover.url);
        if (img) loaded.push({ title: cover.title, img });
      }

      if (pageDestroyed) return;

      noiseTexture = await noisePromise;
      coverImages = loaded.map((item) => item.img);
      coverTitles = loaded.map((item) => item.title);
      await tick();
      if (pageDestroyed) return;
      remountCovers(effectKey, effectParams);
    } catch (caught) {
      coverError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      coverLoading = false;
    }
  }

  onDestroy(() => {
    pageDestroyed = true;
    disposeCoverMounts();
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
        <h2>Effects playground</h2>
        <span class="muted">
          {#if coverLoading}
            loading covers…
          {:else}
            last 30 days · {defaultProfileSlug} · {coverImages.length}/{COVER_PREVIEW}
          {/if}
        </span>
      </div>

      <div class="cover-bench">
        {#if coverImages.length > 0}
          <div class="cover-wall">
            {#each coverImages as img, index}
              <div class="cover-cell">
                <img
                  class="cover-layer"
                  class:is-hidden={!coverShowOriginals}
                  src={img.src}
                  alt={coverTitles[index] ?? ''}
                  width="300"
                  height="300"
                />
                <div
                  class="cover-layer cover-shader"
                  class:is-hidden={coverShowOriginals}
                  use:bindCoverHost={index}
                ></div>
              </div>
            {/each}
          </div>
        {:else if !coverLoading}
          <p class="muted">No album covers in this range.</p>
        {/if}

        <div class="cover-controls">
          <div class="cover-toolbar">
            <div class="effect-pick">
              <label for="fx-key">effect</label>
              <select
                id="fx-key"
                value={effectKey}
                on:change={(e) => selectEffect(e.currentTarget.value)}
              >
                {#each EFFECT_KEYS as key}
                  <option value={key}>{COVER_EFFECTS[key].label}</option>
                {/each}
              </select>
              <span class="muted">
                {selectedEffect.keepsColour ? 'keeps cover colours' : 're-tints the cover'}
              </span>
            </div>
            <button type="button" on:click={() => resetEffect(effectKey)}>reset</button>
            {#if coverImages.length > 0}
              <label class="cover-toggle" for="cover-originals">
                <input id="cover-originals" type="checkbox" bind:checked={coverShowOriginals} />
                {coverShowOriginals ? 'originals' : 'effect'}
              </label>
            {/if}
          </div>

          <div class="cover-fields">
            {#each selectedEffect.controls as control (control.key)}
              <div class="field">
                <label for="fx-{control.key}">
                  {control.label} · {controlValueLabel(
                    selectedEffect,
                    control.key,
                    effectParams[control.key] ?? 0
                  )}
                </label>
                {#if control.options}
                  <select
                    id="fx-{control.key}"
                    value={effectParams[control.key]}
                    on:change={(e) => setParam(control.key, Number(e.currentTarget.value))}
                  >
                    {#each control.options as option}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                {:else}
                  <input
                    id="fx-{control.key}"
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={effectParams[control.key] ?? 0}
                    on:input={(e) => setParam(control.key, Number(e.currentTarget.value))}
                  />
                {/if}
              </div>
            {/each}
          </div>

          <pre class="snippet">{coverSnippet}</pre>

          {#if coverError}
            <p class="muted">{coverError}</p>
          {/if}
        </div>
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

  .cover-bench {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-12);
  }

  .cover-controls {
    display: flex;
    flex: 0 1 300px;
    flex-direction: column;
    gap: var(--space-4);
  }

  .cover-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .effect-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .effect-pick label {
    color: var(--muted);
    font-size: var(--text-sm);
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
  }

  .cover-wall {
    /* Four across, so eight covers make two rows beside the controls.
       minmax(0, 1fr) rather than a bare 1fr: 1fr floors at the track's
       min-content width, and a canvas that has not been sized yet reports its
       300px default, which shoves the controls off the row. */
    display: grid;
    flex: 1 1 420px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .cover-cell {
    position: relative;
    aspect-ratio: 1;
  }

  .cover-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-shader :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .cover-layer.is-hidden {
    visibility: hidden;
    pointer-events: none;
  }
</style>
