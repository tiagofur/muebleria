/**
 * #1496 — Contract de paridad TS/Go del tipo de mueble panel (eje del espesor).
 *
 * Lee `contracts/panelThicknessParity.contract.json` y afirma que el motor TS
 * reemplaza el eje declarado con el espesor del material FRENTE antes de
 * expandir piezas. El MISMO fixture lo consume
 * `backend-go/internal/domain/engine/panelThicknessParityContract_test.go` —
 * cualquier divergencia TS↔Go↔fixture rompe ambas suites (regla AGENTS:
 * una regla que vive en TS y Go necesita contract fixture de paridad).
 *
 * Regla del contract: si un motor diverge, se alinea el motor — nunca el
 * expected del fixture.
 */

import { describe, expect, it } from 'vitest';
import contract from '../../../contracts/panelThicknessParity.contract.json';
import { resolveBom } from './engine';
import type {
  Catalog,
  Module,
  ResolvedBoardPart,
  ResolvedHardwareLine,
} from './types';

const fx = contract as unknown as {
  readonly catalog: Catalog;
  readonly scenarios: readonly {
    readonly id: string;
    readonly description: string;
    readonly moduleId: string;
    readonly optionChoicesOverride?: Record<string, string>;
    readonly expected: {
      readonly parts: readonly {
        readonly description: string;
        readonly lengthMm: number;
        readonly widthMm: number;
        readonly quantity: number;
        readonly optionRole: string;
        readonly edges: readonly string[];
        readonly materialId: string;
      }[];
      readonly hardware: readonly unknown[];
    };
  }[];
};

function enabledEdges(
  edges: readonly { readonly side: string; readonly enabled: boolean }[] | undefined,
): string {
  return (edges ?? [])
    .filter((e) => e.enabled)
    .map((e) => e.side)
    .sort()
    .join(',');
}

function partMatches(
  part: ResolvedBoardPart,
  exp: (typeof fx.scenarios)[number]['expected']['parts'][number],
): boolean {
  return (
    part.description === exp.description &&
    part.lengthMm === exp.lengthMm &&
    part.widthMm === exp.widthMm &&
    part.optionRole === exp.optionRole &&
    enabledEdges(part.edges) === [...exp.edges].sort().join(',') &&
    part.materialId === exp.materialId
  );
}

function consumeOne(
  pool: ResolvedBoardPart[],
  matches: (part: ResolvedBoardPart) => boolean,
  scenarioId: string,
  what: string,
): void {
  const idx = pool.findIndex(matches);
  expect(
    idx,
    `${scenarioId}: ${what} no encontrado en el output (restante: ${JSON.stringify(pool)})`,
  ).toBeGreaterThanOrEqual(0);
  pool.splice(idx, 1);
}

describe('panelThicknessParity contract (shared with Go)', () => {
  expect(fx.scenarios.length).toBeGreaterThanOrEqual(4);

  for (const scenario of fx.scenarios) {
    it(scenario.id, () => {
      const module = fx.catalog.modules.find((m) => m.id === scenario.moduleId);
      expect(module, `module ${scenario.moduleId} del scenario ${scenario.id}`).toBeTruthy();

      const bom = resolveBom(
        module as Module,
        { ...scenario.optionChoicesOverride },
        fx.catalog,
      );

      const parts = [...bom.boardParts];
      const hardware = [...bom.hardwareLines];
      for (const expPart of scenario.expected.parts) {
        consumeOne(
          parts,
          (p) => partMatches(p, expPart),
          scenario.id,
          `pieza ${expPart.description} ${expPart.lengthMm}×${expPart.widthMm}`,
        );
      }
      // Sin herrajes esperados en este contract: cualquier línea residual falla.
      expect(parts, `${scenario.id}: partes residuales`).toEqual([]);
      expect(hardware, `${scenario.id}: herrajes residuales`).toEqual([]);
    });
  }
});
