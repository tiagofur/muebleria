import { describe, expect, it } from 'vitest';

import type { Project, ProjectItem } from './types';
import {
  PRODUCTION_SECTORS,
  PIPELINE_SECTORS,
  PRODUCTION_SECTOR_LABELS_ES,
  isProductionSector,
  sectorForFloorStatus,
  floorStatusForSector,
  itemsWaitingForSector,
  buildProjectFloorSummary,
} from './productionSectors';
import {
  advanceFloorStatus,
  appendFloorEvent,
  floorTimelineForItem,
  latestFloorEvent,
} from './productionFloorEvents';

function makeItem(id: string, floorStatus?: ProjectItem['floorStatus']): ProjectItem {
  return {
    id,
    moduleId: 'mod-1',
    quantity: 1,
    optionChoices: {},
    floorStatus,
  };
}

function makeProject(items: ProjectItem[]): Project {
  return {
    id: 'p-1',
    name: 'Cocina Test',
    status: 'accepted',
    items,
    currency: 'MXN',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  } as unknown as Project;
}

describe('productionSectors', () => {
  it('covers every label for every sector', () => {
    for (const sector of PRODUCTION_SECTORS) {
      expect(typeof PRODUCTION_SECTOR_LABELS_ES[sector]).toBe('string');
      expect(PRODUCTION_SECTOR_LABELS_ES[sector].length).toBeGreaterThan(0);
    }
    expect(isProductionSector('cutting')).toBe(true);
    expect(isProductionSector('ventas')).toBe(false);
  });

  it('maps statuses to owning sectors and back', () => {
    expect(sectorForFloorStatus('pending')).toBeNull();
    expect(sectorForFloorStatus('cut')).toBe('cutting');
    expect(sectorForFloorStatus('edged')).toBe('edge_banding');
    expect(sectorForFloorStatus('assembled')).toBe('assembly');
    expect(sectorForFloorStatus('packaged')).toBe('packaging');
    expect(sectorForFloorStatus('loaded')).toBe('shipping');
    expect(sectorForFloorStatus('installed')).toBe('installation');

    expect(floorStatusForSector('cutting')).toBe('cut');
    expect(floorStatusForSector('installation')).toBe('installed');
    // warehouse stages materials (no status) and cnc waits for `machined` (Fase 3).
    expect(floorStatusForSector('warehouse')).toBeNull();
    expect(floorStatusForSector('cnc')).toBeNull();
  });

  it('computes the waiting queue per sector', () => {
    const project = makeProject([
      makeItem('a'), // pending
      makeItem('b', 'cut'), // waiting for edge banding
      makeItem('c', 'edged'), // waiting for assembly
      makeItem('d', 'assembled'), // waiting for packaging
      makeItem('e', 'packaged'), // waiting for shipping (load)
    ]);

    expect(itemsWaitingForSector(project, 'cutting').map((i) => i.id)).toEqual(['a']);
    expect(itemsWaitingForSector(project, 'warehouse').map((i) => i.id)).toEqual(['a']);
    expect(itemsWaitingForSector(project, 'edge_banding').map((i) => i.id)).toEqual(['b']);
    expect(itemsWaitingForSector(project, 'assembly').map((i) => i.id)).toEqual(['c']);
    expect(itemsWaitingForSector(project, 'packaging').map((i) => i.id)).toEqual(['d']);
    expect(itemsWaitingForSector(project, 'shipping').map((i) => i.id)).toEqual(['e']);
    // cnc has no status to produce yet — empty queue, not an error.
    expect(itemsWaitingForSector(project, 'cnc')).toEqual([]);
    expect(itemsWaitingForSector(project, 'installation')).toEqual([]);
  });

  it('summarizes floor progress per sector for visibility surfaces', () => {
    const project = makeProject([
      makeItem('a'), // pending
      makeItem('b', 'cut'),
      makeItem('c', 'installed'),
      makeItem('d', 'installed'),
    ]);

    const summary = buildProjectFloorSummary(project);
    expect(summary.totalItems).toBe(4);
    expect(summary.installedItems).toBe(2);
    // Mean per-item progress: (0 + 1/6 + 1 + 1) / 4 = 54%.
    expect(summary.percentage).toBe(54);

    const bySector = new Map(summary.stages.map((s) => [s.sector, s]));
    // done = reached-or-passed the sector's status.
    expect(bySector.get('cutting')).toMatchObject({ done: 3, waiting: 1, total: 4 });
    expect(bySector.get('edge_banding')).toMatchObject({ done: 2, waiting: 1, total: 4 });
    expect(bySector.get('installation')).toMatchObject({ done: 2, waiting: 0, total: 4 });

    // Bottleneck: first sector with unfinished items = cutting.
    expect(summary.activeSector).toBe('cutting');
  });

  it('reports activeSector as the bottleneck in manufacturing order', () => {
    const project = makeProject([
      makeItem('a', 'edged'),
      makeItem('b', 'assembled'),
    ]);
    const summary = buildProjectFloorSummary(project);
    // cutting and edge_banding are done for all; assembly is not.
    expect(summary.activeSector).toBe('assembly');
  });

  it('returns null activeSector only when everything is installed', () => {
    const project = makeProject([
      makeItem('a', 'installed'),
      makeItem('b', 'installed'),
    ]);
    const summary = buildProjectFloorSummary(project);
    expect(summary.activeSector).toBeNull();
    expect(summary.percentage).toBe(100);
  });

  it('keeps pipeline sectors in manufacturing order', () => {
    expect([...PIPELINE_SECTORS]).toEqual([
      'cutting',
      'edge_banding',
      'assembly',
      'packaging',
      'shipping',
      'installation',
    ]);
  });
});

