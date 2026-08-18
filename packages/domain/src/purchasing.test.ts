import { describe, expect, it } from 'vitest';
import {
  PICKING_MATERIALS,
  PICKING_STATUS_LABELS_ES,
  pickingKey,
} from './purchasing';

describe('purchasing (Fase 3)', () => {
  it('exposes the three material picking types in order', () => {
    expect(PICKING_MATERIALS).toEqual(['herrajes', 'tableros', 'cintillas']);
  });

  it('labels picking statuses in Spanish', () => {
    expect(PICKING_STATUS_LABELS_ES.pendiente).toBe('Pendiente');
    expect(PICKING_STATUS_LABELS_ES.despachado).toBe('Despachado');
  });

  it('builds the local-state key as projectId:material', () => {
    expect(pickingKey('p1', 'herrajes')).toBe('p1:herrajes');
    expect(pickingKey('p1', 'tableros')).toBe('p1:tableros');
    // Distinct per material so each list toggles independently.
    expect(pickingKey('p1', 'herrajes')).not.toBe(pickingKey('p1', 'tableros'));
    expect(pickingKey('p1', 'herrajes')).not.toBe(pickingKey('p2', 'herrajes'));
  });
});
