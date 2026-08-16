import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import {
  allModulesLoaded,
  allModulesPackaged,
  calculateLoadingProgress,
  countFloorStatuses,
  nextItemFloorStatus,
  normalizeItemFloorStatus,
  setProjectItemFloorStatus,
} from './productionFloor';

function project(): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 2, optionChoices: {}, floorStatus: 'cut' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

describe('productionFloor (PROD-3.1 + Logistics)', () => {
  it('normalizes missing status to pending', () => {
    expect(normalizeItemFloorStatus(undefined)).toBe('pending');
    expect(normalizeItemFloorStatus('nope')).toBe('pending');
  });

  it('advances pipeline with nextItemFloorStatus', () => {
    expect(nextItemFloorStatus('pending')).toBe('cut');
    expect(nextItemFloorStatus('cut')).toBe('edged');
    expect(nextItemFloorStatus('edged')).toBe('assembled');
    expect(nextItemFloorStatus('assembled')).toBe('packaged');
    expect(nextItemFloorStatus('packaged')).toBe('loaded');
    expect(nextItemFloorStatus('loaded')).toBe('installed');
    expect(nextItemFloorStatus('installed')).toBeNull();
  });

  it('sets floor status on one item', () => {
    const next = setProjectItemFloorStatus(project(), 'i1', 'assembled', '2026-02-01T00:00:00.000Z');
    expect(next.items[0]!.floorStatus).toBe('assembled');
    expect(next.items[1]!.floorStatus).toBe('cut');
    expect(next.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('counts statuses', () => {
    const c = countFloorStatuses(project());
    expect(c.pending).toBe(1);
    expect(c.cut).toBe(1);
    expect(c.assembled).toBe(0);
    expect(c.packaged).toBe(0);
    expect(c.loaded).toBe(0);
  });

  it('evaluates allModulesPackaged and allModulesLoaded', () => {
    const base = project();
    expect(allModulesPackaged(base)).toBe(false);
    expect(allModulesLoaded(base)).toBe(false);

    const packagedProj: Project = {
      ...base,
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {}, floorStatus: 'packaged' },
        { id: 'i2', moduleId: 'm2', quantity: 2, optionChoices: {}, floorStatus: 'loaded' },
      ],
    };
    expect(allModulesPackaged(packagedProj)).toBe(true);
    expect(allModulesLoaded(packagedProj)).toBe(false);

    const loadedProj: Project = {
      ...base,
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {}, floorStatus: 'loaded' },
        { id: 'i2', moduleId: 'm2', quantity: 2, optionChoices: {}, floorStatus: 'loaded' },
      ],
    };
    expect(allModulesPackaged(loadedProj)).toBe(true);
    expect(allModulesLoaded(loadedProj)).toBe(true);
  });

  it('calculates loading progress correctly', () => {
    const base = project();
    const p1 = calculateLoadingProgress(base);
    expect(p1.totalUnits).toBe(3); // 1 + 2
    expect(p1.loadedUnits).toBe(0);
    expect(p1.percentage).toBe(0);
    expect(p1.isComplete).toBe(false);

    const partialProj: Project = {
      ...base,
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {}, floorStatus: 'loaded' },
        { id: 'i2', moduleId: 'm2', quantity: 2, optionChoices: {}, floorStatus: 'packaged' },
      ],
    };
    const p2 = calculateLoadingProgress(partialProj);
    expect(p2.totalUnits).toBe(3);
    expect(p2.loadedUnits).toBe(1);
    expect(p2.percentage).toBe(33);
    expect(p2.isComplete).toBe(false);

    const fullProj: Project = {
      ...base,
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {}, floorStatus: 'loaded' },
        { id: 'i2', moduleId: 'm2', quantity: 2, optionChoices: {}, floorStatus: 'loaded' },
      ],
    };
    const p3 = calculateLoadingProgress(fullProj);
    expect(p3.totalUnits).toBe(3);
    expect(p3.loadedUnits).toBe(3);
    expect(p3.percentage).toBe(100);
    expect(p3.isComplete).toBe(true);
  });
});
