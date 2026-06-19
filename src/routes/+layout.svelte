<script lang="ts">
  import { browser } from '$app/environment';
  import '../styles.css';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';

  const links = [
    { href: '/', label: 'overview' },
    { href: '/app/', label: 'login' },
    { href: '/explore/', label: 'explore' },
    { href: '/activity/', label: 'activity' },
    { href: '/about/', label: 'about' }
  ];

  const themeKey = 'spotify-history-theme';
  const themes = [
    { value: 'warm-dark', label: 'dark' },
    { value: 'kanagawa', label: 'kanagawa' },
    { value: 'light', label: 'light' },
    { value: 'black', label: 'black' }
  ] as const;

  type Theme = (typeof themes)[number]['value'];

  let theme: Theme = 'warm-dark';
  let themeMenu: HTMLDetailsElement | null = null;

  onMount(() => {
    let storedTheme: string | null = null;

    try {
      storedTheme = localStorage.getItem(themeKey);
    } catch {
      storedTheme = null;
    }

    const currentTheme = isTheme(storedTheme) ? storedTheme : document.documentElement.dataset.theme;
    theme = isTheme(currentTheme) ? currentTheme : 'warm-dark';
    applyTheme(theme);

    const closeThemeMenu = (event: MouseEvent) => {
      if (themeMenu && event.target instanceof Node && !themeMenu.contains(event.target)) {
        themeMenu.open = false;
      }
    };

    document.addEventListener('click', closeThemeMenu);
    return () => document.removeEventListener('click', closeThemeMenu);
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

  function selectTheme(nextTheme: Theme): void {
    theme = nextTheme;
    applyTheme(theme);
    if (themeMenu) themeMenu.open = false;
  }
</script>

<svelte:head>
  <title>musik</title>
  <meta
    name="description"
    content="A public read-only dashboard for personal Spotify listening history."
  />
</svelte:head>

<div class="app-shell">
  <header class="site-header">
    <a class="brand" href="{base}/" aria-label="musik home">
      <span>musik</span>
    </a>

    <div class="header-controls">
      <nav class="site-nav" aria-label="Primary navigation">
        {#each links as link, index}
          {#if index > 0}
            <span class="nav-separator">/</span>
          {/if}
          <a href="{base}{link.href}" data-sveltekit-preload-data="hover">{link.label}</a>
        {/each}

        <span class="nav-separator">/</span>
        <details bind:this={themeMenu} class="theme-menu">
          <summary>theme</summary>
          <div class="theme-options" role="radiogroup" aria-label="Color theme">
            {#each themes as option}
              <button
                class:active={theme === option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                on:click={() => selectTheme(option.value)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </details>
      </nav>
    </div>
  </header>

  <main>
    <slot />
  </main>
</div>
