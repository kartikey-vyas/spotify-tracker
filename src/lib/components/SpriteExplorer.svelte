<script lang="ts">
  import { onMount } from 'svelte';
  import { characterRegistry } from '$lib/pixel-person/characters';
  import { rasterizeFrame, themeOutline } from '$lib/pixel-person/render';
  import { applyTheme, themes, type Theme } from '$lib/theme';
  import type { CharacterDefinition } from '$lib/pixel-person/types';

  // Big enough to count individual pixels while authoring.
  const PREVIEW_STEP = 8;

  let mounted = false;
  let outline = '#111';

  const characters: CharacterDefinition[] = Object.values(characterRegistry);

  function setTheme(value: Theme): void {
    applyTheme(value);
    outline = themeOutline();
  }

  onMount(() => {
    outline = themeOutline();
    mounted = true;
  });

  function paint(node: HTMLDivElement, args: { character: CharacterDefinition; animationName: string; frameIndex: number; step: number; outline: string }) {
    function draw(current: typeof args) {
      const animation = current.character.animations[
        current.animationName as keyof CharacterDefinition['animations']
      ];
      const frame = animation?.frames[current.frameIndex];
      node.replaceChildren();
      if (!frame) return;
      node.appendChild(
        rasterizeFrame(frame, current.character.palette, current.outline, current.step)
      );
    }
    draw(args);
    return { update: draw };
  }
</script>

<section class="page">
  <div class="page-header">
    <span class="eyebrow">Dev</span>
    <h1>Sprite explorer</h1>
    <p class="lede">
      Every character, animation and frame, rasterized through the same path the canvas uses.
      Dev-only surface for iterating on the pixel art.
    </p>
  </div>

  <div class="themebar">
    <span class="muted">theme:</span>
    {#each themes as t (t.value)}
      <button type="button" on:click={() => setTheme(t.value)}>{t.label}</button>
    {/each}
  </div>

  {#if mounted}
    {#each characters as character (character.id)}
      <section class="panel">
        <h2>{character.id}</h2>
        <p class="muted">
          {character.pixelWidth}×{character.pixelHeight} @ {character.scale} →
          {character.pixelWidth * character.scale}×{character.pixelHeight * character.scale} CSS px
          · body {character.body.width}×{character.body.height}
        </p>

        <div class="swatches">
          {#each Object.entries(character.palette) as [key, color] (key)}
            <span class="swatch">
              <span class="chip" style:background={color === '$outline' ? outline : color}></span>
              <code>{key}</code>
            </span>
          {/each}
        </div>

        {#each Object.keys(character.animations) as animationName (animationName)}
          <div class="anim">
            <code class="anim-name">{animationName}</code>
            <div class="frames">
              {#each character.animations[animationName as keyof CharacterDefinition['animations']]?.frames ?? [] as _frame, frameIndex (frameIndex)}
                <div class="frame">
                  <div use:paint={{ character, animationName, frameIndex, step: PREVIEW_STEP, outline }}></div>
                  <code class="muted">{frameIndex}</code>
                </div>
              {/each}
            </div>
          </div>
        {/each}

        <div class="anim">
          <code class="anim-name">idle @ device steps</code>
          <div class="frames">
            {#each [1, 2, 3, 4] as step (step)}
              <div class="frame">
                <div use:paint={{ character, animationName: 'idle', frameIndex: 0, step, outline }}></div>
                <code class="muted">step {step}</code>
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/each}
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

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .swatch {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .chip {
    width: 1rem;
    height: 1rem;
    border: 1px solid var(--line);
    display: inline-block;
  }

  .anim {
    margin-top: 1rem;
  }

  .anim-name {
    display: block;
    margin-bottom: 0.4rem;
  }

  .frames {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-end;
  }

  .frame {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
  }

  .frame :global(canvas) {
    display: block;
    image-rendering: pixelated;
  }
</style>
