<script lang="ts">
  import { dev } from '$app/environment';
  import '../styles.css';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { isCurrentUserAdmin } from '$lib/queries/admin';
  import { supabase } from '$lib/supabase';
  import { THEME_KEY, applyTheme, isTheme, themes, type Theme } from '$lib/theme';

  const links = [
    { href: '/', label: 'overview' },
    { href: '/app/', label: 'login' },
    { href: '/explore/', label: 'explore' },
    { href: '/activity/', label: 'activity' },
    { href: '/about/', label: 'about' }
  ];

  let theme: Theme = 'warm-dark';
  let themeMenu: HTMLDetailsElement | null = null;
  let showAdmin = dev;

  onMount(() => {
    let storedTheme: string | null = null;

    try {
      storedTheme = localStorage.getItem(THEME_KEY);
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

    void refreshAdminAccess();
    const {
      data: { subscription }
    } = supabase?.auth.onAuthStateChange(() => {
      void refreshAdminAccess();
    }) ?? { data: { subscription: null } };

    return () => {
      document.removeEventListener('click', closeThemeMenu);
      subscription?.unsubscribe();
    };
  });

  function positionThemeMenu(): void {
    if (!themeMenu?.open) return;
    const options = themeMenu.querySelector<HTMLElement>('.theme-options');
    if (!options) return;
    options.style.setProperty('--theme-menu-shift', '0px');
    const margin = 8;
    const overflow = margin - options.getBoundingClientRect().left;
    if (overflow > 0) options.style.setProperty('--theme-menu-shift', `${overflow}px`);
  }

  function selectTheme(nextTheme: Theme): void {
    theme = nextTheme;
    applyTheme(theme);
    if (themeMenu) themeMenu.open = false;
  }

  async function refreshAdminAccess(): Promise<void> {
    showAdmin = dev || (await isCurrentUserAdmin());
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

        {#if showAdmin}
          <span class="nav-separator">/</span>
          <a href="{base}/admin/" data-sveltekit-preload-data="hover">admin</a>
        {/if}

        <span class="nav-separator">/</span>
        <details bind:this={themeMenu} class="theme-menu" on:toggle={positionThemeMenu}>
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
