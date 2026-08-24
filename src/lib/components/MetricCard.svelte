<script lang="ts">
  export let label: string;
  export let value: string;
  export let caption = '';
  export let detail = '';
</script>

<section class="panel metric-card">
  <span class="metric-label">{label}</span>
  <strong>{value}</strong>
  {#if detail}
    <p>{#if caption}<span class="metric-caption">{caption}</span>{/if}{detail}</p>
  {/if}
</section>

<style>
  .metric-card {
    display: grid;
    gap: var(--space-1);
  }

  .metric-label {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .metric-label::before {
    content: "> ";
  }

  .metric-card strong {
    font-size: var(--text-base);
  }

  .metric-card p {
    margin: 0;
    color: var(--muted);
  }

  .metric-caption {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: var(--text-2xs);
    opacity: 0.7;
  }

  .metric-caption::after {
    content: " · ";
  }
</style>
