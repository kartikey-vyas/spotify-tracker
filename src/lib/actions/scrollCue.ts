/* Sets `data-more` on a scroll container while content remains below the
   visible area, so CSS can show a cue in place of a scrollbar. Watches the
   container and its children: rows arriving or leaving change the content
   height without any scroll event. */
export function scrollCue(node: HTMLElement): { destroy(): void } {
  const update = () => {
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    node.toggleAttribute('data-more', remaining > 1);
  };

  const resize = new ResizeObserver(update);
  resize.observe(node);
  for (const child of node.children) resize.observe(child);
  node.addEventListener('scroll', update, { passive: true });
  update();

  return {
    destroy() {
      resize.disconnect();
      node.removeEventListener('scroll', update);
    }
  };
}
