import { describe, expect, it } from 'vitest';
import type { ProductionCutRow } from '@granete/domain';
import { ValidationError } from '@granete/domain';
import { cutListConfigurableCsvExport } from './cutListConfigurableCsvExport';

const mockRows: readonly ProductionCutRow[] = [
  {
    quantity: 2,
    lengthMm: 1200,
    widthMm: 600,
    description: 'P001 · Lateral · MOD-01',
    partName: 'Lateral',
    partCode: 'P001',
    moduleCode: 'MOD-01',
    materialName: 'Melamina Blanco 18mm',
    grain: 1,
    L1: 1,
    L2: 1,
    W1: 0,
    W2: 0,
  },
  {
    quantity: 4,
    lengthMm: 800,
    widthMm: 400,
    description: 'P002 · Puerta · MOD-01',
    partName: 'Puerta',
    partCode: 'P002',
    moduleCode: 'MOD-01',
    materialName: 'MDF Roble 18mm',
    grain: 0,
    L1: 1,
    L2: 1,
    W1: 1,
    W2: 1,
  },
];

describe('cutListConfigurableCsvExport', () => {
  it('exports standard format with default semicolon delimiter', () => {
    const csv = cutListConfigurableCsvExport(mockRows);
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe(
      'piece_code;module_code;material;length_mm;width_mm;qty;grain;edges;description',
    );
    expect(lines[1]).toContain('MOD-01-P001;MOD-01;Melamina Blanco 18mm;1200;600;2;1;L1+L2;');
  });

  it('exports with comma delimiter when specified', () => {
    const csv = cutListConfigurableCsvExport(mockRows, { delimiter: ',' });
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe(
      'piece_code,module_code,material,length_mm,width_mm,qty,grain,edges,description',
    );
  });

  it('exports Lepton optimizer preset', () => {
    const csv = cutListConfigurableCsvExport(mockRows, { preset: 'lepton' });
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('CODIGO;CANTIDAD;LARGO;ANCHO;MATERIAL;VETA;L1;L2;A1;A2');
    expect(lines[1]).toBe('MOD-01-P001;2;1200;600;Melamina Blanco 18mm;1;1;1;0;0');
  });

  it('exports CorteCerto optimizer preset', () => {
    const csv = cutListConfigurableCsvExport(mockRows, { preset: 'cortecerto' });
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('Peca;Qtd;Compr;Larg;Material;Veta');
    expect(lines[1]).toBe('MOD-01-P001;2;1200;600;Melamina Blanco 18mm;1');
  });

  it('exports OptiNest optimizer preset', () => {
    const csv = cutListConfigurableCsvExport(mockRows, { preset: 'optinest' });
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('Name;Quantity;Length;Width;Material;Grain');
  });

  it('omits header row when includeHeader is false', () => {
    const csv = cutListConfigurableCsvExport(mockRows, { includeHeader: false });
    const lines = csv.trim().split('\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).not.toContain('piece_code');
  });

  it('filters by materialName when materialFilter is provided', () => {
    const csv = cutListConfigurableCsvExport(mockRows, {
      materialFilter: 'MDF Roble 18mm',
    });
    const lines = csv.trim().split('\n');

    expect(lines.length).toBe(2); // Header + 1 filtered row
    expect(lines[1]).toContain('MDF Roble 18mm');
    expect(csv).not.toContain('Melamina Blanco 18mm');
  });

  it('throws ValidationError when no rows match material filter', () => {
    expect(() =>
      cutListConfigurableCsvExport(mockRows, {
        materialFilter: 'Inexistente',
      }),
    ).toThrow(ValidationError);
  });
});
