// Calls onOutside(event) on any press outside a popup. A DISABLED button never fires click, so the press is caught at
// pointerdown; click stays for keyboard and synthetic activation. Listening starts on the next tick so the press or
// click that opens the popup does not close it. Returns the stop function.
export function listenOutsidePress(onOutside) {
  let live = true;
  const timer = setTimeout(() => {
    if (!live) return;
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('click', onOutside);
  }, 0);
  return () => {
    live = false; clearTimeout(timer);
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('click', onOutside);
  };
}
