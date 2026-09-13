/**
 * Modal to browse and select an exact revision of an existing 3D asset (#667 M2).
 * Excludes thumbnails from model selection; displays retired status and allows
 * retiring assets with explicit confirmation.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HardwareVisualAssetBinding } from '@granete/domain';
import type { HardwareAsset, HardwareAssetRevision, HardwareAssetService } from '@granete/storage';
import { AlertCircle, Archive, Box, Check, Loader2, RefreshCw } from 'lucide-react';
import { Modal, SearchInput, useDebouncedValue } from '../../common';

export interface HardwareAssetSelectorModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (binding: HardwareVisualAssetBinding, assetName: string) => void;
  readonly assetService?: HardwareAssetService;
  readonly canMutate?: boolean;
  readonly currentBinding?: HardwareVisualAssetBinding | null;
}

export function HardwareAssetSelectorModal({
  open,
  onClose,
  onSelect,
  assetService,
  canMutate = true,
  currentBinding,
}: HardwareAssetSelectorModalProps): ReactNode {
  const [assets, setAssets] = useState<readonly HardwareAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [retireConfirmId, setRetireConfirmId] = useState<string | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);

  const searchInputId = useId();
  const fetchGenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchAssets = () => {
    if (!assetService) return;
    const currentGen = ++fetchGenRef.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setRetireError(null);

    assetService
      .listAssets(controller.signal)
      .then((data) => {
        if (fetchGenRef.current !== currentGen || controller.signal.aborted) return;
        setAssets(data);
        if (data.length > 0 && !selectedAssetId) {
          // Pre-select current bound asset if in list, else first
          if (currentBinding) {
            const current = data.find((a) => a.id === currentBinding.assetId);
            if (current) setSelectedAssetId(current.id);
            else if (data[0]) setSelectedAssetId(data[0].id);
          } else if (data[0]) {
            setSelectedAssetId(data[0].id);
          }
        }
      })
      .catch((err: unknown) => {
        if (fetchGenRef.current !== currentGen || controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Error al cargar los recursos 3D';
        setError(msg);
      })
      .finally(() => {
        if (fetchGenRef.current !== currentGen || controller.signal.aborted) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    if (open) {
      setSearch('');
      setRetireConfirmId(null);
      setRetireError(null);
      fetchAssets();
    }
    return () => {
      fetchGenRef.current++;
      abortControllerRef.current?.abort();
    };
  }, [open, assetService]);

  const filteredAssets = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.display_name.toLowerCase().includes(q));
  }, [assets, debouncedSearch]);

  const selectedAsset = useMemo(() => {
    return assets.find((a) => a.id === selectedAssetId) ?? null;
  }, [assets, selectedAssetId]);

  // Thumbnails are NOT selectable as 3D models (prompt §6.2)
  const selectableRevisions = useMemo(() => {
    if (!selectedAsset) return [];
    return selectedAsset.revisions.filter(
      (r) => r.representation === 'skp' || r.representation === 'glb',
    );
  }, [selectedAsset]);

  const handleRetire = async (assetId: string) => {
    if (!assetService || !canMutate) return;
    setRetiringId(assetId);
    setRetireError(null);
    try {
      const updated = await assetService.retireAsset(assetId);
      setAssets((prev) => prev.map((a) => (a.id === assetId ? updated : a)));
      setRetireConfirmId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo retirar el recurso';
      setRetireError(msg);
    } finally {
      setRetiringId(null);
    }
  };

  const handleSelectRevision = (asset: HardwareAsset, rev: HardwareAssetRevision) => {
    if (asset.status === 'retired') return;
    const binding: HardwareVisualAssetBinding = {
      assetId: asset.id,
      assetRevisionId: rev.id,
      representation: rev.representation,
      sha256: rev.sha256,
      validationState: rev.validation_state,
    };
    onSelect(binding, asset.display_name);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Elegir modelo 3D existente"
      size="md"
      dataTestId="hardware-asset-selector-modal"
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <div className="hardware-asset-selector" data-testid="hardware-asset-selector">
        {!assetService ? (
          <div className="hardware-asset-selector__empty" data-testid="hardware-asset-no-service">
            <p>El servicio de recursos 3D no está disponible en este entorno o sesión.</p>
          </div>
        ) : loading ? (
          <div className="hardware-asset-selector__loading" data-testid="hardware-asset-loading">
            <Loader2 className="catalog-spin" size={24} aria-hidden />
            <p>Cargando recursos 3D...</p>
          </div>
        ) : error ? (
          <div className="hardware-asset-selector__error" data-testid="hardware-asset-error">
            <AlertCircle size={20} aria-hidden />
            <p>{error}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={fetchAssets}>
              <RefreshCw size={14} aria-hidden /> Reintentar
            </button>
          </div>
        ) : assets.length === 0 ? (
          <div className="hardware-asset-selector__empty" data-testid="hardware-asset-empty">
            <Box size={32} strokeWidth={1.5} aria-hidden />
            <p>No hay modelos 3D disponibles en la organización.</p>
          </div>
        ) : (
          <>
            <div className="hardware-asset-selector__search">
              <SearchInput
                id={searchInputId}
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nombre..."
                data-testid="hardware-asset-search"
              />
            </div>

            {retireError ? (
              <div className="catalog-form__error" data-testid="hardware-asset-retire-error">
                {retireError}
              </div>
            ) : null}

            <div className="hardware-asset-selector__body">
              {/* Assets list */}
              <div className="hardware-asset-selector__list" role="listbox" aria-label="Modelos 3D">
                {filteredAssets.length === 0 ? (
                  <p className="hardware-asset-selector__no-results">
                    No se encontraron modelos con ese nombre.
                  </p>
                ) : (
                  filteredAssets.map((asset) => {
                    const isSelected = asset.id === selectedAssetId;
                    const isRetired = asset.status === 'retired';
                    return (
                      <div
                        key={asset.id}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        className={`hardware-asset-selector__item ${
                          isSelected ? 'is-selected' : ''
                        } ${isRetired ? 'is-retired' : ''}`}
                        onClick={() => setSelectedAssetId(asset.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedAssetId(asset.id);
                          }
                        }}
                        data-testid={`hardware-asset-item-${asset.id}`}
                      >
                        <div className="hardware-asset-selector__item-header">
                          <span className="hardware-asset-selector__item-name">
                            {asset.display_name}
                          </span>
                          {isRetired ? (
                            <span className="badge badge--warning" title="Retirado de nuevas selecciones">
                              Retirado
                            </span>
                          ) : (
                            <span className="badge badge--neutral">
                              {asset.revisions.length}{' '}
                              {asset.revisions.length === 1 ? 'revisión' : 'revisiones'}
                            </span>
                          )}
                        </div>
                        {asset.provenance ? (
                          <span className="hardware-asset-selector__item-meta">
                            Origen: {asset.provenance}
                          </span>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Selected asset details & revisions */}
              <div className="hardware-asset-selector__details">
                {selectedAsset ? (
                  <div className="hardware-asset-detail">
                    <div className="hardware-asset-detail__header">
                      <div>
                        <h4 className="hardware-asset-detail__title">{selectedAsset.display_name}</h4>
                        <span className="hardware-asset-detail__id">ID: {selectedAsset.id}</span>
                      </div>
                      {canMutate && selectedAsset.status === 'active' ? (
                        retireConfirmId === selectedAsset.id ? (
                          <div className="hardware-asset-retire-confirm">
                            <p className="hardware-asset-retire-confirm__text">
                              ¿Retirar recurso de nuevas selecciones?
                              <br />
                              <small>
                                Los herrajes existentes conservarán su modelo. Esta acción no borra
                                archivos.
                              </small>
                            </p>
                            <div className="hardware-asset-retire-confirm__actions">
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => handleRetire(selectedAsset.id)}
                                disabled={retiringId === selectedAsset.id}
                                data-testid="hardware-asset-retire-confirm-btn"
                              >
                                {retiringId === selectedAsset.id ? 'Retirando...' : 'Confirmar retiro'}
                              </button>
                              <button
                                type="button"
                                className="btn btn--sm"
                                onClick={() => setRetireConfirmId(null)}
                                data-testid="hardware-asset-retire-cancel-btn"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setRetireConfirmId(selectedAsset.id)}
                            title="Retirar de nuevas selecciones"
                            data-testid="hardware-asset-retire-btn"
                          >
                            <Archive size={14} aria-hidden /> Retirar recurso
                          </button>
                        )
                      ) : null}
                    </div>

                    {selectedAsset.status === 'retired' ? (
                      <div className="hardware-asset-warning-banner">
                        <Archive size={16} aria-hidden />
                        <span>
                          Este recurso está retirado. Permanece consultable para herrajes ya asociados,
                          pero no está disponible para nuevas asociaciones.
                        </span>
                      </div>
                    ) : null}

                    <h5 className="hardware-asset-detail__subtitle">Revisiones disponibles</h5>
                    {selectableRevisions.length === 0 ? (
                      <p className="catalog-form__hint">
                        No hay archivos de modelo (.skp o .glb) en este recurso.
                      </p>
                    ) : (
                      <div className="hardware-asset-revisions-list">
                        {selectableRevisions.map((rev) => {
                          const isCurrent =
                            currentBinding?.assetId === selectedAsset.id &&
                            currentBinding?.assetRevisionId === rev.id;
                          const isRetired = selectedAsset.status === 'retired';
                          return (
                            <div
                              key={rev.id}
                              className={`hardware-asset-revision-card ${
                                isCurrent ? 'is-current' : ''
                              }`}
                              data-testid={`hardware-asset-revision-${rev.revision_number}`}
                            >
                              <div className="hardware-asset-revision-card__info">
                                <div className="hardware-asset-revision-card__title">
                                  <strong>Rev. {rev.revision_number}</strong>
                                  <span className="badge badge--info">
                                    {rev.representation.toUpperCase()}
                                  </span>
                                  {isCurrent ? (
                                    <span className="badge badge--success">
                                      <Check size={12} aria-hidden /> Asociado actualmente
                                    </span>
                                  ) : null}
                                </div>
                                <div className="hardware-asset-revision-card__meta">
                                  <span>Tamaño: {(rev.size_bytes / 1024).toFixed(1)} KB</span>
                                  <span>SHA-256: {rev.sha256.slice(0, 16)}...</span>
                                  <span>
                                    Estado:{' '}
                                    {rev.validation_state === 'pending'
                                      ? 'Pendiente de validación'
                                      : rev.validation_state === 'validated'
                                      ? 'Validado'
                                      : 'Falló validación'}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                disabled={isRetired || !canMutate}
                                onClick={() => handleSelectRevision(selectedAsset, rev)}
                                title={
                                  isRetired
                                    ? 'No se puede asociar un recurso retirado'
                                    : 'Seleccionar esta revisión exacta'
                                }
                                data-testid={`hardware-asset-select-rev-${rev.revision_number}`}
                              >
                                Seleccionar
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="catalog-form__hint">Selecciona un modelo de la lista.</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
