/**
 * #442 — Contract de paridad TS/Go del tratamiento de base (zócalo/patas).
 *
 * Lee `contracts/plinthBaseParity.contract.json` y afirma que el motor TS
 * produce los outputs congelados. El MISMO fixture lo consume
 * `backend-go/internal/domain/engine/plinthBaseParityContract_test.go` —
 * cualquier divergencia TS↔Go↔fixture rompe ambas suites (regla AGENTS:
 * una regla que vive en TS y Go necesita contract fixture de paridad).
 *
 * Regla del contract: si un motor diverge, se alinea el motor — nunca el
 * expected del fixture.
 */

import { describe, expect, it } from 'vitest';
import contract from '../../../contracts/plinthBaseParity.contract.json';
import { resolveBom } from './engine';
import { baseContextForItem } from './plinth';
import type {
  Catalog,
  Module,
  Project,
  ProjectItem,
  ProjectKitchenLayout,
  ResolvedBoardPart,
  ResolvedHardwareLine,
} from './types';

const fx = contract as unknown as {
  readonly catalog: Catalog;
  readonly scenarios: readonly {
    readonly id: string;
    readonly description: string;
    readonly moduleId: string;
    readonly itemBaseMode?: string;
    readonly layout?: ProjectKitchenLayout;
    readonly optionChoicesOverride?: Record<string, string>;
    readonly expected: {
      readonly parts: readonly {
        readonly id?: string;
        readonly code?: string;
        readonly description: string;
        readonly lengthMm: number;
        readonly widthMm: number;
        readonly quantity: number;
        readonly optionRole: string;
        readonly edges: readonly string[];
        readonly materialId: string;
      }[];
      readonly hardware: readonly {
        readonly id?: string;
        readonly optionRole: string;
        readonly quantity: number;
        readonly hardwareId: string;
        readonly descriptionOverride?: string;
      }[];
    };
  }[];
};

const BASE_CHOICES: Record<string, string> = {
  FRENTE: 'mat-front',
  INTERIOR: 'mat-body',
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
  if (exp.id !== undefined && part.id !== exp.id) return false;
  if (exp.code !== undefined && part.code !== exp.code) return false;
  return (
    part.description === exp.description &&
    part.lengthMm === exp.lengthMm &&
    part.widthMm === exp.widthMm &&
    part.optionRole === exp.optionRole &&
    enabledEdges(part.edges) === [...exp.edges].sort().join(',') &&
    part.materialId === exp.materialId
  );
}

function hardwareMatches(
  line: ResolvedHardwareLine,
  exp: (typeof fx.scenarios)[number]['expected']['hardware'][number],
): boolean {
  if (exp.id !== undefined && line.id !== exp.id) return false;
  if (exp.descriptionOverride !== undefined && line.descriptionOverride !== exp.descriptionOverride) {
    return false;
  }
  return (
    line.optionRole === exp.optionRole &&
    line.quantity === exp.quantity &&
    line.hardwareId === exp.hardwareId
  );
}

function consumeOne<T>(
  pool: T[],
  matches: (item: T) => boolean,
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

describe('plinthBaseParity contract (shared with Go)', () => {
  expect(fx.scenarios.length).toBeGreaterThanOrEqual(13);

  for (const scenario of fx.scenarios) {
    it(scenario.id, () => {
      const module = fx.catalog.modules.find((m) => m.id === scenario.moduleId);
      expect(module, `module ${scenario.moduleId} del scenario ${scenario.id}`).toBeTruthy();

      const item: ProjectItem = {
        id: 'item-1',
        moduleId: scenario.moduleId,
        quantity: 1,
        optionChoices: { ...BASE_CHOICES, ...scenario.optionChoicesOverride },
        ...(scenario.itemBaseMode ? { baseMode: scenario.itemBaseMode as ProjectItem['baseMode'] } : {}),
      };
      const project = {
        items: [item],
        ...(scenario.layout ? { kitchenLayout: scenario.layout } : {}),
      } as Pick<Project, 'items' | 'kitchenLayout'>;

      const context = baseContextForItem(project, item, fx.catalog);
      const bom = resolveBom(
        module as Module,
        item.optionChoices,
        fx.catalog,
        undefined,
        undefined,
        context,
      );

      // Parts: cada expected entry consume `quantity` partes idénticas; al
      // final no debe sobrar ninguna (ni fantasma ni faltante).
      const actualParts = [...bom.boardParts];
      for (const exp of scenario.expected.parts) {
        for (let i = 0; i < exp.quantity; i++) {
          consumeOne(
            actualParts,
            (p) => partMatches(p, exp),
            scenario.id,
            `parte expected ${exp.description} ${exp.lengthMm}×${exp.widthMm}`,
          );
        }
      }
      expect(
        actualParts,
        `${scenario.id}: partes no esperadas en el BOM`,
      ).toHaveLength(0);

      // Hardware: match exacto (ml fraccional incluido).
      const actualHardware = [...bom.hardwareLines];
      for (const exp of scenario.expected.hardware) {
        consumeOne(
          actualHardware,
          (l) => hardwareMatches(l, exp),
          scenario.id,
          `herraje expected ${exp.optionRole} ×${exp.quantity}`,
        );
      }
      expect(
        actualHardware,
        `${scenario.id}: herraje no esperado en el BOM`,
      ).toHaveLength(0);
    });
  }
});
