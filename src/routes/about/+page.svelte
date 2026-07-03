<section class="page">
  <div class="page-header">
    <span class="eyebrow">About</span>
    <h1>What is this?</h1>
    <p class="lede">
      Spotify listening history for me and my friends. It's invite-only, and each member chooses
      whether their profile is public.
    </p>
  </div>

  <section class="grid cols-2">
    <div class="panel">
      <h2>Where the data comes from</h2>
      <p class="muted">
        A sync job checks Spotify every 15 minutes for each member's recent plays. Members can
        also import their Spotify Extended Streaming History export, which covers everything back
        to their first listen.
      </p>
    </div>

    <div class="panel">
      <h2>Times and dates</h2>
      <p class="muted">
        Everything is counted in Melbourne time. Weeks start on Monday.
      </p>
    </div>

    <div class="panel">
      <h2>Privacy</h2>
      <p class="muted">
        Only profiles marked public show up here. The browser can read public stats and nothing
        else; Spotify logins and tokens stay on the server.
      </p>
    </div>
  </section>

  <p class="muted footnote">
    Source and setup instructions:
    <a href="https://github.com/kartikey-vyas/spotify-tracker">github.com/kartikey-vyas/spotify-tracker</a>
  </p>
</section>

<style>
  .footnote {
    margin-top: 1.5rem;
    font-size: 0.9em;
  }
</style>
