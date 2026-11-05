/**
 * #1429 slice B — paridad compartida TS↔Go de la proyección member-host: un
 * miembro rígido de la receta con hostPlacement taladra la pieza EXTERNA del
 * módulo con el perfil de mecanizado de catálogo del herraje. El MISMO
 * fixture lo consume el engine Go (member_host_drilling_contract_test.go,
 * autor golden vía ResolveAuthoringLayout): mismos agujeros board-local por
 * pieza anfitriona en AMBOS runtimes (drift 0 — aceptación de la issue).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveProjectDrilling } from './projectDrilling';
import type { AgregadoRigidMember } from './agregadoAssembly';
import type { Agregado, Catalog, Component, Hardware, MachiningOperation, Module, Structure } from './types';
import { IDS, plantillaCatalogWithModules, plantillaProject } from './__fixtures__/plantillaDemo';

interface MemberHostFixture {
  readonly module: { readonly widthMm: number; readonly heightMm: number; readonly depthMm: number };
  readonly carcase: {
    readonly thicknessMm: number;
    readonly components: {
      readonly id: string;
      readonly code: string;
      readonly name: string;
      readonly placement: string;
      readonly lengthFormula: string;
      readonly widthFormula: string;
      readonly optionRole: string;
    }[];
  };
  readonly drawer: {
    readonly agregadoId: string;
    readonly code: string;
    readonly name: string;
    readonly widthMm: number;
    readonly heightMm: number;
    readonly depthMm: number;
    readonly members: {
      readonly memberId: string;
      readonly role: string;
      readonly hardwareId: string;
      readonly hostPlacement: string;
      readonly xRef: string;
      readonly yOffsetMm?: number;
    }[];
  };
  readonly hardware: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly operations: {
      readonly id: string;
      readonly kind: string;
      readonly diameterMm: number;
      readonly depthMm: number;
      readonly xMm: number;
      readonly yMm: number;
    }[];
  }[];
  readonly expected: {
    readonly byMember: Record<
      string,
      {
        readonly hostPlacement: string;
        readonly holes: {
          readonly face: string;
          readonly xMm: number;
          readonly yMm: number;
          readonly diameterMm: number;
          readonly depthMm: number;
        }[];
      }
    >;
  };
}

const fixturePath = resolve(__dirname, '../../../contracts/memberHostDrilling.contract.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as MemberHostFixture;

// The carcase: the fixture carries the runtime-neutral identity slice; the
// formulas (PH/PD/PW) resolve through the composed-module engine on each
// runtime. The geometry numbers are the formula fallbacks (same shape the
// formulas produce for the fixture's module dims).
const carcaseComponents: Component[] = fixture.carcase.components.map((c) => ({
  id: c.id,
  code: c.code,
  name: c.name,
  placement: c.placement as Component['placement'],
  geometry: {
    kind: 'rectangular_board',
    lengthMm: fixture.module.heightMm,
    widthMm: c.widthFormula === 'PW' ? fixture.module.widthMm : fixture.module.depthMm,
    thicknessMm: fixture.carcase.thicknessMm,
    lengthFormula: c.lengthFormula,
    widthFormula: c.widthFormula,
  },
  defaultEdges: [
    { side: 'L1', enabled: false },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ],
  optionRoles: [c.optionRole],
  active: true,
}));

const structure: Structure = {
  id: 'st-mbox',
  code: 'CUERPO-MBOX',
  name: 'Cuerpo MBOX',
  components: fixture.carcase.components.map((c) => ({ componentId: c.id, quantity: 1 })),
};

const drawer: Agregado = {
  id: fixture.drawer.agregadoId,
  code: fixture.drawer.code,
  name: fixture.drawer.name,
  externalDims: {
    width: fixture.drawer.widthMm,
    height: fixture.drawer.heightMm,
    depth: fixture.drawer.depthMm,
  },
  rigidMembers: fixture.drawer.members.map((m): AgregadoRigidMember => ({
    memberId: m.memberId,
    role: m.role,
    source: { kind: 'fixed', fixed: { hardwareId: m.hardwareId } },
    placement: {
      x: { ref: m.xRef as 'min' | 'max', offsetMm: 0 },
      y: { ref: 'min', offsetMm: m.yOffsetMm ?? 0 },
      z: { ref: 'min', offsetMm: 0 },
    },
    bomRole: 'non_purchasing',
    hostPlacement: m.hostPlacement,
  })),
};

const rails: Hardware[] = fixture.hardware.map((h) => ({
  id: h.id,
  code: h.code,
  name: h.name,
  unit: 'piece',
  costPerUnit: 0,
  active: true,
  machining: {
    parts: [
      {
        id: 'pilot',
        role: 'screw',
        operations: h.operations.map(
          (op): MachiningOperation => ({
            id: op.id,
            kind: op.kind as MachiningOperation['kind'],
            diameterMm: op.diameterMm,
            depthMm: op.depthMm,
            xMm: op.xMm,
            yMm: op.yMm,
            face: 'anchor' as MachiningOperation['face'],
          }),
        ),
      },
    ],
  },
}));

const modMbox: Module = {
  id: 'mod-mbox',
  code: 'MOD-MBOX',
  name: 'Base MERIVOBOX',
  externalDims: { width: fixture.module.widthMm, height: fixture.module.heightMm, depth: fixture.module.depthMm },
  furnitureType: 'inferior',
  structureId: structure.id,
  components: [],
  agregados: [{ id: 'inst-mbox', agregadoId: drawer.id, quantity: 1 }],
  hardwareLines: [],
};

const catalog: Catalog = {
  ...plantillaCatalogWithModules,
  hardware: [...plantillaCatalogWithModules.hardware, ...rails],
  components: [...(plantillaCatalogWithModules.components ?? []), ...carcaseComponents],
  agregados: [drawer],
  structures: [...(plantillaCatalogWithModules.structures ?? []), structure],
  modules: [...plantillaCatalogWithModules.modules, modMbox],
};

const project = {
  ...plantillaProject,
  items: [
    {
      id: 'item-mbox',
      moduleId: modMbox.id,
      quantity: 1,
      optionChoices: { LATERAL: IDS.matArauco, FRENTE: IDS.matArauco },
    },
  ],
};

describe('memberHostDrilling contract (#1429 slice B)', () => {
  const result = resolveProjectDrilling({ project, catalog, generatedAt: '2026-11-05T00:00:00.000Z' });

  // hostPlacement → carcase component name (the fixture names the component
  // each placement role belongs to; the pattern joins by partName).
  const nameByPlacement = new Map(
    fixture.carcase.components.map((c) => [c.placement, c.name] as const),
  );

  for (const [memberId, want] of Object.entries(fixture.expected.byMember)) {
    it(`el miembro ${memberId} taladra su pieza anfitriona (${want.hostPlacement}) con los agujeros del contrato`, () => {
      const partName = nameByPlacement.get(want.hostPlacement);
      expect(partName, `componente para ${want.hostPlacement}`).toBeDefined();
      const pattern = result.patterns.find((p) => p.partName === partName);
      expect(pattern, `patrón para ${partName}`).toBeDefined();
      for (const hole of want.holes) {
        const matches = pattern!.holes.filter(
          (h) =>
            h.face === hole.face &&
            Math.abs(h.xMm - hole.xMm) < 0.01 &&
            Math.abs(h.yMm - hole.yMm) < 0.01 &&
            Math.abs(h.diameterMm - hole.diameterMm) < 0.01 &&
            Math.abs(h.depthMm - hole.depthMm) < 0.01,
        );
        expect(matches.length, `agujero ${JSON.stringify(hole)} en ${partName}`).toBe(1);
      }
    });
  }

  it('sin issues de resolución (member-host resuelve limpio en las piezas anfitrionas)', () => {
    // La proyección member-host y el transporte F131 no reportan nada: los
    // avisos F129 default (cajas minifix de la plantilla sobre una carrocería
    // sin tapas) son ruido ajeno a este contrato y quedan fuera de la
    // aserción.
    expect(result.resolutionIssues.map((i) => `${i.code}: ${i.message}`)).toEqual([]);
    for (const pattern of result.patterns) {
      const memberHostIssues = pattern.issues.filter((i) => i.message.includes('member-host'));
      expect(memberHostIssues).toEqual([]);
    }
  });
});

// #1429 slice B (review B1): el lado TS del dedupe y del fail-closed tiene
// sus propios tests — una regresión que silencie la señal o duplique el
// agujero no puede quedar en verde.
describe('memberHostDrilling — dedupe y fail-closed en el pipeline (#1429 slice B)', () => {
  it('un placement manual equivalente SUPRIME el agujero member-host duplicado (la autoría manda)', () => {
    // Herraje de UN piloto con el perfil exacto de una fila Blum: el placement
    // manual ancla en (front, 207, 33.5) — el golden hole de fixed_rail_left.
    const tornillo: Hardware = {
      id: 'hw-tornillo-32-12',
      code: 'TOR-32-12',
      name: 'Tornillo piloto Ø3.2×12',
      unit: 'piece',
      costPerUnit: 0,
      active: true,
      machining: {
        parts: [
          {
            id: 'pilot',
            role: 'screw',
            operations: [
              { id: 'pilot-1', kind: 'screw_pilot', diameterMm: 3.2, depthMm: 12, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      },
    };
    const structureConManual: Structure = {
      ...structure,
      components: (structure.components ?? []).map((c) =>
        c.componentId === 'comp-side'
          ? {
              ...c,
              overrides: {
                hardwarePlacements: [
                  { hardwareId: tornillo.id, anchorFace: 'front', relativePosition: { xMm: 207, yMm: 33.5 } },
                ],
              },
            }
          : c,
      ),
    };
    const catalogConManual: Catalog = {
      ...catalog,
      hardware: [...catalog.hardware, tornillo],
      structures: catalog.structures?.map((s) => (s.id === structure.id ? structureConManual : s)),
    };
    const resultado = resolveProjectDrilling({
      project,
      catalog: catalogConManual,
      generatedAt: '2026-11-05T00:00:00.000Z',
    });

    const lateral = resultado.patterns.find((p) => p.partName === 'Lateral');
    expect(lateral).toBeDefined();
    const enElPunto = lateral!.holes.filter(
      (h) =>
        h.face === 'front' &&
        Math.abs(h.xMm - 207) < 0.01 &&
        Math.abs(h.yMm - 33.5) < 0.01 &&
        Math.abs(h.diameterMm - 3.2) < 0.01 &&
        Math.abs(h.depthMm - 12) < 0.01,
    );
    // El punto aparece EXACTAMENTE una vez (el manual): el member-host
    // equivalente se suprime, ni duplicado ni colisión.
    expect(enElPunto).toHaveLength(1);
    // Las otras 5 filas Blum siguen perforando: 5 member-host + 1 manual.
    const filas = lateral!.holes.filter((h) => h.face === 'front' && Math.abs(h.diameterMm - 3.2) < 0.01);
    expect(filas).toHaveLength(6);
  });

  it('hostPlacement sin pieza con ese rol → exactamente 1 issue fail-closed por template', () => {
    // Carrocería sin lateral derecho: fixed_rail_right declara
    // lateral_derecho y el mueble no tiene esa pieza.
    const carcaseSinDerecho: Component[] = carcaseComponents.filter((c) => c.id !== 'comp-side-r');
    const structureSinDerecho: Structure = {
      ...structure,
      components: [{ componentId: 'comp-side', quantity: 1 }, { componentId: 'comp-front', quantity: 1 }],
    };
    const modSinDerecho: Module = { ...modMbox, id: 'mod-mbox-sin-der', code: 'MOD-MBOX-SD' };
    const catalogSinDerecho: Catalog = {
      ...catalog,
      components: [...(catalog.components ?? []).filter((c) => !carcaseComponents.some((cc) => cc.id === c.id && cc.id === 'comp-side-r')), ...carcaseSinDerecho],
      structures: catalog.structures?.map((s) => (s.id === structure.id ? structureSinDerecho : s)),
      modules: [...(catalog.modules ?? []).filter((m) => m.id !== modMbox.id), modSinDerecho],
    };
    const resultado = resolveProjectDrilling({
      project: { ...project, items: [{ ...project.items[0]!, id: 'item-sin-der', moduleId: modSinDerecho.id }] },
      catalog: catalogSinDerecho,
      generatedAt: '2026-11-05T00:00:00.000Z',
    });

    const issues = resultado.resolutionIssues.filter((i) => i.code === 'DRILLING_MEMBER_HOST_UNRESOLVED');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.stage).toBe('member-host');
    expect(issues[0]!.blocking).toBe(true);
    expect(issues[0]!.message).toContain('lateral_derecho');
  });
});
