<script lang="ts">
  import { dev } from '$app/environment';
</script>

{#if dev}
  {#await import('$lib/components/LoaderPreview.svelte') then Preview}
    <Preview.default />
  {/await}
{/if}
