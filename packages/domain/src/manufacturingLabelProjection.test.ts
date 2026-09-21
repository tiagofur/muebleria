import { describe, expect, it } from 'vitest';
import {
  manufacturingCncScope,
  manufacturingLabelProjectionFromDemand,
  type ReleaseCuttingDemandView,
} from './index';

/**
 * #793 — the neutral label projection takes its industrial identity
 * EXCLUSIVELY from the snapshot-frozen fields. Releases whose snapshots
 * predate the freeze BLOCK; the live catalog is never consulted (the builder
 * does not even receive one).
 */

function demandWith(overrides: {
  units?: Partial<ReleaseCuttingDemandView['units'][number]>[];
}): ReleaseCuttingDemandView {
  return {
    releaseId: '11117930-0000-4000-8000-0000000000d1',
    releaseNumber: 4,
    designRevisionId: '11117930-0000-4000-8000-0000000000d2',
    designRevisionNumber: 2,
    manufacturingFingerprint: `sha256-${'11ab79'.repeat(10)}11ab`,
    schemaVersion: 2,
    units: overrides.units?.map((unit) => ({
      furnitureInstanceId: '11117930-0000-4000-8000-0000000000u1',
      furnitureDefinitionId: 'mod-x',
      workshopOccurrenceOrdinal: 1,
      frozenModuleCode: 'MOD-X',
      frozenModuleName: 'Modulo X',
      frozenModuleWidthMm: 600,
      frozenModuleHeightMm: 1600,
      frozenModuleDepthMm: 450,
      ...unit,
      pieces: unit.pieces ?? [{
        partId: 'p1',
        description: 'Panel',
        quantity: 1,
        lengthMm: 500,
        widthMm: 400,
        thicknessMm: 18,
        materialId: 'm1',
        frozenMaterialCode: 'MDFA',
        grain: 1 as const,
        l1: 0 as const,
        l2: 0 as const,
        w1: 0 as const,
        w2: 0 as const,
      }],
    })) ?? [],
  };
}

describe('manufacturingLabelProjectionFromDemand (#793 frozen identity)', () => {
  it('derives every identity field from the snapshot freeze (module, material, edge, -C<n> copies)', () => {
    const projection = manufacturingLabelProjectionFromDemand(demandWith({
      units: [{
        pieces: [
          {
            partId: 'p1',
            description: 'Costado',
            quantity: 2,
            lengthMm: 1500,
            widthMm: 400,
            thicknessMm: 18,
            materialId: 'm1',
            frozenMaterialCode: 'MDFA',
            frozenEdgeBandCode: 'C-ABS',
            grain: 1,
            l1: 1,
            l2: 1,
            w1: 0,
            w2: 0,
          },
        ],
      }],
    }));
    expect(projection.pieces.map((piece) => piece.manufacturingPartCode)).toEqual([
      'MOD-X-P01',
      'MOD-X-P01-C2',
    ]);
    expect(projection.pieces.every((piece) => piece.materialCode === 'MDFA')).toBe(true);
    expect(projection.pieces.every((piece) => piece.edgeBandCode === 'C-ABS')).toBe(true);
    expect(projection.pieces.every((piece) => piece.moduleCode === 'MOD-X')).toBe(true);
    expect(projection.pieces.every((piece) => piece.moduleName === 'Modulo X')).toBe(true);
    expect(projection.pieces.every((piece) => piece.workshopOccurrenceOrdinal === 1)).toBe(true);
    expect(projection.orderRef).toBe('R4');
    expect(projection.cncScope).toBe(manufacturingCncScope(projection.releaseBase));
  });

  it('snapshot sin frozenModuleCode BLOQUEA (nunca sustituye el catálogo live)', () => {
    expect(() => manufacturingLabelProjectionFromDemand(demandWith({
      units: [{ frozenModuleCode: null, frozenModuleName: null }],
    }))).toThrow(/código de módulo congelado/);
  });

  it('snapshot sin frozenMaterialCode BLOQUEA', () => {
    expect(() => manufacturingLabelProjectionFromDemand(demandWith({
      units: [{
        pieces: [{
          partId: 'p1',
          description: 'Panel',
          quantity: 1,
          lengthMm: 500,
          widthMm: 400,
          thicknessMm: 18,
          materialId: 'm1',
          frozenMaterialCode: null,
          grain: 1,
          l1: 0,
          l2: 0,
          w1: 0,
          w2: 0,
        }],
      }],
    }))).toThrow(/código de material congelado/);
  });

  it('pieza con cantos sin frozenEdgeBandCode BLOQUEA', () => {
    expect(() => manufacturingLabelProjectionFromDemand(demandWith({
      units: [{
        pieces: [{
          partId: 'p1',
          description: 'Costado',
          quantity: 1,
          lengthMm: 1500,
          widthMm: 400,
          thicknessMm: 18,
          materialId: 'm1',
          frozenMaterialCode: 'MDFA',
          frozenEdgeBandCode: null,
          grain: 1,
          l1: 1,
          l2: 0,
          w1: 0,
          w2: 0,
        }],
      }],
    }))).toThrow(/código industrial/i);
  });

  it('pieza sin cantos NO exige frozenEdgeBandCode (celda vacía)', () => {
    const projection = manufacturingLabelProjectionFromDemand(demandWith({
      units: [{ pieces: undefined }],
    }));
    expect(projection.pieces[0]?.edgeBandCode).toBeUndefined();
  });

  it('dims de módulo congeladas opcionales: parcialmente ausentes quedan vacías, no inventadas', () => {
    const projection = manufacturingLabelProjectionFromDemand(demandWith({
      units: [{
        frozenModuleWidthMm: 600,
        frozenModuleHeightMm: null,
        frozenModuleDepthMm: null,
      }],
    }));
    expect(projection.pieces[0]?.moduleWidthMm).toBeUndefined();
    expect(projection.pieces[0]?.moduleHeightMm).toBeUndefined();
    expect(projection.pieces[0]?.moduleDepthMm).toBeUndefined();
  });

  it('autoridad CNC explícita marca sólo las piezas cubiertas', () => {
    const projection = manufacturingLabelProjectionFromDemand(
      demandWith({ units: [{ pieces: undefined }] }),
      { machining: { provenance: 'test', machiningPartIds: ['p1'] } },
    );
    expect(projection.pieces[0]?.hasCncMachining).toBe(true);
    const without = manufacturingLabelProjectionFromDemand(demandWith({ units: [{ pieces: undefined }] }));
    expect(without.pieces[0]?.hasCncMachining).toBeUndefined();
  });
});
