/**
 * JSON and CSV exporters for structured part drilling data (F074).
 */

import type { ProjectDrillingData } from '@granete/domain';
import { ValidationError } from '@granete/domain';

export const DRILLING_CSV_HEADERS = [
  'piece_code',
  'module_code',
  'part_name',
  'face',
  'x_mm',
  'y_mm',
  'diameter_mm',
  'depth_mm',
  'hole_type',
  'description',
] as const;

export const DRILLING_CSV_SEPARATOR = ';' as const;

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[";\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Export ProjectDrillingData to pretty-printed JSON string.
 */
export function drillingDataExportJson(data: ProjectDrillingData): string {
  if (!data || data.patterns.length === 0) {
    throw new ValidationError('no hay perforaciones registradas para exportar', {
      field: 'patterns',
    });
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Export ProjectDrillingData to tabular CSV string.
 */
export function drillingDataExportCsv(data: ProjectDrillingData): string {
  if (!data || data.patterns.length === 0) {
    throw new ValidationError('no hay perforaciones registradas para exportar', {
      field: 'patterns',
    });
  }

  const lines: string[] = [DRILLING_CSV_HEADERS.join(DRILLING_CSV_SEPARATOR)];

  for (const pattern of data.patterns) {
    for (const hole of pattern.holes) {
      lines.push(
        [
          csvEscape(pattern.pieceCode),
          csvEscape(pattern.moduleCode),
          csvEscape(pattern.partName),
          csvEscape(hole.face),
          csvEscape(hole.xMm),
          csvEscape(hole.yMm),
          csvEscape(hole.diameterMm),
          csvEscape(hole.depthMm),
          csvEscape(hole.type),
          csvEscape(hole.description ?? ''),
        ].join(DRILLING_CSV_SEPARATOR),
      );
    }
  }

  return `${lines.join('\n')}\n`;
}
