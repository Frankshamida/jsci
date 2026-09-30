// Ref callback for a suggestion list under an input. Inside a scrolling
// dialog a list hanging below the last fields is cut off and makes the dialog
// scroll to reach it - so when there is not room below but there is above,
// the list opens upward instead (the `up` class).
export function flipListUp(list) {
  if (!list) return;
  const field = list.parentElement;
  if (!field) return;

  // The nearest box that clips, else the window.
  let box = field.parentElement;
  while (box && box !== document.body) {
    const { overflowY } = getComputedStyle(box);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') break;
    box = box.parentElement;
  }
  const bounds = box && box !== document.body
    ? box.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };

  const rect = field.getBoundingClientRect();
  const need = list.offsetHeight + 8;
  const below = bounds.bottom - rect.bottom;
  const above = rect.top - bounds.top;
  list.classList.toggle('up', below < need && above > below);
}
