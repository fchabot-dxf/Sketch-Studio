// Tiny shared store + pub/sub. The tree, canvas, and inspector all need the
// same "current document" and "current selection", so they subscribe here
// instead of knowing about each other.

const listeners = new Set();

export const store = {
  doc: null,      // the live <svg> root element we are editing (DOM we mutate in place)
  selected: null, // the currently selected Element inside doc
};

export function subscribe(fn) {
  listeners.add(fn);
  fn(store); // push current state immediately
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(store);
}

export function setDoc(svg) {
  store.doc = svg;
  store.selected = null;
  emit();
}

export function select(el) {
  store.selected = el;
  emit();
}
