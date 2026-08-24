<script lang="ts">
  import { dev } from '$app/environment';
  import '../styles.css';
  import { afterNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import { onMount, tick } from 'svelte';
  import { isCurrentUserAdmin } from '$lib/queries/admin';
  import { supabase } from '$lib/supabase';
  import { THEME_KEY, applyTheme, isTheme, themes, type Theme } from '$lib/theme';
  import {
    isPixelPersonRoute,
    shouldEnablePixelPerson
  } from '$lib/pixel-person/availability';
  import { pixelPersonController } from '$lib/pixel-person/controller';

  const links = [
    { href: '/', label: 'overview' },
    { href: '/app/', label: 'login' },
    { href: '/explore/', label: 'explore' },
    { href: '/activity/', label: 'activity' },
    { href: '/about/', label: 'about' }
  ];

  let theme: Theme = 'warm-dark';
  let themeMenu: HTMLDetailsElement | null = null;
  let navRail: HTMLElement | null = null;
  let showAdmin = dev;
  let canSummonPixelPerson = false;
  let pixelPersonWorld:
    | (typeof import('$lib/components/PixelPersonWorld.svelte'))['default']
    | null = null;
  let loadingPixelPersonWorld: Promise<void> | null = null;
  let reducedMotionQuery: MediaQueryList | null = null;

  afterNavigate(() => {
    updatePixelPersonAvailability();
    scrollActiveNavLinkIntoView(navRail, window.location.pathname);
  });

  function normalisePath(pathname: string): string {
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  }

  // Below 800px the nav is a horizontal rail, so the link for the page you are on
  // can start out scrolled off the right edge. Centre it after each navigation —
  // above 800px the rail does not overflow and this is a no-op. The rail element
  // and the path are passed in rather than read from state: a derived `$:` would
  // still be stale here.
  function scrollActiveNavLinkIntoView(nav: HTMLElement | null, pathname: string): void {
    if (!nav) return;
    const current = normalisePath(pathname);
    let active: HTMLAnchorElement | null = null;
    let activeLength = -1;
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const path = normalisePath(link.pathname);
      // Longest match wins, so /admin/mark/ picks admin rather than the home link.
      if ((current === path || current.startsWith(`${path}/`)) && path.length > activeLength) {
        active = link;
        activeLength = path.length;
      }
    }
    if (!active) return;
    const railBox = nav.getBoundingClientRect();
    const linkBox = active.getBoundingClientRect();
    nav.scrollLeft += linkBox.left - railBox.left - (railBox.width - linkBox.width) / 2;
  }

  // The pixel-person world (simulation, physics, sprites) is a large module
  // graph; it is only fetched and mounted once the feature can actually run.
  function loadPixelPersonWorld(): Promise<void> {
    loadingPixelPersonWorld ??= import('$lib/components/PixelPersonWorld.svelte').then(
      (module) => {
        pixelPersonWorld = module.default;
      }
    );
    return loadingPixelPersonWorld;
  }

  function updatePixelPersonAvailability(): void {
    if (typeof window === 'undefined') return;
    reducedMotionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    canSummonPixelPerson =
      isPixelPersonRoute(window.location.pathname, base) && !reducedMotionQuery.matches;
    if (
      !pixelPersonWorld &&
      shouldEnablePixelPerson(
        window.location.pathname,
        window.innerWidth,
        reducedMotionQuery.matches,
        base
      )
    ) {
      void loadPixelPersonWorld();
    }
  }

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

    updatePixelPersonAvailability();
    const onPixelPersonEnvironmentChange = () => updatePixelPersonAvailability();
    reducedMotionQuery?.addEventListener('change', onPixelPersonEnvironmentChange);
    window.addEventListener('resize', onPixelPersonEnvironmentChange);

    void refreshAdminAccess();
    const {
      data: { subscription }
    } = supabase?.auth.onAuthStateChange(() => {
      void refreshAdminAccess();
    }) ?? { data: { subscription: null } };

    return () => {
      document.removeEventListener('click', closeThemeMenu);
      reducedMotionQuery?.removeEventListener('change', onPixelPersonEnvironmentChange);
      window.removeEventListener('resize', onPixelPersonEnvironmentChange);
      subscription?.unsubscribe();
    };
  });

  function positionThemeMenu(): void {
    if (!themeMenu?.open) return;
    const options = themeMenu.querySelector<HTMLElement>('.menu-options');
    if (!options) return;
    options.style.setProperty('--menu-shift', '0px');
    const margin = 8;
    const overflow = margin - options.getBoundingClientRect().left;
    if (overflow > 0) options.style.setProperty('--menu-shift', `${overflow}px`);
  }

  function selectTheme(nextTheme: Theme): void {
    theme = nextTheme;
    applyTheme(theme);
    if (themeMenu) themeMenu.open = false;
  }

  async function summonPixelPerson(): Promise<void> {
    await loadPixelPersonWorld();
    await tick();
    pixelPersonController.summon();
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
      <nav class="site-nav" bind:this={navRail} aria-label="Primary navigation">
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
      </nav>

      <!-- Controls, not destinations. They sit outside the nav because below 800px
           the nav becomes a scroll container, which would clip the theme dropdown. -->
      <div class="header-tools">
        <span class="nav-separator">/</span>
        <details bind:this={themeMenu} class="menu" on:toggle={positionThemeMenu}>
          <summary class="menu-trigger">theme</summary>
          <div class="menu-options is-right is-theme" role="radiogroup" aria-label="Color theme">
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

        {#if canSummonPixelPerson}
          <span class="nav-separator">/</span>
          <button
            class="pixel-person-summon"
            type="button"
            aria-label="Add a tiny listener"
            title="add a tiny listener"
            on:click={summonPixelPerson}
          >
            +1
          </button>
        {/if}
      </div>
    </div>
  </header>

  <main>
    <slot />
  </main>
</div>

{#if pixelPersonWorld}
  <svelte:component this={pixelPersonWorld} />
{/if}

<style>
  /* The tools sit outside .site-nav now, but the header still has to read as one
     unbroken line, so the gap between nav and tools matches the nav's item gap. */
  .header-controls {
    gap: var(--space-2);
  }

  .header-tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Phone header: brand and tools keep one row, the nav drops below them as a
     horizontal rail. A grid rather than the desktop flex row, because the nav has
     to span the full width while brand and tools stay on the line above. */
  @media (max-width: 800px) {
    .site-header {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      column-gap: var(--space-4);
      row-gap: var(--space-2);
    }

    /* Flattened so nav and tools place themselves on the header grid directly. */
    .header-controls {
      display: contents;
    }

    .brand {
      grid-area: 1 / 1;
    }

    .header-tools {
      grid-area: 1 / 2;
      justify-content: flex-end;
    }

    /* The leading slash only made sense while the tools trailed the nav links. */
    .header-tools > .nav-separator:first-child {
      display: none;
    }

    .site-nav {
      grid-area: 2 / 1 / 3 / -1;
      flex-wrap: nowrap;
      white-space: nowrap;
      /* The desktop rule right-aligns the links against the tools. A rail reads
         from its left edge, and this still matters once the links are narrower
         than the viewport — a tablet, or a signed-out visitor with fewer links. */
      justify-content: flex-start;
      /* Without min-width: 0 the links size the grid column, so a long nav widens
         the page sideways instead of scrolling inside the rail. */
      min-width: 0;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      /* Bleed through the header's gutter so the rail runs edge to edge: negative
         margin cancels the page padding, the matching padding puts it back inside
         the scroller. Both must stay in step with .site-header's padding. */
      margin-inline: calc(-1 * clamp(var(--space-4), 3vw, var(--space-8)));
      padding-inline: clamp(var(--space-4), 3vw, var(--space-8));
      /* Room for focus rings, which the scroll container would otherwise clip. */
      padding-block: var(--space-1);
    }

    .site-nav::-webkit-scrollbar {
      display: none;
    }

    .site-nav > * {
      flex: 0 0 auto;
    }
  }
</style>
