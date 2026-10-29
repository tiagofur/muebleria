/**
 * Compact single-file hardware asset upload (#1416).
 *
 * The full interactive upload UX (resume, retry, cancel-confirm) lives in
 * packages/ui's HardwareAssetUploadModal. The kit wizard needs the plain
 * happy-path: start → bytes → finalize → read back the exact revision →
 * binding. Errors throw with step context so the caller can report which
 * design file failed; no silent fallback.
 */

import type { HardwareVisualAssetBinding } from '@granete/domain';

import { newIdempotencyKey } from './apiClient';
import type { HardwareAssetService } from './hardwareAssetService';

export interface UploadHardwareAssetBindingRequest {
  readonly file: File;
  readonly displayName: string;
  readonly provenance?: string;
}

function detectRepresentation(file: File): 'skp' | 'glb' | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.skp')) return 'skp';
  if (name.endsWith('.glb')) return 'glb';
  return null;
}

export async function uploadHardwareAssetBinding(
  assetService: HardwareAssetService,
  req: UploadHardwareAssetBindingRequest,
  signal?: AbortSignal,
): Promise<HardwareVisualAssetBinding> {
  const rep = detectRepresentation(req.file);
  if (!rep) {
    throw new Error(`«${req.file.name}»: solo se admiten archivos .skp y .glb.`);
  }

  let session;
  try {
    session = await assetService.startUpload(
      {
        representation: rep,
        display_name: req.displayName,
        ...(req.provenance?.trim() ? { provenance: req.provenance.trim() } : {}),
      },
      newIdempotencyKey(),
      signal,
    );
  } catch (err) {
    throw new Error(
      `No se pudo iniciar la carga de «${req.file.name}»: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await assetService.uploadBytes(session.id, rep, req.file, req.file.name, signal);
    await assetService.finalizeUpload(session.id, newIdempotencyKey(), signal);
    session = await assetService.getSession(session.id, signal);
  } catch (err) {
    throw new Error(
      `Falló la carga de «${req.file.name}»: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (session.status !== 'finalized') {
    throw new Error(
      `La carga de «${req.file.name}» terminó en estado «${session.status}» (se esperaba finalized).`,
    );
  }
  const assetId = session.finalized_asset_id;
  const revisionId = session.finalized_revision_id;
  if (!assetId || !revisionId) {
    throw new Error(
      `La carga de «${req.file.name}» finalizó sin las identidades definitivas del recurso.`,
    );
  }

  const asset = await assetService.getAsset(assetId, signal);
  const exactRev = asset.revisions.find((r) => r.id === revisionId);
  if (!exactRev) {
    throw new Error(
      `No se encontró la revisión creada (${revisionId}) del recurso cargado para «${req.file.name}».`,
    );
  }

  return {
    assetId: asset.id,
    assetRevisionId: exactRev.id,
    representation: exactRev.representation,
    sha256: exactRev.sha256,
    validationState: exactRev.validation_state,
  };
}
