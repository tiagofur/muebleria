/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSessionSyncForTests,
  installSessionSync,
  notifySessionChanged,
} from './sessionSync';

class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) { FakeChannel.instances.push(this); }
  postMessage(data: unknown): void {
    for (const channel of FakeChannel.instances) {
      if (channel !== this && channel.name === this.name) channel.onmessage?.({ data });
    }
  }
  close(): void { FakeChannel.instances = FakeChannel.instances.filter((item) => item !== this); }
}

describe('session multi-tab policy (#458)', () => {
  afterEach(() => {
    __resetSessionSyncForTests();
    FakeChannel.instances.length = 0;
    vi.unstubAllGlobals();
  });

  it('notifies another tab without broadcasting credentials or scope data', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    const changed = vi.fn();
    installSessionSync(changed);
    const external = new FakeChannel('granete-session');

    external.postMessage('session-changed');

    expect(changed).toHaveBeenCalledOnce();
  });

  it('publishes only the opaque session-changed signal', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    installSessionSync(() => undefined);
    const external = new FakeChannel('granete-session');
    const received = vi.fn();
    external.onmessage = received;

    notifySessionChanged();

    expect(received).toHaveBeenCalledWith({ data: 'session-changed' });
  });
});
