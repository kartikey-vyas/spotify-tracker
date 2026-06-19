<script lang="ts">
  export let label: string;
  export let value: string;
  export let detail: string | null = null;
</script>

<section class="panel metric-card">
  <span class="metric-label">{label}</span>
  <strong>{value}</strong>
  {#if detail}
    <p>{detail}</p>
  {/if}
</section>

<style>
  .metric-card {
    display: grid;
    gap: 4px;
    min-height: 0;
  }

  .metric-label {
    color: var(--muted);
    font-size: 0.86rem;
    font-weight: 400;
    text-transform: none;
  }

  .metric-label::before {
    content: "> ";
  }

  strong {
    font-size: 1rem;
    line-height: 1.25;
    font-weight: 700;
  }

  p {
    color: var(--muted);
    line-height: 1.35;
  }
</style>
