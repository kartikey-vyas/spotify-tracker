<script lang="ts">
  export let label: string;
  export let value: string;
  export let caption = '';
  export let detail = '';
  // Label only, with placeholder lines where the value and detail will go, so
  // the card keeps its final size while the data loads.
  export let loading = false;
</script>

<section class="panel metric-card">
  <span class="metric-label">{label}</span>
  {#if loading}
    <span class="skeleton skeleton-value" aria-hidden="true"></span>
    <span class="skeleton skeleton-detail" aria-hidden="true"></span>
  {:else}
    <strong>{value}</strong>
    {#if detail}
      <p>{#if caption}<span class="metric-caption">{caption}</span>{/if}{detail}</p>
    {/if}
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
    line-height: var(--leading-sm);
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
    letter-spacing: var(--tracking-wide);
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
    opacity: 0.7;
  }

  .metric-caption::after {
    content: " · ";
  }

  /* Each line is one line-height tall, the height of the text it stands in for. */
  .skeleton-value,
  .skeleton-detail {
    display: block;
    height: var(--leading-base);
  }

  .skeleton-value {
    width: 40%;
  }

  .skeleton-detail {
    width: 70%;
  }
</style>
