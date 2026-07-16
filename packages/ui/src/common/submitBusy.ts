/**
 * Submit button label helper when an async save is in flight.
 */

export function submitBusyLabel(
  busy: boolean,
  idleLabel: string,
  busyLabel = 'Guardando…',
): string {
  return busy ? busyLabel : idleLabel;
}
