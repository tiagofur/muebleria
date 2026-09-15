/**
 * #738 review — deferred-navigation intent guard.
 *
 * "Abrir Ingeniería" (and equivalent post-release exits) refresh the server
 * read model BEFORE navigating, so the workspace resolves the exact release
 * context without a manual reload. That refresh is asynchronous: by the time
 * it settles, the user may have navigated elsewhere, switched organization
 * or ended the session. A late completion must never drag the user back to
 * the abandoned intent.
 *
 * The guard captures the intent's session scope and the exact URL where it
 * started, and revalidates BOTH against live state before navigating. The
 * URL comparison uses the whole path+search: any change (another project,
 * another surface, an explicit context re-pin by the user) means the intent
 * was superseded.
 */
export interface DeferredNavigationIntent {
  /** Session/tenant scope key at the moment the intent was created. */
  readonly scopeKey: string | null;
  /** pathname+search where the user was when the intent was created. */
  readonly startedPath: string;
}

export function captureDeferredNavigationIntent(args: {
  readonly scopeKey: string | null;
  readonly path: string;
}): DeferredNavigationIntent {
  return { scopeKey: args.scopeKey, startedPath: args.path };
}

export function deferredNavigationStillCurrent(
  intent: DeferredNavigationIntent,
  live: {
    readonly scopeKey: string | null;
    readonly path: string;
    /** The session is gone: no navigation may run. */
    readonly sessionActive: boolean;
  },
): boolean {
  if (!live.sessionActive) return false;
  return intent.scopeKey === live.scopeKey && intent.startedPath === live.path;
}
