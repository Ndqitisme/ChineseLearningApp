/** Room kept under a revealed row: the focus ring of the pill in it (2px out, 2px wide) and its close shadow. */
const MARGIN = 8;

/** Brings `el` into the page's scroll box only as far as it is cut off, keeping MARGIN under it. scrollIntoView would
 *  also honour the box's 24px scroll padding, so a page whose row already shows would land scrolled by a few pixels and
 *  its header would sit higher than on the other pages. */
export function revealRow(el: Element | undefined) {
  if (!el) return;
  // Measured once the fonts are in and the frame is laid out: measured when the question rendered, the same quiz state
  // landed at 0 with the row cut off in one run and scrolled 12 px in another.
  void document.fonts.ready.then(() => requestAnimationFrame(() => { if (el.isConnected) reveal(el); }));
}

function reveal(el: Element) {
  const box = el.closest('main');
  if (!box) return el.scrollIntoView({ block: 'nearest' });
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) el.scrollIntoView({ block: 'nearest' });
  else if (r.bottom > b.bottom - MARGIN) box.scrollTop += Math.ceil(r.bottom - (b.bottom - MARGIN));
}
