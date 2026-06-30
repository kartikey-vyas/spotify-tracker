<script context="module" lang="ts">
  export type CoverItem = {
    id: string;
    title: string;
    subtitle?: string | null;
    value?: string | null;
    imageUrl: string | null;
    href?: string | null;
  };
</script>

<script lang="ts">
  import { base } from '$app/paths';
  import { onMount } from 'svelte';

  export let items: CoverItem[] = [];

  let failed: Record<string, boolean> = {};
  let grid: HTMLUListElement;
  let columns = 0;

  // Read the live column count from the resolved grid template (auto-fill).
  function measureColumns(): void {
    if (!grid) return;
    const tracks = getComputedStyle(grid).gridTemplateColumns;
    columns = tracks && tracks !== 'none' ? tracks.split(' ').filter(Boolean).length : 0;
  }

  onMount(() => {
    measureColumns();
    const observer = new ResizeObserver(measureColumns);
    observer.observe(grid);
    return () => observer.disconnect();
  });

  // How many items fill only complete rows at the current column count. Falls
  // back to all items before the first measure (columns === 0) or when there
  // aren't even enough for one full row, so the wall is always a filled rectangle.
  function completeRowCount(itemCount: number, columnCount: number): number {
    if (columnCount === 0) return itemCount;
    return Math.floor(itemCount / columnCount) * columnCount || itemCount;
  }

  $: visible = items.slice(0, completeRowCount(items.length, columns));

  function markFailed(id: string): void {
    failed = { ...failed, [id]: true };
  }

  function captionText(item: CoverItem): string {
    return [item.title, item.subtitle].filter(Boolean).join(' — ');
  }
</script>

{#if items.length > 0}
  <ul class="cover-wall" bind:this={grid}>
    {#each visible as item (item.id)}
      <li>
        <svelte:element
          this={item.href ? 'a' : 'div'}
          class="tile"
          href={item.href ? `${base}${item.href}` : undefined}
          title={[captionText(item), item.value].filter(Boolean).join(' · ')}
        >
          {#if item.imageUrl && !failed[item.id]}
            <img
              class="art"
              src={item.imageUrl}
              alt={captionText(item)}
              loading="lazy"
              on:error={() => markFailed(item.id)}
            />
          {:else}
            <span class="art placeholder" aria-hidden="true">♪</span>
          {/if}
          <span class="overlay">
            <span class="title">{item.title}</span>
            {#if item.subtitle}<span class="subtitle">{item.subtitle}</span>{/if}
            {#if item.value}<span class="value">{item.value}</span>{/if}
          </span>
        </svelte:element>
      </li>
    {/each}
  </ul>
{:else}
  <p class="empty muted">No albums for this view.</p>
{/if}

<style>
  .cover-wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tile {
    position: relative;
    display: block;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--text);
    text-decoration: none;
  }

  .art {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder {
    color: var(--muted);
    font-size: 1.6rem;
  }

  .overlay {
    position: absolute;
    inset: auto 0 0 0;
    display: grid;
    gap: 1px;
    padding: 6px 7px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0));
    color: #fff;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .tile:hover .overlay,
  .tile:focus-visible .overlay {
    opacity: 1;
  }

  .title {
    font-size: 0.8rem;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle,
  .value {
    font-size: 0.72rem;
    opacity: 0.85;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
  }
</style>
