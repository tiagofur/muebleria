/**
 * runExport — the shared flow behind every file export (F119).
 *
 * Wraps: busy counter + inline issue list + delivery + optional stamp +
 * success/error toasts + exception guard (F118 A1). Handlers keep only their
 * unique parts: project resolution, RBAC gate, builder args and stamp.
 */

import type { ExportIssue } from '@muebles/domain';

import { deliverExcelFile, type DeliverExcelResult } from '../exportOptimizer';
import { getUiStoreState } from '../stores/uiStore';

export type ExportDelivery = DeliverExcelResult;

export type ExportBuildResult<B = unknown> =
  | { readonly ok: true; readonly bytes: B; readonly fileName: string }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

export interface RunExportOptions<B = unknown> {
  readonly build: () => Promise<ExportBuildResult<B>>;
  /** Default: deliverExcelFile. Override for PDF-style builders. */
  readonly deliver?: (
    bytes: B,
    fileName: string,
  ) => Promise<DeliverExcelResult>;
  /** Extra UX when the build returned issues (the inline list is always set). */
  readonly onIssues?: (issues: readonly ExportIssue[]) => void;
  /** Called only after a successful delivery (export revision stamps, etc). */
  readonly stamp?: () => void;
  readonly successMessage?: (
    fileName: string,
    delivery: ExportDelivery,
  ) => string;
}

/**
 * Runs the export flow. Returns true when the file was saved/downloaded.
 * Never throws: builder/delivery exceptions surface as an error toast.
 */
export async function runExport<B>(
  options: RunExportOptions<B>,
): Promise<boolean> {
  const ui = getUiStoreState();
  ui.setExportBusy(true);
  ui.setExportErrors([]);
  try {
    const result = await options.build();
    if (!result.ok) {
      // Validation issues stay inline (ExportIssueList) — not as toasts.
      ui.setExportErrors(result.issues);
      options.onIssues?.(result.issues);
      return false;
    }
    const delivery: ExportDelivery = options.deliver
      ? await options.deliver(result.bytes, result.fileName)
      : await deliverExcelFile(
          result.bytes as Uint8Array | ArrayBuffer,
          result.fileName,
        );
    if (delivery === 'cancelled') {
      getUiStoreState().toast({ type: 'info', message: 'Export cancelado' });
      return false;
    }
    options.stamp?.();
    getUiStoreState().toast({
      type: 'success',
      message:
        options.successMessage?.(result.fileName, delivery) ??
        (delivery === 'saved'
          ? `✓ ${result.fileName} guardado`
          : `✓ ${result.fileName} descargado`),
    });
    return true;
  } catch (err) {
    console.error('Export failed:', err);
    getUiStoreState().toast({
      type: 'error',
      message: 'No se pudo generar el archivo. Revisá la consola para detalle.',
    });
    return false;
  } finally {
    getUiStoreState().setExportBusy(false);
  }
}
