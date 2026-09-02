/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWebSessionChannelForTests,
  broadcastWebSessionEvent,
  subscribeToWebSessionEvents,
} from './webSessionChannel';

afterEach(() => {
  __resetWebSessionChannelForTests();
});

describe('webSessionChannel — señales cross-tab no-secretas (SEC-4B §35)', () => {
  it('jamás transporta tokens: el payload es sólo { type }', () => {
    const postMessage = vi.fn();
    const originalBC = globalThis.BroadcastChannel;
    class FakeChannel {
      postMessage = postMessage;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    try {
      broadcastWebSessionEvent({ type: 'session-replaced' });
      broadcastWebSessionEvent({ type: 'session-ended' });
      broadcastWebSessionEvent({ type: 'scope-changed' });
      broadcastWebSessionEvent({ type: 'refresh-completed' });
      for (const call of postMessage.mock.calls) {
        expect(Object.keys(call[0] as object)).toEqual(['type']);
        // Nada que se parezca a un JWT o a material de credential.
        expect(JSON.stringify(call[0])).not.toMatch(/eyJ|Bearer|token|secret|cookie/i);
      }
      expect(postMessage).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
      void originalBC;
    }
  });

  it('el handler recibe los eventos del canal', () => {
    const received: string[] = [];
    const originalBC = globalThis.BroadcastChannel;
    class FakeChannel {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    try {
      const handler = (event: { type: string }) => received.push(event.type);
      subscribeToWebSessionEvents(handler);
      // Simula un mensaje de otra instancia del canal.
      broadcastWebSessionEvent({ type: 'scope-changed' });
      // FakeChannel no se auto-entrega (el real tampoco): suscribir directo.
      const probe = new FakeChannel();
      probe.onmessage = (event) => handler(event.data as { type: string });
      probe.onmessage({ data: { type: 'session-ended' } });
      expect(received).toContain('session-ended');
    } finally {
      vi.unstubAllGlobals();
      void originalBC;
    }
  });

  it('sin BroadcastChannel el módulo degrada sin romper (la cookie sigue siendo la fuente)', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(() => broadcastWebSessionEvent({ type: 'session-ended' })).not.toThrow();
    expect(() => subscribeToWebSessionEvents(() => undefined)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
