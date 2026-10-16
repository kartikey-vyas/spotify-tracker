<script lang="ts">
  import { dev } from '$app/environment';
  import { onMount } from 'svelte';
  import { MUSIC } from '$lib/pixel-person/activities';
  import { parseArtistPresence } from '$lib/pixel-person/artist-presence';
  import {
    artistCharacterFor,
    hasMatchedArtist,
    pickCharacter,
    resolveCharacter
  } from '$lib/pixel-person/artists';
  import { desiredPopulation, MAX_PIXEL_PEOPLE } from '$lib/pixel-person/availability';
  import { pixelPersonController } from '$lib/pixel-person/controller';
  import { DOORWAY, doorwayOpacity, isOverDoorway } from '$lib/pixel-person/doorway';
  import { clamp } from '$lib/pixel-person/physics';
  import { getRecordArt, requestRecordArt } from '$lib/pixel-person/record-art';
  import { isPointOnPixelPerson, renderRoom } from '$lib/pixel-person/render';
  import {
    rememberRecords,
    roomSession,
    uniqueRecords
  } from '$lib/pixel-person/residents';
  import { isOnLamp, layoutRoom, type RoomLayout, type ShelfSide } from '$lib/pixel-person/room';
  import { createRecordPlayer } from '$lib/pixel-person/record-player';
  import { createSeats, resizeSeats, type SeatState } from '$lib/pixel-person/seats';
  import { createShelf, releaseShelf, resizeShelf, stockShelf, type ShelfSlot } from '$lib/pixel-person/shelf';
  import {
    beginDoorwayExit,
    beginPixelPersonDrag,
    createPixelPerson,
    currentBeat,
    doorOpenness,
    enterThroughDoor,
    moveDraggedPixelPerson,
    nextArrivalStart,
    rebaseDraggedPixelPerson,
    releaseFurniture,
    releasePixelPersonDrag,
    setPersonDefinition,
    settleIntoRoom,
    stepPixelPerson,
    setLamp,
    type LampState,
    type PixelPersonRuntime,
    type RoomWorld
  } from '$lib/pixel-person/simulation';
  import type {
    ArtistPresence,
    CharacterDefinition,
    PixelPersonCommand,
    Point,
    RoomRecord
  } from '$lib/pixel-person/types';

  /** The room band this stage fills. */
  export let host: HTMLElement;
  export let shelfSide: ShelfSide = 'right';

  /** The first resident waits this long for the page's artists to load. */
  const FIRST_SPAWN_WAIT_MS = 2_500;
  /** A resident rolled before the artists loaded may be re-rolled this soon after. */
  const ARTIST_REROLL_WINDOW_MS = 10_000;
  const PAGE_SCAN_DEBOUNCE_MS = 200;

  let canvas: HTMLCanvasElement;
  let room: RoomLayout = layoutRoom(0, 0, shelfSide);
  let shelf: ShelfSlot[] = createShelf(room.shelf.slots.length);
  let seats: SeatState[] = createSeats(room.seats.length);
  const player = createRecordPlayer();
  // Shared with every page's room, so a lamp left on stays on.
  const lamp: LampState = { on: roomSession.lampOn, changedAt: Number.NEGATIVE_INFINITY };
  let people: PixelPersonRuntime[] = [];
  let pageRecords: RoomRecord[] = [];
  let presences: ArtistPresence[] = [];
  let mountedAt = 0;
  let spawnReadyAt = 0;
  let artistRerollDone = false;
  let visible = true;
  let animationFrame = 0;
  let lastFrameAt = 0;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cached from resize events: reading innerWidth in the frame loop can force a layout. */
  let viewportWidth = 0;
  let debug = false;
  let lastDebugAt = 0;

  // The door is only there while someone is held, coming in or going out, so
  // it never becomes furniture. `doorChangedAt` drives its fade both ways.
  let doorShown = false;
  let doorChangedAt = 0;
  /** Keeps the shut door up for a beat after the last person through it. */
  let doorCloseHoldUntil = 0;
  /** 0 open, 1 shut. */
  let doorShut = 1;

  let activePointerId: number | null = null;
  /** The press began on the lamp; the click that ends it switches the lamp. */
  let pressedLamp = false;
  let activePersonId: string | null = null;
  let lastPointerClient: Point | null = null;

  onMount(() => {
    const now = performance.now();
    mountedAt = now;
    viewportWidth = window.innerWidth;
    debug = dev && new URLSearchParams(window.location.search).get('pixelDebug') === '1';
    measure();
    scanPage(now);

    // A navigation clears a deliberate "everyone out"; whoever was in the last
    // room walks into this one as themselves.
    roomSession.suppressed = false;
    people = roomSession.people.filter((person) =>
      settleIntoRoom(person, roomSession.lastRoomWidth, room, now)
    );
    spawnReadyAt = now + (people.length > 0 ? 0 : FIRST_SPAWN_WAIT_MS);

    const appShell = document.querySelector('.app-shell') ?? document.body;
    const mutationObserver = new MutationObserver(schedulePageScan);
    mutationObserver.observe(appShell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-pixel-record', 'data-pixel-artist', 'data-pixel-artist-rank']
    });
    const resizeObserver = new ResizeObserver(() => {
      measure();
      requestFrame();
    });
    resizeObserver.observe(host);
    // Nobody needs simulating while the room is scrolled away.
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) {
        lastFrameAt = performance.now();
        requestFrame();
      }
    });
    intersectionObserver.observe(host);

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelDrag();
        return;
      }
      lastFrameAt = performance.now();
      requestFrame();
    };
    const onScroll = () => {
      // The canvas moves with the page; keep a held person under the pointer.
      const person = findActivePerson();
      if (activePointerId !== null && person && lastPointerClient) {
        rebaseDraggedPixelPerson(person, activePointerId, anchorFor(lastPointerClient, person), performance.now());
      }
    };
    const onResize = () => {
      viewportWidth = window.innerWidth;
      requestFrame();
    };
    const offCommand = pixelPersonController.onCommand(onCommand);

    onCommand();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('click', summonClickedArtist);
    requestFrame();

    return () => {
      cancelDrag();
      window.cancelAnimationFrame(animationFrame);
      if (scanTimer) clearTimeout(scanTimer);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      offCommand();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('click', summonClickedArtist);
      // This room's shelf and seats go with it; the next room's
      // settleIntoRoom drops whatever anyone was holding or sitting in.
      roomSession.people = people;
      roomSession.lastRoomWidth = room.width;
      roomSession.lampOn = lamp.on;
    };
  });

  function measure(): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === room.width && height === room.height) return;
    room = layoutRoom(width, height, shelfSide);
    shelf = resizeShelf(shelf, room.shelf.slots.length);
    // A seat that vanished in a resize leaves its sitter standing.
    seats = resizeSeats(seats, room.seats.length);
    for (const person of people) {
      if (person.seated && person.seated.seat >= seats.length) person.seated = null;
    }
    stockShelf(shelf, pageRecords.length > 0 ? pageRecords : roomSession.crate);
  }

  function schedulePageScan(): void {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanPage(performance.now());
      requestFrame();
    }, PAGE_SCAN_DEBOUNCE_MS);
  }

  /**
   * Reads the page's semantic tags — never its layout. `data-pixel-record`
   * stocks the shelf (in page order, which is rank order) and
   * `data-pixel-artist` decides which artist characters might turn up.
   */
  function scanPage(now: number): void {
    const records: RoomRecord[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('[data-pixel-record]')) {
      const imageUrl = element.getAttribute('data-pixel-record');
      if (!imageUrl) continue;
      const artistName = element.getAttribute('data-pixel-artist')?.trim() || undefined;
      records.push({ imageUrl, artistName });
    }
    pageRecords = uniqueRecords(records);
    roomSession.crate = rememberRecords(roomSession.crate, pageRecords);
    // A page without an album wall shelves what earlier pages showed.
    stockShelf(shelf, pageRecords.length > 0 ? pageRecords : roomSession.crate);
    for (const record of roomSession.crate) requestRecordArt(record.imageUrl);

    presences = [];
    for (const element of document.querySelectorAll<HTMLElement>('[data-pixel-artist]')) {
      const presence = parseArtistPresence(
        element.getAttribute('data-pixel-artist'),
        element.getAttribute('data-pixel-artist-rank')
      );
      if (presence) presences.push(presence);
    }
    // The page's data arrives after mount. Once there is something to go on,
    // the first arrival need not keep waiting for it.
    if (people.length === 0 && (presences.length > 0 || pageRecords.length > 0)) {
      spawnReadyAt = Math.min(spawnReadyAt, now + 300);
    }
    if (!artistRerollDone && hasMatchedArtist(presences)) {
      artistRerollDone = true;
      for (const person of people) {
        if (person.pinnedCharacter || person.drag || person.exit) continue;
        if (person.spawnedAt < mountedAt || now - person.spawnedAt > ARTIST_REROLL_WINDOW_MS) continue;
        setPersonDefinition(person, pickCharacter(presences));
      }
    }
  }

  function onCommand(): void {
    const commands = pixelPersonController.drain();
    if (commands.length > 0) applyCommands(commands, performance.now());
  }

  function applyCommands(commands: PixelPersonCommand[], now: number): void {
    for (const command of commands) {
      roomSession.suppressed = false;
      if (command.type === 'summon') {
        roomSession.manualPopulation = Math.min(
          MAX_PIXEL_PEOPLE,
          Math.max(roomSession.manualPopulation, people.length) + 1
        );
        spawnReadyAt = now;
      } else if (people.length < MAX_PIXEL_PEOPLE) {
        roomSession.manualPopulation = Math.min(
          MAX_PIXEL_PEOPLE,
          Math.max(roomSession.manualPopulation, people.length + 1)
        );
        // Named characters are pinned: no re-roll will swap them out.
        people.push(createResident(resolveCharacter(command.characterId), now, true));
      }
    }
    requestFrame();
  }

  /** A new resident, coming in through the door to settle in. */
  function createResident(
    definition: CharacterDefinition,
    now: number,
    pinned = false
  ): PixelPersonRuntime {
    const person = createPixelPerson(
      definition,
      0,
      room,
      now,
      `pixel-person-${roomSession.nextPersonId++}`,
      pinned,
      MUSIC.firstDelayMs
    );
    enterThroughDoor(person, room, nextArrivalStart(people, now));
    return person;
  }

  /**
   * Matches the head count to what the room wants, one arrival per frame.
   * Returns how many people the room wants.
   */
  function syncPopulation(now: number): number {
    const desired = desiredPopulation(
      viewportWidth,
      roomSession.manualPopulation,
      roomSession.suppressed
    );
    if (people.length > desired) {
      for (const person of people.slice(desired)) {
        if (person.id === activePersonId) cancelDrag();
        releaseFurniture({ shelf, seats, player }, person.id);
      }
      people = people.slice(0, desired);
    } else if (people.length < desired && now >= spawnReadyAt && room.width > 0) {
      people.push(createResident(pickCharacter(presences), now));
    }
    return desired;
  }

  function requestFrame(): void {
    if (!animationFrame && visible && !document.hidden) {
      animationFrame = window.requestAnimationFrame(frame);
    }
  }

  function frame(now: number): void {
    animationFrame = 0;
    if (!visible || document.hidden || room.width === 0) return;
    const elapsedSeconds = lastFrameAt > 0 ? (now - lastFrameAt) / 1000 : 0;
    lastFrameAt = now;

    const wanted = syncPopulation(now);
    const world: RoomWorld = {
      room,
      shelf,
      seats,
      player,
      lamp,
      people,
      // Pockets only offer records whose art is ready, so nothing is pulled
      // out invisible. A getter, because only choosing a plan reads it.
      get crate() {
        return roomSession.crate.filter((record) => getRecordArt(record.imageUrl)?.status === 'ready');
      },
      random: Math.random
    };
    let left = 0;
    people = people.filter((person) => {
      const stays = stepPixelPerson(person, world, elapsedSeconds, now);
      if (!stays) left += 1;
      return stays;
    });
    for (const person of people) {
      if (!person.carrying) continue;
      // Touching the cache pins the art against LRU eviction; art that failed
      // to load goes back where it came from.
      if (requestRecordArt(person.carrying.record.imageUrl).status === 'failed') {
        releaseShelf(shelf, person.id);
        person.carrying = null;
      }
    }
    if (left > 0) {
      // Lower the population to match, or the next frame refills it and the
      // exit looks like it failed. Nobody left at all means "on purpose".
      roomSession.manualPopulation = people.length;
      if (people.length === 0) roomSession.suppressed = true;
    }
    updateDoor(now);

    renderRoom(canvas, {
      room,
      shelf,
      people,
      now,
      doorOpacity: doorwayOpacity(doorShown, doorChangedAt, now),
      doorShut,
      lamp,
      player,
      debug
    });
    // Dev builds always expose state for runtime checks; outlines need ?pixelDebug=1.
    if (dev) updateDebugAttributes(now);

    const doorFading = now - doorChangedAt < DOORWAY.fadeMs;
    if (people.length > 0 || wanted > 0 || doorShown || doorFading) requestFrame();
  }

  /**
   * The only place the door's state is written. Anyone coming or going says
   * how open they need it and the most open wins, so a leaver and an arrival
   * can share it. Someone held over the room gets an open doorway, offered as
   * somewhere to drop them.
   */
  function updateDoor(now: number): void {
    let open: number | null = null;
    for (const person of people) {
      const need = doorOpenness(person, now);
      if (need !== null) open = Math.max(open ?? 0, need);
    }
    // After the last one through, the shut door stays up for a beat. A drag
    // that ends anywhere else lets it fade straight away.
    if (open !== null) doorCloseHoldUntil = now + DOORWAY.holdAfterShutMs;
    if (activePointerId !== null) open = 1;
    if (open !== null) {
      setDoorShown(true, now);
      doorShut = 1 - open;
    } else if (doorShown && now >= doorCloseHoldUntil) {
      setDoorShown(false, now);
    }
  }

  function setDoorShown(shown: boolean, now: number): void {
    if (doorShown === shown) return;
    doorShown = shown;
    doorChangedAt = now;
  }

  function toLocal(client: Point): Point {
    const box = canvas.getBoundingClientRect();
    return { x: client.x - box.left, y: client.y - box.top };
  }

  /**
   * Where the hand is, kept inside the room: the canvas is the room, so a
   * person carried past its edge would simply be cut off.
   */
  function anchorFor(client: Point, person: PixelPersonRuntime): Point {
    const local = toLocal(client);
    return {
      x: clamp(local.x, 4, room.width - 4),
      y: clamp(local.y, 2, Math.max(2, room.floorY - person.body.height))
    };
  }

  function findActivePerson(): PixelPersonRuntime | null {
    return activePersonId ? (people.find((person) => person.id === activePersonId) ?? null) : null;
  }

  /** The topmost person under the point: the last drawn wins. */
  function personAt(local: Point, now: number): PixelPersonRuntime | undefined {
    for (let index = people.length - 1; index >= 0; index -= 1) {
      if (isPointOnPixelPerson(people[index], local, now)) return people[index];
    }
    return undefined;
  }

  /**
   * What is under a room point, people first: they stand in front of the lamp,
   * so a press on someone is a grab, not a switch.
   */
  function targetAt(
    local: Point,
    now: number
  ): { kind: 'person'; person: PixelPersonRuntime } | { kind: 'lamp' } | null {
    const person = personAt(local, now);
    if (person) return { kind: 'person', person };
    return isOnLamp(room, local) ? { kind: 'lamp' } : null;
  }

  function onPointerDown(event: PointerEvent): void {
    if (activePointerId !== null || !event.isPrimary || event.button !== 0) return;
    const now = performance.now();
    const client = { x: event.clientX, y: event.clientY };
    const found = targetAt(toLocal(client), now);
    // The lamp answers any pointer, taps included; the switch happens on click.
    pressedLamp = found?.kind === 'lamp';
    // Touch stays a scroll gesture; picking people up is a mouse and pen thing.
    if (found?.kind !== 'person') return;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const target = found.person;
    event.preventDefault();
    activePointerId = event.pointerId;
    activePersonId = target.id;
    lastPointerClient = client;
    beginPixelPersonDrag(target, { shelf, seats, player }, event.pointerId, anchorFor(client, target), now);
    canvas.style.cursor = 'grabbing';
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; the window keeps delivering moves without it.
    }
    requestFrame();
  }

  function onPointerMove(event: PointerEvent): void {
    const now = performance.now();
    if (activePointerId === null) {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        const found = targetAt(toLocal({ x: event.clientX, y: event.clientY }), now);
        canvas.style.cursor = found?.kind === 'person' ? 'grab' : found ? 'pointer' : '';
      }
      return;
    }
    if (event.pointerId !== activePointerId) return;
    const person = findActivePerson();
    if (!person) {
      cancelDrag();
      return;
    }
    lastPointerClient = { x: event.clientX, y: event.clientY };
    moveDraggedPixelPerson(person, event.pointerId, anchorFor(lastPointerClient, person), now);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    const person = findActivePerson();
    if (person) {
      const client = { x: event.clientX, y: event.clientY };
      moveDraggedPixelPerson(person, event.pointerId, anchorFor(client, person), performance.now());
    }
    finishDrag(performance.now(), true);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId === activePointerId) finishDrag(performance.now(), false);
  }

  /**
   * A click (or tap) switches the lamp only when the press began on it, so
   * dropping someone near the lamp after a drag never flicks it.
   */
  function onClick(): void {
    if (!pressedLamp) return;
    pressedLamp = false;
    setLamp(lamp, !lamp.on, performance.now());
    requestFrame();
  }

  function cancelDrag(): void {
    finishDrag(performance.now(), false);
  }

  function finishDrag(now: number, allowDoorway: boolean): void {
    const pointerId = activePointerId;
    if (pointerId === null) return;
    const person = findActivePerson();
    if (person) {
      const droppedOn = {
        x: person.body.x + person.body.width / 2,
        y: person.body.y + person.body.height / 2
      };
      releasePixelPersonDrag(person, room, pointerId, now);
      // Dropped on the door: set down beside it, walk in, door shuts.
      if (allowDoorway && isOverDoorway(droppedOn, room)) beginDoorwayExit(person, room, now);
    }
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      // Already released by the browser.
    }
    activePointerId = null;
    activePersonId = null;
    lastPointerClient = null;
    canvas.style.cursor = '';
    requestFrame();
  }

  /**
   * Easter egg: clicking an artist the sprite library knows brings them into
   * the room. Reads the same `data-pixel-artist` tags as the page scan, so any
   * list that opts in gets this for free. Never hijacks a real control.
   */
  function summonClickedArtist(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('a, button, input, select, textarea, label')) return;
    const row = target.closest('[data-pixel-artist]');
    if (!row) return;
    const character = artistCharacterFor(row.getAttribute('data-pixel-artist') ?? '');
    if (character) pixelPersonController.spawn(character.id);
  }

  function updateDebugAttributes(now: number): void {
    if (now - lastDebugAt < 100) return;
    lastDebugAt = now;
    canvas.dataset.pixelPersonCount = String(people.length);
    canvas.dataset.pixelPeople = JSON.stringify(
      people.map((person) => ({
        id: person.id,
        character: person.definition.id,
        pinned: person.pinnedCharacter,
        x: Number(person.body.x.toFixed(1)),
        y: Number(person.body.y.toFixed(1)),
        grounded: person.body.grounded,
        activity: person.plan?.activity ?? null,
        beat: currentBeat(person)?.kind ?? null,
        animation: person.animation,
        carrying: person.carrying ? person.carrying.source : null,
        seated: person.seated?.seat ?? null,
        exit: person.exit?.phase ?? null
      }))
    );
    canvas.dataset.pixelShelf = JSON.stringify(
      shelf.map((slot) => (slot.record ? (slot.out ? 'out' : slot.reservedBy ? 'reserved' : 'on') : 'empty'))
    );
    canvas.dataset.pixelCrate = String(roomSession.crate.length);
    canvas.dataset.pixelLamp = lamp.on ? 'on' : 'off';
    canvas.dataset.pixelPlayer = player.record ? `playing:${player.owner}` : 'idle';
    canvas.dataset.pixelSeats = JSON.stringify(seats.map((seat) => seat.occupant ?? seat.reservedBy ?? null));
  }
</script>

<canvas
  bind:this={canvas}
  class="pixel-room-stage"
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointercancel={onPointerCancel}
  on:click={onClick}
  on:lostpointercapture={onPointerCancel}
  on:pointerleave={() => {
    if (activePointerId === null) canvas.style.cursor = '';
  }}
></canvas>

<style>
  .pixel-room-stage {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
</style>
