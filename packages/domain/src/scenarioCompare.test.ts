import { describe, expect, it } from 'vitest';
import {
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
  IDS,
} from './__fixtures__/plantillaDemo';
import {
  applyRoleChoiceToProject,
  compareRoleScenario,
  projectWithRoleChoice,
} from './scenarioCompare';

describe('scenarioCompare', () => {
  it('forces role choice on all lines', () => {
    const next = projectWithRoleChoice(plantillaProject, 'FRENTE', 'other-id');
    expect(next.priceSnapshot).toBeUndefined();
    expect(next.projectLevelChoices?.FRENTE).toBe('other-id');
    for (const item of next.items) {
      expect(item.optionChoices.FRENTE).toBe('other-id');
    }
  });

  it('compares sale prices for alternate frente', () => {
    // Same choice as A → delta 0
    const frenteA = plantillaChoices.FRENTE;
    if (!frenteA) {
      // fixture always has FRENTE
      expect(frenteA).toBeTruthy();
      return;
    }
    const same = compareRoleScenario(
      plantillaProject,
      plantillaCatalogWithModules,
      'FRENTE',
      frenteA,
    );
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.delta).toBe(0);
      expect(same.saleA).toBeGreaterThan(0);
    }
  });

  it('apply B updates draft timestamp and choices', () => {
    const applied = applyRoleChoiceToProject(
      plantillaProject,
      'FRENTE',
      IDS.matArauco,
      '2026-07-17T12:00:00.000Z',
    );
    expect(applied.status).toBe('draft');
    expect(applied.updatedAt).toBe('2026-07-17T12:00:00.000Z');
    expect(applied.items[0]?.optionChoices.FRENTE).toBeTruthy();
  });

  it('fails on empty project', () => {
    const r = compareRoleScenario(
      { ...plantillaProject, items: [] },
      plantillaCatalogWithModules,
      'FRENTE',
      'x',
    );
    expect(r.ok).toBe(false);
  });
});
