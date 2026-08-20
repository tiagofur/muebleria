/**
 * Web pipeline: CutPlan (saw) → PTX v1.14 (Pattern Exchange) → download.
 */

import { ptxCutPlanExport, type PtxCutPlanExportInput } from '@muebles/excel';
import type { CutPlan } from '@muebles/domain';
import { downloadOptimizerXlsx, type DownloadDeps } from './exportOptimizer';

export interface DownloadCutPlanPtxOptions {
  readonly projectName?: string;
  readonly customerName?: string;
  readonly projectCode?: string;
  readonly sawKerfMm?: number;
}

export function ptxFileName(projectName?: string): string {
  const name = (projectName || 'plan-de-corte').trim();
  const safe =
    name
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'plan-de-corte';
  return `${safe}.ptx`;
}

export async function downloadCutPlanPtx(
  cutPlan: CutPlan,
  options?: DownloadCutPlanPtxOptions,
  fileName?: string,
  deps?: DownloadDeps,
): Promise<void> {
  const input: PtxCutPlanExportInput = {
    cutPlan,
    projectName: options?.projectName,
    customerName: options?.customerName,
    projectCode: options?.projectCode,
    sawKerfMm: options?.sawKerfMm,
  };
  const bytes = ptxCutPlanExport(input);
  const targetFileName =
    fileName || ptxFileName(options?.projectName || cutPlan.projectName || cutPlan.projectId);
  downloadOptimizerXlsx(bytes, targetFileName, deps);
}
