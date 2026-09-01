/**
 * webSessionChannel — señales cross-tab del ciclo de vida de la sesión Web
 * (#460 SEC-4B).
 *
 * Payload policy ESTRUCTURAL: los eventos son `{ type }` y nada más. Nunca
 * viaja el access token, ningún refresh material ni datos de negocio/usuario;
 * una pestaña que recibe una señal resuelve su propio estado autoritativo
 * mediante la cookie (bootstrap/refresh) — no copiando credenciales.
 *
 *   session-replaced  → otra pestaña hizo un NUEVO login (cookie = S2)
 *   session-ended     → logout revocó la sesión compartida
 *   scope-changed     → select-org cambió el scope de la sesión compartida
 *   refresh-completed → rotación normal (mismo user/org/sid): nadie debe
 *                       recargar nada
 *   lock-released     → interno del fallback lock (webSessionLock)
 */

export type WebSessionEvent =
  | { readonly type: 'session-replaced' }
  | { readonly type: 'session-ended' }
  | { readonly type: 'scope-changed' }
  | { readonly type: 'refresh-completed' }
  | { readonly type: 'lock-released' };

const CHANNEL_NAME = 'granete-web-session';

let channel: BroadcastChannel | null = null;

function resolveChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
    return channel;
  } catch {
    return null;
  }
}

/** Emite una señal no-secreta a las demás pestañas (best-effort). */
export function broadcastWebSessionEvent(event: WebSessionEvent): void {
  try {
    resolveChannel()?.postMessage(event);
  } catch {
    // El canal es best-effort: la cookie sigue siendo la fuente compartida.
  }
}

/** Suscribe handlers a las señales; devuelve unsubscribe. */
export function subscribeToWebSessionEvents(
  handler: (event: WebSessionEvent) => void,
): () => void {
  const ch = resolveChannel();
  if (!ch) return () => undefined;
  ch.onmessage = (message: MessageEvent) => {
    const data = message.data as WebSessionEvent | null;
    if (data && typeof data === 'object' && typeof data.type === 'string') {
      handler(data);
    }
  };
  return () => {
    if (ch.onmessage !== null) ch.onmessage = null;
  };
}

/** Test-only: cierra y olvida el canal singleton. */
export function __resetWebSessionChannelForTests(): void {
  try {
    channel?.close();
  } catch {
    // ya estaba cerrado
  }
  channel = null;
}
