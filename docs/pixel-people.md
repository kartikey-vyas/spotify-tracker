# Pixel people and sprites

An ambient pixel character walks the dashboard chrome. It lives in `src/lib/pixel-person/` and is driven entirely off the rendered DOM.

- **The promenade is authored; the DOM is not an obstacle course.** A clear
  walking band opts in with `data-pixel-promenade="rail"`; its bottom edge is
  the walking plane, and `data-pixel-station` gives the stop a semantic name.
  The shared `PixelPromenade.svelte` component is the normal way to add one.
  Cover-wall shelves still opt in explicitly with
  `data-pixel-collision="platform"`, but buttons, images, SVGs, borders and text
  never become terrain just because they are on the page. Semantic rails stay
  independent: `data-pixel-record` supplies an album URL a person can pick up,
  while `data-pixel-artist` + `data-pixel-artist-rank` drive artist presence and
  click-to-summon. Clicking a tagged artist ignores anything inside an
  `a`/`button` because cover tiles carry the artist rail and are links.
- **That world only exists near the viewport** (`scanBounds` = viewport + `SCAN_PADDING_X`/`_Y`). Someone outside it is *frozen* (`lifecycle.ts`), holding their spot on the page and their character until the reader scrolls back — stepping them would drop them through a floor that was never scanned. So "fell out of the world" is measured against the document, never against `scanBounds`, which follows the viewport.
- **Ambient movement is a quiet, rail-bound routine.** A routine is a short
  queue of `travel`/`rest`/`look` beats run to completion, with long holds and
  short walks clamped to the support underfoot. Ambient people do not decide to
  leave a rail, climb a panel, take a ladder or hide behind UI. Same-level
  record errands remain purposeful and use the faster walking gear. Active
  scrolling settles an aimless walker; once its old rail is offscreen, an
  unpinned ambient resident may re-enter on a visible rail, while deliberately
  summoned artists keep their document position.
- **Every duration shaping the feel lives in a named block** — `ROUTINE`, `RECORD_ERRAND`, `HIDE`, `DOORWAY_EXIT`, `DOORWAY` — so retuning is a no-logic change. Errand timeouts are derived against the walk speed and a test pins that relation: lowering the speed without raising them silently strands people mid-errand.
- **Frames** carry their own dimensions. Every shipped character now uses a 48×64 source rendered at 0.5 scale for a denser 24×32 CSS footprint; the old 24×32 frame data has been removed. Generic rigs live in `characters.ts`; artist characters own their art in `artists.ts`. Generated frames can use additional palette keys beyond `oghfstpbn` and declare `frameSource.editable = false`, so the sprite editor previews them without offering a source splice it cannot perform.
- **Artist characters are deliberately not in `characterRegistry` or `ambientCharacterRegistry`.** `pickCharacter` builds ordinary spawns from the ambient registry, then folds artist characters in separately, weighted by presence and rank.
- **Identity survives.** Deliberate spawns are pinned (`pinnedCharacter`) against a navigation's blanket re-roll, and recovery from a mishap (wedged in geometry, fallen out of the document) rebuilds people *as themselves* — same id, character, pinned-ness. Rolling a fresh character on recovery made it look like a different person turning up.
- **The doorway** (`doorway.ts`) is how a character is removed: it fades in while one is held, and dropping them on it lands them beside it, walks them in and shuts the door. Leaving must lower the population or a rescan refills it and the delete looks broken; emptying the world sets `ambientSuppressed`, which `+1` and a navigation both clear. Its base anchors to `viewportFloorY`, the single expression deciding where the ground is — derive that twice and furniture floats above the feet standing on it.
- **Dev-only routes:** `/sprites/` (explorer) and `/sprites/edit/` (paint frames by hand). Both are `{#if dev}` + dynamic import so they constant-fold out of the production bundle, and `scripts/strip-dev-routes.ts` removes the leftover shells after `vite build`. The editor saves by POSTing to a Vite middleware declared `apply: 'serve'`, which therefore does not exist in a production build. `scripts/lib/sprite-source.ts` holds the splice logic, kept free of Vite and DOM types so it is unit-testable under Node.

Runtime verification is worth more than reading here: load any supported route with `?pixelDebug=1` and poll the `canvas.pixel-person-world` data attributes (`pixelPersonCount`, `pixelPeople`, `pixelColliderCount`) instead of screenshotting blindly. `pixelPeople` carries each person's activity and exit phase. Single runs are noisy enough to mislead — the same build swings widely between samples — so measure a behaviour change across several before believing a number.
