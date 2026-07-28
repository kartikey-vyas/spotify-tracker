<script lang="ts">
  import { dev } from '$app/environment';
</script>

{#if dev}
  {#await import('$lib/components/SpriteExplorer.svelte') then Explorer}
    <Explorer.default />
  {/await}
{/if}
