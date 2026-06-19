<script lang="ts">
  import '../styles.css';
  import { base } from '$app/paths';

  const links = [
    { href: '/', label: 'Overview' },
    { href: '/explore/', label: 'Explore' },
    { href: '/activity/', label: 'Activity' },
    { href: '/artists/', label: 'Artists' },
    { href: '/genres/', label: 'Genres' },
    { href: '/tracks/', label: 'Tracks' },
    { href: '/about/', label: 'About' }
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
      <span class="brand-mark"></span>
      <span>Spotify History Explorer</span>
    </a>

    <nav class="site-nav" aria-label="Primary navigation">
      {#each links as link}
        <a href="{base}{link.href}" data-sveltekit-preload-data="hover">{link.label}</a>
      {/each}
    </nav>
  </header>

  <main>
    <slot />
  </main>
</div>
