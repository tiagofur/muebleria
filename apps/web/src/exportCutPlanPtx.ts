import JSZip from 'jszip';
import {
  ptxCutPlanExport,
  generatePtxByMaterial,
  type PtxCutPlanExportInput,
} from '@granete/excel';
import type { MachineArtifactBundle } from '@granete/excel';
import type { CutPlan } from '@granete/domain';
import { downloadOptimizerXlsx, type DownloadDeps } from './exportOptimizer';

export interface DownloadCutPlanPtxOptions {
  readonly projectName?: string;
  readonly customerName?: string;
  readonly projectCode?: string;
  readonly sawKerfMm?: number;
  /**
   * 'unified': single .ptx file containing all materials.
   * 'by-material': separate .ptx file per material, bundled in .zip if multiple.
   */
  readonly mode?: 'unified' | 'by-material';
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

export function ptxZipFileName(projectName?: string): string {
  const name = (projectName || 'plan-de-corte').trim();
  const safe =
    name
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'plan-de-corte';
  return `seccionadora-materiales-${safe}.zip`;
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

  const mode = options?.mode ?? 'unified';

  if (mode === 'by-material') {
    const files = generatePtxByMaterial(input);
    if (files.length === 0) {
      const bytes = ptxCutPlanExport(input);
      const targetFileName =
        fileName || ptxFileName(options?.projectName || cutPlan.projectName || cutPlan.projectId);
      downloadOptimizerXlsx(bytes, targetFileName, deps);
      return;
    }

    if (files.length === 1) {
      const single = files[0]!;
      downloadOptimizerXlsx(single.bytes, fileName || single.fileName, deps);
      return;
    }

    // Multiple materials → bundle in ZIP
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.fileName, f.bytes);
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const targetZipName =
      fileName || ptxZipFileName(options?.projectName || cutPlan.projectName || cutPlan.projectId);
    downloadOptimizerXlsx(zipBytes, targetZipName, deps);
    return;
  }

  // Unified single PTX
  const bytes = ptxCutPlanExport(input);
  const targetFileName =
    fileName || ptxFileName(options?.projectName || cutPlan.projectName || cutPlan.projectId);
  downloadOptimizerXlsx(bytes, targetFileName, deps);
}

/**
 * Downloads the cutting artifacts of the #591 machine-output path: exactly one
 * bundle → its file directly; several (by-material mode) → ALL of them bundled
 * in a single .zip. A bundle list must never silently drop entries.
 */
export async function downloadCuttingArtifactBundles(
  bundles: readonly MachineArtifactBundle[],
  projectName?: string,
  deps?: DownloadDeps,
): Promise<void> {
  const [single] = bundles;
  if (bundles.length === 1 && single) {
    downloadOptimizerXlsx(single.artifact.bytes, single.artifact.fileName, deps);
    return;
  }
  const zip = new JSZip();
  for (const bundle of bundles) {
    zip.file(bundle.artifact.fileName, bundle.artifact.bytes);
  }
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  downloadOptimizerXlsx(zipBytes, ptxZipFileName(projectName), deps);
}
