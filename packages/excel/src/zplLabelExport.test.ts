import { describe, expect, it } from 'vitest';
import type { PieceLabel, ModuleLabel } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';
import {
  dotsPerMm,
  pieceBatchToZpl,
  pieceToZpl,
  moduleToZpl,
  moduleBatchToZpl,
  sanitizeZplText,
  ZPL_SIZE_PRESETS,
} from './zplLabelExport';

const mockLabel: PieceLabel = {
  partCode: 'P001',
  description: 'Puerta Izquierda',
  moduleCode: 'MOD-01',
  moduleName: 'Alacena Superior',
  materialCode: 'MEL-18',
  materialName: 'Melamina Blanco 18mm',
  lengthMm: 720,
  widthMm: 400,
  quantity: 2,
  L1: true,
  L2: false,
  W1: false,
  W2: false,
  edgeBandingInstruction: 'L1: Canto PVC 1mm',
};

describe('sanitizeZplText', () => {
  it('replaces special ZPL control characters safely', () => {
    expect(sanitizeZplText('Caja ^1 ~2 _3')).toBe('Caja  1  2 -3');
  });

  it('handles empty input', () => {
    expect(sanitizeZplText('')).toBe('');
  });
});

describe('dotsPerMm', () => {
  it('returns 8 dots/mm for 203 DPI', () => {
    expect(dotsPerMm(203)).toBe(8.0);
  });

  it('returns 11.81 dots/mm for 300 DPI', () => {
    expect(dotsPerMm(300)).toBe(11.81);
  });
});

describe('pieceToZpl', () => {
  it('generates standard 100x50 ZPL label with QR code', () => {
    const zpl = pieceToZpl(mockLabel, '100x50', { projectId: 'PROJ-123' });
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^PW800');
    expect(zpl).toContain('^LL400');
    expect(zpl).toContain('^CI28');
    expect(zpl).toContain('P001 - Puerta Izquierda');
    expect(zpl).toContain('Mod: MOD-01 - Alacena Superior');
    expect(zpl).toContain('Medida: 720x400 mm | Cant: 2');
    expect(zpl).toContain('Material: Melamina Blanco 18mm (MEL-18)');
    expect(zpl).toContain('Encintado: L1: Canto PVC 1mm');
    expect(zpl).toContain('^BQN,2,3^FDMM,A{"v":2,"projectId":"PROJ-123","module":"MOD-01","part":"P001","desc":"Puerta Izquierda","material":"MEL-18","L":720,"W":400,"qty":2,"edges":"L1","edge":"","rev":""}^FS');
    expect(zpl).toContain('^XZ');
  });

  it('generates large 100x150 ZPL label', () => {
    const zpl = pieceToZpl(mockLabel, '100x150');
    expect(zpl).toContain('^PW800');
    expect(zpl).toContain('^LL1200');
  });

  it('generates compact 50x25 ZPL label', () => {
    const zpl = pieceToZpl(mockLabel, '50x25');
    expect(zpl).toContain('^PW400');
    expect(zpl).toContain('^LL200');
  });

  it('adjusts dot metrics when 300 DPI is specified', () => {
    const zpl = pieceToZpl(mockLabel, '100x50', { dpi: 300 });
    expect(zpl).toContain('^PW1181');
    expect(zpl).toContain('^LL591');
  });
});

describe('pieceBatchToZpl', () => {
  it('concatenates multiple ZPL labels', () => {
    const labels = [mockLabel, { ...mockLabel, partCode: 'P002' }];
    const batch = pieceBatchToZpl(labels, '100x50');
    expect(batch.split('^XA').length - 1).toBe(2);
    expect(batch.split('^XZ').length - 1).toBe(2);
  });

  it('throws ValidationError when labels array is empty', () => {
    expect(() => pieceBatchToZpl([])).toThrow(ValidationError);
  });
});

const mockModuleLabel: ModuleLabel = {
  itemId: 'item-101',
  factoryCode: 'GAB-01',
  moduleCode: 'GAB-01',
  moduleName: 'Bajo Fregadero 2P',
  projectId: 'proj-999',
  projectName: 'Cocina Residencial',
  customerName: 'Cliente Juan Pérez',
  packageIndex: 3,
  totalPackages: 8,
  unitIndex: 1,
  unitQuantity: 2,
  widthMm: 800,
  heightMm: 850,
  depthMm: 600,
  measuresLabel: '800×850×600 mm',
  spaceName: 'Cocina Principal',
  wallName: 'Muro Norte',
  floorStatus: 'cut',
  boardPartCount: 6,
  hardwareCount: 8,
  revision: '2',
};

describe('moduleToZpl and moduleBatchToZpl', () => {
  it('generates 100x150 mm package label with Bulto header and module QR', () => {
    const zpl = moduleToZpl(mockModuleLabel, '100x150');
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^PW800');
    expect(zpl).toContain('^LL1200');
    expect(zpl).toContain('BULTO 3 DE 8');
    expect(zpl).toContain('Obra: Cocina Residencial');
    expect(zpl).toContain('Cliente: Cliente Juan Pérez');
    expect(zpl).toContain('GAB-01 - Bajo Fregadero 2P');
    expect(zpl).toContain('Medidas: 800×850×600 mm');
    expect(zpl).toContain('Ambiente: Cocina Principal | Muro Norte');
    expect(zpl).toContain('^BQN,2,4^FDMM,A{"v":2,"k":"mod"');
    expect(zpl).toContain('^XZ');
  });

  it('generates 100x50 mm horizontal package label', () => {
    const zpl = moduleToZpl(mockModuleLabel, '100x50');
    expect(zpl).toContain('^PW800');
    expect(zpl).toContain('^LL400');
    expect(zpl).toContain('BULTO 3 DE 8');
    expect(zpl).toContain('GAB-01 - Bajo Fregadero 2P');
  });

  it('moduleBatchToZpl concatenates batch labels or throws on empty', () => {
    const batch = moduleBatchToZpl([mockModuleLabel, { ...mockModuleLabel, packageIndex: 4 }]);
    expect(batch.split('^XA').length - 1).toBe(2);
    expect(() => moduleBatchToZpl([])).toThrow(ValidationError);
  });
});
