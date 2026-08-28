/**
 * Cross-tab catalog freshness (pre-demo audit P0-3 mitigation).
 *
 * The web app keeps the whole catalog in per-tab memory and every mutation
 * re-PUTs it server-side, with no cross-tab sync and no optimistic
 * concurrency. The audit demonstrated the failure: tab A renamed a material,
 * tab B (stale copy) created another, and B's save silently reverted A's
 * rename while A kept showing the phantom local value.
 *
 * Mitigation (demo-sized, ~40 lines): when a tab successfully saves the
 * catalog it broadcasts a signal; other tabs mark themselves stale and
 * re-fetch the workspace from the server when the user returns to them
 * (visibilitychange). This collapses the stale window from "forever" to
 * "until you switch back". The full fix — per-entity PUTs plus
 * updated_at/If-Match conflict detection — is tracked as a separate issue.
 */

const CHANNEL_NAME = 'granete-catalog';
const MUTATED_SIGNAL = 'catalog-mutated';

type Refresh = () => Promise<void>;

let channel: BroadcastChannel | null = null;
let stale = false;
let installed = false;

/** Broadcast "this tab mutated the catalog" after a successful save. */
export function notifyCatalogMutated(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(MUTATED_SIGNAL);
  } catch {
    // BroadcastChannel is best-effort; never let it break a save.
  }
}

let visibilityListener: (() => void) | null = null;

/**
 * Listen for mutations from other tabs and refresh this tab's workspace when
 * the user comes back to it. Call once at app boot.
 */
export function installCrossTabRefresh(refresh: Refresh): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        if (event.data === MUTATED_SIGNAL) stale = true;
      };
    } catch {
      // Same-origin browsers without BroadcastChannel: no sync, app still works.
    }
  }

  visibilityListener = () => {
    if (document.visibilityState !== 'visible' || !stale) return;
    stale = false;
    void refresh().catch((err) => {
      // Keep the dirty signal until a server refresh really succeeds. A
      // transient network failure must retry on the next visibility event.
      stale = true;
      console.error('cross-tab refresh failed:', err);
    });
  };

  document.addEventListener('visibilitychange', visibilityListener);
}

/**
 * Test-only: the module keeps process-wide singletons (channel + stale
 * flag). Unit tests reset them between cases; production never calls this.
 */
export function __resetCrossTabSyncForTests(): void {
  try {
    channel?.close();
  } catch {
    // channel may already be closed
  }
  channel = null;
  stale = false;
  installed = false;
  if (visibilityListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
}
