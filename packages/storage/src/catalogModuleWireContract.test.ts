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
    // #1404 follow-up (#1403 review): the generated schema accepts the
    // optional per-copy link on a hardware line.
    expect(parsed.hardware_lines?.[0]?.component_id).toBeUndefined();
    expect(parsed.hardware_lines?.[1]?.component_id).toBe(
      '32a046f2-35b3-4e63-93ba-bb531e1b4507',
    );
  });

  it('round-trips the captured wire through the mappers into a valid write payload', () => {
    const mod = moduleFromApi(fixture as Record<string, unknown>);
    expect(mod.version).toBe(1);
    // #1404: the populated component link survives read and write.
    expect(mod.hardwareLines[1]?.componentId).toBe(
      '32a046f2-35b3-4e63-93ba-bb531e1b4507',
    );
    expect(mod.hardwareLines[0]?.componentId).toBeUndefined();
    const write = moduleToApi(mod);
    const parsed = parseGenerated<CatalogModuleWrite>('CatalogModuleWrite', write);
    expect(parsed.code).toBe('WIRE-CAP');
    expect(parsed.parameter_definitions).toHaveLength(1);
    const writeLines = write.hardware_lines as Array<Record<string, unknown>>;
    expect(writeLines[1]?.component_id).toBe(
      '32a046f2-35b3-4e63-93ba-bb531e1b4507',
    );
  });
});
