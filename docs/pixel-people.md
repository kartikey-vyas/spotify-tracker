# Pixel people and sprites

Pixel people live in a **room**: one band of page per route (`PixelRoom.svelte`), with its own canvas. They never leave it. The room has a floor (the band's bottom rule), two walls, a ceiling, a low record shelf, a lounge (couch, record player, armchair, floor lamp) and a door. Code lives in `src/lib/pixel-person/`.

This replaced a page-wide world that scanned the DOM for platforms, ladders and occluders. That world made people climb, fall and wedge themselves all over the dashboard; the room exists so that cannot happen. **Do not reintroduce page geometry.** The page is never terrain.

## How it fits together

- **`PixelRoom.svelte`** is the light shell pages place (`<PixelRoom station="…" shelf="left|centre|right" />`). It lazy-loads **`PixelRoomStage.svelte`** (canvas, frame loop, pointer handling) only when the room can have someone in it: not under reduced motion, and on a narrow viewport only after a summon.
- **`room.ts`** — pure layout in room-local CSS pixels: floor, walls, shelf slots, lounge furniture and seats, door, walk range, `chooseOpenSpot`. No scrolling or page coordinates anywhere. The lounge stands right beside the shelf (lamp nearest it) so the two read as one listening corner; mid-room, every shelf trip became a walk across the room and people walked more than they did anything else. Narrow rooms get a smaller set (`LOUNGE_PLANS`).
- **`shelf.ts`** — which record is in which slot, who has it out, who has reserved it. A slot remembers its record while it is out, so it goes back where it came from.
- **`seats.ts`** — lounge occupancy, with the same reserve-then-take shape as the shelf.
- **`record-player.ts`** — what is on the record player and whose it is; one record at a time, reserved like a seat.
- **`simulation.ts`** — the person runtime and the **beat runner**. A plan is a queue of beats (`walk`, `pause`, `pose`, `take-from-shelf`, `return-to-shelf`, `take-from-pocket`, `stow`, `listen`, `sit`, `stand`, `set-lamp`, `play-record`, `take-from-player`) run to completion. Also drag, release, the doorway exit, and `settleIntoRoom`.
- **`activities.ts`** — what people choose to do. Each activity is a `weight()` and a `plan()` that returns beats.
- **`render.ts`** — draws the furniture, shelf, people, carried records, notes and the door. Upholstery uses the theme's `--data-1..3` ramp, resolved through a probe element because canvas cannot parse their `color-mix()`. Signature-based, so a still room does not redraw.
- **`residents.ts`** — module-level session state. Residents survive navigation: the next page's room settles them in as themselves (same id and character, same relative spot). It also holds the **crate**: covers seen this session, used for pocket records and to stock the shelf on pages without an album wall.

## Adding things to do

To add an activity, write an `Activity` in `activities.ts` and append it to `ACTIVITIES`. Most new behaviour is a new plan built from existing beats. Only add a beat kind for a new kind of *effect* (moving a record, a pose with a side effect). Then handle it in `startBeat`/`beatStatus` in `simulation.ts`.

- **A newcomer settles in first.** `chooseActivity` runs `settleInPlan` before any weighted roll while `settlingIn` is set: a record, the lamp, a seat, a listen. It only falls back to the roll when there is no music to be had.
- **Where a record is held and where notes start come from the pose drawn** (`POSE` in `render.ts`: `hold`, `restHeight`, `headDrop`). A new pose that holds a record differently declares an entry there instead of adding a special case.
- **Seats are for listening only.** The `lounge` pose wears headphones, so a seat is never taken without a record in hand or coming out of a pocket, and the stow is the last beat before standing. A record-less lounge activity shipped briefly and read as people listening to nothing; a test now pins this.
- **The `lounge` pose** (`makePilotLoungeFrame`, `makeFrankLoungeFrame`) is drawn for the couch: front on, hips in the cushion (row 46 of 64 is the cushion top), shins hanging so the feet stay on the floor, one arm out on an armrest. The body is never lifted, so a sitter ends up shorter than when standing. The first version lifted the cross-legged floor pose onto the cushion and people towered over the couch. Each seat sets `facing` so the resting arm reaches the nearer armrest. The sitter's shoulders sit below the top of the backrest, so an arm "along the back" cannot work. A walk beat stands them up first, and a drag, an abort or a room change frees the seat.
- Every duration lives in a named block (`ROUTINE`, `MUSIC`, `LOUNGE_TIMING`, `DOORWAY`, `DOORWAY_EXIT`), so retuning is a no-logic change.
- A walk's budget is derived from distance and pace (`walkBudgetMs`), so slowing people down cannot turn a walk into a timeout.
- A beat that cannot start (a reserved record taken, nothing in hand to listen to) aborts the plan. Someone holding a shelf record walks it back first. A second failure pockets it, so recovery cannot loop.
- New poses need frames for **every** character. Author them in the dev-only `/sprites/` explorer, never blind. Several animations (`climb`, `crawl`, `mantle`, `jump`) are no longer used by the room but still exist on every character, ready to be repurposed.

## Opting in from the page

Components still opt in by **tagging**, never by importing the pixel world:

- `data-pixel-record="<cover url>"` puts that album on the room's shelf (page order is rank order) and in the session crate.
- `data-pixel-artist` + `data-pixel-artist-rank` weight which artist characters turn up. Clicking a tagged artist brings that character into the room. Clicks inside `a`/`button` are ignored, because cover tiles carry the tag and are links.

`data-pixel-collision`, `data-pixel-promenade` and the cover-wall ladders are gone.

## Things that cost time

- **Identity survives.** Deliberate spawns are pinned (`pinnedCharacter`). The one re-roll — when the page's artists load after the first resident was rolled — only touches unpinned people spawned in this room within the last 10s.
- **The record player** stands between the couch and the armchair (it is dropped from rooms too narrow for it). When it and a seat are free, a shelf record goes on it (`playerListen`, `RECORD_PLAYER.playChance`; always for someone settling in): lamp on, crouch, record on, sit and listen hands-free, then take it back off and shelve it. A `listen` beat needs music: a record in hand, or theirs on the player. While it plays, the vinyl's sheen turns, the sleeve leans against the cabinet's outer side, and the notes still rise from the listener's headphones. Picking the owner up takes the record off and pops it back onto the shelf, like any shelf record.
- **The lamp** (`lampSwitch`, `LAMP`) is switched with a `set-lamp` beat after a `reach` pose: one arm up to the shade, then a small pull down. A first version reused the `climb` frames' alternating hands and read as janky. The shade is at head height, so they stand beside the pole on the open-floor side (`lampReach`); standing under it made them wear the shade like a hat. A taller lamp with a pull-chain was tried and rejected as ugly. Keep the lamp simple. Only one person heads for it at a time, and a seated listen often switches it on first. The glow is the room's one gradient: a soft warm yellow around the shade, fading over `LAMP_GLOW.fadeMs`. It is deliberately not the theme accent, because a lamp is lamplight. Light themes get a deeper amber at more strength (`LAMP_GLOW.light`, chosen by `--bg` luminance) or it vanishes. Readers can click (or tap) the lamp to switch it too (`isOnLamp`). It switches only when the press began on the lamp, so dropping someone beside it never flicks it. Every switch goes through `setLamp`, so a resident already on the way to set it the same way finds it done. Lamp state lives in `roomSession.lampOn`, so it carries across pages.
- **The door's state is written in one place**, `updateDoor` in the stage, from each person's `doorOpenness` plus an open doorway while someone is held.
- **The door** stands on the right wall in every room (people come and go stage right). A right-hand shelf is pushed inward to keep the doorstep clear (`ROOM.doorClearance`). It appears only while someone is held, coming in or going out. New residents arrive through it (`enterThroughDoor`): it fades in shut, swings open, they fade up on the threshold, walk to an open spot, and it shuts once they are clear of the frame. Simultaneous arrivals queue (`nextArrivalStart`). People following the reader between pages are already in the room and do not use it. Each person reports how open they need it (`doorOpenness`); the room takes the most open. Dropping a held person on it sets them down beside it, walks them in and shuts it. Leaving lowers `manualPopulation`; emptying the room sets `suppressed`, which `+1` and a navigation both clear. Otherwise the next frame refills the room and the exit looks broken.
- **Records are drawn at one CSS pixel per art pixel (12px)**, on the shelf and in hand, from the 24px sprite in `record-art.ts`. Pockets only offer covers whose art is already loaded, so nothing is pulled out invisible.
- **Frames** carry their own dimensions. Every shipped character is a 48×64 source rendered at 0.5 scale (24×32 CSS). Generic rigs live in `characters.ts`; artist characters own their art in `artists.ts`. **Residents are Frank Ocean by default** (`defaultResident`); the generic rigs no longer spawn and are kept only for the sprite editor. `pickCharacter` weighs any other artist on the page against him by rank.
- **Dev-only routes:** `/sprites/` (explorer) and `/sprites/edit/` (paint frames). Both are `{#if dev}` + dynamic import, and `scripts/strip-dev-routes.ts` removes the leftover shells after `vite build`. `scripts/lib/sprite-source.ts` holds the editor's splice logic, kept free of Vite and DOM types so it is unit-testable.

## Verifying

Tests pass `random` into the world explicitly. Pool seeds rather than trusting one trajectory, and do not trust the *first* draw of the small-seed LCG: it is about 0.24 for every small seed. Sweep the roll instead when a test is about weighting.

In a dev build, read the stage canvas's data attributes: `pixelPeople` (activity, beat, animation, carrying per person), `pixelShelf` (`on`/`out`/`reserved`/`empty` per slot) and `pixelCrate`. Also `pixelSeats` (who is in or headed for each seat), `pixelLamp` (`on`/`off`) and `pixelPlayer` (`idle`, or `playing:<owner id>`). Add `?pixelDebug=1` to outline the shelf slots and the door; that flag is read on mount.
