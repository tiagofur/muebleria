import { describe, expect, it } from 'vitest';
import type { Project, ProductionCutRow } from '@granete/domain';
import {
  PRODUCTION_ORDER_TABS,
  buildProductionOrderReadiness,
  isProductionOrderTab,
  parseProductionOrderTab,
  projectAllowsProductionOrder,
} from './productionOrderModel';

function baseProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const cutRow: ProductionCutRow = {
  quantity: 2,
  lengthMm: 720,
  widthMm: 560,
  description: 'Lateral',
  materialName: 'Blanco',
  grain: 0,
  L1: 0,
  L2: 0,
  W1: 0,
  W2: 0,
  moduleCode: 'M1',
  partCode: 'LAT',
};

describe('productionOrderModel (PROD-0.1 / 0.3)', () => {
  it('parses tabs and defaults to resumen', () => {
    expect(isProductionOrderTab('despiece')).toBe(true);
    expect(isProductionOrderTab('nope')).toBe(false);
    expect(isProductionOrderTab('exports')).toBe(false);
    expect(parseProductionOrderTab('vistas')).toBe('vistas');
    expect(parseProductionOrderTab('exports')).toBe('documentos');
    expect(parseProductionOrderTab('x')).toBe('resumen');
    expect(PRODUCTION_ORDER_TABS[0]).toBe('resumen');
    expect(PRODUCTION_ORDER_TABS).not.toContain('exports');
  });

  // #697 review matrix — the ONE access rule over the release authority:
  //   A. modern draft + canonical P1            → open
  //   B. modern draft without release           → closed
  //   C. modern + residual accepted + no P1     → closed (THE blocker case)
  //   D. true pre-DT + accepted                 → compatibility-only open
  //   E. true pre-DT + produced                 → compatibility-only open
  const canonicalRelease = {
    source: 'canonical' as const,
    releaseId: 'rel-1',
    releaseNumber: 1,
    designRevisionId: 'dr-1',
    designRevisionNumber: 2,
    quoteRevisionId: 'q-2',
    manufacturingFingerprint: 'sha256-abc',
    frozenRouting: true,
  };

  it('A: modern draft + canonical ProductionRelease opens the order', () => {
    // Digital Thread golden truth: Project.status stays draft forever; the
    // manufacturing authority (canonical release) decides factory access.
    const releasedDraft = baseProject({
      status: 'draft',
      hasDigitalThreadContext: true,
      resolvedProductionRelease: canonicalRelease,
    });
    expect(projectAllowsProductionOrder(releasedDraft)).toBe(true);
  });

  it('B: modern draft without a release stays closed', () => {
    expect(
      projectAllowsProductionOrder(baseProject({ status: 'draft', hasDigitalThreadContext: true })),
    ).toBe(false);
    // Without the projection the same holds: draft never opens.
    expect(projectAllowsProductionOrder(baseProject({ status: 'draft' }))).toBe(false);
  });

  it('C (blocker): modern DT project with residual accepted stamp and NO release fails closed', () => {
    // The exact #697 review case: a modern Digital Thread project (quote
    // revisions exist) whose Project.status was accidentally stamped
    // accepted. Legacy status compatibility must NOT apply — commercial
    // acceptance is a precondition for creating a release, never a
    // substitute for having one.
    const modernAccidentalStamp = baseProject({
      status: 'accepted',
      hasDigitalThreadContext: true,
    });
    expect(projectAllowsProductionOrder(modernAccidentalStamp)).toBe(false);
    expect(projectAllowsProductionOrder(baseProject({ status: 'produced', hasDigitalThreadContext: true }))).toBe(false);
  });

  it('D/E: true pre-Digital-Thread accepted|produced keeps compatibility-only access', () => {
    // The server projection positively identifies these projects as
    // pre-Digital-Thread (no quote revisions, no designs, no releases).
    expect(
      projectAllowsProductionOrder(baseProject({ status: 'accepted', hasDigitalThreadContext: false })),
    ).toBe(true);
    expect(
      projectAllowsProductionOrder(baseProject({ status: 'produced', hasDigitalThreadContext: false })),
    ).toBe(true);
    // Absent projection (local mode / stale payloads) is not positive legacy
    // evidence, so compatibility fails closed.
    expect(projectAllowsProductionOrder(baseProject({ status: 'accepted' }))).toBe(false);
    expect(projectAllowsProductionOrder(baseProject({ status: 'produced' }))).toBe(false);
    // Non-queue statuses stay closed in every interpretation.
    expect(projectAllowsProductionOrder(baseProject({ status: 'quoted', hasDigitalThreadContext: false }))).toBe(false);
  });

  it('readiness: ready when cut rows exist', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject(),
      cutRows: [cutRow],
    });
    expect(r.cutListOk).toBe(true);
    expect(r.cutRowCount).toBe(1);
    expect(r.moduleUnitCount).toBe(3);
    expect(r.moduleLineCount).toBe(2);
    expect(r.materialsResolved).toBe(true);
    expect(r.optimizerGenerable).toBe(true);
    expect(r.packGenerable).toBe(true);
    expect(r.readyToCut).toBe(true);
    expect(r.hasKitchenLayout).toBe(false);
  });

  it('readiness: cut failure is not ready', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject(),
      cutRows: null,
      cutListError: 'Módulo faltante',
    });
    expect(r.cutListOk).toBe(false);
    expect(r.readyToCut).toBe(false);
    expect(r.cutListError).toContain('Módulo');
  });

  it('readiness: empty cut rows not ready to cut', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject(),
      cutRows: [],
    });
    expect(r.cutListOk).toBe(true);
    expect(r.materialsResolved).toBe(false);
    expect(r.readyToCut).toBe(false);
  });

  it('detects kitchen layout and unplaced items', () => {
    const r = buildProductionOrderReadiness({
      project: baseProject({
        kitchenLayout: {
          walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0 }],
          placements: [
            {
              itemId: 'i1',
              instanceIndex: 0,
              wallId: 'w1',
              offsetMm: 0,
              elevation: 'floor',
            },
          ],
        },
      }),
      cutRows: [cutRow],
    });
    expect(r.hasKitchenLayout).toBe(true);
    expect(r.hasPlacements).toBe(true);
    expect(r.hasUnplacedItems).toBe(true); // i2 not placed
  });
});
