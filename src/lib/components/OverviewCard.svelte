<script lang="ts">
  export let label: string;
  export let value: string;
  export let detail: string | null = null;
</script>

<section class="panel metric-card">
  <span>{label}</span>
  <strong>{value}</strong>
  {#if detail}
    <p>{detail}</p>
  {/if}
</section>

<style>
  .metric-card {
    display: grid;
    gap: 8px;
    min-height: 132px;
  }

  span {
    color: var(--muted);
    font-size: 0.82rem;
    font-weight: 740;
    text-transform: uppercase;
  }

  strong {
    font-size: 2rem;
    line-height: 1;
  }

  p {
    color: var(--muted);
    line-height: 1.35;
  }
</style>