describe('advanceFloorStatus', () => {
  it('advances to next with an audit event', () => {
    const result = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'pending',
      advance: true,
      by: { userId: 'u-1', name: 'Ramón' },
      source: 'scan',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('cut');
    expect(result.event).toMatchObject({
      projectId: 'p-1',
      itemId: 'a',
      from: 'pending',
      to: 'cut',
      byUserId: 'u-1',
      byName: 'Ramón',
      source: 'scan',
    });
  });

  it('accepts an explicit adjacent target', () => {
    const result = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'cut',
      target: 'edged',
      source: 'manual',
    });
    expect(result.ok && result.status).toBe('edged');
  });

  it('rejects jumps unless allowJump records them', () => {
    const rejected = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'pending',
      target: 'loaded',
      source: 'dispatch',
    });
    expect(rejected).toEqual({ ok: false, reason: 'jump-not-allowed' });

    const allowed = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'pending',
      target: 'loaded',
      allowJump: true,
      source: 'dispatch',
      note: 'carga directa',
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.status).toBe('loaded');
    expect(allowed.event?.note).toContain('carga directa');
    expect(allowed.event?.note).toContain('salto pending → loaded');
  });

  it('normalizes invalid current status to pending', () => {
    const result = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: undefined,
      advance: true,
    });
    expect(result.ok && result.status).toBe('cut');
    if (result.ok && result.event) {
      expect(result.event.from).toBe('pending');
    }
  });

  it('is a no-op event when target equals current', () => {
    const result = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'cut',
      target: 'cut',
    });
    expect(result).toEqual({ ok: true, status: 'cut', event: null });
  });

  it('fails at the end of the pipeline', () => {
    const result = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'installed',
      advance: true,
    });
    expect(result).toEqual({ ok: false, reason: 'at-end' });
  });

  it('rejects invalid targets', () => {
    const result = advanceFloorStatus({
      projectId: 'p-1',
      itemId: 'a',
      current: 'cut',
      target: 'banded' as never,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-target' });
  });
});

describe('floor event log helpers', () => {
  const eventA = {
    id: 'e-1',
    projectId: 'p-1',
    itemId: 'a',
    from: 'pending',
    to: 'cut',
    at: '2026-08-17T10:00:00.000Z',
    source: 'scan',
  } as const;
  const eventB = {
    id: 'e-2',
    projectId: 'p-1',
    itemId: 'b',
    from: 'cut',
    to: 'edged',
    at: '2026-08-17T12:00:00.000Z',
    source: 'manual',
  } as const;

  it('appends events immutably and dedupes by id', () => {
    const project = makeProject([makeItem('a')]);
    const withEvent = appendFloorEvent(project, eventA);
    expect(withEvent.floorEvents).toHaveLength(1);
    expect(project.floorEvents).toBeUndefined();

    const deduped = appendFloorEvent(withEvent, eventA);
    expect(deduped).toBe(withEvent);
    expect(deduped.floorEvents).toHaveLength(1);

    const two = appendFloorEvent(withEvent, eventB);
    expect(two.floorEvents).toHaveLength(2);
  });

  it('filters the timeline per item', () => {
    expect(floorTimelineForItem([eventA, eventB], 'a')).toEqual([eventA]);
    expect(floorTimelineForItem(undefined, 'a')).toEqual([]);
  });

  it('finds the latest event across items', () => {
    expect(latestFloorEvent([eventA, eventB])?.id).toBe('e-2');
    expect(latestFloorEvent([])).toBeUndefined();
    expect(latestFloorEvent(undefined)).toBeUndefined();
  });
});
