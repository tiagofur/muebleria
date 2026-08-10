/**
 * Ambient materials catalog ABM — presentation-only materials (floor tiles,
 * wall porcelain, paint) for the 3D room scene. NEVER enters BOM/cost/quote.
 * Clean type separation from MaterialBoard (spec #4148).
 *
 * Pattern: tabla-expand + Modal SM (design.md §6.4). Mirrors MaterialsCatalog
 * but carries NO pricing/BOM fields (widthMm/lengthMm/thicknessMm/boardPrice/
 * wastePercent/costPerM2/defaultEdgeBandId/grainDefault).
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AmbientMaterial, AmbientSurfaceType } from '@muebles/domain';
import {
  isValidPreviewColor,
  normalizePreviewColor,
} from '@muebles/domain';
import {
  Eye,
  EyeOff,
  Layers,
  Pencil,
  Plus,
  SearchX,
} from 'lucide-react';
import {
  EmptyState,
  Modal,
  SearchInput,
  StatusChips,
  useDebouncedValue,
} from '../common';
import {
  filterCatalogItems,
  validateRequiredName,
  validateUniqueCode,
  type CatalogStatusFilter,
} from './catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from './CatalogTable';

import './catalogs.css';

export type AmbientMaterialDraft = {
  code: string;
  name: string;
  surfaceType: AmbientSurfaceType;
  previewColor: string;
  /** Relative media path for 3D texture. */
  previewTextureUrl: string;
  previewTextureTileWidthMm: number;
  previewTextureTileLengthMm: number;
  previewRoughness?: number | '';
  previewMetalness?: number | '';
  previewClearcoat?: number | '';
};

const emptyDraft = (): AmbientMaterialDraft => ({
  code: '',
  name: '',
  surfaceType: 'floor',
  previewColor: '',
  previewTextureUrl: '',
  previewTextureTileWidthMm: 0,
  previewTextureTileLengthMm: 0,
  previewRoughness: '',
  previewMetalness: '',
  previewClearcoat: '',
});

function toDraft(item: AmbientMaterial): AmbientMaterialDraft {
  return {
    code: item.code,
    name: item.name,
    surfaceType: item.surfaceType,
    previewColor: item.previewColor ?? '',
    previewTextureUrl: item.previewTextureUrl ?? '',
    previewTextureTileWidthMm: item.previewTextureTileWidthMm ?? 0,
    previewTextureTileLengthMm: item.previewTextureTileLengthMm ?? 0,
    previewRoughness: item.previewRoughness ?? '',
    previewMetalness: item.previewMetalness ?? '',
    previewClearcoat: item.previewClearcoat ?? '',
  };
}

const SURFACE_TYPE_LABEL: Readonly<Record<AmbientSurfaceType, string>> = {
  floor: 'Suelo',
  wall: 'Pared',
  ceiling: 'Techo',
};

