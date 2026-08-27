/**
 * #403 / MT-2 — material binding role contract regression.
 *
 * Physical/placement role and material binding role are orthogonal concerns:
 * LEFT_SIDE/BASE/SHELF/DOOR answer "what piece is this"; BODY/FRONT/BACK
 * answer "which material selection does this piece follow". The binding is
 * single (optionRoles[0] is the only effective key), never inferred from
 * component name, placement, color or texture, and legacy aliases (ZOCLO /
 * PUERTA / FRENTE_CAJON → FRENTE) follow one explicit precedence table.
 *
 * The alias/binding tables live in contracts/materialRoleBinding.contract.json
 * and are consumed VERBATIM by the Go mirror
 * (backend-go/internal/domain/engine/regression_403_test.go) — a change here
 * without the other is a contract break by definition.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ResolutionError, ValidationError } from './errors';
import {
  materialBindingRole,
  resolveBoardOptionChoiceId,
} from './index';
import { resolveBom } from './engine/bom';
import { validateComponent } from './engine/validate';
import type {
  Catalog,
  Component,
  EdgeAssignment,
  Module,
  OptionChoices,
  OptionGroup,
  Structure,
} from './types';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const contractPath = join(repoRoot, 'contracts', 'materialRoleBinding.contract.json');

interface AliasCase {
  readonly name: string;
  readonly role: string;
  readonly choices: Record<string, string>;
  readonly expectedChoiceId: string | null;
}

interface BindingCase {
  readonly name: string;
  readonly optionRoles: string[];
  readonly expectRole?: string;
  readonly expectError?: boolean;
}

interface RoleBindingContract {
  readonly aliasCases: readonly AliasCase[];
  readonly bindingCases: readonly BindingCase[];
}

const contract = JSON.parse(
  readFileSync(contractPath, 'utf8'),
) as RoleBindingContract;

// ─── Shared contract fixture (alias table + single binding) ───────────────────

describe('materialRoleBinding shared contract (contracts/materialRoleBinding.contract.json)', () => {
  it('applies the alias precedence table exactly as written', () => {
    for (const c of contract.aliasCases) {
      const resolved = resolveBoardOptionChoiceId(c.role, c.choices);
      expect(
        resolved ?? null,
        `alias case "${c.name}" (role=${c.role})`,
      ).toBe(c.expectedChoiceId);
    }
  });

  it('resolves or rejects bindings exactly as written', () => {
    for (const c of contract.bindingCases) {
      const component = {
        id: 'comp-contract',
        code: 'CONTRACT',
        optionRoles: c.optionRoles,
      };
      if (c.expectError) {
        expect(
          () => materialBindingRole(component),
          `binding case "${c.name}"`,
        ).toThrow(ResolutionError);
      } else {
        expect(
          materialBindingRole(component),
          `binding case "${c.name}"`,
        ).toBe(c.expectRole);
      }
    }
  });
});

// ─── Reference cabinet (parity with Go regression_403_test.go) ────────────────
//
// Nominal thicknesses deliberately differ from the materials so a green test
// can never come from coincidence (contract §18):
//
//   nominal:   laterals 15 · base/top 18 · door 18 · back 15 · drawer front 15
//   materials: white16 = 16 mm · oak18 = 18 mm · back6 = 6 mm

const NO_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
];

function boardComponent(
  id: string,
  code: string,
  name: string,
  placement: Component['placement'],
  nominalT: number,
  optionRoles: string[],
): Component {
  return {
    id,
    code,
    name,
    placement,
    geometry: { kind: 'rectangular_board', lengthMm: 700, widthMm: 500, thicknessMm: nominalT },
    defaultEdges: NO_EDGES,
    optionRoles,
    active: true,
  };
}

function referenceCabinet(): { module: Module; catalog: Catalog } {
  const sideL = boardComponent('comp-side-l', 'LAT-L', 'Lateral Izquierdo', 'lateral_izquierdo', 15, ['BODY']);
  const sideR = boardComponent('comp-side-r', 'LAT-R', 'Lateral Derecho', 'lateral_derecho', 15, ['BODY']);
  const base = boardComponent('comp-base', 'PISO', 'Piso', 'base', 18, ['BODY']);
  const top = boardComponent('comp-top', 'TECHO', 'Techo', 'superior', 18, ['BODY']);
  const shelf = boardComponent('comp-shelf', 'ENTRE', 'Entrepaño', 'interno', 18, ['BODY']);
  const back = boardComponent('comp-back', 'FONDO', 'Fondo', 'trasera', 15, ['BACK']);
  const door = boardComponent('comp-door', 'PTA', 'Puerta', 'puerta', 18, ['FRONT']);
  const drawerFront = boardComponent('comp-dfront', 'FCAJ', 'Frente Cajón', 'frente_cajon', 15, ['FRONT']);

  const structure: Structure = {
    id: 'st-ref',
    code: 'CUERPO-REF',
    name: 'Cuerpo Referencia',
    externalDims: { width: 600, height: 720, depth: 560 },
    components: [
      { componentId: 'comp-side-l', quantity: 1 },
      { componentId: 'comp-side-r', quantity: 1 },
      { componentId: 'comp-base', quantity: 1 },
      { componentId: 'comp-top', quantity: 1 },
      { componentId: 'comp-back', quantity: 1 },
    ],
    agregados: [
      { agregadoId: 'agr-drawer', quantity: 3 },
    ],
    active: true,
  };

  const module: Module = {
    id: 'mod-ref',
    code: 'REF-600',
    name: 'Referencia 600',
    externalDims: { width: 600, height: 720, depth: 560 },
    structureId: 'st-ref',
    components: [
      { componentId: 'comp-shelf', quantity: 2 },
      { componentId: 'comp-door', quantity: 1 },
    ],
    hardwareLines: [],
  };

  const optionGroups: OptionGroup[] = [
    { id: 'og-body', code: 'BODY', name: 'Cuerpo', kind: 'board', required: true, optionIds: ['mat-white16'] },
    { id: 'og-front', code: 'FRONT', name: 'Frente', kind: 'board', required: true, optionIds: ['mat-oak18'] },
    { id: 'og-back', code: 'BACK', name: 'Fondo', kind: 'board', required: true, optionIds: ['mat-back6'] },
  ];

  const catalog: Catalog = {
    optionGroups,
    materials: [
      { id: 'mat-white16', code: 'BLANCO-16', name: 'Blanco 16', widthMm: 2100, lengthMm: 2800, thicknessMm: 16, boardPrice: 400, wastePercent: 10, costPerM2: 100, active: true, grainDefault: true },
      { id: 'mat-oak18', code: 'ROBLE-18', name: 'Roble 18', widthMm: 2100, lengthMm: 2800, thicknessMm: 18, boardPrice: 800, wastePercent: 10, costPerM2: 200, active: true, grainDefault: true },
      { id: 'mat-back6', code: 'FONDO-6', name: 'Fondo 6', widthMm: 2100, lengthMm: 2800, thicknessMm: 6, boardPrice: 200, wastePercent: 10, costPerM2: 50, active: true, grainDefault: false },
    ],
    edges: [],
    hardware: [],
    structures: [structure],
    components: [sideL, sideR, base, top, shelf, back, door, drawerFront],
    agregados: [
      {
        id: 'agr-drawer',
        code: 'CAJON',
        name: 'Cajón',
        components: [{ componentId: 'comp-dfront', quantity: 1 }],
        hardwareLines: [],
        active: true,
      },
    ],
    modules: [],
  };

  return { module, catalog };
}

const REF_CHOICES: OptionChoices = {
  BODY: 'mat-white16',
  FRONT: 'mat-oak18',
  BACK: 'mat-back6',
};

/** Catalog + module/structure pair exposing exactly one test component instance. */
function moduleForSingleComponent(
  catalog: Catalog,
  componentId: string,
): { module: Module; catalog: Catalog } {
  const structureId = `st-${componentId}`;
  const withStructure: Catalog = {
    ...catalog,
    structures: [
      ...catalog.structures ?? [],
      {
        id: structureId,
        code: `EST-${componentId}`,
        name: `Estructura ${componentId}`,
        externalDims: { width: 600, height: 720, depth: 560 },
        components: [{ componentId, quantity: 1 }],
        active: true,
      },
    ],
  };
  return {
    module: {
      id: `mod-${componentId}`,
      code: `MOD-${componentId}`,
      name: `Módulo ${componentId}`,
      externalDims: { width: 600, height: 720, depth: 560 },
      structureId,
      components: [],
      hardwareLines: [],
    },
    catalog: withStructure,
  };
}

