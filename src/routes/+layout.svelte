<script lang="ts">
  import { browser } from '$app/environment';
  import '../styles.css';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';

  const links = [
    { href: '/', label: 'overview' },
    { href: '/app/', label: 'app' },
    { href: '/explore/', label: 'explore' },
    { href: '/activity/', label: 'activity' },
    { href: '/about/', label: 'about' }
  ];

  const themeKey = 'spotify-history-theme';
  const themes = [
    { value: 'light', label: 'light' },
    { value: 'black', label: 'black' },
    { value: 'warm-dark', label: 'warm dark' }
  ] as const;

  type Theme = (typeof themes)[number]['value'];

  let theme: Theme = 'light';

  onMount(() => {
    const currentTheme = document.documentElement.dataset.theme;
    theme = isTheme(currentTheme) ? currentTheme : 'light';
    applyTheme(theme);
  });

  function isTheme(value: string | undefined | null): value is Theme {
    return themes.some((option) => option.value === value);
  }

  function applyTheme(nextTheme: Theme): void {
    if (!browser) return;

    if (nextTheme === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.dataset.theme = nextTheme;
    }

    try {
      localStorage.setItem(themeKey, nextTheme);
    } catch {
      // Keep the applied theme even when storage is unavailable.
    }
  }
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

    <div class="header-controls">
      <nav class="site-nav" aria-label="Primary navigation">
        {#each links as link, index}
          {#if index > 0}
            <span class="nav-separator">/</span>
          {/if}
          <a href="{base}{link.href}" data-sveltekit-preload-data="hover">{link.label}</a>
        {/each}
      </nav>

      <label class="theme-control">
        <span>theme</span>
        <select bind:value={theme} on:change={() => applyTheme(theme)} aria-label="Color theme">
          {#each themes as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
    </div>
  </header>

  <main>
    <slot />
  </main>
</div>
