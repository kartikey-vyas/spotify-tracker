<script lang="ts">
  import { qualityLabel } from '$lib/metrics';

  export let quality: number;
  export let gapRisk = false;
</script>

<span class:warn={gapRisk} class="quality">
  [{gapRisk ? 'gap-risk' : qualityLabel(quality).toLowerCase()}]
</span>

<style>
  .quality {
    display: inline-flex;
    align-items: center;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-size: 0.86rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .quality.warn {
    color: var(--amber);
  }
</style>
