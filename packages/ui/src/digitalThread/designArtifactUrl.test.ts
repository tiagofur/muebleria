import { describe, expect, it } from 'vitest';
import { resolveDesignArtifactUrl } from './designArtifactUrl';

describe('resolveDesignArtifactUrl', () => {
  it('resolves a root-relative grant against the backend origin when the API base ends in /api', () => {
    expect(
      resolveDesignArtifactUrl(
        'https://granete.test/api',
        '/api/design-artifacts/storage/revision/preview.png?grant=signed',
      ),
    ).toBe('https://granete.test/api/design-artifacts/storage/revision/preview.png?grant=signed');
  });

  it('accepts an absolute grant only on the configured backend origin', () => {
    expect(
      resolveDesignArtifactUrl(
        'https://granete.test/api/',
        'https://granete.test/api/design-artifacts/storage/revision/model.skp?grant=signed',
      ),
    ).toBe('https://granete.test/api/design-artifacts/storage/revision/model.skp?grant=signed');
  });

  it.each([
    'https://attacker.test/api/design-artifacts/storage/revision/model.skp?grant=stolen',
    '//attacker.test/api/design-artifacts/storage/revision/model.skp?grant=stolen',
    '/api/media/unrelated.png?grant=signed',
    'api/design-artifacts/storage/revision/model.skp?grant=signed',
    'javascript:alert(1)',
  ])('fails closed for an unsupported grant URL: %s', (grantUrl) => {
    expect(() => resolveDesignArtifactUrl('https://granete.test/api', grantUrl)).toThrow(
      'Unsupported Design artifact URL',
    );
  });
});
