import { TOKEN_STORAGE_KEY } from './session';

const CHANNEL_NAME = 'granete-session';
const SESSION_CHANGED = 'session-changed';

let channel: BroadcastChannel | null = null;
let installed = false;
let storageListener: ((event: StorageEvent) => void) | null = null;

export function notifySessionChanged(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(SESSION_CHANGED);
  } catch {
    // The localStorage event remains the fallback for other tabs.
  }
}

export function installSessionSync(onChanged: () => void): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        if (event.data === SESSION_CHANGED) onChanged();
      };
      return;
    } catch {
      // Fall through to the storage event.
    }
  }
  storageListener = (event) => {
    if (event.key === TOKEN_STORAGE_KEY) onChanged();
  };
  window.addEventListener('storage', storageListener);
}

export function __resetSessionSyncForTests(): void {
  try { channel?.close(); } catch { /* already closed */ }
  channel = null;
  installed = false;
  if (storageListener && typeof window !== 'undefined') {
    window.removeEventListener('storage', storageListener);
    storageListener = null;
  }
}
