/**
 * Production pack: Optimizer + herrajes + etiquetas in one ZIP (#134).
 */

import type {
  Catalog,
  Customer,
  ExportIssue,
  Project,
} from '@muebles/domain';
import JSZip from 'jszip';
import { buildHardwareListExport } from './exportHardwareList';
import { buildOptimizerExport } from './exportOptimizer';
import { buildPieceLabelsExport } from './exportPieceLabels';

export type ExportProductionPackResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly issues: readonly ExportIssue[];
      /** Files that succeeded before a hard failure (optimizer missing). */
      readonly partialFiles?: readonly string[];
    };

/** Safe default: pack-produccion-{projectName}.zip */
export function productionPackFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `pack-produccion-${safe}.zip`;
}

/**
 * Build a ZIP with Optimizer (required) + herrajes + etiquetas when each succeeds.
 * Optimizer failure → pack fails (cannot cut without cut-list).
 * Hardware/labels failures are skipped so the pack still ships the rest.
 */
export async function buildProductionPackExport(
  project: Project,
  catalog: Catalog,
  customers: readonly Customer[] = [],
): Promise<ExportProductionPackResult> {
  const included: string[] = [];
  const softIssues: ExportIssue[] = [];

  const optimizer = await buildOptimizerExport(project, catalog);
  if (!optimizer.ok) {
    return { ok: false, issues: optimizer.issues };
  }

  const zip = new JSZip();
  zip.file(optimizer.fileName, optimizer.bytes);
  included.push(optimizer.fileName);

  const hardware = await buildHardwareListExport(project, catalog);
  if (hardware.ok) {
    zip.file(hardware.fileName, hardware.bytes);
    included.push(hardware.fileName);
  } else {
    softIssues.push(...hardware.issues);
  }

  const labels = await buildPieceLabelsExport(project, catalog, customers);
  if (labels.ok) {
    zip.file(labels.fileName, labels.bytes);
    included.push(labels.fileName);
  } else {
    softIssues.push(...labels.issues);
  }

  const buffer = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    ok: true,
    fileName: productionPackFileName(project.name),
    bytes: buffer,
  };
}
