<section class="page">
  <div class="page-header">
    <span class="eyebrow">About</span>
    <h1>Data caveats</h1>
    <p class="lede">This public dashboard keeps the browser read-only and reserves writes for local import scripts and scheduled GitHub Actions.</p>
  </div>

  <section class="grid cols-2">
    <div class="panel">
      <h2>Quality labels</h2>
      <p class="muted">
        Export rows are exact and include ms_played. Recently-played API rows count as plays but have unknown duration, so they are excluded from minute totals.
      </p>
    </div>

    <div class="panel">
      <h2>Timezone</h2>
      <p class="muted">
        Dates are bucketed in Australia/Melbourne and weeks start on Monday.
      </p>
    </div>

    <div class="panel">
      <h2>Genres</h2>
      <p class="muted">
        Genre rollups use the primary artist's Spotify genre tags and split listening time evenly across those tags.
      </p>
    </div>

    <div class="panel">
      <h2>Security</h2>
      <p class="muted">
        The frontend receives only the public Supabase URL and anon key. Service credentials and Spotify refresh tokens are used only by local scripts or GitHub Actions.
      </p>
    </div>
  </section>
</section>
