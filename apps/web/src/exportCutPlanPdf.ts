/**
 * Web pipeline: CutPlan → vector PDF → download (F115).
 */

import { cutPlanPdfExport } from '@muebles/excel';
import type { CutPlan } from '@muebles/domain';
import { downloadOptimizerXlsx, type DownloadDeps } from './exportOptimizer';

export async function downloadCutPlanPdf(
  cutPlan: CutPlan,
  fileName: string,
  deps?: DownloadDeps,
): Promise<void> {
  const bytes = await cutPlanPdfExport({
    cutPlan,
    projectName: cutPlan.projectName,
  });
  downloadOptimizerXlsx(bytes, fileName, deps);
}
