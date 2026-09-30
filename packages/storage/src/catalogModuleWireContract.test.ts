import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { moduleFromApi, moduleToApi } from './apiMappers';
import { parseGenerated } from './openapi/generated/types';
import type { CatalogModule, CatalogModuleWrite } from './openapi/generated/types';

// #497 T3: the generated CatalogModule schema must accept the EXACT wire the
// Go server emits for a fully-populated module (captured from a real storage
// round-trip into this fixture), and the client's own write shape must
// validate against CatalogModuleWrite — closing the server-wire ↔ contract ↔
// client-emit loop without a second model.
describe('CatalogModule wire contract (#497 T3)', () => {
  const fixture: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('./catalogModule.wire.fixture.json', import.meta.url)), 'utf8'),
  );

  it('validates the captured server wire against the generated schema', () => {
    const parsed = parseGenerated<CatalogModule>('CatalogModule', fixture);
    expect(parsed.version).toBe((fixture as { version: number }).version);
    expect(parsed.parameter_definitions?.[0]?.binding?.kind).toBe('componentQuantity');
    // nullable nil-slices stay null, exactly as Go marshals them
    expect(parsed.board_parts).toBeNull();
  });

  it('round-trips the captured wire through the mappers into a valid write payload', () => {
    const mod = moduleFromApi(fixture as Record<string, unknown>);
    expect(mod.version).toBe(1);
    const write = moduleToApi(mod);
    const parsed = parseGenerated<CatalogModuleWrite>('CatalogModuleWrite', write);
    expect(parsed.code).toBe('WIRE-CAP');
    expect(parsed.parameter_definitions).toHaveLength(1);
  });
});
