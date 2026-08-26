/**
 * Web pipeline: CutPlan (nesting) → DXF R12 individual files / ZIP → download (F125/F126).
 */

import JSZip from 'jszip';
import {
  dxfCutPlanExport,
  generateDxfBySheet,
  generateDxfByPiece,
} from '@granete/excel';
import type { CutPlan, PartDrillingPattern } from '@granete/domain';
import { downloadOptimizerXlsx, type DownloadDeps } from './exportOptimizer';

export interface DownloadCutPlanDxfOptions {
  readonly projectName?: string;
  readonly drilling?: readonly PartDrillingPattern[];
}

export function dxfZipFileName(projectName: string | undefined, variant: 'sheets' | 'pieces'): string {
  const name = (projectName || 'plan-de-corte').trim();
  const safe =
    name
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'plan-de-corte';
  const suffix = variant === 'sheets' ? 'tableros' : 'piezas';
  return `${safe}-nesting-${suffix}.zip`;
}

export async function downloadCutPlanDxf(
  cutPlan: CutPlan,
  variant: 'sheets' | 'pieces',
  fileName?: string,
  deps?: DownloadDeps,
  options?: DownloadCutPlanDxfOptions,
): Promise<void> {
  const projectName = options?.projectName || cutPlan.projectName || cutPlan.projectId;

  if (variant === 'sheets') {
    const files = generateDxfBySheet({
      cutPlan,
      projectName,
      drilling: options?.drilling,
    });

    if (files.length === 0) {
      const bytes = dxfCutPlanExport({ cutPlan, variant: 'sheets', drilling: options?.drilling });
      const targetFileName = fileName || `${projectName || 'plan'}-nesting-tableros.dxf`;
      downloadOptimizerXlsx(bytes, targetFileName, deps);
      return;
    }

    if (files.length === 1) {
      const single = files[0]!;
      downloadOptimizerXlsx(single.bytes, fileName || single.fileName, deps);
      return;
    }

    // Multiple sheets → bundle into ZIP
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.fileName, f.bytes);
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const targetZipName = fileName || dxfZipFileName(projectName, 'sheets');
    downloadOptimizerXlsx(zipBytes, targetZipName, deps);
    return;
  }

  // variant === 'pieces'
  const files = generateDxfByPiece({
    cutPlan,
    projectName,
    drilling: options?.drilling,
  });

  if (files.length === 0) {
    const bytes = dxfCutPlanExport({ cutPlan, variant: 'pieces', drilling: options?.drilling });
    const targetFileName = fileName || `${projectName || 'plan'}-nesting-piezas.dxf`;
    downloadOptimizerXlsx(bytes, targetFileName, deps);
    return;
  }

  if (files.length === 1) {
    const single = files[0]!;
    downloadOptimizerXlsx(single.bytes, fileName || single.fileName, deps);
    return;
  }

  // Multiple pieces → bundle into ZIP
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.fileName, f.bytes);
  }
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const targetZipName = fileName || dxfZipFileName(projectName, 'pieces');
  downloadOptimizerXlsx(zipBytes, targetZipName, deps);
}
