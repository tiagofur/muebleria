/**
 * Shared body scroll lock (#1445). Nested/overlapping surfaces — Modal,
 * FullscreenDialog, CommandPalette — share ONE lock: the original overflow is
 * captured when the FIRST lock is taken and restored only when the LAST one
 * is released. With per-surface capture/restore, a surface opening during
 * another's lock captured 'hidden' as the "previous" value and left the page
 * without scroll after both closed (#1432).
 */

let lockCount = 0;
let previousOverflow = '';

/** Takes one lock and returns the release function (idempotent per call). */
export function acquireBodyScrollLock(): () => void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
  }
  lockCount += 1;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow;
    }
  };
}