export interface AmbientMaterialsCatalogProps {
  readonly materials: readonly AmbientMaterial[];
  readonly onCreate: (draft: AmbientMaterialDraft) => void;
  readonly onUpdate: (id: string, draft: AmbientMaterialDraft) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  /** F035: hide ABM when false (read-only list). roleCanMutateCatalog gate. */
  readonly canMutate?: boolean;
  /** F042: upload media; returns relative media URL. */
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function AmbientMaterialsCatalog({
  materials,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  canMutate = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
}: AmbientMaterialsCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AmbientMaterialDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      filterCatalogItems(materials, {
        status,
        query: debouncedSearch,
      }),
    [materials, status, debouncedSearch],
  );

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (item: AmbientMaterial) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setError(null);
    setModalOpen(true);
  };

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(
      draft.code,
      materials,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    const colorTrim = draft.previewColor.trim();
    if (colorTrim && !isValidPreviewColor(colorTrim)) {
      return 'Color de vista previa inválido. Usá #RGB o #RRGGBB, o dejalo vacío.';
    }
    return null;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    const parsePbr = (v: number | '' | undefined) =>
      typeof v === 'number' && Number.isFinite(v)
        ? Math.min(1, Math.max(0, v))
        : undefined;

    const finalDraft: AmbientMaterialDraft = {
      ...draft,
      previewColor: normalizePreviewColor(draft.previewColor) ?? '',
      previewTextureUrl: draft.previewTextureUrl.trim(),
      previewTextureTileWidthMm:
        draft.previewTextureTileWidthMm > 0
          ? draft.previewTextureTileWidthMm
          : 0,
      previewTextureTileLengthMm:
        draft.previewTextureTileLengthMm > 0
          ? draft.previewTextureTileLengthMm
          : 0,
      previewRoughness: parsePbr(draft.previewRoughness),
      previewMetalness: parsePbr(draft.previewMetalness),
      previewClearcoat: parsePbr(draft.previewClearcoat),
    };

    if (editingId) {
      onUpdate(editingId, finalDraft);
    } else {
      onCreate(finalDraft);
    }
    closeModal();
  };

  const columns: CatalogColumn<AmbientMaterial>[] = useMemo(
    () => [
      {
        key: 'previewColor',
        header: 'Color',
        render: (r) =>
          r.previewColor ? (
            <svg
              className="material-color-swatch"
              width={20}
              height={20}
              viewBox="0 0 20 20"
              aria-label={r.previewColor}
              data-testid={`ambient-material-swatch-${r.id}`}
            >
              <rect
                x={0}
                y={0}
                width={20}
                height={20}
                rx={4}
                fill={r.previewColor}
              />
            </svg>
          ) : (
            <span className="catalog-form__hint">—</span>
          ),
      },
      {
        key: 'code',
        header: 'Código',
        render: (r) => (
          <span className="catalog-row-detail__value--mono">{r.code}</span>
        ),
      },
      { key: 'name', header: 'Nombre', render: (r) => r.name },
      {
        key: 'surfaceType',
        header: 'Tipo',
        render: (r) => SURFACE_TYPE_LABEL[r.surfaceType],
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [],
  );

  const isTrulyEmpty = materials.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section
      className="catalog-page"
      aria-label="Catálogo de materiales de ambiente"
    >
      <div className="catalog-page__header">
        <div>
          <h2 className="catalog-page__title">Materiales de ambiente</h2>
          <p className="page-header__subtitle">
            Pisos y paredes para la escena 3D (solo presentación, sin costo)
          </p>
        </div>
        <div className="catalog-page__toolbar">
          {canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
              data-testid="ambient-material-create"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo material
            </button>
          ) : null}
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar materiales de ambiente…"
            aria-label="Buscar materiales de ambiente"
          />
          <StatusChips value={status} onChange={setStatus} />
        </div>
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={Layers}
            title="No hay materiales de ambiente"
            description="Agregá pisos o paredes para texturizar la escena 3D del Proyectar."
            actionLabel="Agregar material"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="Sin resultados"
            description="No hay materiales que coincidan con la búsqueda o el filtro."
            actionLabel="Limpiar filtros"
            onAction={() => {
              setSearch('');
              setStatus('active');
            }}
          />
        ) : (
          <CatalogTable
            columns={columns}
            rows={rows}
            expandedId={expandedId}
            isInactive={(r) => !r.active}
            onRowClick={(row) =>
              setExpandedId((prev) => (prev === row.id ? null : row.id))
            }
            renderExpandedDetail={(row) => (
              <>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Código</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    {row.code}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Nombre</span>
                  <span className="catalog-row-detail__value">{row.name}</span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">
                    Tipo de superficie
                  </span>
                  <span className="catalog-row-detail__value">
                    {SURFACE_TYPE_LABEL[row.surfaceType]}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Estado</span>
                  <span className="catalog-row-detail__value">
                    <ActiveBadge active={row.active} />
                  </span>
                </div>
                {canMutate ? (
                  <div className="catalog-row-detail__actions">
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => startEdit(row)}
                    >
                      <Pencil size={14} strokeWidth={1.5} aria-hidden />
                      Editar
                    </button>
                    {row.active ? (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => onDeactivate(row.id)}
                      >
                        <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                        Desactivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => onReactivate(row.id)}
                      >
                        <Eye size={14} strokeWidth={1.5} aria-hidden />
                        Reactivar
                      </button>
                    )}
                  </div>
                ) : null}
              </>
            )}
            getRowActions={(row) =>
              canMutate ? (
                <>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    aria-label={`Editar ${row.code}`}
                    onClick={() => startEdit(row)}
                  >
                    <Pencil size={14} strokeWidth={1.5} aria-hidden />
                    Editar
                  </button>
                  {row.active ? (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--danger"
                      aria-label={`Desactivar ${row.code}`}
                      onClick={() => onDeactivate(row.id)}
                    >
                      <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                      Desactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      aria-label={`Reactivar ${row.code}`}
                      onClick={() => onReactivate(row.id)}
                    >
                      <Eye size={14} strokeWidth={1.5} aria-hidden />
                      Reactivar
                    </button>
                  )}
                </>
              ) : null
            }
          />
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar material de ambiente' : 'Nuevo material de ambiente'}
        size="sm"
        dataTestId="ambient-material-form-modal"
        footer={
          <>
            <button type="button" className="btn" onClick={closeModal}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={formId}
              data-testid="ambient-material-submit"
            >
              Guardar
            </button>
          </>
        }
      >
        <form id={formId} className="catalog-form" onSubmit={handleSubmit}>
          {error ? <p className="catalog-form__error">{error}</p> : null}

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Identidad</legend>
            <div className="catalog-form__field">
              <label htmlFor="amb-code">Código</label>
              <input
                id="amb-code"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                autoComplete="off"
                required
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="amb-name">Nombre</label>
              <input
                id="amb-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="amb-surface">Tipo de superficie</label>
              <select
                id="amb-surface"
                value={draft.surfaceType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    surfaceType: e.target.value as AmbientSurfaceType,
                  })
                }
              >
                <option value="floor">Suelo</option>
                <option value="wall">Pared</option>
                <option value="ceiling">Techo</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">
              Vista 3D y textura
            </legend>
            <div className="catalog-form__field">
              <label htmlFor="amb-color">Color de vista previa</label>
              <div className="material-preview-color-row">
                <input
                  id="amb-color-picker"
                  type="color"
                  className="material-preview-color-picker"
                  value={
                    /^#([0-9a-fA-F]{6})$/.test(draft.previewColor)
                      ? draft.previewColor
                      : '#D4C4A8'
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, previewColor: e.target.value })
                  }
                  aria-label="Selector de color"
                  data-testid="ambient-material-color-picker"
                />
                <input
                  id="amb-color"
                  className="material-preview-color-hex"
                  value={draft.previewColor}
                  onChange={(e) =>
                    setDraft({ ...draft, previewColor: e.target.value })
                  }
                  placeholder="#F5F5F0"
                  autoComplete="off"
                />
              </div>
              <p className="catalog-form__hint">
                Color sólido para el 3D (#RRGGBB). Vacío = color genérico.
              </p>
            </div>
            <div
              className="catalog-form__field"
              data-testid="ambient-material-image-field"
            >
              <label htmlFor="amb-texture">Textura (foto)</label>
              <div className="catalog-form__image-row">
                {draft.previewTextureUrl ? (
                  <img
                    src={resolveImageUrl(draft.previewTextureUrl)}
                    alt={draft.name || 'Textura'}
                    className="catalog-image catalog-image--md"
                  />
                ) : (
                  <span className="catalog-form__hint">Sin textura</span>
                )}
                {canMutate && onUploadImage ? (
                  <input
                    id="amb-texture"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void (async () => {
                        try {
                          const url = await onUploadImage(file);
                          setDraft((prev) => ({
                            ...prev,
                            previewTextureUrl: url,
                          }));
                        } catch {
                          /* shell toasts */
                        }
                      })();
                      e.target.value = '';
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-tex-tile-w">
                  Muestra textura X — ancho (mm)
                </label>
                <input
                  id="amb-tex-tile-w"
                  type="number"
                  min={0}
                  step="1"
                  value={draft.previewTextureTileWidthMm || ''}
                  placeholder="600"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      previewTextureTileWidthMm: Number(e.target.value) || 0,
                    })
                  }
                  data-testid="ambient-material-texture-tile-width"
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-tex-tile-l">
                  Muestra textura Y — alto (mm)
                </label>
                <input
                  id="amb-tex-tile-l"
                  type="number"
                  min={0}
                  step="1"
                  value={draft.previewTextureTileLengthMm || ''}
                  placeholder="600"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      previewTextureTileLengthMm: Number(e.target.value) || 0,
                    })
                  }
                  data-testid="ambient-material-texture-tile-length"
                />
              </div>
            </div>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-pbr-roughness">Rugosidad (0..1)</label>
                <input
                  id="amb-pbr-roughness"
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={draft.previewRoughness ?? ''}
                  placeholder="0.6"
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? '' : Number(e.target.value);
                    setDraft({ ...draft, previewRoughness: val });
                  }}
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-pbr-clearcoat">Laca / Brillo (0..1)</label>
                <input
                  id="amb-pbr-clearcoat"
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={draft.previewClearcoat ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? '' : Number(e.target.value);
                    setDraft({ ...draft, previewClearcoat: val });
                  }}
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-pbr-metalness">Metálico (0..1)</label>
                <input
                  id="amb-pbr-metalness"
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={draft.previewMetalness ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? '' : Number(e.target.value);
                    setDraft({ ...draft, previewMetalness: val });
                  }}
                />
              </div>
            </div>
          </fieldset>
        </form>
      </Modal>
    </section>
  );
}
