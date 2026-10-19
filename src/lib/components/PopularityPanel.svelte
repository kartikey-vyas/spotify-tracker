<script lang="ts">
  import type { DeepCut, InsightsPayload } from '$lib/types';
  import {
    bandFor,
    bandTicks,
    buildYearSeries,
    formatListeners,
    reliableMedian,
    type StripEntry,
    type YearBar
  } from '$lib/insights';
  import { formatPlays } from '$lib/metrics';
  import { tooltip as tipAction } from '$lib/actions/tooltip';

  export let insights: InsightsPayload;
  /** Every public profile's all-time score; the current one is `selected`. */
  export let strip: StripEntry[] = [];
  /** Turns each deep cut's artist into a link. Plain text without it. */
  export let artistHref: ((cut: DeepCut) => string | null) | null = null;

  const ticks = bandTicks();

  $: allTime = reliableMedian(insights.popularity.all_time);
  $: years = buildYearSeries(insights.popularity.by_year);
  $: lowest = years.find((year) => year.lowest) ?? null;
  $: deepCuts = insights.popularity.deep_cuts;
  // Label every year when there are few, decades plus the last one otherwise.
  $: lastYear = years.length > 0 ? years[years.length - 1].year : null;
  $: showYearLabel = (year: number): boolean =>
    years.length <= 8 || year % 5 === 0 || year === lastYear;
  $: observedOn = insights.stats_observed_through
    ? new Date(`${insights.stats_observed_through}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : null;

  const listenersText = (count: number): string => `${formatListeners(count)} listeners`;

  function yearTooltip(bar: YearBar): string {
    return `${bar.year} · ${listenersText(bar.listeners)} · ${bar.band}`;
  }

  function stripTooltip(entry: StripEntry): string {
    return `${entry.name} · ${listenersText(entry.listeners)} · ${entry.band}`;
  }
</script>

{#if allTime !== null}
  <section class="popularity">
    <div class="headline">
      <strong>{bandFor(allTime)}</strong>
      <span class="muted">
        The typical artist you play has {listenersText(allTime)} on Last.fm.
      </span>
    </div>

    <div class="pop-grid">
      <div class="pop-main">
        {#if strip.length > 1}
          <div class="block">
            <h3>Compared with friends</h3>
            <ol class="strip" aria-label="Typical artist listeners per profile">
              {#each strip as entry (entry.slug)}
                <li class:selected={entry.selected}>
                  <span class="who">{entry.name}</span>
                  <span class="track" use:tipAction={stripTooltip(entry)}>
                    {#each ticks as tick (tick.listeners)}
                      <span class="tick" style="left: {tick.position * 100}%"></span>
                    {/each}
                    <span class="dot" style="left: {entry.position * 100}%"></span>
                  </span>
                  <span class="value">{formatListeners(entry.listeners)}</span>
                </li>
              {/each}
            </ol>
            <div class="strip-axis" aria-hidden="true">
              <span class="who"></span>
              <span class="track">
                <span class="axis-label">underground</span>
                <span class="axis-label">mainstream</span>
              </span>
            </div>
          </div>
        {/if}

        {#if years.length > 1}
          <div class="block">
            <h3>By year</h3>
            <div class="years">
              <div class="bars" role="img" aria-label="Typical artist listeners by year">
                {#each years as bar (bar.year)}
                  <div class="col" use:tipAction={yearTooltip(bar)}>
                    <div
                      class="bar"
                      class:lowest={bar.lowest}
                      style="height: {Math.max(2, bar.fraction * 100)}%"
                    ></div>
                  </div>
                {/each}
              </div>
              <div class="axis" aria-hidden="true">
                {#each years as bar (bar.year)}
                  <span class="year-tick">{showYearLabel(bar.year) ? bar.year : ''}</span>
                {/each}
              </div>
            </div>
            {#if lowest}
              <p class="muted note">
                Most underground year: <span class="accent">{lowest.year}</span>
                ({listenersText(lowest.listeners)}).
              </p>
            {/if}
          </div>
        {/if}
      </div>

      {#if deepCuts.length > 0}
        <div class="block">
          <h3>Deep cuts</h3>
          <ol class="cuts">
            {#each deepCuts as cut (`${cut.artist_id}:${cut.track_name}`)}
              {@const href = artistHref ? artistHref(cut) : null}
              <li>
                <span class="cut-name">
                  <span class="track-name">{cut.track_name}</span>
                  {#if cut.artist_name}
                    {#if href}
                      <a class="artist" {href}>{cut.artist_name}</a>
                    {:else}
                      <span class="artist">{cut.artist_name}</span>
                    {/if}
                  {/if}
                </span>
                <span class="count" use:tipAction={`${formatPlays(cut.plays)} · ${listenersText(cut.track_listeners)}`}>
                  {formatListeners(cut.track_listeners)}
                </span>
              </li>
            {/each}
          </ol>
          <p class="muted note">Songs you have played 3+ times with under 20k listeners.</p>
        </div>
      {/if}
    </div>

    <p class="muted source">
      Listener counts from
      <a href="https://www.last.fm" rel="noopener noreferrer" target="_blank">Last.fm</a>{observedOn
        ? ` as of ${observedOn}`
        : ''}: how popular the music is now, not when you played it.
    </p>
  </section>
{/if}

<style>
  .popularity {
    display: grid;
    gap: var(--space-6);
  }

  .headline {
    display: grid;
    gap: var(--space-1);
  }

  .headline strong {
    color: var(--accent);
    font-size: var(--text-lg);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .pop-grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: var(--space-12);
  }

  .pop-main {
    display: grid;
    gap: var(--space-8);
    align-content: start;
  }

  .block h3 {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: var(--leading-sm);
  }

  .block h3::before {
    content: '> ';
  }

  .note {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .accent {
    color: var(--accent);
  }

  /* Comparison strip: one row per profile on a shared log axis. Rows, not
     labelled dots on one line, so close scores never collide. */
  .strip {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .strip li,
  .strip-axis {
    display: grid;
    grid-template-columns: minmax(0, 7rem) minmax(0, 1fr) 3.5rem;
    align-items: center;
    gap: var(--space-3);
  }

  .strip li {
    padding: var(--space-1) 0;
  }

  .strip .who {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strip li.selected .who,
  .strip li.selected .value {
    color: var(--text);
  }

  .track {
    position: relative;
    height: 12px;
    border-bottom: 1px solid var(--line);
  }

  .tick {
    position: absolute;
    bottom: -1px;
    width: 1px;
    height: 6px;
    background: var(--line);
  }

  .dot {
    position: absolute;
    bottom: -4px;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    background: var(--data-bar);
  }

  .strip li.selected .dot {
    background: var(--accent);
  }

  .strip .value {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* The axis words span into the value column, so they never touch on phones. */
  .strip-axis .track {
    grid-column: 2 / -1;
    height: auto;
    border: 0;
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .axis-label {
    color: var(--muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  /* Year bars: same flat bar language as the release-year chart. */
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 120px;
  }

  .col {
    display: flex;
    flex: 1 0 5px;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
  }

  .bar {
    width: 100%;
    background: var(--data-bar);
  }

  .bar.lowest {
    background: var(--accent);
  }

  .col:hover .bar {
    background: var(--accent-dark);
  }

  .axis {
    display: flex;
    gap: 2px;
    margin-top: var(--space-2);
    color: var(--muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
  }

  .year-tick {
    flex: 1 0 5px;
    overflow: visible;
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
  }

  /* Deep cuts: the StatList row language, with the artist under the track. */
  .cuts {
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: rank;
  }

  .cuts li {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--line);
    counter-increment: rank;
  }

  .cuts li:last-child {
    border-bottom: 0;
  }

  .cuts li::before {
    content: counter(rank);
    min-width: 1.4em;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .cut-name {
    display: grid;
    flex: 1 1 auto;
    min-width: 0;
  }

  .track-name,
  .artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artist {
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  a.artist:hover {
    color: var(--accent);
  }

  @media (hover: hover) {
    a.artist {
      text-decoration: none;
    }

    a.artist:hover {
      text-decoration: underline;
    }
  }

  .count {
    margin-left: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .source {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
  }

  .source a {
    color: inherit;
  }

  @media (max-width: 800px) {
    .pop-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-8);
    }
  }

  @media (max-width: 480px) {
    .strip li,
    .strip-axis {
      grid-template-columns: minmax(0, 5rem) minmax(0, 1fr) 3.5rem;
    }
  }
</style>
