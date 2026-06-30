// Shared hover tooltip styled in the app's terminal/monospace language, replacing
// the native `title=""` attributes (slow, unstyled OS tooltip). One tooltip
// element is lazily created and reused across every `use:tooltip` instance.
//
// Usage: `use:tooltip={text}` on any element, including SVG <path>. Pass an
// empty/falsy string to suppress (e.g. out-of-range calendar cells).

type TooltipText = string | null | undefined;

const TIP_ID = 'app-tooltip';
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = 14;
const EDGE = 8; // keep this far from the viewport edges

let tip: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
  if (tip) return tip;
  const el = document.createElement('div');
  el.id = TIP_ID;
  el.className = 'app-tooltip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);
  tip = el;
  return el;
}

export function tooltip(node: HTMLElement | SVGElement, text: TooltipText) {
  let current = text;
  // Cached tooltip size, refreshed only when the text/visibility changes, so the
  // hot pointermove path never reads layout.
  let tipWidth = 0;
  let tipHeight = 0;

  function owns(): boolean {
    return node.getAttribute('aria-describedby') === TIP_ID;
  }

  function measure(el: HTMLDivElement): void {
    const rect = el.getBoundingClientRect();
    tipWidth = rect.width;
    tipHeight = rect.height;
  }

  function show(): boolean {
    if (!current) return false;
    const el = ensureTip();
    el.textContent = String(current);
    el.hidden = false;
    node.setAttribute('aria-describedby', TIP_ID);
    measure(el);
    return true;
  }

  function hide(): void {
    if (tip) tip.hidden = true;
    if (owns()) node.removeAttribute('aria-describedby');
  }

  // Cursor-following placement, flipping to the other side of the pointer near
  // the right/bottom edges so the box never overflows the viewport.
  function placeAtCursor(clientX: number, clientY: number): void {
    if (!tip || tip.hidden) return;
    let left = clientX + CURSOR_OFFSET_X;
    let top = clientY + CURSOR_OFFSET_Y;
    if (left + tipWidth > window.innerWidth - EDGE) left = clientX - tipWidth - CURSOR_OFFSET_X;
    if (top + tipHeight > window.innerHeight - EDGE) top = clientY - tipHeight - CURSOR_OFFSET_Y;
    tip.style.left = `${Math.max(EDGE, left)}px`;
    tip.style.top = `${Math.max(EDGE, top)}px`;
  }

  function onEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return; // no hover surface on touch
    if (show()) placeAtCursor(event.clientX, event.clientY);
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    if (!owns() && !show()) return;
    placeAtCursor(event.clientX, event.clientY);
  }

  // Keyboard focus: anchor above the element (no cursor to follow), flipping
  // below when there isn't room above.
  function onFocus(): void {
    if (!show() || !tip) return;
    const anchor = node.getBoundingClientRect();
    let left = anchor.left;
    let top = anchor.top - tipHeight - 6;
    if (top < EDGE) top = anchor.bottom + 6;
    if (left + tipWidth > window.innerWidth - EDGE) left = window.innerWidth - tipWidth - EDGE;
    tip.style.left = `${Math.max(EDGE, left)}px`;
    tip.style.top = `${top}px`;
  }

  const listeners: Array<[string, EventListener]> = [
    ['pointerenter', onEnter as EventListener],
    ['pointermove', onMove as EventListener],
    ['pointerleave', hide],
    ['focus', onFocus],
    ['blur', hide]
  ];
  for (const [type, handler] of listeners) node.addEventListener(type, handler);

  return {
    update(next: TooltipText): void {
      current = next;
      if (!owns()) return;
      if (!current) hide();
      else if (tip) {
        tip.textContent = String(current);
        measure(tip);
      }
    },
    destroy(): void {
      for (const [type, handler] of listeners) node.removeEventListener(type, handler);
      if (owns()) hide();
    }
  };
}
