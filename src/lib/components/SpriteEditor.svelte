<script lang="ts">
  import { onMount } from 'svelte';
  import { artistRegistry } from '$lib/pixel-person/artists';
  import { characterRegistry, promenadePerson } from '$lib/pixel-person/characters';
  import { rasterizeFrame, themeOutline } from '$lib/pixel-person/render';
  import { applyTheme, themes, type Theme } from '$lib/theme';
  import type { AnimationName, CharacterDefinition, SpriteFrame } from '$lib/pixel-person/types';

  // Big enough to count individual pixels while authoring.
  const paletteKeys = ['o', 'g', 'h', 'f', 's', 't', 'p', 'b', 'n', 'a'] as const;

  // Artist characters live outside characterRegistry so they never spawn
  // unprompted, but authoring their palette preview needs the same list.
  const characters: CharacterDefinition[] = [
    ...Object.values(characterRegistry),
    ...artistRegistry.map((entry) => entry.character)
  ];

  const animationNames = Object.keys(promenadePerson.animations) as AnimationName[];

  /**
   * Reverse of a character's frame map: source identifier -> every `anim:index`
   * that writes to it. `idleB` maps from both `idle:1` and `hide:1`, which is
   * exactly the surprise this UI has to surface.
   */
  function usageOf(character: CharacterDefinition): Map<string, string[]> {
    const usage = new Map<string, string[]>();
    for (const [key, source] of Object.entries(character.frameSource.names)) {
      const list = usage.get(source) ?? [];
      list.push(key);
      usage.set(source, list);
    }
    return usage;
  }

  /** Survives the HMR remount a save triggers, so the editor stays where it was. */
  const SELECTION_KEY = 'sprite-editor-selection';

  let mounted = false;
  let outline = '#111';

  let characterId = promenadePerson.id;
  let animationName: AnimationName = 'idle';
  let frameIndex = 0;
  let selectedKey: string = 's';
  let onionSkin = false;

  let grid: string[][] = [];
  let savedRows: string[] = [];
  let isPointerDown = false;

  let saving = false;
  let saveMessage: { kind: 'ok' | 'error'; text: string } | null = null;

  function setTheme(value: Theme): void {
    applyTheme(value);
    outline = themeOutline();
  }

  $: character = characters.find((entry) => entry.id === characterId) ?? promenadePerson;
  $: frameWidth = character.pixelWidth;
  $: frameHeight = character.pixelHeight;
  // Keep the high-density sources on one reasonably-sized authoring canvas.
  $: cellPx = Math.max(
    6,
    Math.min(14, Math.floor(480 / frameWidth), Math.floor(640 / frameHeight))
  );
  $: sourceEditable = character.frameSource.editable !== false;
  // Read the frames off the SELECTED character, not the base rig. Characters
  // that fork their frames (artists) have entirely different pixels here.
  $: frames = framesFor(character, animationName);
  $: frameKey = `${animationName}:${frameIndex}`;
  $: sourceFile = character.frameSource.file;
  $: sourceName = character.frameSource.names[frameKey];
  $: sharedWith = sourceName
    ? (usageOf(character).get(sourceName) ?? []).filter((key) => key !== frameKey)
    : [];
  $: currentRows = grid.map((row) => row.join(''));
  $: isDirty = savedRows.length > 0 && currentRows.some((row, index) => row !== savedRows[index]);
  $: currentFrame = { rows: currentRows } satisfies SpriteFrame;
  $: otherFrameIndex = frames.length > 1 ? (frameIndex === 0 ? 1 : 0) : -1;
  $: onionFrame = onionSkin && otherFrameIndex >= 0 ? frames[otherFrameIndex] : null;

  // Declared reactively, not as a plain function: the template calls
  // `resolveColor(cell)`, whose only tracked dependency is `cell`. As a plain
  // function closing over `character`, switching character left every cell
  // painted in the previous palette.
  $: resolveColor = ((palette: Record<string, string>, outlineColor: string) =>
    (key: string): string => {
      if (key === '.') return 'transparent';
      const raw = palette[key];
      if (!raw) return 'transparent';
      return raw === '$outline' ? outlineColor : raw;
    })(character.palette, outline);

  /**
   * Every caller passes the frames it just selected. That is the whole point:
   * `frames` is a `$:` value, so a handler that assigns `characterId` and then
   * reads `frames` in the same tick gets the PREVIOUS character's pixels — the
   * palette recolours but the art is the old character's.
   */
  function loadFrame(available: SpriteFrame[]): void {
    const source = available[frameIndex] ?? available[0];
    if (!source) {
      grid = [];
      savedRows = [];
      return;
    }
    if (!available[frameIndex]) frameIndex = 0;
    savedRows = [...source.rows];
    grid = source.rows.map((row) => row.split(''));
  }

  function framesFor(entry: CharacterDefinition, name: AnimationName): SpriteFrame[] {
    return entry.animations[name]?.frames ?? [];
  }

  function confirmDiscard(): boolean {
    if (!isDirty) return true;
    return confirm('Discard unsaved changes to this frame?');
  }

  /**
   * Restores the `<select>` to what state actually holds. Assigning the same
   * string back to `characterId` would not do it: Svelte's `safe_not_equal`
   * treats an unchanged primitive as clean, so the DOM would keep the value the
   * user just cancelled.
   */
  function cancelSelect(select: HTMLSelectElement, value: string): void {
    select.value = value;
  }

  function selectCharacter(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    if (select.value === characterId) return;
    if (!confirmDiscard()) return cancelSelect(select, characterId);
    const next = characters.find((entry) => entry.id === select.value);
    if (!next) return cancelSelect(select, characterId);
    characterId = next.id;
    saveMessage = null;
    loadFrame(framesFor(next, animationName));
    persistSelection();
  }

  function selectAnimation(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    if (select.value === animationName) return;
    if (!confirmDiscard()) return cancelSelect(select, animationName);
    animationName = select.value as AnimationName;
    frameIndex = 0;
    saveMessage = null;
    loadFrame(framesFor(character, animationName));
    persistSelection();
  }

  function selectFrame(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    if (Number(select.value) === frameIndex) return;
    if (!confirmDiscard()) return cancelSelect(select, String(frameIndex));
    frameIndex = Number(select.value);
    saveMessage = null;
    // The animation is unchanged, so `frames` is already the right list here.
    loadFrame(frames);
    persistSelection();
  }

  function paintCell(row: number, col: number): void {
    if (!sourceEditable) return;
    if (grid[row]?.[col] === undefined || grid[row][col] === selectedKey) return;
    grid[row][col] = selectedKey;
    grid = grid;
  }

  function startPaint(row: number, col: number): void {
    isPointerDown = true;
    paintCell(row, col);
  }

  function continuePaint(row: number, col: number): void {
    if (isPointerDown) paintCell(row, col);
  }

  function revert(): void {
    loadFrame(frames);
    saveMessage = null;
  }

  async function save(): Promise<void> {
    if (!sourceEditable) {
      saveMessage = { kind: 'error', text: 'This character is preview-only.' };
      return;
    }
    if (!sourceName) {
      saveMessage = { kind: 'error', text: `No source frame mapped for ${frameKey}.` };
      return;
    }
    saving = true;
    saveMessage = null;
    try {
      const response = await fetch('/__sprite/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: sourceFile, frame: sourceName, rows: currentRows })
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        saveMessage = { kind: 'error', text: data.error ?? `HTTP ${response.status}` };
      } else {
        saveMessage = {
          kind: 'ok',
          text: data.changed ? 'Saved.' : 'Saved (no changes — grid matched disk).'
        };
        savedRows = [...currentRows];
      }
    } catch (error) {
      saveMessage = { kind: 'error', text: error instanceof Error ? error.message : String(error) };
    } finally {
      saving = false;
    }
  }

  function drawCanvas(
    node: HTMLElement,
    args: { frame: SpriteFrame; palette: Record<string, string>; outline: string; step: number }
  ) {
    function render(current: typeof args) {
      node.replaceChildren();
      node.appendChild(rasterizeFrame(current.frame, current.palette, current.outline, current.step));
    }
    render(args);
    return { update: render };
  }

  function persistSelection(): void {
    sessionStorage.setItem(
      SELECTION_KEY,
      JSON.stringify({ character: characterId, animation: animationName, frame: frameIndex })
    );
  }

  /**
   * Saving rewrites a source file, which HMR reacts to by re-running this
   * module with fresh state — dropping the selection back to the default
   * character. Parking it per-tab means the remount lands back on the frame
   * that was just edited, now read from the updated module.
   */
  function restoreSelection(): void {
    const raw = sessionStorage.getItem(SELECTION_KEY);
    if (!raw) return;
    let saved: { character?: unknown; animation?: unknown; frame?: unknown };
    try {
      saved = JSON.parse(raw);
    } catch {
      return;
    }
    const restored = characters.find((entry) => entry.id === saved.character);
    if (!restored) return;
    characterId = restored.id;
    if ((animationNames as string[]).includes(saved.animation as string)) {
      animationName = saved.animation as AnimationName;
    }
    // `loadFrame` clamps an out-of-range index, so a stale frame number from a
    // longer animation lands on frame 0 rather than clearing the grid.
    frameIndex = typeof saved.frame === 'number' ? saved.frame : 0;
    loadFrame(framesFor(restored, animationName));
  }

  onMount(() => {
    outline = themeOutline();
    loadFrame(framesFor(character, animationName));
    restoreSelection();
    mounted = true;
    const stopPainting = () => {
      isPointerDown = false;
    };
    window.addEventListener('mouseup', stopPainting);
    return () => window.removeEventListener('mouseup', stopPainting);
  });
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Dev</span>
    <h1>Sprite editor</h1>
    <p class="lede">
      Paint pixel-person frames by hand instead of hand-typing row strings.
      The first save turns a generated frame into a 48×64 literal override in its source file;
      later saves update that override and Vite HMR reloads it live.
    </p>
  </div>

  <div class="themebar">
    <span class="muted">theme:</span>
    {#each themes as t (t.value)}
      <button type="button" on:click={() => setTheme(t.value)}>{t.label}</button>
    {/each}
  </div>

  {#if mounted}
    <section class="panel controls">
      <div class="field">
        <label for="character-select">Character (palette preview)</label>
        <select
          id="character-select"
          value={characterId}
          on:change={selectCharacter}
        >
          {#each characters as c (c.id)}
            <option value={c.id}>{c.id}</option>
          {/each}
        </select>
        <p class="muted small">
          {#if !sourceEditable}
            This character is preview-only.
          {:else if sharedWith.length > 0}
            Heads up: <code>{sourceName}</code> also backs
            {sharedWith.join(', ')} — editing it changes those too.
          {:else}
            Editing writes <code>{sourceName}</code> in <code>{sourceFile}</code>, which only
            this character uses.
          {/if}
        </p>
      </div>

      <div class="field">
        <label for="animation-select">Animation</label>
        <select
          id="animation-select"
          value={animationName}
          on:change={selectAnimation}
        >
          {#each animationNames as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label for="frame-select">Frame</label>
        <select
          id="frame-select"
          value={frameIndex}
          on:change={selectFrame}
        >
          {#each frames as _frame, index (index)}
            <option value={index}>{index}</option>
          {/each}
        </select>
      </div>

      <p class="muted small">
        {sourceEditable ? 'Editing' : 'Previewing'} source frame
        <code>{sourceName ?? '(none)'}</code> in <code>{sourceFile}</code>.
      </p>

      {#if sourceEditable && sharedWith.length > 0}
        <p class="warning">
          Warning: <code>{sourceName}</code> is also used by
          {#each sharedWith as key, i (key)}{i > 0 ? ', ' : ' '}<code>{key}</code>{/each}
          — editing this frame changes those animations too.
        </p>
      {/if}
    </section>

    <section class="panel editor-layout">
      <div class="grid-column">
        <div class="grid-toolbar">
          <label class="onion-toggle">
            <input type="checkbox" bind:checked={onionSkin} disabled={otherFrameIndex < 0} />
            Onion skin (show other frame)
          </label>
          <span class="dirty-indicator" class:dirty={isDirty}>
            {isDirty ? 'Unsaved changes' : 'Saved'}
          </span>
        </div>

        <div
          class="grid-stage"
          style:width="{frameWidth * cellPx}px"
          style:height="{frameHeight * cellPx}px"
        >
          {#if onionFrame}
            <div
              class="onion"
              use:drawCanvas={{ frame: onionFrame, palette: character.palette, outline, step: cellPx }}
            ></div>
          {/if}
          <div
            class="paint-grid"
            style:grid-template-columns="repeat({frameWidth}, {cellPx}px)"
            style:grid-template-rows="repeat({frameHeight}, {cellPx}px)"
          >
            {#each grid as row, r (r)}
              {#each row as cell, c (c)}
                <div
                  class="cell"
                  style:background={resolveColor(cell)}
                  role="presentation"
                  on:mousedown|preventDefault={() => startPaint(r, c)}
                  on:mouseenter={() => continuePaint(r, c)}
                ></div>
              {/each}
            {/each}
          </div>
        </div>

        <div class="actions">
          <button type="button" on:click={revert} disabled={!isDirty}>Revert</button>
          <button type="button" on:click={save} disabled={saving || !sourceName || !sourceEditable}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {#if saveMessage}
          <p class="save-message" class:error={saveMessage.kind === 'error'}>{saveMessage.text}</p>
        {/if}
      </div>

      <div class="side-column">
        <div class="palette">
          <span class="muted small">palette</span>
          <div class="swatches">
            {#each paletteKeys as key (key)}
              <button
                type="button"
                class="swatch-btn"
                class:selected={selectedKey === key}
                on:click={() => (selectedKey = key)}
              >
                <span class="chip" style:background={resolveColor(key)}></span>
                <code>{key}</code>
              </button>
            {/each}
            <button
              type="button"
              class="swatch-btn"
              class:selected={selectedKey === '.'}
              on:click={() => (selectedKey = '.')}
            >
              <span class="chip eraser"></span>
              <code>eraser</code>
            </button>
          </div>
        </div>

        <div class="preview">
          <span class="muted small">preview @1×</span>
          <div class="preview-1x" use:drawCanvas={{ frame: currentFrame, palette: character.palette, outline, step: 1 }}></div>
        </div>

        <div class="preview">
          <span class="muted small">preview @4×</span>
          <div class="preview-4x" use:drawCanvas={{ frame: currentFrame, palette: character.palette, outline, step: 4 }}></div>
        </div>
      </div>
    </section>
  {/if}
</section>

<style>
  .themebar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 1rem;
  }

  .controls {
    display: grid;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .field {
    display: grid;
    gap: 0.3rem;
  }

  .field label {
    font-size: 0.85rem;
    font-weight: 700;
  }

  .field select {
    width: max-content;
    min-width: 10rem;
  }

  .small {
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .warning {
    padding: 0.5rem;
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .editor-layout {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: flex-start;
  }

  .grid-column {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .grid-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .onion-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .dirty-indicator {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .dirty-indicator.dirty {
    color: var(--accent);
    font-weight: 700;
  }

  .grid-stage {
    position: relative;
    border: 1px solid var(--line);
  }

  .onion {
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0.35;
    pointer-events: none;
  }

  .onion :global(canvas) {
    display: block;
    image-rendering: pixelated;
  }

  .paint-grid {
    position: relative;
    display: grid;
    user-select: none;
  }

  .cell {
    border: 1px solid color-mix(in oklab, var(--line) 35%, transparent);
    box-sizing: border-box;
    cursor: crosshair;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .save-message {
    font-size: 0.85rem;
  }

  .save-message.error {
    color: var(--accent);
  }

  .side-column {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 12rem;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }

  .swatch-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.3rem;
  }

  .swatch-btn.selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .chip {
    width: 1.1rem;
    height: 1.1rem;
    border: 1px solid var(--line);
    display: inline-block;
  }

  .chip.eraser {
    background:
      linear-gradient(45deg, transparent 45%, var(--line) 45%, var(--line) 55%, transparent 55%),
      linear-gradient(-45deg, transparent 45%, var(--line) 45%, var(--line) 55%, transparent 55%);
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .preview :global(canvas) {
    display: block;
    image-rendering: pixelated;
    border: 1px solid var(--line);
  }
</style>
