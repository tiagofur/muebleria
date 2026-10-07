/**
 * #1078 — demo economics under the hinge band: every demo module that still
 * authors a BISAGRA bulk line must resolve to the SAME total hinge quantity
 * (the band replaces the line with derived demand — the demo's numbers are
 * pinned, their ORIGIN changes). A drift here is a fixture that needs its
 * door dims or authored line updated on purpose, never a silent price move.
 */
import { describe, expect, it } from 'vitest';
import { resolveBom } from './engine/bom';
import { seedCatalogExpandedLatAm } from './__fixtures__/cocinaLopezDemo';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
} from './__fixtures__/plantillaDemo';
import type { Catalog, OptionChoices } from './types';

function assertAuthoredTotalsSurvive(name: string, catalog: Catalog, choicesFor: (moduleId: string) => OptionChoices) {
  for (const mod of catalog.modules) {
    const authored = (mod.hardwareLines ?? [])
      .filter((l) => l.optionRole === 'BISAGRA' && !l.hardwareId)
      .reduce((sum, l) => sum + l.quantity, 0);
    if (authored === 0) continue;
    // Composed modules pin a commercial preset — use the module's own
    // first preset (the same default the demo pickers use).
    const bom = resolveBom(mod, choicesFor(mod.id), catalog, mod.presets?.[0]?.id);
    const derived = bom.hardwareLines
      .filter((l) => l.optionRole === 'BISAGRA' && l.hardwareId)
      .reduce((sum, l) => sum + l.quantity, 0);
    expect(
      derived,
      `${name}/${mod.code}: derived hinge demand must keep the authored total`,
    ).toBe(authored);
  }
}

describe('#1078 demo economics (authored BISAGRA lines vs derived band)', () => {
  it('cocina López: every authored BISAGRA total survives the band', () => {
    assertAuthoredTotalsSurvive(
      'cocina-lopez',
      seedCatalogExpandedLatAm,
      () => plantillaChoices,
    );
  });

  it('plantilla demo: every authored BISAGRA total survives the band', () => {
    assertAuthoredTotalsSurvive('plantilla', plantillaCatalogWithModules, () => plantillaChoices);
  });
});
