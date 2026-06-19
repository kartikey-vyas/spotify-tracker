<script lang="ts">
  import { qualityLabel } from '$lib/metrics';

  export let quality: number;
  export let gapRisk = false;
</script>

<span class:warn={gapRisk} class="quality">
  {gapRisk ? 'Gap risk' : qualityLabel(quality)}
</span>

<style>
  .quality {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.76rem;
    font-weight: 730;
    white-space: nowrap;
  }

  .quality.warn {
    border-color: #f3c178;
    background: #fff7e8;
    color: var(--amber);
  }
</style>