describe('material role binding — reference scenario (#403)', () => {
  it('binds many physical component types to one role: BODY covers sides/base/top/shelves regardless of placement', () => {
    const { module, catalog } = referenceCabinet();
    const bom = resolveBom(module, REF_CHOICES, catalog);

    const bodyDescriptions = ['Lateral Izquierdo', 'Lateral Derecho', 'Piso', 'Techo', 'Entrepaño'];
    const bodyParts = bom.boardParts.filter((p) => bodyDescriptions.includes(p.description ?? ''));
    // 4 structure pieces + 2 shelves from the module.
    expect(bodyParts).toHaveLength(6);
    for (const part of bodyParts) {
      expect(part.optionRole).toBe('BODY');
      expect(part.materialId).toBe('mat-white16');
      expect(part.thicknessMm).toBe(16);
    }
  });

  it('binds doors and agregado drawer fronts to the same FRONT choice', () => {
    const { module, catalog } = referenceCabinet();
    const bom = resolveBom(module, REF_CHOICES, catalog);

    const fronts = bom.boardParts.filter(
      (p) => p.description === 'Puerta' || p.description === 'Frente Cajón',
    );
    // 1 normal door + 3 agregado drawer fronts, all following FRONT.
    expect(fronts).toHaveLength(4);
    for (const part of fronts) {
      expect(part.optionRole).toBe('FRONT');
      expect(part.materialId).toBe('mat-oak18');
      expect(part.thicknessMm).toBe(18);
    }
  });

  it('isolates roles: changing FRONT does not alter BODY or BACK', () => {
    const { module, catalog } = referenceCabinet();
    const before = resolveBom(module, REF_CHOICES, catalog);
    const after = resolveBom(
      module,
      { ...REF_CHOICES, FRONT: 'mat-white16' },
      catalog,
    );

    const byRole = (bom: typeof before, role: string) =>
      bom.boardParts.filter((p) => p.optionRole === role);
    expect(byRole(after, 'FRONT').every((p) => p.materialId === 'mat-white16')).toBe(true);
    expect(byRole(after, 'FRONT').every((p) => p.thicknessMm === 16)).toBe(true);
    expect(byRole(after, 'BODY').every((p) => p.materialId === 'mat-white16')).toBe(true);
    expect(byRole(after, 'BODY').every((p) => p.thicknessMm === 16)).toBe(true);
    expect(byRole(after, 'BACK').every((p) => p.materialId === 'mat-back6')).toBe(true);
    expect(byRole(after, 'BACK').every((p) => p.thicknessMm === 6)).toBe(true);
    // Before/after equivalence outside FRONT.
    expect(byRole(before, 'BODY').map((p) => p.materialId))
      .toEqual(byRole(after, 'BODY').map((p) => p.materialId));
  });
});

