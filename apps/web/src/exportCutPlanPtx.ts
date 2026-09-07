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
   * 'by-material': one .ptx file per material, always bundled in a .zip —
   * the user picked "Separado por material (.zip)", so even a single
   * material must arrive as the promised ZIP.
   */
  readonly mode?: 'unified' | 'by-material';
}

/** What actually got delivered — the toast reports these exact counts. */
export interface CuttingDownloadResult {
  readonly fileName: string;
  readonly filesCount: number;
  readonly materialsCount: number;
  readonly zipped: boolean;
  readonly kind: 'ptx' | 'saw' | 'mpr' | 'dxf' | 'csv' | 'pdf' | 'label' | 'other';
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

interface CuttingZipEntry {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** Fixed DOS epoch (1980-01-01): same input → byte-identical ZIP. */
const ZIP_FIXED_DATE = new Date('1980-01-01T00:00:00Z');

function byFileName(a: CuttingZipEntry, b: CuttingZipEntry): number {
  return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
}

/**
 * Deterministic collision guard at the ZIP boundary: a name that already
 * exists gets a stable '-2' suffix. JSZip would otherwise silently
 * overwrite the previous entry with the same name.
 */
function uniqueZipEntryName(fileName: string, used: ReadonlySet<string>): string {
  if (!used.has(fileName)) return fileName;
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let candidate = `${base}-2${ext}`;
  let counter = 2;
  while (used.has(candidate)) {
    counter++;
    candidate = `${base}-${counter}${ext}`;
  }
  return candidate;
}

/**
 * Hardened ZIP builder shared by both cutting paths:
 * - never builds an empty ZIP (an empty bundle list is an error, not a download);
 * - deterministic entry order (sorted by file name) and fixed entry dates, so
 *   the same input always yields the same entries, names and bytes;
 * - duplicate names after sanitization can never overwrite each other.
 */
async function buildCuttingZip(
  entries: readonly CuttingZipEntry[],
  zipName: string,
  deps?: DownloadDeps,
): Promise<CuttingDownloadResult> {
  if (entries.length === 0) {
    throw new Error('No hay archivos de corte para descargar (plan sin materiales)');
  }
  const zip = new JSZip();
  const used = new Set<string>();
  for (const entry of [...entries].sort(byFileName)) {
    const name = uniqueZipEntryName(entry.fileName, used);
    used.add(name);
    zip.file(name, entry.bytes, { date: ZIP_FIXED_DATE });
  }
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  downloadOptimizerXlsx(zipBytes, zipName, deps);
  return {
    fileName: zipName,
    filesCount: entries.length,
    materialsCount: entries.length,
    zipped: true,
    kind: 'ptx',
  };
}

export async function downloadCutPlanPtx(
  cutPlan: CutPlan,
  options?: DownloadCutPlanPtxOptions,
  fileName?: string,
  deps?: DownloadDeps,
): Promise<CuttingDownloadResult> {
  const input: PtxCutPlanExportInput = {
    cutPlan,
    projectName: options?.projectName,
    customerName: options?.customerName,
    projectCode: options?.projectCode,
    sawKerfMm: options?.sawKerfMm,
  };

  const mode = options?.mode ?? 'unified';
  const displayName =
    options?.projectName || cutPlan.projectName || cutPlan.projectId;

  if (mode === 'by-material') {
    const files = generatePtxByMaterial(input);
    if (files.length === 0) {
      // Degenerate plan: let the generator surface the exact validation
      // error — never download an empty or substitute format.
      ptxCutPlanExport(input);
      throw new Error('El plan de corte no tiene materiales para exportar');
    }
    return buildCuttingZip(
      files.map((f) => ({ fileName: f.fileName, bytes: f.bytes })),
      fileName || ptxZipFileName(displayName),
      deps,
    );
  }

  // Unified single PTX
  const bytes = ptxCutPlanExport(input);
  const targetFileName = fileName || ptxFileName(displayName);
  downloadOptimizerXlsx(bytes, targetFileName, deps);
  return {
    fileName: targetFileName,
    filesCount: 1,
    materialsCount: 1,
    zipped: false,
    kind: 'ptx',
  };
}

/**
 * Downloads the cutting artifacts of the #591 machine-output path: exactly
 * one bundle in unified mode downloads its file directly; the by-material
 * mode bundles ALL of them into a single .zip (even a lone material — the
 * user explicitly chose "Separado por material (.zip)"). A bundle list must
 * never silently drop entries nor produce an empty ZIP.
 */
export async function downloadCuttingArtifactBundles(
  bundles: readonly MachineArtifactBundle[],
  projectName?: string,
  deps?: DownloadDeps,
  mode: 'unified' | 'by-material' = 'unified',
): Promise<CuttingDownloadResult> {
  const [single] = bundles;
  if (bundles.length === 1 && single && mode !== 'by-material') {
    downloadOptimizerXlsx(single.artifact.bytes, single.artifact.fileName, deps);
    return {
      fileName: single.artifact.fileName,
      filesCount: 1,
      materialsCount: 1,
      zipped: false,
      kind: single.artifact.kind,
    };
  }
  const kind = single?.artifact.kind ?? 'ptx';
  const result = await buildCuttingZip(
    bundles.map((b) => ({ fileName: b.artifact.fileName, bytes: b.artifact.bytes })),
    ptxZipFileName(projectName),
    deps,
  );
  return kind === 'ptx' ? result : { ...result, kind };
}
