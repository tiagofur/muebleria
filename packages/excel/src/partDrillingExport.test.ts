import { describe, expect, it } from 'vitest';
import type { ProjectDrillingData } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';
import {
  drillingDataExportCsv,
  drillingDataExportJson,
} from './partDrillingExport';

const mockDrillingData: ProjectDrillingData = {
  schema: 'muebles.drilling-data.v1',
  projectId: 'p1',
  projectName: 'Cocina Test',
  generatedAt: '2026-08-01T00:00:00.000Z',
  totalPiecesCount: 1,
  totalHolesCount: 2,
  patterns: [
    {
      pieceCode: 'MOD-01-P001',
      moduleCode: 'MOD-01',
      partName: 'Puerta',
      lengthMm: 720,
      widthMm: 400,
      materialName: 'MDF 18mm',
      holes: [
        {
          face: 'back',
          xMm: 22.5,
          yMm: 96,
          diameterMm: 35,
          depthMm: 12.5,
          type: 'hinge',
          description: 'Bisagra superior 35mm',
        },
        {
          face: 'back',
          xMm: 22.5,
          yMm: 304,
          diameterMm: 35,
          depthMm: 12.5,
          type: 'hinge',
          description: 'Bisagra inferior 35mm',
        },
      ],
    },
  ],
};

describe('partDrillingExport', () => {
  it('exports drilling data to valid pretty JSON string', () => {
    const json = drillingDataExportJson(mockDrillingData);
    expect(json).toContain('"schema": "muebles.drilling-data.v1"');
    expect(json).toContain('"diameterMm": 35');
    const parsed = JSON.parse(json);
    expect(parsed.patterns.length).toBe(1);
  });

  it('throws ValidationError when exporting empty drilling data to JSON', () => {
    expect(() =>
      drillingDataExportJson({
        ...mockDrillingData,
        patterns: [],
      }),
    ).toThrow(ValidationError);
  });

  it('exports drilling data to tabular CSV string', () => {
    const csv = drillingDataExportCsv(mockDrillingData);
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe(
      'piece_code;module_code;part_name;face;x_mm;y_mm;diameter_mm;depth_mm;hole_type;description',
    );
    expect(lines[1]).toBe(
      'MOD-01-P001;MOD-01;Puerta;back;22.5;96;35;12.5;hinge;Bisagra superior 35mm',
    );
    expect(lines[2]).toBe(
      'MOD-01-P001;MOD-01;Puerta;back;22.5;304;35;12.5;hinge;Bisagra inferior 35mm',
    );
  });

  it('throws ValidationError when exporting empty drilling data to CSV', () => {
    expect(() =>
      drillingDataExportCsv({
        ...mockDrillingData,
        patterns: [],
      }),
    ).toThrow(ValidationError);
  });
});