describe('material role binding — negative proofs (#403)', () => {
  it('rejects a board declaring a second optionRole instead of silently ignoring it', () => {
    const { catalog } = referenceCabinet();
    const ambiguous = boardComponent('comp-amb', 'AMB', 'Ambigua', 'puerta', 18, ['FRONT', 'BODY']);
    const withAmb = {
      ...catalog,
      components: [...catalog.components ?? [], ambiguous],
    };
    const { module: modAmb, catalog: catAmb } = moduleForSingleComponent(withAmb, 'comp-amb');

    expect(() => resolveBom(modAmb, REF_CHOICES, catAmb)).toThrow(ResolutionError);
    expect(() => resolveBom(modAmb, REF_CHOICES, catAmb)).toThrow(
      /multiple material binding roles \[FRONT, BODY\]/,
    );
  });

  it('rejects a board with only empty optionRoles entries', () => {
    const { catalog } = referenceCabinet();
    const empty = boardComponent('comp-empty', 'VACIO', 'Vacía', 'puerta', 18, ['', '  ']);
    const withEmpty = {
      ...catalog,
      components: [...catalog.components ?? [], empty],
    };
    const { module: modEmpty, catalog: catEmpty } = moduleForSingleComponent(withEmpty, 'comp-empty');

    expect(() => resolveBom(modEmpty, REF_CHOICES, catEmpty)).toThrow(
      /no material binding role/,
    );
  });

  it('never infers the binding from the component name: a piece named "Puerta" bound to BACK gets BACK', () => {
    const { catalog } = referenceCabinet();
    // Same name as a door and identical look, but explicitly bound to BACK.
    const impostor = boardComponent('comp-impostor', 'PTA-X', 'Puerta', 'puerta', 15, ['BACK']);
    const withImpostor = {
      ...catalog,
      components: [...catalog.components ?? [], impostor],
    };
    const { module: modImpostor, catalog: catImpostor } = moduleForSingleComponent(withImpostor, 'comp-impostor');

    const bom = resolveBom(modImpostor, REF_CHOICES, catImpostor);
    expect(bom.boardParts).toHaveLength(1);
    expect(bom.boardParts[0]!.optionRole).toBe('BACK');
    expect(bom.boardParts[0]!.materialId).toBe('mat-back6');
    expect(bom.boardParts[0]!.thicknessMm).toBe(6);
  });

  it('never infers the binding from placement: a door-placement piece bound to BODY gets BODY', () => {
    const { catalog } = referenceCabinet();
    // Physically a door, but explicitly bound to the BODY finish.
    const bodyDoor = boardComponent('comp-bodydoor', 'PTA-B', 'Puerta Cuerpo', 'puerta', 15, ['BODY']);
    const withBodyDoor = {
      ...catalog,
      components: [...catalog.components ?? [], bodyDoor],
    };
    const { module: modBodyDoor, catalog: catBodyDoor } = moduleForSingleComponent(withBodyDoor, 'comp-bodydoor');

    const bom = resolveBom(modBodyDoor, REF_CHOICES, catBodyDoor);
    expect(bom.boardParts).toHaveLength(1);
    expect(bom.boardParts[0]!.optionRole).toBe('BODY');
    expect(bom.boardParts[0]!.materialId).toBe('mat-white16');
    expect(bom.boardParts[0]!.thicknessMm).toBe(16);
  });

  it('legacy alias roles follow the explicit FRENTE precedence through the engine', () => {
    const { catalog } = referenceCabinet();
    const legacyDoor = boardComponent('comp-puerta-legacy', 'PTA-L', 'Puerta Legacy', 'puerta', 15, ['PUERTA']);
    const withLegacy = {
      ...catalog,
      components: [...catalog.components ?? [], legacyDoor],
    };
    const { module: modLegacy, catalog: catLegacy } = moduleForSingleComponent(withLegacy, 'comp-puerta-legacy');
    // Legacy workshop choices use the FRENTE role the alias table targets.
    const legacyChoices: OptionChoices = {
      BODY: 'mat-white16',
      FRENTE: 'mat-oak18',
      BACK: 'mat-back6',
    };

    // No PUERTA choice: inherits FRENTE's material (thickness 18, not 15).
    const inherited = resolveBom(modLegacy, legacyChoices, catLegacy);
    expect(inherited.boardParts[0]!.optionRole).toBe('PUERTA');
    expect(inherited.boardParts[0]!.materialId).toBe('mat-oak18');
    expect(inherited.boardParts[0]!.thicknessMm).toBe(18);

    // A direct PUERTA choice beats the alias.
    const direct = resolveBom(
      modLegacy,
      { ...legacyChoices, PUERTA: 'mat-back6' },
      catLegacy,
    );
    expect(direct.boardParts[0]!.materialId).toBe('mat-back6');
    expect(direct.boardParts[0]!.thicknessMm).toBe(6);
  });
});

describe('validateComponent — single binding at authoring time (#403)', () => {
  const base = {
    id: 'comp-v',
    code: 'VAL',
    name: 'Valida',
    placement: 'interno' as const,
    geometry: { kind: 'rectangular_board' as const, lengthMm: 100, widthMm: 50, thicknessMm: 18 },
    defaultEdges: NO_EDGES,
    active: true,
  };

  it('accepts a single role (even duplicated or padded)', () => {
    expect(() => validateComponent({ ...base, optionRoles: ['FRENTE'] })).not.toThrow();
    expect(() => validateComponent({ ...base, optionRoles: ['FRENTE', 'FRENTE'] })).not.toThrow();
    expect(() => validateComponent({ ...base, optionRoles: ['', ' FRENTE '] })).not.toThrow();
  });

  it('rejects empty and ambiguous bindings', () => {
    expect(() => validateComponent({ ...base, optionRoles: [] })).toThrow(ValidationError);
    expect(() => validateComponent({ ...base, optionRoles: ['', '  '] })).toThrow(ValidationError);
    expect(() =>
      validateComponent({ ...base, optionRoles: ['FRONT', 'BODY'] }),
    ).toThrow(/single material binding role/);
  });
});
