import { describe, expect, it } from 'vitest';
import { physicalProgress } from './productionQueueProgress';

describe('physicalProgress — conteo físico para la cola de producción (#301)', () => {
  it('cuenta piezas listas y unidades instaladas de la ejecución física', () => {
    const progress = physicalProgress({
      part_instances: [
        { status: 'ready_for_assembly' },
        { status: 'ready_for_assembly' },
        { status: 'in_progress' },
        { status: 'assembled' },
      ],
      module_units: [{ status: 'installed' }, { status: 'assembly' }, { status: 'packaged' }],
    });
    expect(progress).toEqual({
      partsReady: 3, // ready_for_assembly ×2 + assembled
      partsTotal: 4,
      unitsInstalled: 1,
      unitsTotal: 3,
    });
  });

  it('obra sin ejecución física (flujo legacy) → null, sin línea física', () => {
    expect(physicalProgress({ part_instances: [], module_units: [] })).toBeNull();
    expect(physicalProgress(null)).toBeNull();
    expect(physicalProgress(undefined)).toBeNull();
  });

  it('payload parcial (piezas sin unidades aún) → null hasta que ambas existan', () => {
    expect(
      physicalProgress({ part_instances: [{ status: 'pending' }], module_units: [] }),
    ).toBeNull();
  });
});
