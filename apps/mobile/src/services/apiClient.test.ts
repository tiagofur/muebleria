import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedApiClient, setApiBaseUrl } from './apiClient';

describe('mobile generated API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setApiBaseUrl('http://localhost:8080');
  });

  it('keeps the generated contract under the legacy /api base path', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    setApiBaseUrl('https://mobile.example.test/root/');

    await generatedApiClient().login({
      email: 'user@example.test', password: 'secret123', transport: 'mobile',
    }).catch(() => undefined);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://mobile.example.test/root/api/auth/login');
  });
});
