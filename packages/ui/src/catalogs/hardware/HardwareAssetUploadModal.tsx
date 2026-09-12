/**
 * Modal to upload a 3D model (.skp / .glb) or add a revision to an existing asset (#667 M2).
 * Strictly manages upload stages, stable idempotency keys per logical attempt,
 * explicit session query on finalize, and exact revision verification.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { HardwareVisualAssetBinding } from '@granete/domain';
import type {
  HardwareAsset,
  HardwareAssetOrigin,
  HardwareAssetRepresentation,
  HardwareAssetService,
  HardwareAssetUploadSession,
  StartHardwareAssetUploadRequest,
} from '@granete/storage';
import { newIdempotencyKey } from '@granete/storage';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileUp,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Modal } from '../../common';

export type UploadStage =
  | 'idle'
  | 'starting'
  | 'uploading'
  | 'finalizing'
  | 'confirmed'
  | 'error'
  | 'cancelled';

export interface HardwareAssetUploadModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess: (binding: HardwareVisualAssetBinding, asset: HardwareAsset) => void;
  readonly assetService?: HardwareAssetService;
  readonly targetAssetId?: string | null;
  readonly targetAssetName?: string | null;
}

export function HardwareAssetUploadModal({
  open,
  onClose,
  onSuccess,
  assetService,
  targetAssetId,
  targetAssetName,
}: HardwareAssetUploadModalProps): ReactNode {
  const formId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState(targetAssetName ?? '');
  const [provenance, setProvenance] = useState('');
  const [license, setLicense] = useState('');

  // Advanced physical origin configuration (C4)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hasConfiguredOrigin, setHasConfiguredOrigin] = useState(false);
  const [sourceUnits, setSourceUnits] = useState<'mm' | 'cm' | 'm' | 'inch'>('mm');
  const [upAxis, setUpAxis] = useState<'y' | 'z'>('z');
  const [hasAnchorOffset, setHasAnchorOffset] = useState(false);
  const [anchorX, setAnchorX] = useState('');
  const [anchorY, setAnchorY] = useState('');
  const [anchorZ, setAnchorZ] = useState('');

  // Upload operation state
  const [stage, setStage] = useState<UploadStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<HardwareAssetUploadSession | null>(null);

  // Stable idempotency keys per attempt
  const [startKey, setStartKey] = useState<string>(() => newIdempotencyKey());
  const [finalizeKey, setFinalizeKey] = useState<string>(() => newIdempotencyKey());

  // Cancellation and operation scope tracking (C3)
  const opGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetForm = () => {
    setFile(null);
    setDisplayName(targetAssetName ?? '');
    setProvenance('');
    setLicense('');
    setAdvancedOpen(false);
    setHasConfiguredOrigin(false);
    setSourceUnits('mm');
    setUpAxis('z');
    setHasAnchorOffset(false);
    setAnchorX('');
    setAnchorY('');
    setAnchorZ('');
    setStage('idle');
    setError(null);
    setSession(null);
    setStartKey(newIdempotencyKey());
    setFinalizeKey(newIdempotencyKey());
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      opGenerationRef.current++;
      abortControllerRef.current?.abort();
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    }
    return () => {
      opGenerationRef.current++;
      abortControllerRef.current?.abort();
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, [open]);

  const handleClose = () => {
    if (stage === 'starting' || stage === 'uploading' || stage === 'finalizing') {
      if (!window.confirm('Hay una carga en curso. ¿Deseas cancelarla?')) {
        return;
      }
      if (session && assetService) {
        void assetService.cancelUpload(session.id);
      }
    }
    opGenerationRef.current++;
    abortControllerRef.current?.abort();
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    resetForm();
    onClose();
  };

  const detectRepresentation = (f: File): HardwareAssetRepresentation | null => {
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'skp') return 'skp';
    if (ext === 'glb') return 'glb';
    return null;
  };

  // C4: Origin configuration does NOT depend on accordion open state
  const buildOrigin = (): { origin?: HardwareAssetOrigin; error?: string } => {
    if (!hasConfiguredOrigin) return { origin: undefined };
    const origin: HardwareAssetOrigin = {
      source_units: sourceUnits,
      up_axis: upAxis,
    };
    if (hasAnchorOffset) {
      if (anchorX.trim() === '' || anchorY.trim() === '' || anchorZ.trim() === '') {
        return {
          error:
            'Las coordenadas de desplazamiento de anclaje (X, Y, Z) son obligatorias si se activa la opción.',
        };
      }
      const x = Number(anchorX);
      const y = Number(anchorY);
      const z = Number(anchorZ);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          error:
            'Las coordenadas de desplazamiento de anclaje deben ser números finitos válidos.',
        };
      }
      return {
        origin: {
          ...origin,
          anchor_offset_mm: { x_mm: x, y_mm: y, z_mm: z },
        },
      };
    }
    return { origin };
  };

  const runUploadProcess = async (
    targetFile: File,
    sessionToResume: HardwareAssetUploadSession | null,
  ) => {
    if (!assetService) {
      setError('Servicio de recursos no disponible');
      setStage('error');
      return;
    }

    const rep = detectRepresentation(targetFile);
    if (!rep) {
      setError('Solo se admiten archivos .skp y .glb');
      setStage('error');
      return;
    }

    const originResult = buildOrigin();
    if (originResult.error) {
      setError(originResult.error);
      setStage('error');
      return;
    }

    const currentGen = ++opGenerationRef.current;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }

    const isStale = () =>
      opGenerationRef.current !== currentGen || abortController.signal.aborted;

    setError(null);
    let activeSession = sessionToResume;

    try {
      // C2: If resuming an existing session, query authoritative state from the server first
      if (activeSession) {
        try {
          activeSession = await assetService.getSession(
            activeSession.id,
            abortController.signal,
          );
          if (isStale()) return;
          setSession(activeSession);
        } catch (err: unknown) {
          if (isStale()) return;
          const msg =
            err instanceof Error ? err.message : 'Error al consultar la sesión';
          setError(`No se pudo verificar el estado de la sesión de carga: ${msg}`);
          setStage('error');
          return;
        }

        if (activeSession.status === 'cancelled') {
          setError('La sesión de carga fue cancelada en el servidor. Inicia una nueva carga.');
          setStage('error');
          setSession(null);
          return;
        }

        if (activeSession.status !== 'finalized') {
          const expiresAtMs = new Date(activeSession.expires_at).getTime();
          if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
            setError('La sesión de carga ha expirado. Inicia una nueva carga.');
            setStage('error');
            setSession(null);
            return;
          }
        }
      }

      // Step 1: Start upload session if not already started
      if (!activeSession) {
        setStage('starting');
        const req: StartHardwareAssetUploadRequest = {
          representation: rep,
          display_name: targetAssetName ?? (displayName.trim() || targetFile.name),
          ...(provenance.trim() ? { provenance: provenance.trim() } : {}),
          ...(license.trim() ? { license: license.trim() } : {}),
          ...(originResult.origin ? { origin: originResult.origin } : {}),
          ...(targetAssetId ? { asset_id: targetAssetId } : {}),
        };
        const startedSession = await assetService.startUpload(
          req,
          startKey,
          abortController.signal,
        );
        if (isStale()) {
          // C3: If modal closed or cancelled while start was in flight, cancel the remote session
          void assetService.cancelUpload(startedSession.id);
          return;
        }
        activeSession = startedSession;
        setSession(activeSession);
      }

      // Step 2: Upload binary bytes if prepared and not already staged (C2)
      if (activeSession.status === 'prepared' && !activeSession.staged) {
        setStage('uploading');
        const staged = await assetService.uploadBytes(
          activeSession.id,
          rep,
          targetFile,
          targetFile.name,
          abortController.signal,
        );
        if (isStale()) return;
        activeSession = { ...activeSession, staged };
        setSession(activeSession);
      }

      // Step 3: Finalize upload session if prepared (C2: skip if already finalized)
      if (activeSession.status === 'prepared') {
        setStage('finalizing');
        await assetService.finalizeUpload(
          activeSession.id,
          finalizeKey,
          abortController.signal,
        );
        if (isStale()) return;

        // Query session to get finalized_asset_id and finalized_revision_id
        activeSession = await assetService.getSession(
          activeSession.id,
          abortController.signal,
        );
        if (isStale()) return;
        setSession(activeSession);
      }

      // Step 4: Session is finalized: read asset and select exact revision
      if (activeSession.status === 'finalized') {
        const assetId = activeSession.finalized_asset_id;
        const revisionId = activeSession.finalized_revision_id;
        if (!assetId || !revisionId) {
          throw new Error('La sesión finalizada no devolvió las identidades definitivas del recurso');
        }

        const asset = await assetService.getAsset(assetId, abortController.signal);
        if (isStale()) return;

        const exactRev = asset.revisions.find((r) => r.id === revisionId);
        if (!exactRev) {
          throw new Error(
            `No se encontró la revisión creada (${revisionId}) en el recurso ${assetId}`,
          );
        }

        // Step 5: Success!
        setStage('confirmed');
        const binding: HardwareVisualAssetBinding = {
          assetId: asset.id,
          assetRevisionId: exactRev.id,
          representation: exactRev.representation,
          sha256: exactRev.sha256,
          validationState: exactRev.validation_state,
        };

        successTimerRef.current = setTimeout(() => {
          if (isStale()) return;
          onSuccess(binding, asset);
          resetForm();
          onClose();
        }, 300);
      } else {
        throw new Error(`Estado de sesión no reconocido: ${activeSession.status}`);
      }
    } catch (err: unknown) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : 'Error durante la carga del archivo';
      setError(msg);
      setStage('error');
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!file) {
      setError('Selecciona un archivo .skp o .glb');
      return;
    }
    void runUploadProcess(file, null);
  };

  const handleRetry = () => {
    if (!file) return;
    // C2: Resume from the existing session state
    void runUploadProcess(file, session);
  };

  const isBusy =
    stage === 'starting' || stage === 'uploading' || stage === 'finalizing';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={targetAssetId ? `Nueva versión: ${targetAssetName ?? 'Herraje'}` : 'Subir modelo 3D'}
      size="md"
      dataTestId="hardware-asset-upload-modal"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={handleClose}
            disabled={isBusy}
            data-testid="hardware-asset-upload-cancel-btn"
          >
            Cancelar
          </button>
          {stage === 'error' ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRetry}
              data-testid="hardware-asset-upload-retry-btn"
            >
              <RefreshCw size={14} aria-hidden /> Reintentar
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!file || isBusy || stage === 'confirmed'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSubmit(e);
              }}
              data-testid="hardware-asset-upload-submit-btn"
            >
              {isBusy ? (
                <>
                  <Loader2 className="catalog-spin" size={14} aria-hidden />
                  {stage === 'starting'
                    ? 'Iniciando...'
                    : stage === 'uploading'
                    ? 'Subiendo archivo...'
                    : 'Finalizando...'}
                </>
              ) : (
                <>
                  <Upload size={14} aria-hidden /> Iniciar carga
                </>
              )}
            </button>
          )}
        </>
      }
    >
      <form id={formId} className="catalog-form" onSubmit={handleSubmit}>
        {error ? (
          <div className="catalog-form__error" data-testid="hardware-upload-error">
            <AlertCircle size={16} aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {stage === 'confirmed' ? (
          <div className="hardware-upload-success" data-testid="hardware-upload-success">
            <CheckCircle2 size={24} aria-hidden />
            <div>
              <strong>Archivo almacenado correctamente</strong>
              <p>Revisión asociada al formulario.</p>
            </div>
          </div>
        ) : null}

        {/* File input */}
        <div className="catalog-form__field">
          <label htmlFor="hw-asset-file">Archivo 3D (.skp o .glb)</label>
          <input
            id="hw-asset-file"
            type="file"
            accept=".skp,.glb,model/gltf-binary,application/octet-stream"
            disabled={isBusy}
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setFile(selected);
              if (selected && !targetAssetId && !displayName) {
                const nameWithoutExt = selected.name.replace(/\.[^/.]+$/, '');
                setDisplayName(nameWithoutExt);
              }
              // A new file resets the session and keys
              setSession(null);
              setStartKey(newIdempotencyKey());
              setFinalizeKey(newIdempotencyKey());
              setError(null);
              setStage('idle');
            }}
            required
            data-testid="hardware-asset-file-input"
          />
          <p className="catalog-form__hint">
            Formatos soportados: SketchUp (.skp) y glTF Binary (.glb).
          </p>
        </div>

        {/* Display name (only if creating new asset) */}
        {!targetAssetId ? (
          <div className="catalog-form__field">
            <label htmlFor="hw-asset-name">Nombre del recurso 3D</label>
            <input
              id="hw-asset-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ej. Tirador Tubular 128mm"
              disabled={isBusy}
              required
              data-testid="hardware-asset-name-input"
            />
          </div>
        ) : null}

        {/* Metadata fields */}
        <div className="catalog-form__row">
          <div className="catalog-form__field">
            <label htmlFor="hw-asset-prov">Procedencia (opcional)</label>
            <input
              id="hw-asset-prov"
              value={provenance}
              onChange={(e) => setProvenance(e.target.value)}
              placeholder="ej. Fabricante / Catálogo oficial"
              disabled={isBusy}
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="hw-asset-lic">Licencia (opcional)</label>
            <input
              id="hw-asset-lic"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              placeholder="ej. Propietaria / CC-BY"
              disabled={isBusy}
            />
          </div>
        </div>

        {/* Advanced origin disclosure */}
        <div className="catalog-form__disclosure">
          <button
            type="button"
            className="catalog-form__disclosure-header"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((o) => !o)}
            disabled={isBusy}
            data-testid="hardware-upload-advanced-toggle"
          >
            {advancedOpen ? (
              <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
            )}
            <span className="catalog-form__disclosure-title">
              Configuración de origen del modelo (opcional)
            </span>
          </button>
          {advancedOpen ? (
            <div className="catalog-form__disclosure-body">
              <p className="catalog-form__hint">
                Normalización física del archivo. Si no se modifica, se conservan los valores
                predeterminados del archivo.
              </p>
              <div className="catalog-form__field">
                <label className="catalog-form__checkbox-label">
                  <input
                    type="checkbox"
                    checked={hasConfiguredOrigin}
                    onChange={(e) => {
                      setHasConfiguredOrigin(e.target.checked);
                      setSession(null);
                      setStartKey(newIdempotencyKey());
                      setFinalizeKey(newIdempotencyKey());
                    }}
                    disabled={isBusy}
                    data-testid="hardware-upload-configure-origin-checkbox"
                  />
                  <span>Declarar normalización física de origen y montaje</span>
                </label>
              </div>

              {hasConfiguredOrigin ? (
                <>
                  <div className="catalog-form__row">
                    <label className="catalog-form__field">
                      <span>Unidades de origen</span>
                      <select
                        value={sourceUnits}
                        onChange={(e) => {
                          setSourceUnits(e.target.value as 'mm' | 'cm' | 'm' | 'inch');
                          setSession(null);
                          setStartKey(newIdempotencyKey());
                          setFinalizeKey(newIdempotencyKey());
                        }}
                        disabled={isBusy}
                        data-testid="hardware-upload-source-units"
                      >
                        <option value="mm">Milímetros (mm)</option>
                        <option value="cm">Centímetros (cm)</option>
                        <option value="m">Metros (m)</option>
                        <option value="inch">Pulgadas (inch)</option>
                      </select>
                    </label>
                    <label className="catalog-form__field">
                      <span>Eje vertical (Up Axis)</span>
                      <select
                        value={upAxis}
                        onChange={(e) => {
                          setUpAxis(e.target.value as 'y' | 'z');
                          setSession(null);
                          setStartKey(newIdempotencyKey());
                          setFinalizeKey(newIdempotencyKey());
                        }}
                        disabled={isBusy}
                        data-testid="hardware-upload-up-axis"
                      >
                        <option value="z">Z arriba (SketchUp estándar)</option>
                        <option value="y">Y arriba (glTF / WebGL estándar)</option>
                      </select>
                    </label>
                  </div>

                  <div className="catalog-form__field">
                    <label className="catalog-form__checkbox-label">
                      <input
                        type="checkbox"
                        checked={hasAnchorOffset}
                        onChange={(e) => {
                          setHasAnchorOffset(e.target.checked);
                          setSession(null);
                          setStartKey(newIdempotencyKey());
                          setFinalizeKey(newIdempotencyKey());
                        }}
                        disabled={isBusy}
                        data-testid="hardware-upload-has-anchor-offset"
                      />
                      <span>Especificar desplazamiento de anclaje (Anchor Offset)</span>
                    </label>
                  </div>

                  {hasAnchorOffset ? (
                    <div className="catalog-form__row">
                      <label className="catalog-form__field">
                        <span>X (mm)</span>
                        <input
                          type="number"
                          step="any"
                          value={anchorX}
                          onChange={(e) => {
                            setAnchorX(e.target.value);
                            setSession(null);
                            setStartKey(newIdempotencyKey());
                            setFinalizeKey(newIdempotencyKey());
                          }}
                          disabled={isBusy}
                          data-testid="hardware-upload-anchor-x"
                        />
                      </label>
                      <label className="catalog-form__field">
                        <span>Y (mm)</span>
                        <input
                          type="number"
                          step="any"
                          value={anchorY}
                          onChange={(e) => {
                            setAnchorY(e.target.value);
                            setSession(null);
                            setStartKey(newIdempotencyKey());
                            setFinalizeKey(newIdempotencyKey());
                          }}
                          disabled={isBusy}
                          data-testid="hardware-upload-anchor-y"
                        />
                      </label>
                      <label className="catalog-form__field">
                        <span>Z (mm)</span>
                        <input
                          type="number"
                          step="any"
                          value={anchorZ}
                          onChange={(e) => {
                            setAnchorZ(e.target.value);
                            setSession(null);
                            setStartKey(newIdempotencyKey());
                            setFinalizeKey(newIdempotencyKey());
                          }}
                          disabled={isBusy}
                          data-testid="hardware-upload-anchor-z"
                        />
                      </label>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Stage progress feedback */}
        {isBusy ? (
          <div className="hardware-upload-stage" data-testid="hardware-upload-stage-indicator">
            <Loader2 className="catalog-spin" size={16} aria-hidden />
            <span>
              {stage === 'starting' && 'Iniciando sesión de carga...'}
              {stage === 'uploading' && 'Transfiriendo bytes del modelo...'}
              {stage === 'finalizing' && 'Verificando integridad y finalizando...'}
            </span>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
