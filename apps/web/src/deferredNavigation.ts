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

/**
 * The composed deferred-navigation run behind "Abrir Ingeniería": refresh
 * the read model, then navigate to the exact target IFF the intent is still
 * current. Kept dependency-injected so the integration behavior (pending
 * refresh, context change, resolve/reject, real effect on navigate) is
 * testable without rendering the shell.
 */
export function runDeferredNavigationGuarded(args: {
  readonly projectId: string;
  readonly releaseId: string;
  readonly start: DeferredNavigationIntent;
  readonly deps: {
    readonly refreshWorkspace: () => Promise<void>;
    readonly navigate: (target: string) => void;
    /** Live context read at completion time (never a render closure). */
    readonly live: () => {
      readonly scopeKey: string | null;
      readonly path: string;
      readonly sessionActive: boolean;
    };
    readonly target: (projectId: string, releaseId: string) => string;
  };
}): void {
  const complete = () => {
    const live = args.deps.live();
    if (!deferredNavigationStillCurrent(args.start, live)) {
      return;
    }
    const target = args.deps.target(args.projectId, args.releaseId);
    if (live.path !== target) {
      args.deps.navigate(target);
    }
  };
  // Both outcomes run the SAME guard. The rejection is consumed here (the
  // workspace fetches its own context after navigating): a failed refresh
  // never surfaces as an unhandled rejection from this path.
  void args.deps.refreshWorkspace().then(complete, complete);
}
