/**
 * "Modelo 3D y montaje" section for HardwareFormModal (#667 M2).
 * Offers two operational modes:
 *  1. Representación genérica (procedural preview shape / color / finishes)
 *  2. Modelo de archivo (exact versioned .skp / .glb asset binding)
 * Preserves generic shape as fallback when a file is bound.
 */

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Hardware, HardwareVisualAssetBinding } from '@granete/domain';
import {
  HARDWARE_FINISHES,
  HARDWARE_PART_ROLE_LABELS_ES,
  hardwarePartRolesForShape,
  matchHardwareFinish,
} from '@granete/domain';
import type { HardwareAsset, HardwareAssetService } from '@granete/storage';
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileUp,
  Info,
  Layers,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { HardwareDraft } from './hardwareDraft';
import { WorkspaceTabs } from '../../common';
import { HardwareAssetSelectorModal } from './HardwareAssetSelectorModal';
import { HardwareAssetUploadModal } from './HardwareAssetUploadModal';

export interface Hardware3DSectionProps {
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
  readonly canMutate: boolean;
  readonly assetService?: HardwareAssetService;
}

export function Hardware3DSection({
  draft,
  setDraft,
  canMutate,
  assetService,
}: Hardware3DSectionProps): ReactNode {
  const [sectionOpen, setSectionOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'file' | 'generic'>(
    draft.previewShape && !draft.visualAsset ? 'generic' : 'file',
  );

  // Submodals
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<{ id: string; name: string } | null>(null);

  // Loaded asset metadata for the current binding (display name, etc.)
  const [boundAsset, setBoundAsset] = useState<HardwareAsset | null>(null);

  // Automatically open section if editing an item with visual asset or generic shape
  useEffect(() => {
    if (draft.visualAsset) {
      setSectionOpen(true);
      setActiveTab('file');
    } else if (draft.previewShape) {
      setSectionOpen(true);
      setActiveTab('generic');
    }
  }, [draft.visualAsset, draft.previewShape]);

  // Fetch asset details if bound
  useEffect(() => {
    if (!draft.visualAsset || !assetService) {
      setBoundAsset(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    assetService
      .getAsset(draft.visualAsset.assetId, controller.signal)
      .then((asset) => {
        if (!active || controller.signal.aborted) return;
        setBoundAsset(asset);
      })
      .catch(() => {
        // Leave boundAsset null, fallback to binding ID info
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [draft.visualAsset?.assetId, assetService]);

  const selectedFinishId = matchHardwareFinish({
    color: draft.previewColor,
    metalness: draft.previewMetalness,
    roughness: draft.previewRoughness,
    clearcoat: draft.previewClearcoat,
  });

  const partRoles = (() => {
    const validShapes: readonly string[] = [
      'knob',
      'bar-pull',
      'cup-pull',
      'hinge',
      'slide',
      'rail',
      'leg',
    ];
    if (!validShapes.includes(draft.previewShape)) return [];
    const roles = hardwarePartRolesForShape(
      draft.previewShape as NonNullable<Hardware['previewShape']>,
    );
    return roles.length >= 2 ? roles : [];
  })();

  const handleSelectBinding = (binding: HardwareVisualAssetBinding, assetName: string) => {
    setDraft((prev) => ({
      ...prev,
      visualAsset: binding,
    }));
  };

  const handleUploadSuccess = (binding: HardwareVisualAssetBinding, asset: HardwareAsset) => {
    setBoundAsset(asset);
    setDraft((prev) => ({
      ...prev,
      visualAsset: binding,
    }));
  };

  const handleUnbind = () => {
    // Only affects this hardware draft; does not delete or retire files
    setDraft((prev) => ({
      ...prev,
      visualAsset: null,
    }));
  };

  const currentRevisionNumber = (() => {
    if (!boundAsset || !draft.visualAsset) return null;
    const rev = boundAsset.revisions.find(
      (r) => r.id === draft.visualAsset?.assetRevisionId,
    );
    return rev ? rev.revision_number : null;
  })();

  const summaryText = (() => {
    if (draft.visualAsset) {
      const rep = (draft.visualAsset.representation ?? 'skp').toUpperCase();
      const revText = currentRevisionNumber ? `Rev. ${currentRevisionNumber}` : 'Asociado';
      return `${rep} · ${revText}`;
    }
    if (draft.previewShape) {
      return 'Representación genérica';
    }
    return 'Opcional — modelo o forma genérica';
  })();

  return (
    <>
      <div className="catalog-form__disclosure" data-testid="hardware-3d-section">
        <button
          type="button"
          className="catalog-form__disclosure-header"
          aria-expanded={sectionOpen}
          onClick={() => setSectionOpen((o) => !o)}
          data-testid="hardware-3d-section-toggle"
        >
          {sectionOpen ? (
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
          )}
          <span className="catalog-form__disclosure-title">Modelo 3D y montaje</span>
          <span className="catalog-form__disclosure-summary">{summaryText}</span>
        </button>

        {sectionOpen ? (
          <div className="catalog-form__disclosure-body" data-testid="hardware-3d-section-body">
            {/* Mode selection tabs */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <WorkspaceTabs<'file' | 'generic'>
                ariaLabel="Modo de modelo 3D"
                idPrefix="hardware-3d-mode"
                testIdPrefix="hardware-3d"
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabs={[
                  {
                    id: 'file',
                    label: 'Modelo de archivo (.skp / .glb)',
                    icon: <FileCode2 size={15} aria-hidden />,
                  },
                  {
                    id: 'generic',
                    label: 'Representación genérica',
                    icon: <Sparkles size={15} aria-hidden />,
                  },
                ]}
              />
            </div>

            {/* TAB: File model */}
            {activeTab === 'file' ? (
              <div className="hardware-3d-file-panel" data-testid="hardware-3d-file-panel">
                {draft.visualAsset ? (
                  <div className="hardware-bound-card" data-testid="hardware-bound-card">
                    <div className="hardware-bound-card__header">
                      <div className="hardware-bound-card__badge-row">
                        <span className="badge badge--info">
                          {(draft.visualAsset.representation ?? 'skp').toUpperCase()}
                        </span>
                        {currentRevisionNumber ? (
                          <span className="badge badge--neutral">
                            Rev. {currentRevisionNumber}
                          </span>
                        ) : null}
                        <span
                          className={`badge ${
                            draft.visualAsset.validationState === 'validated'
                              ? 'badge--success'
                              : draft.visualAsset.validationState === 'failed'
                              ? 'badge--danger'
                              : 'badge--warning'
                          }`}
                        >
                          {draft.visualAsset.validationState === 'validated'
                            ? 'Validado'
                            : draft.visualAsset.validationState === 'failed'
                            ? 'Falló validación'
                            : 'Pendiente de validación'}
                        </span>
                        <span className="badge badge--neutral">Archivo almacenado</span>
                      </div>
                      <h4 className="hardware-bound-card__name">
                        {boundAsset?.display_name ?? 'Modelo 3D vinculado'}
                      </h4>
                      <p className="hardware-bound-card__ids">
                        ID: {draft.visualAsset.assetId} · Rev: {draft.visualAsset.assetRevisionId}
                      </p>
                      {draft.visualAsset.sha256 ? (
                        <p className="hardware-bound-card__hash">
                          SHA-256: <code>{draft.visualAsset.sha256.slice(0, 16)}...</code>
                        </p>
                      ) : null}
                    </div>

                    <div className="hardware-bound-card__notice">
                      <Info size={15} aria-hidden />
                      <span>
                        La visualización de este archivo en SketchUp se incorporará en la siguiente
                        entrega.
                      </span>
                    </div>

                    <div className="hardware-bound-card__actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setSelectorOpen(true)}
                        disabled={!canMutate}
                        data-testid="hardware-change-asset-btn"
                      >
                        Cambiar selección...
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => {
                          setUploadTarget({
                            id: draft.visualAsset!.assetId,
                            name: boundAsset?.display_name ?? 'Herraje',
                          });
                          setUploadOpen(true);
                        }}
                        disabled={!canMutate}
                        data-testid="hardware-add-revision-btn"
                      >
                        <FileUp size={14} aria-hidden /> Subir nueva versión...
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={handleUnbind}
                        disabled={!canMutate}
                        title="Quitar asociación para este herraje"
                        data-testid="hardware-unbind-asset-btn"
                      >
                        <Trash2 size={14} aria-hidden /> Quitar asociación
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="hardware-unbound-card" data-testid="hardware-unbound-card">
                    <Box size={32} strokeWidth={1.5} aria-hidden />
                    <p className="hardware-unbound-card__title">
                      Sin modelo de archivo asociado
                    </p>
                    <p className="hardware-unbound-card__desc">
                      Puedes seleccionar un archivo .skp o .glb existente o subir un archivo nuevo.
                    </p>
                    <div className="hardware-unbound-card__actions">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setSelectorOpen(true)}
                        disabled={!canMutate}
                        data-testid="hardware-open-selector-btn"
                      >
                        Elegir modelo existente
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => {
                          setUploadTarget(null);
                          setUploadOpen(true);
                        }}
                        disabled={!canMutate}
                        data-testid="hardware-open-upload-btn"
                      >
                        <FileUp size={14} aria-hidden /> Subir nuevo modelo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* TAB: Generic procedural preview (preserves fields as fallback) */}
            {activeTab === 'generic' ? (
              <div className="hardware-3d-generic-panel" data-testid="hardware-preview-3d-body">
                <p className="catalog-form__hint">
                  Esta representación paramétrica básica se utiliza cuando no hay un modelo de archivo
                  asociado o como respaldo visual.
                </p>
                <div className="catalog-form__row">
                  <label className="catalog-form__field">
                    <span>Forma (3D)</span>
                    <select
                      value={draft.previewShape}
                      onChange={(e) => setDraft({ ...draft, previewShape: e.target.value })}
                      data-testid="hardware-form-shape"
                    >
                      <option value="">— Sin forma —</option>
                      <option value="knob">Tirador (perilla)</option>
                      <option value="bar-pull">Tirador (barra)</option>
                      <option value="cup-pull">Tirador (copa)</option>
                      <option value="hinge">Bisagra</option>
                      <option value="slide">Corredera</option>
                      <option value="rail">Riel</option>
                      <option value="leg">Pata</option>
                    </select>
                  </label>
                  <label className="catalog-form__field">
                    <span>Acabado</span>
                    <select
                      value={selectedFinishId}
                      onChange={(e) => {
                        const finish = HARDWARE_FINISHES.find((f) => f.id === e.target.value);
                        if (finish) {
                          setDraft({
                            ...draft,
                            previewColor: finish.color,
                            previewMetalness: String(finish.metalness),
                            previewRoughness: String(finish.roughness),
                            previewClearcoat: String(finish.clearcoat),
                          });
                        }
                      }}
                      data-testid="hardware-form-finish"
                    >
                      <option value="">— Personalizado —</option>
                      {HARDWARE_FINISHES.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="catalog-form__row">
                  <label className="catalog-form__field">
                    <span>Color</span>
                    <input
                      type="color"
                      value={draft.previewColor || '#9aa0a6'}
                      onChange={(e) => setDraft({ ...draft, previewColor: e.target.value })}
                      data-testid="hardware-form-color"
                    />
                  </label>
                  {draft.previewColor ? (
                    <span
                      className="material-color-swatch"
                      style={{ backgroundColor: draft.previewColor }}
                      aria-label={draft.previewColor}
                      data-testid="hardware-form-color-swatch"
                    />
                  ) : null}
                </div>

                {partRoles.length > 0 ? (
                  <>
                    <div
                      className="catalog-form__row"
                      data-testid="hardware-form-part-finishes"
                    >
                      {partRoles.map((role) => (
                        <label key={role} className="catalog-form__field">
                          <span>Acabado · {HARDWARE_PART_ROLE_LABELS_ES[role]}</span>
                          <select
                            value={draft.partFinishes[role]}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                partFinishes: {
                                  ...draft.partFinishes,
                                  [role]: e.target.value,
                                },
                              })
                            }
                            data-testid={`hardware-form-finish-${role}`}
                          >
                            <option value="">Igual al acabado general</option>
                            {HARDWARE_FINISHES.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <p className="catalog-form__hint">
                      Cada parte puede llevar su propio acabado (F080). Vacío = usa el acabado
                      general de arriba.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Modals for selection and upload */}
      <HardwareAssetSelectorModal
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        onSelect={handleSelectBinding}
        assetService={assetService}
        canMutate={canMutate}
        currentBinding={draft.visualAsset}
      />

      <HardwareAssetUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={handleUploadSuccess}
        assetService={assetService}
        targetAssetId={uploadTarget?.id}
        targetAssetName={uploadTarget?.name}
      />
    </>
  );
}
