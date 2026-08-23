/**
 * F145 / #313 (P3D-7) — Contract diseño→BOM→precio compartido con Go.
 *
 * Lee `contracts/designBomPrice.json` y afirma que el motor TS produce los
 * outputs congelados. El MISMO fixture lo consume
 * `backend-go/internal/domain/engine/designBomPriceContract_test.go` —
 * cualquier divergencia TS↔Go↔fixture rompe ambas suites (regla AGENTS:
 * una regla que vive en TS y Go necesita contract fixture de paridad).
 *
 * Regla del contract: si un motor diverge, se alinea el motor — nunca el
 * expected del fixture.
 */

import { describe, expect, it } from 'vitest';
import contract from '../../../contracts/designBomPrice.json';
import {
  calcProjectBreakdown,
  resolveBom,
} from './engine';
import { computeProductionDesignFingerprint } from './productionRevision';
import type {
  Catalog,
  Module,
  Project,
  ProjectItem,
} from './types';

const fx = contract as unknown as {
  readonly ambientMaterialIds: readonly string[];
  readonly catalog: Catalog;
  readonly project: Project;
  readonly scenarios: readonly {
    readonly id: string;
    readonly description: string;
    readonly agregadoQty: number;
    readonly customDims?: { widthMm: number; heightMm: number; depthMm: number };
    readonly optionChoicesOverride?: Record<string, string>;
    readonly expected: {
      readonly parts: readonly {
        readonly description: string;
        readonly lengthMm: number;
        readonly widthMm: number;
        readonly materialId: string;
        readonly count: number;
      }[];
      readonly hardwareTotals: Record<string, number>;
      readonly materialsCost: number;
      readonly hardwareTotal: number;
      readonly directCost: number;
      readonly salePrice: number;
    };
  }[];
  readonly staleFingerprint: {
    readonly description: string;
    readonly customDims: { widthMm: number; heightMm: number; depthMm: number };
  };
};

function moduleForScenario(agregadoQty: number): Module {
  const base = fx.catalog.modules.find((m) => m.id === 'm-bajo')!;
  if (agregadoQty > 0) {
    return {
      ...base,
      agregados: [{ agregadoId: 'agr-cajon', quantity: agregadoQty }],
    };
  }
  return base;
}

function projectForScenario(
  scenario: (typeof fx.scenarios)[number],
): Project {
  const baseItem = fx.project.items[0]!;
  const item: ProjectItem = {
    ...baseItem,
    ...(scenario.optionChoicesOverride
      ? {
          optionChoices: {
            ...baseItem.optionChoices,
            ...scenario.optionChoicesOverride,
          },
        }
      : {}),
    ...(scenario.customDims ? { customDims: scenario.customDims } : {}),
  };
  return { ...fx.project, items: [item] };
}

/** Firma estable de piezas entre motores: los IDs internos difieren por diseño. */
function partSignatureKey(p: {
  description?: string;
  lengthMm: number;
  widthMm: number;
  materialId?: string;
}): string {
  return `${p.description ?? ''}|${p.lengthMm}|${p.widthMm}|${p.materialId ?? ''}`;
}

describe('contract diseño→BOM→precio (fixture compartido TS/Go)', () => {
  for (const scenario of fx.scenarios) {
    it(`${scenario.id}: ${scenario.description}`, () => {
      const module = moduleForScenario(scenario.agregadoQty);
      const project = projectForScenario(scenario);
      const item = project.items[0]!;

      // 1) BOM: piezas por firma (description + dims + material) y multiplicidad.
      const bom = resolveBom(
        module,
        item.optionChoices,
        { ...fx.catalog, modules: [module] },
        item.measurePresetId,
        undefined,
        undefined,
        item.customDims,
      );

      const counts = new Map<string, number>();
      for (const part of bom.boardParts) {
        const key = partSignatureKey(part);
        counts.set(key, (counts.get(key) ?? 0) + part.quantity);
      }
      expect([...counts.entries()].sort()).toEqual(
        scenario.expected.parts
          .map((p) => [partSignatureKey(p), p.count] as [string, number])
          .sort(),
      );

      // Anti-leak ambiental: ningún id ambiental puede aparecer en el BOM.
      for (const part of bom.boardParts) {
        expect(fx.ambientMaterialIds).not.toContain(part.materialId);
      }

      // 2) Hardware: agregado por hardwareId resuelto (TS emite N líneas qty 1,
      //    Go 1 línea qty N — el costo coincide; el contract congela el total).
      const hardwareTotals = new Map<string, number>();
      for (const line of bom.hardwareLines) {
        hardwareTotals.set(
          line.hardwareId,
          (hardwareTotals.get(line.hardwareId) ?? 0) + line.quantity,
        );
      }
      expect(Object.fromEntries([...hardwareTotals.entries()].sort())).toEqual(
        Object.fromEntries(
          Object.entries(scenario.expected.hardwareTotals).sort(),
        ),
      );

      // 3) Precio: breakdown completo del proyecto (mismo policy de no
      //    redondeo intermedio que Go; tolerancia 0.01 del golden).
      const catalog = { ...fx.catalog, modules: [module] };
      const breakdown = calcProjectBreakdown(project, catalog);
      expect(breakdown.materialsCost).toBeCloseTo(
        scenario.expected.materialsCost,
        2,
      );
      expect(breakdown.hardwareTotal).toBeCloseTo(
        scenario.expected.hardwareTotal,
        2,
      );
      expect(breakdown.directCost).toBeCloseTo(
        scenario.expected.directCost,
        2,
      );
      expect(breakdown.salePrice).toBeCloseTo(scenario.expected.salePrice, 2);
    });
  }

  it('stale-fingerprint: customDims cambia el fingerprint de diseño (O1/#300 pendiente para release flow)', () => {
    const base = computeProductionDesignFingerprint(fx.project);
    const withCustom = computeProductionDesignFingerprint({
      ...fx.project,
      items: [
        {
          ...fx.project.items[0]!,
          customDims: fx.staleFingerprint.customDims,
        },
      ],
    });
    expect(base).not.toBe(withCustom);
    // Sin customDims el token legacy se preserva (sin false-stale masivo).
    expect(base).not.toContain('|d=');
    expect(withCustom).toContain('|d=');
  });

  it('customDims de módulo no paramétrico rechaza (mirror TS/Go)', () => {
    const fixed = {
      ...fx.catalog.modules.find((m) => m.id === 'm-bajo')!,
      structureId: undefined,
    };
    expect(() =>
      resolveBom(
        fixed,
        fx.project.items[0]!.optionChoices,
        { ...fx.catalog, modules: [fixed] },
        'p600',
        undefined,
        undefined,
        fx.staleFingerprint.customDims,
      ),
    ).toThrowError(/no es paramétrico/);
  });
});
