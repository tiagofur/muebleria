import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CutPlan } from '@granete/domain';
import {
  loadReleaseCutPlan,
  saveReleaseCutPlan,
  type ReleaseCutPlanScope,
} from './releaseCutPlanStore';

/** Minimal Storage-compatible fake backed by a plain map. */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  } as Storage;
}

function failingStorage(reason: 'quota' | 'reject'): Storage {
  const base = createStorage();
  return {
    ...base,
    setItem: () => {
      const err = new Error('persist failed');
      err.name = reason === 'quota' ? 'QuotaExceededError' : 'SecurityError';
      throw err;
    },
  } as Storage;
}

const scope: ReleaseCutPlanScope = { organizationId: 'org-a' };

function planFixture(over: Partial<CutPlan> = {}): CutPlan {
  return {
    id: 'plan-1',
    projectId: 'p1',
    projectName: 'Obra',
    generatedAt: '2026-09-15T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 5,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 400,
      minRemnantLengthMm: 600,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
      cutStrategy: 'saw-guillotine',
    },
    sheets: [],
    stats: {
      totalSheets: 0,
      totalPieces: 0,
      totalGrossAreaM2: 0,
      totalNetPiecesAreaM2: 0,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 0,
      globalWastePercent: 0,
      globalYieldPercent: 0,
      byMaterial: [],
    },
    usefulRemnants: [],
    releaseBase: {
      releaseId: 'rel-1',
      releaseNumber: 1,
      designRevisionId: 'rev-2',
      designRevisionNumber: 2,
      manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
    },
    ...over,
  } as CutPlan;
}

describe('releaseCutPlanStore (#739 review: guardado verificable)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trip: guardar con disco 5 y recargar devuelve exactamente ese plan y config', () => {
    const result = saveReleaseCutPlan(scope, 'p1', 'rel-1', planFixture());
    expect(result).toEqual({ kind: 'saved' });
    const loaded = loadReleaseCutPlan(scope, 'p1', 'rel-1');
    expect(loaded?.config.sawKerfMm).toBe(5);
    expect(loaded?.releaseBase?.releaseId).toBe('rel-1');
    expect(loaded?.releaseBase?.manufacturingFingerprint).toBe('sha256-' + 'a'.repeat(64));
  });

  it('cuota excedida: el guardado NO reporta éxito y la recarga no encuentra el plan', () => {
    vi.stubGlobal('localStorage', failingStorage('quota'));
    const result = saveReleaseCutPlan(scope, 'p1', 'rel-1', planFixture());
    expect(result.kind).toBe('memory-only');
    if (result.kind === 'memory-only') {
      expect(result.reason).toContain('lleno');
    }
    expect(loadReleaseCutPlan(scope, 'p1', 'rel-1')).toBeNull();
  });

  it('escritura rechazada: memory-only con motivo, sin plan persistido', () => {
    vi.stubGlobal('localStorage', failingStorage('reject'));
    const result = saveReleaseCutPlan(scope, 'p1', 'rel-1', planFixture());
    expect(result.kind).toBe('memory-only');
    expect(loadReleaseCutPlan(scope, 'p1', 'rel-1')).toBeNull();
  });

  it('sin localStorage disponible: el guardado lo dice — nunca un éxito silencioso', () => {
    vi.stubGlobal('localStorage', undefined);
    const result = saveReleaseCutPlan(scope, 'p1', 'rel-1', planFixture());
    expect(result).toEqual({
      kind: 'memory-only',
      reason: 'este navegador no expone almacenamiento local',
    });
    expect(loadReleaseCutPlan(scope, 'p1', 'rel-1')).toBeNull();
  });

  it('aislamiento por release y por organización: claves distintas no se mezclan', () => {
    saveReleaseCutPlan(scope, 'p1', 'rel-1', planFixture());
    const p2 = planFixture({
      releaseBase: {
        releaseId: 'rel-2',
        releaseNumber: 2,
        designRevisionId: 'rev-2',
        designRevisionNumber: 2,
        manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
      },
    });
    saveReleaseCutPlan(scope, 'p1', 'rel-2', p2);
    saveReleaseCutPlan({ organizationId: 'org-b' }, 'p1', 'rel-1', planFixture());

    expect(loadReleaseCutPlan(scope, 'p1', 'rel-1')?.releaseBase?.releaseNumber).toBe(1);
    expect(loadReleaseCutPlan(scope, 'p1', 'rel-2')?.releaseBase?.releaseNumber).toBe(2);
    expect(loadReleaseCutPlan({ organizationId: 'org-b' }, 'p1', 'rel-1')?.releaseBase?.releaseNumber).toBe(1);
    // Otra organización no ve el plan de org-a.
    expect(loadReleaseCutPlan({ organizationId: 'org-c' }, 'p1', 'rel-1')).toBeNull();
  });

  it('un plan sin pin de esta liberación se rechaza al guardar (error de programación, no silencio)', () => {
    const foreign = planFixture({
      releaseBase: {
        releaseId: 'rel-OTRA',
        releaseNumber: 9,
        designRevisionId: 'rev-2',
        designRevisionNumber: 2,
        manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
      },
    });
    expect(() => saveReleaseCutPlan(scope, 'p1', 'rel-1', foreign)).toThrowError(/pin/);
  });

  it('un plan persistido con pin de otra liberación no se sirve como actual', () => {
    const foreign = planFixture({
      releaseBase: {
        releaseId: 'rel-OTRA',
        releaseNumber: 9,
        designRevisionId: 'rev-2',
        designRevisionNumber: 2,
        manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
      },
    });
    const storage = createStorage();
    storage.setItem(
      'granete_release_cut_plans_v1',
      JSON.stringify({ 'org-a:p1:rel-1': foreign }),
    );
    vi.stubGlobal('localStorage', storage);
    expect(loadReleaseCutPlan(scope, 'p1', 'rel-1')).toBeNull();
  });
});
