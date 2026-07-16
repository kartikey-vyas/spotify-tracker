---
name: verify
description: How to run and observe this SvelteKit app (musik) end-to-end, including the pixel-person canvas overlay.
---

# Verifying musik changes at runtime

## Build / launch
- `pnpm dev --port <port>` (run in background; ready in <1s). `.env.local` provides Supabase keys, so real data loads — the cover wall populates a few seconds after first paint.
- Do NOT wait for playwright `networkidle` — Supabase keeps connections alive and it may never fire. Use `waitUntil: 'domcontentloaded'` and poll DOM state instead.

## Browser automation
- No playwright dep in the repo, but browsers are cached. Install `playwright-core` in the scratchpad and launch with
  `executablePath: ~/Library/Caches/ms-playwright/chromium-<rev>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.

## Pixel-person feature
- Load any supported route (`/`, `/explore/`, `/activity/`, `/about/`) with `?pixelDebug=1` (dev builds only) at viewport width > 800.
- The overlay canvas `canvas.pixel-person-world` exposes live state via data attributes: `pixelPersonCount`, `pixelColliderCount`, `pixelItemSourceCount`, `pixelPlacedRecords`, and `pixelPeople` (JSON per person: activity, animation, errand, carrying, grounded, supportId…). Poll these instead of screenshotting blindly.
- The ambient population is 1 and spawns near the current viewport. To get a person near a specific element, scroll it to viewport center first, then click the nav `+1` button (`button.pixel-person-summon`) — new people spawn around 62% viewport height. Note: a manual summon keeps the feature enabled below the 800px width gate by design.
- Record-carry flow timing: first errand ~12s after a person spawns, walk a few seconds, 550ms stoop, then `carrying` is set (carry lasts 20–60s). Budget ~30s of polling after a summon.
- Gotcha: a person stuck in `crawling: true` never plans errands (crawl bypasses the activity planner); summon a fresh person rather than waiting.
- Taint check for anything drawing external images: `canvas.getContext('2d').getImageData(0,0,1,1)` must not throw.
- Grab-drop probe: read person x/y from `pixelPeople`, convert with `window.scrollX/Y`, `mouse.move` then `mouse.down` on the body center — activity becomes `drag` and a carried record drops (`pixelPlacedRecords` increments, fades after 2.4s).
