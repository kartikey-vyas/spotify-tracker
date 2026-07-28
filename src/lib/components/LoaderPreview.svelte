<script lang="ts">
  import SpotifyLoader from '$lib/components/SpotifyLoader.svelte';
  import { applyTheme, themes } from '$lib/theme';

  const sizes = ['sm', 'md', 'lg'] as const;
  const anims = ['ripple', 'radar', 'pulse'] as const;
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Dev</span>
    <h1>SpotifyLoader</h1>
    <p class="lede">
      Braille Spotify-mark loading animation. Sound-wave arcs ripple outward, inheriting the theme
      accent. Dev-only preview for iterating on the art.
    </p>
  </div>

  <div class="themebar">
    <span class="muted">theme:</span>
    {#each themes as t (t.value)}
      <button type="button" onclick={() => applyTheme(t.value)}>{t.label}</button>
    {/each}
  </div>

  <section class="panel">
    <h2>Animations <span class="muted">(lg)</span></h2>
    <div class="row">
      {#each anims as anim (anim)}
        <div class="cell">
          <SpotifyLoader size="lg" {anim} />
          <code class="muted">anim="{anim}"</code>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>Sizes</h2>
    <div class="row">
      {#each sizes as size (size)}
        <div class="cell">
          <SpotifyLoader {size} />
          <code class="muted">size="{size}"</code>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>With label</h2>
    <div class="row">
      {#each sizes as size (size)}
        <div class="cell">
          <SpotifyLoader {size} label="loading…" />
          <code class="muted">size="{size}"</code>
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <h2>On surfaces (as it will sit inside cards)</h2>
    <div class="row">
      <div class="cell surface-bg"><SpotifyLoader size="md" label="refreshing…" /><code class="muted">--bg</code></div>
      <div class="cell surface-surface"><SpotifyLoader size="md" label="refreshing…" /><code class="muted">--surface</code></div>
      <div class="cell surface-surface2"><SpotifyLoader size="md" label="refreshing…" /><code class="muted">--surface-2</code></div>
    </div>
  </section>
</section>

<style>
  .themebar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 1rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: flex-end;
  }

  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    padding: 1.5rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    min-width: 9rem;
  }

  .cell code {
    font-size: 0.75rem;
  }

  .surface-bg {
    background: var(--bg);
  }
  .surface-surface {
    background: var(--surface);
  }
  .surface-surface2 {
    background: var(--surface-2);
  }
</style>
