import { describe, expect, it } from 'vitest';
import {
  resolveHardwareAssetFileUrl,
  UnsupportedHardwareAssetUrlError,
} from './hardwareAssetUrl';

describe('resolveHardwareAssetFileUrl (#667 M2)', () => {
  it('resolves grant path without duplicating /api prefix when baseUrl includes /api', () => {
    const resolved = resolveHardwareAssetFileUrl(
      'http://localhost:8080/api',
      '/api/hardware-assets/files/org-1/asset-1/rev-1.skp?grant=token123',
    );
    expect(resolved).toBe(
      'http://localhost:8080/api/hardware-assets/files/org-1/asset-1/rev-1.skp?grant=token123',
    );
    expect(resolved).not.toContain('/api/api');
  });

  it('resolves grant path when baseUrl does not include /api', () => {
    const resolved = resolveHardwareAssetFileUrl(
      'https://app.granete.com',
      '/api/hardware-assets/files/org-1/asset-1/rev-1.glb?grant=xyz',
    );
    expect(resolved).toBe(
      'https://app.granete.com/api/hardware-assets/files/org-1/asset-1/rev-1.glb?grant=xyz',
    );
  });

  it('accepts same-origin absolute grant URLs', () => {
    const resolved = resolveHardwareAssetFileUrl(
      'https://app.granete.com/api',
      'https://app.granete.com/api/hardware-assets/files/org-1/asset-1/rev-1.skp?grant=abc',
    );
    expect(resolved).toBe(
      'https://app.granete.com/api/hardware-assets/files/org-1/asset-1/rev-1.skp?grant=abc',
    );
  });

  it('rejects cross-origin grant URLs', () => {
    expect(() =>
      resolveHardwareAssetFileUrl(
        'https://app.granete.com/api',
        'https://evil.com/api/hardware-assets/files/org-1/asset-1/rev-1.skp',
      ),
    ).toThrow(UnsupportedHardwareAssetUrlError);
  });

  it('rejects URLs outside the hardware asset files namespace', () => {
    expect(() =>
      resolveHardwareAssetFileUrl(
        'https://app.granete.com/api',
        '/api/other-files/secret.txt',
      ),
    ).toThrow(UnsupportedHardwareAssetUrlError);
  });

  it('rejects base URLs with credentials or query/hash', () => {
    expect(() =>
      resolveHardwareAssetFileUrl(
        'https://user:pass@app.granete.com/api',
        '/api/hardware-assets/files/org-1/test.skp',
      ),
    ).toThrow(UnsupportedHardwareAssetUrlError);

    expect(() =>
      resolveHardwareAssetFileUrl(
        'https://app.granete.com/api?query=1',
        '/api/hardware-assets/files/org-1/test.skp',
      ),
    ).toThrow(UnsupportedHardwareAssetUrlError);
  });
});
