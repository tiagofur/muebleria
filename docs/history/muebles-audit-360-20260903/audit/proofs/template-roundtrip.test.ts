import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectToTemplate, createProjectFromTemplate } from '../../source/packages/domain/src/duplicate';
import type { Project, ProjectKitchenLayout, ProjectTemplate } from '../../source/packages/domain/src/types';

const now = '2026-09-04T00:00:00.000Z';
const firstPlacement = { itemId: 'item-kitchen', instanceIndex: 0, wallId: 'wall-kitchen', offsetMm: 50, elevation: 'floor' as const };
const secondPlacement = { itemId: 'item-bath', instanceIndex: 0, wallId: 'wall-bath', offsetMm: 100, elevation: 'floor' as const };
const layout: ProjectKitchenLayout = {
  walls: [{ id: 'wall-kitchen', lengthMm: 3000, angleDeg: 0 }],
  placements: [firstPlacement],
  baseClearanceMm: 137,
  wallCabinetZMm: 1520,
  showCountertop: false,
  countertopMaterialId: 'ambient-countertop-audit',
  activeSpaceId: 'space-kitchen',
  spaces: [
    { id: 'space-kitchen', name: 'Kitchen', walls: [{ id: 'wall-kitchen', lengthMm: 3000, angleDeg: 0 }], placements: [firstPlacement], baseClearanceMm: 137, wallCabinetZMm: 1520, showCountertop: false },
    { id: 'space-bath', name: 'Bathroom', walls: [{ id: 'wall-bath', lengthMm: 1800, angleDeg: 90 }], placements: [secondPlacement], baseClearanceMm: 80, wallCabinetZMm: 1400, showCountertop: true },
  ],
};
const project: Project = {
  id: 'audit-project', name: 'Two-space template source', customerId: 'audit-customer',
  currency: 'MXN', marginFactor: 1.3, laborFixedCost: 100, status: 'draft',
  items: [
    { id: 'item-kitchen', moduleId: 'module-base', quantity: 1, optionChoices: {} },
    { id: 'item-bath', moduleId: 'module-bath', quantity: 1, optionChoices: {} },
  ],
  kitchenLayout: layout, createdAt: now, updatedAt: now,
};
const fields = ['spaces', 'activeSpaceId', 'baseClearanceMm', 'wallCabinetZMm', 'showCountertop', 'countertopMaterialId'] as const;
function projectFrom(template: ProjectTemplate) {
  let sequence = 0;
  return createProjectFromTemplate(template, { newId: 'audit-new-project', itemIdFactory: () => `new-item-${++sequence}`, nowIso: now, customerId: 'audit-new-customer', name: 'Template result' });
}
function summarize(value: ProjectKitchenLayout | undefined) {
  return { keys: Object.keys(value ?? {}), spaceCount: value?.spaces?.length ?? 0, placementCount: value?.placements.length ?? 0, baseClearanceMm: value?.baseClearanceMm ?? null, wallCabinetZMm: value?.wallCabinetZMm ?? null, showCountertop: value?.showCountertop ?? null, countertopMaterialId: value?.countertopMaterialId ?? null, activeSpaceId: value?.activeSpaceId ?? null };
}

describe('FM-01 audit-only defect reproduction; passing means loss reproduced, not fixed', () => {
  it('projectToTemplate drops supported multi-space/base/countertop configuration', () => {
    const template = projectToTemplate(project, { newId: 'audit-template', nowIso: now });
    for (const field of fields) expect(template.kitchenLayout?.[field]).toBeUndefined();
    expect(template.kitchenLayout?.walls).toEqual(layout.walls);
    expect(template.kitchenLayout?.placements).toEqual(layout.placements);
    expect(project.kitchenLayout).toEqual(layout);
  });
  it('createProjectFromTemplate independently drops configuration even when template has complete layout', () => {
    const completeTemplate: ProjectTemplate = { ...projectToTemplate(project, { newId: 'audit-template', nowIso: now }), kitchenLayout: layout };
    const result = projectFrom(completeTemplate);
    for (const field of fields) expect(result.kitchenLayout?.[field]).toBeUndefined();
    expect(result.kitchenLayout?.placements[0]?.itemId).toBe('new-item-1');
    expect(result.items).toHaveLength(2);
    expect(completeTemplate.kitchenLayout).toEqual(layout);
  });
  it('records expected versus actual pure-domain round-trip without UI, DB or server claims', () => {
    const template = projectToTemplate(project, { newId: 'audit-template', nowIso: now });
    const result = projectFrom(template);
    expect(result.kitchenLayout?.spaces).toBeUndefined();
    expect(result.items).toHaveLength(2);
    expect(result.kitchenLayout?.placements).toHaveLength(1);
    const proof = {
      id: 'FM-01-PURE-PROOF', findingId: 'FM-01', sourceCommit: '316df57c7c3c9d5470b5a3f22b39fffeacfd7676',
      status: 'CONFIRMED_PURE_DOMAIN_REPRODUCTION', tests: 3,
      meaning: 'Passing assertions reproduce the defect; no product fix was made.',
      expected: summarize(layout), templateActual: summarize(template.kitchenLayout), roundTripActual: summarize(result.kitchenLayout),
      lostFields: fields, retained: ['two project items', 'active top-level wall and placement', 'placement item-ID remapping'],
      scope: 'Actual production domain functions with a typed synthetic two-space fixture; no UI/store persistence/API/DB/native execution.',
      sourceFunctions: ['projectToTemplate', 'createProjectFromTemplate'],
      evidence: ['packages/domain/src/duplicate.ts:274-313', 'packages/domain/src/duplicate.ts:333-380'],
      missingProof: 'UI save/create/reload and server persistence not exercised; consequences beyond returned object shape remain unverified.',
    };
    writeFileSync(fileURLToPath(new URL('../data/template-roundtrip-proof.json', import.meta.url)), JSON.stringify(proof, null, 2) + '\n');
  });
});
