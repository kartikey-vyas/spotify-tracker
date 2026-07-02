<script module lang="ts">
  import { SPOTIFY_FILLED } from './spotifyFilledMark';

  // ───────────────────────────────────────────────────────────────────────
  //  RIPPLE KNOBS — tweak these. Coordinates are in Braille dots (each cell is
  //  2 dots wide x 4 tall); the disc is ~52x52 dots, so its centre is ~(26,26)
  //  and its radius ~26 dots.
  //
  //    FOCAL_X   focal point X offset from disc centre. NEGATIVE = left,
  //              positive = right, 0 = centred. The waves are arcs centred on
  //              this point, so it sets how they curve / which way they lean.
  //    FOCAL_Y   focal point Y offset. POSITIVE = below the disc (waves bulge
  //              up, like the logo); negative = above. Bigger |value| = flatter,
  //              bigger-radius arcs.
  //    BAND      arc half-thickness in dots (bigger = fatter waves).
  //    WAVES     how many arcs are on screen at once.
  //    FRAMES    steps per full sweep.   ┐ together set speed: one sweep takes
  //    INTERVAL  ms per step.            ┘ FRAMES x INTERVAL ms (1800ms now).
  //    DIRECTION  1 = emanate outward from the focal point (with the defaults:
  //              lower-left -> upper-right); -1 = sweep the other way.
  //
  //  Real Spotify centres its waves to the lower-left, hence these defaults.
  // ───────────────────────────────────────────────────────────────────────
  const FOCAL_X = -5;
  const FOCAL_Y = 30;
  const BAND = 3;
  const WAVES = 3;
  const FRAMES = 360;
  const INTERVAL = 5;
  const DIRECTION = 1;

  const BLANK = '⠀';
  const isInk = (ch: string) => ch !== BLANK;
  const dotX = (c: number) => 2 * c + 0.5; // Braille-dot centre for a cell column
  const dotY = (r: number) => 4 * r + 1.5; // Braille-dot centre for a cell row

  type RippleRow = { len: number; cells: { c: number; ch: string; d: number }[] };

  // The art and knobs are compile-time constants, so the disc geometry and every
  // cell's distance to the focal point are computed ONCE here for all instances.
  // Each frame the ripple then only compares these cached distances to the wave
  // radii — no per-cell hypot, no per-instance setup.
  const { LO, SPAN, RIPPLE_ROWS } = (() => {
    const rows = SPOTIFY_FILLED.split('\n');
    let sx = 0,
      sy = 0,
      n = 0;
    rows.forEach((line, r) =>
      [...line].forEach((ch, c) => {
        if (isInk(ch)) {
          sx += dotX(c);
          sy += dotY(r);
          n++;
        }
      })
    );
    const fx = sx / n + FOCAL_X;
    const fy = sy / n + FOCAL_Y;
    let lo = Infinity,
      hi = 0;
    const ripple: RippleRow[] = rows.map((line, r) => {
      const chars = [...line];
      const cells = chars.flatMap((ch, c) => {
        if (!isInk(ch)) return [];
        const d = Math.hypot(dotX(c) - fx, dotY(r) - fy);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        return [{ c, ch, d }];
      });
      return { len: chars.length, cells };
    });
    return { LO: lo - BAND, SPAN: hi - lo + 2 * BAND, RIPPLE_ROWS: ripple };
  })();

  const SWEEP_MS = FRAMES * INTERVAL;

  // WAVES arcs spread evenly across the sweep, so one is always emanating.
  function overlayAt(frame: number): string {
    const base = frame / FRAMES;
    const radii = Array.from({ length: WAVES }, (_, k) => {
      let p = (base + k / WAVES) % 1;
      if (DIRECTION < 0) p = 1 - p;
      return LO + p * SPAN;
    });
    return RIPPLE_ROWS.map(({ len, cells }) => {
      const out = new Array<string>(len).fill(BLANK);
      for (const { c, ch, d } of cells) {
        if (radii.some((rr) => Math.abs(d - rr) <= BAND)) out[c] = ch;
      }
      return out.join('');
    }).join('\n');
  }

  // One shared rAF ticker drives every mounted ripple instance: the overlay is
  // identical for all of them, so it is computed once per painted frame here
  // and every instance just renders it. Time-based phase keeps the sweep at
  // SWEEP_MS regardless of display refresh rate, and rAF pauses in background
  // tabs for free.
  let rippleOverlay = $state(overlayAt(0));
  let rippleUsers = 0;
  let rafId = 0;
  let lastFrame = 0;

  function tick(now: number) {
    const frame = Math.floor(((now % SWEEP_MS) / SWEEP_MS) * FRAMES);
    if (frame !== lastFrame) {
      lastFrame = frame;
      rippleOverlay = overlayAt(frame);
    }
    rafId = requestAnimationFrame(tick);
  }

  function startRipple() {
    if (rippleUsers++ === 0) rafId = requestAnimationFrame(tick);
    return () => {
      if (--rippleUsers === 0) cancelAnimationFrame(rafId);
    };
  }
