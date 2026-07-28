<script lang="ts">
  import { dev } from '$app/environment';
</script>

{#if dev}
  {#await import('$lib/components/SpriteEditor.svelte') then Editor}
    <Editor.default />
  {/await}
{/if}
