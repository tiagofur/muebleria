/**
 * F011 seed_data acceptance — full plantilla seed shape + demo quotation path.
 */

import {
  calcProjectBreakdown,
  generateCutRows,
  resolveBom,
} from '@muebles/domain';
import {
  GAB_ONLY_GOLDEN,
  IDS,
  plantillaChoices,
  plantillaGabOnlyExpected,
} from '@muebles/domain/fixtures';
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, createSeedWorkspace } from './seed';

const MATERIAL_CODES = ['TAB-ARA-BLA', 'TAB-MAD-FRE', 'TAB-MDF-3'] as const;
const EDGE_CODES = ['CAN-ARA-BLA', 'CAN-MAD-FRE', 'CAN-MDF-3'] as const;
const HARDWARE_CODES = [
  'HER-BIS-CL',
  'HER-JAL-INOX',
  'HER-PATA-REG',
  'HER-TOR-4X50',
  'HER-CORR-500',
  'HER-SOP-ENT',
] as const;
const OPTION_GROUP_CODES = [
  'INTERIOR',
  'FRENTE',
  'FONDO',
  'BISAGRA',
  'CORREDERA',
] as const;

describe('createSeedWorkspace (F011 seed_data)', () => {
  it('includes schemaVersion, non-empty plantilla catalogs, and modules', () => {
    const seed = createSeedWorkspace();

    expect(seed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(seed.catalog.materials.length).toBeGreaterThan(0);
    expect(seed.catalog.edges.length).toBeGreaterThan(0);
    expect(seed.catalog.hardware.length).toBeGreaterThan(0);
    expect(seed.catalog.optionGroups.length).toBeGreaterThan(0);

    const codes = seed.catalog.modules.map((m) => m.code);
    expect(codes).toContain('MOD-GAB-01');
    expect(codes).toContain('MOD-CAJ-01');
  });

  it('seed structures are revision-compatible (#108): normalize to revision 1', () => {
    // Seed structures come from domain fixtures without an explicit `revision`
    // field. The domain normalizes missing → 1 via `structureRevision` (Slice 1),
    // so a freshly-seeded workspace is already valid for the v3 schema. This
    // guards against a future fixture change that silently drops compatibility.
    const seed = createSeedWorkspace();
    const structures = seed.catalog.structures ?? [];
    expect(structures.length).toBeGreaterThan(0);
    for (const s of structures) {
      // revision ?? 1 must equal 1 — either explicitly set or normalized.
      expect(s.revision ?? 1).toBe(1);
      // history, when present, must be an array (snapshot list).
      if (s.history !== undefined) {
        expect(Array.isArray(s.history)).toBe(true);
      }
    }
  });

  it('includes Arauco, Maderado, MDF materials with costs and matching edges (CAT-06)', () => {
    const seed = createSeedWorkspace();
    const matCodes = new Set(seed.catalog.materials.map((m) => m.code));
    const edgeCodes = new Set(seed.catalog.edges.map((e) => e.code));

    for (const code of MATERIAL_CODES) {
      expect(matCodes.has(code)).toBe(true);
    }
    for (const code of EDGE_CODES) {
      expect(edgeCodes.has(code)).toBe(true);
    }

    for (const material of seed.catalog.materials) {
      expect(material.costPerM2).toBeGreaterThan(0);
      expect(material.active).toBe(true);
      // Edge band linked by id (defaultEdgeBandId), never by display name
      expect(material.defaultEdgeBandId).toBeTruthy();
      const edge = seed.catalog.edges.find(
        (e) => e.id === material.defaultEdgeBandId,
      );
      expect(edge).toBeDefined();
    }
  });

  it('includes demo hardware set used by plantilla modules', () => {
    const seed = createSeedWorkspace();
    const codes = new Set(seed.catalog.hardware.map((h) => h.code));
    for (const code of HARDWARE_CODES) {
      expect(codes.has(code)).toBe(true);
    }
    for (const hw of seed.catalog.hardware) {
      expect(hw.costPerUnit).toBeGreaterThanOrEqual(0);
      expect(hw.active).toBe(true);
    }
  });

  it('includes option groups with members (OPT-03)', () => {
    const seed = createSeedWorkspace();
    const byCode = new Map(seed.catalog.optionGroups.map((g) => [g.code, g]));

    for (const code of OPTION_GROUP_CODES) {
      const group = byCode.get(code);
      expect(group).toBeDefined();
      expect(group!.optionIds.length).toBeGreaterThan(0);
      expect(group!.required).toBe(true);
    }

    expect(byCode.get('INTERIOR')!.kind).toBe('board');
    expect(byCode.get('FRENTE')!.kind).toBe('board');
    expect(byCode.get('FONDO')!.kind).toBe('board');
    expect(byCode.get('BISAGRA')!.kind).toBe('hardware');
    expect(byCode.get('CORREDERA')!.kind).toBe('hardware');

    expect(byCode.get('INTERIOR')!.optionIds).toContain(IDS.matArauco);
    expect(byCode.get('FRENTE')!.optionIds).toContain(IDS.matMaderado);
    expect(byCode.get('FONDO')!.optionIds).toContain(IDS.matMdf);
    expect(byCode.get('BISAGRA')!.optionIds).toContain(IDS.hwBisagra);
    expect(byCode.get('CORREDERA')!.optionIds).toContain(IDS.hwCorredera);
  });

  it('MOD-GAB-01 and MOD-CAJ-01 have correct optionRoles (MOD-07)', () => {
    const seed = createSeedWorkspace();
    const gab = seed.catalog.modules.find((m) => m.code === 'MOD-GAB-01')!;
    const caj = seed.catalog.modules.find((m) => m.code === 'MOD-CAJ-01')!;
    const comps = seed.catalog.components ?? [];
    const structs = seed.catalog.structures ?? [];

    expect(gab).toBeDefined();
    expect(caj).toBeDefined();

    // Collect optionRoles from the module's component instances + its
    // referenced structure's component instances (modules no longer carry
    // board parts directly).
    const rolesFor = (mod: typeof gab): Set<string> => {
      const roles = new Set<string>();
      const collect = (componentIds: readonly { componentId: string }[]) => {
        for (const inst of componentIds) {
          const c = comps.find((x) => x.id === inst.componentId);
          if (c) for (const r of c.optionRoles) roles.add(r);
        }
      };
      collect(mod.components ?? []);
      const st = structs.find((s) => s.id === mod.structureId);
      collect(st?.components ?? []);
      return roles;
    };

    const gabRoles = rolesFor(gab);
    expect(gabRoles.has('INTERIOR')).toBe(true);
    expect(gabRoles.has('FRENTE')).toBe(true);
    expect(gab.hardwareLines.some((l) => l.optionRole === 'BISAGRA')).toBe(true);
    expect(gab.hardwareLines.some((l) => l.optionRole === 'FIXED' && l.hardwareId)).toBe(
      true,
    );

    const cajRoles = rolesFor(caj);
    expect(cajRoles.has('INTERIOR')).toBe(true);
    expect(cajRoles.has('FRENTE')).toBe(true);
    expect(cajRoles.has('FONDO')).toBe(true);
    expect(caj.hardwareLines.some((l) => l.optionRole === 'CORREDERA')).toBe(
      true,
    );
  });

  it('includes draft demo project MOD-GAB-01 × 1 with plantilla choices', () => {
    const seed = createSeedWorkspace();
    expect(seed.projects).toHaveLength(1);

    const demo = seed.projects[0]!;
    expect(demo.id).toBe(IDS.projectDemo);
    expect(demo.name).toBe('Demo plantilla');
    expect(demo.status).toBe('draft');
    expect(demo.marginFactor).toBe(1.35);
    expect(demo.laborFixedCost).toBe(1200);
    expect(demo.items).toHaveLength(1);

    const item = demo.items[0]!;
    expect(item.moduleId).toBe(IDS.modGab);
    expect(item.quantity).toBe(1);
    expect(item.optionChoices.INTERIOR).toBe(IDS.matArauco);
    expect(item.optionChoices.FRENTE).toBe(IDS.matMaderado);
    expect(item.optionChoices.BISAGRA).toBe(IDS.hwBisagra);
  });

  it('demo project price matches GAB-only plantilla expected (acceptance 2)', () => {
    const seed = createSeedWorkspace();
    const demo = seed.projects[0]!;
    const breakdown = calcProjectBreakdown(demo, seed.catalog);
    const expected = plantillaGabOnlyExpected;

    expect(breakdown.materialsCost).toBeCloseTo(expected.materialsCost, 2);
    expect(breakdown.edgeTotal).toBeCloseTo(expected.edgeTotal, 2);
    expect(breakdown.hardwareTotal).toBeCloseTo(expected.hardwareTotal, 2);
    expect(breakdown.directCost).toBeCloseTo(expected.directCost, 2);
    expect(breakdown.laborModular).toBe(expected.laborModular);
    expect(breakdown.salePrice).toBeCloseTo(expected.salePrice, 2);
  });

  it('demo project cut rows are GAB board parts only (no hardware) for Optimizer path', () => {
    const seed = createSeedWorkspace();
    const demo = seed.projects[0]!;
    const rows = generateCutRows(demo, seed.catalog);

    expect(rows).toHaveLength(8);
    // Pieces come from expanded component instances (no partCode → unstable
    // internal order); assert the multiset of part names instead.
    expect([...rows.map((r) => r.partName)].sort()).toEqual(
      [
        'Costado Gabinete',
        'Costado Gabinete',
        'Respaldo Gabinete',
        'Piso Gabinete',
        'Entrepaño Gabinete',
        'Manguete',
        'Manguete',
        'Puerta Gabinete',
      ].sort(),
    );
    for (const row of rows) {
      expect(row.description.toLowerCase()).not.toMatch(
        /bisagra|jaladera|tornillo|corredera|pata|soporte/,
      );
    }

    // Same shape as dual-module fixture GAB-only project
    expect(demo.items[0]!.moduleId).toBe(GAB_ONLY_GOLDEN.project.items[0]!.moduleId);
  });

  it('seed catalog covers the three furniture types (#109 / H14)', () => {
    const seed = createSeedWorkspace();
    const types = new Set(
      seed.catalog.modules.map((m) => m.furnitureType ?? 'inferior'),
    );
    expect(types.has('inferior')).toBe(true);
    expect(types.has('superior')).toBe(true);
    expect(types.has('alto')).toBe(true);
  });

  it('superior (alacena) and alto (despensa) seed modules resolve BOM without error (#109)', () => {
    // Smoke: the new modules must produce a valid resolved BOM at their default
    // preset. Not asserting golden costs — just that the parametric bodies
    // (costados + base + respaldo) don't throw on resolve.
    const seed = createSeedWorkspace();
    const alacena = seed.catalog.modules.find((m) => m.code === 'MOD-ALA-001')!;
    const despensa = seed.catalog.modules.find((m) => m.code === 'MOD-DES-001')!;

    expect(alacena).toBeDefined();
    expect(despensa).toBeDefined();
    expect(alacena.furnitureType).toBe('superior');
    expect(despensa.furnitureType).toBe('alto');

    // Use plantillaChoices (covers INTERIOR/FRENTE/BISAGRA) so the required
    // hardware role on the seed bodies resolves. Same choices the demo project
    // uses for MOD-GAB-01.
    const choices = plantillaChoices;

    const alacenaBom = resolveBom(
      alacena,
      choices,
      seed.catalog,
      alacena.presets?.[0]?.id,
    );
    expect(alacenaBom.boardParts.length).toBeGreaterThan(0);

    const despensaBom = resolveBom(
      despensa,
      choices,
      seed.catalog,
      despensa.presets?.[0]?.id,
    );
    expect(despensaBom.boardParts.length).toBeGreaterThan(0);
  });
});
