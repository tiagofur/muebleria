/**
 * consumeRequestCreateKey — open create-from-Dashboard once per key value.
 *
 * Shell `requestCreateKey` (uiStore) only bumps and never resets. Screens
 * unmount when leaving the section, so a component ref cannot remember the
 * last consumed value across leave/return. Module-scoped tracking survives
 * remount within the SPA session (JD R4-W sticky create).
 *
 * Returns true when the key is new and should open create; false when already
 * consumed (or key is 0/undefined).
 */

const lastConsumedByScope = new Map<string, number>();

export function consumeRequestCreateKey(
  scope: string,
  key: number | undefined,
): boolean {
  if (!key) return false;
  if (lastConsumedByScope.get(scope) === key) return false;
  lastConsumedByScope.set(scope, key);
  return true;
}

/** Test isolation — clear consumed keys between cases. */
export function resetRequestCreateKeyConsumers(): void {
  lastConsumedByScope.clear();
}
