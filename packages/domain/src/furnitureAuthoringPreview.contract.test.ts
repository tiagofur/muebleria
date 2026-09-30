import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildFurnitureAuthoringPreviewRequest,
  parseFurnitureAuthoringPreviewResponse,
} from './furnitureAuthoringPreview';

// #497 T4 golden parity: contracts/furnitureAuthoringPreview.fixture.json is
// byte-pinned by the Go storage test (UPDATE_AUTHORING_PREVIEW_GOLDEN=1) —
// the exact response a real PostgreSQL-backed preview produced. The browser
// parses that same file through the domain contract, so Go and web share one
// authority for the preview wire.
describe('furniture authoring preview contract (#497 T4)', () => {
  const fixture: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../contracts/furnitureAuthoringPreview.fixture.json', import.meta.url)),
      'utf8',
    ),
  );

  it('parses the Go-pinned accepted preview fail-closed', () => {
    const parsed = parseFurnitureAuthoringPreviewResponse(fixture);
    expect(parsed.status).toBe('accepted');
    if (parsed.status !== 'accepted') return;
    expect(parsed.definitionHash).toMatch(/^sha256-/);
    expect(parsed.catalogRevision).toMatch(/^workshop-/);
    expect(parsed.definitionParameters.length).toBeGreaterThanOrEqual(4);
    expect(parsed.resolved.preflight.scope).toBe('authoring-resolve-subset');
    expect(parsed.resolved.machining.manufacturingFingerprint).toMatch(/^sha256-/);
  });

  it('rejects a rejected-preview that smuggles resolved data', () => {
    expect(() =>
      parseFurnitureAuthoringPreviewResponse({
        ...(fixture as Record<string, unknown>),
        status: 'rejected',
      }),
    ).toThrow(/nunca lleva resolved/);
  });

  it('validates the client-side draft before the wire', () => {
    expect(() =>
      buildFurnitureAuthoringPreviewRequest({
        moduleId: 'mod-1',
        parameterDefinitions: [
          {
            name: 'style',
            label: 'Estilo',
            type: 'enum',
            category: 'metadata',
          },
        ],
      }),
    ).toThrow(/parameterDefinitions inválidas/);
  });
});
