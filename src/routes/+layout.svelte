<script lang="ts">
  import '../styles.css';
  import { base } from '$app/paths';

  const links = [
    { href: '/', label: 'overview' },
    { href: '/explore/', label: 'explore' },
    { href: '/activity/', label: 'activity' },
    { href: '/artists/', label: 'artists' },
    { href: '/genres/', label: 'genres' },
    { href: '/tracks/', label: 'tracks' },
    { href: '/about/', label: 'about' }
  ];
</script>

<svelte:head>
  <title>Spotify History Explorer</title>
  <meta
    name="description"
    content="A public read-only dashboard for personal Spotify listening history."
  />
</svelte:head>

<div class="app-shell">
  <header class="site-header">
    <a class="brand" href="{base}/" aria-label="Spotify History Explorer home">
      <span>spotify-history</span>
    </a>

    <nav class="site-nav" aria-label="Primary navigation">
      {#each links as link, index}
        {#if index > 0}
          <span class="nav-separator">/</span>
        {/if}
        <a href="{base}{link.href}" data-sveltekit-preload-data="hover">{link.label}</a>
      {/each}
    </nav>
  </header>

  <main>
    <slot />
  </main>
</div>
