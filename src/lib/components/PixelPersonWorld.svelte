<script lang="ts">
  import { dev } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import {
    artistCharacterFor,
    hasMatchedArtist,
    pickCharacter,
    resolveCharacter
  } from '$lib/pixel-person/artists';
  import {
    ambientPixelPersonPopulation,
    shouldEnablePixelPerson
  } from '$lib/pixel-person/availability';
  import { pixelPersonController } from '$lib/pixel-person/controller';
  import {
    clientToDocument,
    collectWorldGeometry,
    findSafeSpawn
  } from '$lib/pixel-person/geometry';
  import { expandedRect, intersects, SpatialHash } from '$lib/pixel-person/physics';
  import { getRecordArt, requestRecordArt } from '$lib/pixel-person/record-art';
  import {
    fadeStartAt,
    isPointOnPixelPerson,
    PLACED_RECORD_FADE_MS,
    placedRecordHitTest,
    renderPixelWorld,
    sizeCanvas
  } from '$lib/pixel-person/render';
  import {
    beginPixelPersonDrag,
    cancelRecordErrand,
    createPixelPerson,
    dropCarriedRecord,
    moveDraggedPixelPerson,
    rebaseDraggedPixelPerson,
    releasePixelPersonDrag,
    setPersonDefinition,
    stepPixelPerson,
    STUCK_RECOVERY_MS,
    type PixelPersonRuntime
  } from '$lib/pixel-person/simulation';
  import type {
    CharacterDefinition,
    DroppedRecord,
    PixelPersonCommand,
    PixelWorldEvent,
    PhysicsBody,
    PlacedRecord,
    Point,
    WorldGeometry
  } from '$lib/pixel-person/types';

  const EMPTY_GEOMETRY: WorldGeometry = {
    colliders: [],
    occluders: [],
    itemSources: [],
    artistPresences: [],
    scanBounds: { x: 0, y: 0, width: 0, height: 0 },
    viewportBounds: { x: 0, y: 0, width: 0, height: 0 }
  };
  const MAX_PIXEL_PEOPLE = 6;
  const MAX_PLACED_RECORDS = 12;
  const CLICK_SUPPRESS_MS = 450;
  const CLICK_SUPPRESS_RADIUS_PX = 8;

  let canvas: HTMLCanvasElement;
  let mounted = false;
  let root: HTMLElement | null = null;
  let geometry = EMPTY_GEOMETRY;
  let spatial = new SpatialHash([]);
  let people: PixelPersonRuntime[] = [];
  let nextPersonId = 1;
  let animationFrame = 0;
  let lastFrameAt = 0;
  let lastScanAt = 0;
  let lastScanScrollX = 0;
  let lastScanScrollY = 0;
  let readyAt = 0;
  let geometryDirty = true;
  // The first geometry scan runs before async artist elements (cover tiles, ranking
  // rows) exist, so the initial character is picked from an empty pool. Re-roll once
  // when the rail first has a registered artist in it; after that the character is
  // stable for the page view.
  let artistRerollDone = false;
  let forceRespawn = true;
  let ambientSuppressed = false;
  let enabled = false;
  let manualPopulation = 0;
  let debug = false;
  let reducedMotion: MediaQueryList;
  let lastDebugUpdateAt = 0;
  let lastScanDurationMs = 0;
  let activePointerId: number | null = null;
  let activePersonId: string | null = null;
  let lastPointerClient: Point | null = null;
  let suppressedClick: { until: number; point: Point } | null = null;
  let placedRecords: PlacedRecord[] = [];
  let nextRecordEntityId = 1;
  const simulationEvents: PixelWorldEvent[] = [];

  afterNavigate(() => {
    if (!mounted) return;
    finishPointerDrag(performance.now(), false);
    ambientSuppressed = false;
    forceRespawn = true;
    geometryDirty = true;
    artistRerollDone = false;
    placedRecords = [];
    readyAt = performance.now() + 300;
    refreshAvailability();
  });

  onMount(() => {
    mounted = true;
    root = document.querySelector<HTMLElement>('.app-shell');
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    debug = dev && new URLSearchParams(window.location.search).get('pixelDebug') === '1';
    readyAt = performance.now() + 450;
    refreshAvailability();
    sizeCanvas(canvas);

    const mutationObserver = root
      ? new MutationObserver(() => {
          geometryDirty = true;
        })
      : null;
    mutationObserver?.observe(root!, {
      childList: true,
      subtree: true,
      characterData: true,
      // Attribute-only changes (class/style flips) reflow content without
      // touching the node structure; geometry must rescan for those too.
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden']
    });

    const resizeObserver = root
      ? new ResizeObserver(() => {
          geometryDirty = true;
        })
      : null;
    if (root) resizeObserver?.observe(root);

    const onResize = () => {
      geometryDirty = true;
      refreshAvailability();
      sizeCanvas(canvas);
    };
    const onScroll = () => {
      const activePerson = findActivePerson();
      if (activePointerId !== null && activePerson && lastPointerClient) {
        rebaseDraggedPixelPerson(
          activePerson,
          activePointerId,
          clientToDocument(lastPointerClient),
          performance.now()
        );
      }
      if (
        Math.abs(window.scrollX - lastScanScrollX) >= 160 ||
        Math.abs(window.scrollY - lastScanScrollY) >= 160
      ) {
        geometryDirty = true;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        finishPointerDrag(performance.now(), false);
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else if (enabled) {
        lastFrameAt = performance.now();
        requestNextFrame();
      }
    };
    const onMotionPreference = () => refreshAvailability();
    const onControllerCommand = () => {
      applyLifecycleCommands(pixelPersonController.drain(), performance.now());
      requestNextFrame();
    };

    pixelPersonController.setWakeListener(onControllerCommand);
    onControllerCommand();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', onPointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: false });
    window.addEventListener('pointerout', onPointerOut, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion.addEventListener('change', onMotionPreference);
    requestNextFrame();

    return () => {
      mounted = false;
      pixelPersonController.setWakeListener(null);
      window.cancelAnimationFrame(animationFrame);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      finishPointerDrag(performance.now(), false);
      clearCursors();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('pointerout', onPointerOut, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion.removeEventListener('change', onMotionPreference);
    };
  });

  function refreshAvailability(): void {
    const nextEnabled = shouldEnablePixelPerson(
      window.location.pathname,
      window.innerWidth,
      reducedMotion.matches,
      base,
      manualPopulation > 0
    );
    canvas.hidden = !nextEnabled;
    if (nextEnabled === enabled) return;
    enabled = nextEnabled;
    if (!enabled) {
      finishPointerDrag(performance.now(), false);
      clearCursors();
      people = [];
      placedRecords = [];
      activePersonId = null;
      geometry = EMPTY_GEOMETRY;
      spatial = new SpatialHash([]);
      clearCanvas();
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      return;
    }
    forceRespawn = true;
    geometryDirty = true;
    lastFrameAt = performance.now();
    requestNextFrame();
  }

  function frame(now: number): void {
    animationFrame = 0;
    if (!mounted || !enabled || document.hidden) return;

    if (geometryDirty && now >= readyAt && now - lastScanAt >= 100) scanGeometry(now);
    const elapsedSeconds = lastFrameAt > 0 ? (now - lastFrameAt) / 1000 : 0;
    lastFrameAt = now;

    if (people.length > 0 && geometry.colliders.length > 0) {
      let survivors = 0;
      for (let index = 0; index < people.length; index += 1) {
        const stepped = stepPixelPerson(
          people[index],
          geometry,
          spatial,
          elapsedSeconds,
          now,
          simulationEvents
        );
        if (!stepped) continue;
        // A person flung below everything free-falls forever on a quiet page
        // (the outside-world respawn only runs on geometry rescans, which
        // nothing triggers) — catch the fall here every frame instead.
        const fellOutOfWorld =
          stepped.body.y > geometry.scanBounds.y + geometry.scanBounds.height + 120;
        if (stepped.stuckForMs >= STUCK_RECOVERY_MS || fellOutOfWorld) {
          const dropped = dropCarriedRecord(stepped);
          if (!fellOutOfWorld) placeRecord(dropped, now);
          people[survivors++] = createPersonAtSafeSpawn(
            now,
            index,
            stepped.id,
            pinnedDefinition(stepped)
          );
        } else {
          people[survivors++] = stepped;
        }
      }
      people.length = survivors;
    }
    if (activePointerId !== null && !findActivePerson()?.drag) finishPointerDrag(now, false);

    syncRecordState(now);
    renderPixelWorld(canvas, people, geometry, now, debug, placedRecords);
    updateDebugAttributes(now);
    requestNextFrame();
  }

  function syncRecordState(now: number): void {
    for (const person of people) {
      if (person.recordErrand) {
        // Kick off the artwork fetch the moment an errand is planned, so the
        // sprite is ready long before the person reaches the tile.
        const art = requestRecordArt(person.recordErrand.imageUrl);
        if (art.status === 'failed') cancelRecordErrand(person, now);
      }
      if (person.carrying) {
        // Touching the cache every frame pins live art against LRU eviction
        // (and self-heals by re-fetching if it was somehow dropped).
        const art = requestRecordArt(person.carrying.imageUrl);
        if (art.status === 'failed') dropCarriedRecord(person);
      }
    }
    for (const record of placedRecords) {
      requestRecordArt(record.imageUrl);
    }
    if (simulationEvents.length > 0) {
      for (const event of simulationEvents) {
        if (event.type === 'record-dropped') placeRecord(event.record, now);
      }
      simulationEvents.length = 0;
    }
    if (placedRecords.length > 0) {
      placedRecords = placedRecords.filter(
        (record) => now < fadeStartAt(record) + PLACED_RECORD_FADE_MS
      );
    }
  }

  function placeRecord(record: DroppedRecord | null, now: number): void {
    if (!record || getRecordArt(record.imageUrl)?.status !== 'ready') return;
    if (placedRecords.length >= MAX_PLACED_RECORDS) placedRecords.shift();
    placedRecords.push({
      id: nextRecordEntityId++,
      imageUrl: record.imageUrl,
      position: record.position,
      placedAt: now
    });
  }

  function scanGeometry(now: number): void {
    if (!root) return;
    const scanStartedAt = performance.now();
    geometry = collectWorldGeometry(root);
    lastScanDurationMs = performance.now() - scanStartedAt;
    spatial = new SpatialHash(geometry.colliders);
    geometryDirty = false;
    lastScanAt = now;
    lastScanScrollX = window.scrollX;
    lastScanScrollY = window.scrollY;

    const visibleWorld = expandedRect(geometry.viewportBounds, 60);
    const desiredPopulation = ambientSuppressed
      ? 0
      : Math.min(
          MAX_PIXEL_PEOPLE,
          Math.max(ambientPixelPersonPopulation(window.innerWidth), manualPopulation)
        );
    people = people.slice(0, desiredPopulation).map((person, index) => {
      if (person.activity === 'drag') return person;
      const outsideVisibleWorld = !intersects(person.body, visibleWorld);
      const embeddedInGeometry =
        person.activity !== 'hiding' &&
        spatial
          .query(person.body)
          .some(
            (collider) => collider.kind !== 'ladder' && intersects(person.body, collider)
          );
      // A pinned character was asked for by name, so a blanket reshuffle leaves
      // them where they are. Genuine recovery (fallen out of the world, stuck
      // inside geometry) still applies — it just brings the same person back.
      if (person.pinnedCharacter && !outsideVisibleWorld && !embeddedInGeometry) return person;
      if (forceRespawn || outsideVisibleWorld || embeddedInGeometry) {
        placeRecord(dropCarriedRecord(person), now);
        return createPersonAtSafeSpawn(now, index, undefined, pinnedDefinition(person));
      }
      return person;
    });
    while (people.length < desiredPopulation) {
      people.push(createPersonAtSafeSpawn(now, people.length));
    }
    if (!artistRerollDone && hasMatchedArtist(geometry.artistPresences)) {
      artistRerollDone = true;
      for (const person of people) {
        if (person.activity === 'drag' || person.pinnedCharacter) continue;
        setPersonDefinition(person, pickCharacter(geometry.artistPresences));
      }
    }
    forceRespawn = false;
  }

  /** The character to rebuild a person as, or undefined to roll a fresh one. */
  function pinnedDefinition(person: PixelPersonRuntime): CharacterDefinition | undefined {
    return person.pinnedCharacter ? person.definition : undefined;
  }

  function createPersonAtSafeSpawn(
    now: number,
    slot: number,
    id = `pixel-person-${nextPersonId++}`,
    keep?: CharacterDefinition
  ): PixelPersonRuntime {
    const definition = keep ?? pickCharacter(geometry.artistPresences);
    return createPixelPerson(
      definition,
      findSafeSpawn(geometry, definition, slot),
      now,
      id,
      Boolean(keep)
    );
  }

  function applyLifecycleCommands(commands: PixelPersonCommand[], now: number): void {
    for (const command of commands) {
      if (command.type === 'summon') {
        manualPopulation = Math.min(
          MAX_PIXEL_PEOPLE,
          Math.max(manualPopulation, people.length) + 1
        );
        ambientSuppressed = false;
        geometryDirty = true;
        readyAt = now;
        refreshAvailability();
      } else if (command.type === 'spawn') {
        if (people.length >= MAX_PIXEL_PEOPLE) continue;
        const definition = resolveCharacter(command.characterId);
        ambientSuppressed = false;
        // Raise the cap and switch the world on BEFORE pushing. A spawn is as
        // explicit a request as the summon button, so it wakes a world the
        // viewport gate had switched off.
        manualPopulation = Math.min(
          MAX_PIXEL_PEOPLE,
          Math.max(manualPopulation, people.length + 1)
        );
        refreshAvailability();
        // Reduced motion and unsupported routes stay off; nothing to spawn into.
        if (!enabled) continue;
        // Land them on a real surface near the click. With no geometry yet
        // (the world was off until a moment ago) fall back to the raw point and
        // let the next scan recover them — pinned, so they come back as
        // themselves.
        const body: PhysicsBody =
          geometry.colliders.length > 0
            ? findSafeSpawn(geometry, definition, 0, command.position)
            : {
                x: command.position.x,
                y: command.position.y,
                width: definition.body.width,
                height: definition.body.height,
                vx: 0,
                vy: 0,
                grounded: false,
                supportId: null
              };
        people.push(
          createPixelPerson(
            definition,
            body,
            now,
            `pixel-person-${nextPersonId++}`,
            // Named characters are pinned; an anonymous spawn stays ambient.
            Boolean(command.characterId)
          )
        );
      }
    }
  }

  function requestNextFrame(): void {
    if (!animationFrame && mounted && enabled && !document.hidden) {
      animationFrame = window.requestAnimationFrame(frame);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!enabled || activePointerId !== null || !event.isPrimary || event.button !== 0) {
      return;
    }
    const clientPoint = { x: event.clientX, y: event.clientY };
    const now = performance.now();

    // Placed records dismiss on click/tap (any pointer type): the dismissal
    // timestamp hands them to the existing fade-out.
    const clickedRecord =
      placedRecords.length > 0
        ? placedRecordHitTest(placedRecords, clientToDocument(clientPoint), now)
        : null;
    if (clickedRecord) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clickedRecord.dismissedAt = now;
      suppressNextClick(now, clientPoint);
      requestNextFrame();
      return;
    }

    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const target = [...people]
      .reverse()
      .find((person) => isPointOnPixelPerson(person, clientPoint, geometry, now));
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    activePointerId = event.pointerId;
    activePersonId = target.id;
    lastPointerClient = clientPoint;
    placeRecord(dropCarriedRecord(target), now);
    beginPixelPersonDrag(target, event.pointerId, clientToDocument(clientPoint), now);
    setPointerCursor(false, true);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Window-level listeners still keep the drag alive when capture is unavailable.
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (activePointerId === null) {
      if (!enabled) {
        clearCursors();
        return;
      }
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        const point = { x: event.clientX, y: event.clientY };
        const now = performance.now();
        const grabbable =
          people.length > 0 &&
          people.some((person) => isPointOnPixelPerson(person, point, geometry, now));
        setPointerCursor(grabbable, false);
        setCursorClass(
          'pixel-record-clickable',
          !grabbable &&
            placedRecords.length > 0 &&
            placedRecordHitTest(placedRecords, clientToDocument(point), now) !== null
        );
      }
      return;
    }
    if (event.pointerId !== activePointerId) return;
    const activePerson = findActivePerson();
    if (!activePerson) {
      finishPointerDrag(performance.now(), false);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    lastPointerClient = { x: event.clientX, y: event.clientY };
    moveDraggedPixelPerson(
      activePerson,
      event.pointerId,
      clientToDocument(lastPointerClient),
      performance.now()
    );
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const finalClient = { x: event.clientX, y: event.clientY };
    const activePerson = findActivePerson();
    if (
      activePerson &&
      (!lastPointerClient ||
        Math.hypot(
          finalClient.x - lastPointerClient.x,
          finalClient.y - lastPointerClient.y
        ) > 0.25)
    ) {
      moveDraggedPixelPerson(
        activePerson,
        event.pointerId,
        clientToDocument(finalClient),
        performance.now()
      );
    }
    lastPointerClient = finalClient;
    finishPointerDrag(performance.now(), true, finalClient);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finishPointerDrag(performance.now(), false);
  }

  function onPointerOut(event: PointerEvent): void {
    if (event.relatedTarget !== null) return;
    if (activePointerId !== null) finishPointerDrag(performance.now(), false);
    else clearCursors();
  }

  function onClick(event: MouseEvent): void {
    if (suppressedClick) {
      const closeToRelease =
        Math.hypot(
          event.clientX - suppressedClick.point.x,
          event.clientY - suppressedClick.point.y
        ) <= CLICK_SUPPRESS_RADIUS_PX;
      const suppress = performance.now() <= suppressedClick.until && closeToRelease;
      suppressedClick = null;
      // The click that ended a drag is not a click on what lies underneath.
      if (suppress) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    summonClickedArtist(event);
  }

  /**
   * Easter egg: clicking an artist the sprite library knows summons them.
   *
   * Reads the same `data-pixel-artist` rail the geometry scan uses, so any list
   * that opts into the rail gets this for free and no presentation component
   * needs to know the pixel world exists. Deliberately mouse-only — the rows
   * are data, not controls, and making every artist row focusable to advertise
   * a joke would be a worse page.
   */
  function summonClickedArtist(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    // Never hijack a real control: cover tiles carrying the rail can be links.
    if (target.closest('a, button, input, select, textarea, label')) return;
    const row = target.closest('[data-pixel-artist]');
    if (!row) return;
    const character = artistCharacterFor(row.getAttribute('data-pixel-artist') ?? '');
    if (!character) return;
    pixelPersonController.spawnAt(
      clientToDocument({ x: event.clientX, y: event.clientY }),
      character.id
    );
  }

  function onWindowBlur(): void {
    finishPointerDrag(performance.now(), false);
    clearCursors();
  }

  function finishPointerDrag(now: number, suppressReleaseClick: boolean, point?: Point): void {
    const pointerId = activePointerId;
    if (pointerId === null) return;
    const activePerson = findActivePerson();
    if (activePerson) {
      releasePixelPersonDrag(activePerson, pointerId, spatial, now, {
        x: window.scrollX + 2,
        y: window.scrollY + 2,
        width: Math.max(0, window.innerWidth - 4),
        height: Math.max(0, window.innerHeight - 4)
      });
    }
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      // The browser may have already discarded capture after cancellation.
    }
    activePointerId = null;
    activePersonId = null;
    lastPointerClient = null;
    clearCursors();
    if (suppressReleaseClick && point) {
      suppressNextClick(now, point);
    }
  }

  function findActivePerson(): PixelPersonRuntime | null {
    return activePersonId
      ? (people.find((person) => person.id === activePersonId) ?? null)
      : null;
  }

  function setCursorClass(name: string, on: boolean): void {
    document.documentElement.classList.toggle(name, on);
  }

  function setPointerCursor(grabbable: boolean, dragging: boolean): void {
    setCursorClass('pixel-person-grabbable', grabbable);
    setCursorClass('pixel-person-dragging', dragging);
  }

  function clearCursors(): void {
    setPointerCursor(false, false);
    setCursorClass('pixel-record-clickable', false);
  }

  function suppressNextClick(now: number, point: Point): void {
    suppressedClick = { until: now + CLICK_SUPPRESS_MS, point: { ...point } };
  }

  function clearCanvas(): void {
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function updateDebugAttributes(now: number): void {
    const debugPerson = findActivePerson() ?? people[0] ?? null;
    if (!dev || (!debugPerson?.drag && now - lastDebugUpdateAt < 100)) return;
    lastDebugUpdateAt = now;
    canvas.dataset.pixelPersonCount = String(people.length);
    canvas.dataset.pixelPeopleAt = now.toFixed(1);
    canvas.dataset.pixelPeople = JSON.stringify(
      people.map((person) => ({
        id: person.id,
        character: person.definition.id,
        pinned: person.pinnedCharacter,
        x: Number(person.body.x.toFixed(1)),
        y: Number(person.body.y.toFixed(1)),
        vx: Number(person.body.vx.toFixed(1)),
        activity: person.activity,
        animation: person.animation,
        crawling: person.crawling,
        bodyHeight: person.body.height,
        grounded: person.body.grounded,
        supportId: person.body.supportId,
        stuckForMs: Math.round(person.stuckForMs),
        climbWallId: person.climb?.wall.id ?? null,
        errand: person.recordErrand?.sourceId ?? null,
        carrying: person.carrying?.sourceId ?? null
      }))
    );
    canvas.dataset.pixelPersonState = debugPerson?.animation ?? 'absent';
    canvas.dataset.pixelPersonActivity = debugPerson?.activity ?? 'absent';
    canvas.dataset.pixelPersonGrounded = String(debugPerson?.body.grounded ?? false);
    canvas.dataset.pixelColliderCount = String(geometry.colliders.length);
    canvas.dataset.pixelOccluderCount = String(geometry.occluders.length);
    canvas.dataset.pixelItemSourceCount = String(geometry.itemSources.length);
    canvas.dataset.pixelPlacedRecords = String(placedRecords.length);
    canvas.dataset.pixelPersonX = debugPerson?.body.x.toFixed(1) ?? '';
    canvas.dataset.pixelPersonY = debugPerson?.body.y.toFixed(1) ?? '';
    canvas.dataset.pixelPersonSupport = debugPerson?.body.supportId ?? '';
    canvas.dataset.pixelScanMs = lastScanDurationMs.toFixed(1);
    canvas.dataset.pixelPersonDragging = String(Boolean(debugPerson?.drag));
    canvas.dataset.pixelPersonAngle = debugPerson?.drag?.angle.toFixed(3) ?? '';
    canvas.dataset.pixelPointerSpeed = debugPerson?.drag
      ? Math.hypot(
          debugPerson.drag.pointerVelocity.x,
          debugPerson.drag.pointerVelocity.y
        ).toFixed(1)
      : '';
  }

</script>

<canvas
  bind:this={canvas}
  class="pixel-person-world"
  class:is-disabled={!enabled}
  data-pixel-world
  data-pixel-collision="ignore"
  aria-hidden="true"
></canvas>

<style>
  .pixel-person-world {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: block;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    pointer-events: none;
    image-rendering: pixelated;
    contain: strict;
  }

  .pixel-person-world.is-disabled {
    display: none;
  }

  :global(html.pixel-person-grabbable),
  :global(html.pixel-person-grabbable *) {
    cursor: grab !important;
  }

  :global(html.pixel-person-dragging),
  :global(html.pixel-person-dragging *) {
    cursor: grabbing !important;
  }

  :global(html.pixel-record-clickable),
  :global(html.pixel-record-clickable *) {
    cursor: pointer !important;
  }
</style>
