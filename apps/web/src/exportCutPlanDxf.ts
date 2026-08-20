/**
 * Web pipeline: CutPlan (nesting) → DXF R12 → download (F125/F126).
 */

import { dxfCutPlanExport } from '@muebles/excel';
import type { CutPlan } from '@muebles/domain';
import { downloadOptimizerXlsx, type DownloadDeps } from './exportOptimizer';

export async function downloadCutPlanDxf(
  cutPlan: CutPlan,
  variant: 'sheets' | 'pieces',
  fileName: string,
  deps?: DownloadDeps,
): Promise<void> {
  const bytes = dxfCutPlanExport({ cutPlan, variant });
  downloadOptimizerXlsx(bytes, fileName, deps);
}