</script>

<script lang="ts">
  type LoaderSize = 'sm' | 'md' | 'lg';
  type Anim = 'ripple' | 'radar' | 'pulse';

  let {
    size = 'md',
    anim = 'ripple',
    label
  }: {
    size?: LoaderSize;
    /** Motion for the mark. */
    anim?: Anim;
    label?: string;
  } = $props();

  $effect(() => {
    if (anim !== 'ripple') return;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    return startRipple();
  });
</script>

<div class="loader" data-size={size} role="status" aria-label={label ?? 'Loading'}>
  <div class="mark filled anim-{anim}">
    <pre class="fill-base" aria-hidden="true">{SPOTIFY_FILLED}</pre>
    {#if anim === 'ripple'}
      <pre class="fill-ripple" aria-hidden="true">{rippleOverlay}</pre>
    {/if}
  </div>
  {#if label}<span class="label">{label}</span>{/if}
</div>

<style>
  .loader {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5em;
    color: var(--muted);
  }

  .mark {
    position: relative;
    display: inline-block;
    line-height: 1.05;
  }

  pre {
    margin: 0;
    font-family: inherit;
    white-space: pre;
    letter-spacing: 0;
  }

  /* ---- Filled (Braille disc) ---- */
  .filled pre {
    /* The mark is 26 cells wide x 13 tall. Monospace cells are ~0.6em wide, so
       at line-height 1 it renders ~26*0.6 = 15.6em wide vs 13em tall (a flat
       ellipse). Stretching the line box to 15.6/13 ≈ 1.2 makes it round (and
       squares up the Braille dots). Nudge 1.15–1.25 if your font differs. */
    line-height: 1.2;
  }
  .fill-base {
    color: var(--muted);
  }
  /* Blush: darken the resting disc a touch (toward the theme text colour). */
  :global(html[data-theme='blush']) .fill-base {
    color: color-mix(in oklab, var(--muted) 75%, var(--text));
  }
  /* Ripple: bright ring of real glyphs sweeping outward, over the dim disc. */
  .fill-ripple {
    position: absolute;
    inset: 0;
    color: var(--accent);
  }

  /* Radar: a bright wedge orbits the disc (rotating conic highlight). */
  @property --sweep {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }
  .anim-radar .fill-base {
    color: transparent;
    background-image: conic-gradient(
      from var(--sweep),
      var(--accent),
      var(--muted) 55deg,
      var(--muted) 305deg,
      var(--accent) 360deg
    );
    -webkit-background-clip: text;
    background-clip: text;
    animation: radar 1.3s linear infinite;
  }
  @keyframes radar {
    to {
      --sweep: 360deg;
    }
  }

  /* Pulse: accent glow swelling outward from the centre. */
  .anim-pulse .fill-base {
    color: transparent;
    background-color: var(--muted);
    background-image: radial-gradient(circle at 50% 54%, var(--accent) 0%, transparent 55%);
    background-repeat: no-repeat;
    background-position: center;
    background-size: 40% 40%;
    -webkit-background-clip: text;
    background-clip: text;
    animation: pulse 1.8s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      background-size: 35% 35%;
    }
    50% {
      background-size: 300% 300%;
    }
  }

  /* Size scaling via font-size on the mark. */
  .loader[data-size='sm'] .mark {
    font-size: 0.5rem;
  }
  .loader[data-size='md'] .mark {
    font-size: 0.72rem;
  }
  .loader[data-size='lg'] .mark {
    font-size: 1rem;
  }

  .label {
    font-size: 0.8em;
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  @media (prefers-reduced-motion: reduce) {
    .anim-radar .fill-base,
    .anim-pulse .fill-base {
      animation: none;
      background: none;
      color: var(--muted);
    }
    .fill-ripple {
      display: none;
    }
  }
</style>
