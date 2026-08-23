/**
 * Create/edit material modal (F020 pattern, MD size) — grouped form:
 * Identidad / Tablero y precio / Vista 3D collapsible (Fase 3 UI).
 * Presentational: state lives in the parent screen (F117 split).
 */

import { type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import type { EdgeBand, MaterialCategory } from '@muebles/domain';
import { categoryPath } from '@muebles/domain';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { CatalogImage, Modal, formatMoneyDisplay } from '../../common';
import { CatalogPicker } from '../CatalogPicker';
import { extractDominantColorFromImageFile } from '../extractDominantColor';
import type { MaterialCostInputs, MaterialDraft } from './materialDraft';
import { edgePickerItems, hasPreview3dConfig } from './materialDraft';

export interface MaterialFormModalProps {
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: MaterialDraft;
  readonly setDraft: Dispatch<SetStateAction<MaterialDraft>>;
  readonly error: string | null;
  /** All edges (picker only shows active ones — passed pre-filtered). */
  readonly activeEdges: readonly EdgeBand[];
  /** F142: subgrupos de materiales (árbol de categorías). */
  readonly materialCategories: readonly MaterialCategory[];
  readonly canMutate: boolean;
  readonly getCostPerM2: (input: MaterialCostInputs) => number;
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
  readonly preview3dOpen: boolean;
  readonly setPreview3dOpen: Dispatch<SetStateAction<boolean>>;
  readonly tileSuggestBusy: boolean;
  readonly tileSuggestMsg: string | null;
  readonly onSuggestTiles: () => void;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onClose: () => void;
  readonly onOpenCreateEdge: () => void;
}

export function MaterialFormModal({
  open,
  editingId,
  formId,
  draft,
  setDraft,
  error,
  activeEdges,
  materialCategories,
  canMutate,
  getCostPerM2,
  onUploadImage,
  resolveImageUrl,
  preview3dOpen,
  setPreview3dOpen,
  tileSuggestBusy,
  tileSuggestMsg,
  onSuggestTiles,
  onSubmit,
  onClose,
  onOpenCreateEdge,
}: MaterialFormModalProps): ReactNode {
  const textureImagePath =
    draft.previewTextureUrl.trim() || draft.imageUrl.trim() || '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId ? 'Editar material' : 'Nuevo material'}
      size="md"
      dataTestId="material-form-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" form={formId}>
            Guardar
          </button>
        </>
      }
    >
      <form id={formId} className="catalog-form" onSubmit={onSubmit}>
        {error ? <p className="catalog-form__error">{error}</p> : null}

        <fieldset className="catalog-form__section">
          <legend className="catalog-form__section-title">Identidad</legend>
          <div className="catalog-form__field">
            <label htmlFor="mat-code">Código</label>
            <input
              id="mat-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-name">Nombre</label>
            <input
              id="mat-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-manufacturer">Fabricante</label>
            <input
              id="mat-manufacturer"
              value={draft.manufacturer}
              onChange={(e) =>
                setDraft({ ...draft, manufacturer: e.target.value })
              }
              placeholder="Ej. Arauco, Masisa…"
              autoComplete="off"
              required
              data-testid="material-form-manufacturer"
            />
          </div>
          {materialCategories.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="mat-category">Subgrupo</label>
              <select
                id="mat-category"
                value={draft.categoryId}
                onChange={(e) =>
                  setDraft({ ...draft, categoryId: e.target.value })
                }
                data-testid="material-form-category"
              >
                <option value="">Sin subgrupo</option>
                {materialCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryPath(category.id, materialCategories)
                      .map((node) => node.name)
                      .join(' › ')}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div
            className="catalog-form__field"
            data-testid="material-image-field"
          >
            <label htmlFor="mat-image">Foto</label>
            <div className="catalog-form__image-row">
              <CatalogImage
                src={resolveImageUrl(draft.imageUrl || undefined)}
                alt={draft.name || 'Material'}
                size="md"
              />
              {canMutate && onUploadImage ? (
                <input
                  id="mat-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void (async () => {
                      try {
                        const url = await onUploadImage(file);
                        let previewColor: string | undefined;
                        try {
                          previewColor =
                            await extractDominantColorFromImageFile(file);
                        } catch {
                          /* color is optional */
                        }
                        setDraft((prev) => ({
                          ...prev,
                          imageUrl: url,
                          ...(previewColor && !prev.previewColor.trim()
                            ? { previewColor }
                            : {}),
                        }));
                        if (previewColor) setPreview3dOpen(true);
                      } catch {
                        /* shell toasts */
                      }
                    })();
                    e.target.value = '';
                  }}
                />
              ) : (
                <p className="catalog-form__hint">
                  {draft.imageUrl ? 'Foto cargada' : 'Sin foto'}
                </p>
              )}
            </div>
            <p className="catalog-form__hint">
              Opcional. El color y la textura 3D se ajustan en «Vista 3D y
              textura».
            </p>
          </div>
        </fieldset>

        <fieldset className="catalog-form__section">
          <legend className="catalog-form__section-title">
            Tablero y precio
          </legend>
          <div className="catalog-form__field-row">
            <div className="catalog-form__field catalog-form__field--grow">
              <label htmlFor="mat-thickness">Espesor (mm)</label>
              <input
                id="mat-thickness"
                type="number"
                min={0}
                step="any"
                value={draft.thicknessMm}
                onChange={(e) =>
                  setDraft({ ...draft, thicknessMm: Number(e.target.value) })
                }
                required
              />
            </div>
            <div className="catalog-form__field catalog-form__row-check catalog-form__field--grow">
              <input
                id="mat-grain"
                type="checkbox"
                checked={draft.grainDefault}
                onChange={(e) =>
                  setDraft({ ...draft, grainDefault: e.target.checked })
                }
              />
              <label htmlFor="mat-grain">Veta por defecto</label>
            </div>
          </div>
          <div className="catalog-form__field-row">
            <div className="catalog-form__field catalog-form__field--grow">
              <label htmlFor="mat-length">Largo del tablero — Veta (mm)</label>
              <input
                id="mat-length"
                type="number"
                min={1}
                value={draft.lengthMm}
                onChange={(e) =>
                  setDraft({ ...draft, lengthMm: Number(e.target.value) })
                }
                required
              />
            </div>
            <div className="catalog-form__field catalog-form__field--grow">
              <label htmlFor="mat-width">Ancho del tablero (mm)</label>
              <input
                id="mat-width"
                type="number"
                min={1}
                value={draft.widthMm}
                onChange={(e) =>
                  setDraft({ ...draft, widthMm: Number(e.target.value) })
                }
                required
              />
            </div>
          </div>
          <div className="catalog-form__field-row">
            <div className="catalog-form__field catalog-form__field--grow">
              <label htmlFor="mat-price">Precio del tablero ($)</label>
              <input
                id="mat-price"
                type="number"
                min={0}
                step="any"
                value={draft.boardPrice}
                onChange={(e) =>
                  setDraft({ ...draft, boardPrice: Number(e.target.value) })
                }
                required
              />
            </div>
            <div className="catalog-form__field catalog-form__field--grow">
              <label htmlFor="mat-waste">Merma (%)</label>
              <input
                id="mat-waste"
                type="number"
                min={0}
                step="any"
                value={draft.wastePercent}
                onChange={(e) =>
                  setDraft({ ...draft, wastePercent: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="catalog-form__field">
            <label>Costo / m² calculado (con merma)</label>
            <div className="catalog-form__calculated-value">
              {formatMoneyDisplay(
                getCostPerM2({
                  widthMm: draft.widthMm,
                  lengthMm: draft.lengthMm,
                  boardPrice: draft.boardPrice,
                  wastePercent: draft.wastePercent,
                }),
              )}
            </div>
          </div>
          <div className="catalog-form__field">
            <div className="catalog-form__inline-actions">
              <CatalogPicker
                id="mat-default-edge"
                className="catalog-picker--grow"
                label="Cintilla por defecto"
                placeholder="— Sin cintilla —"
                searchPlaceholder="Buscar cintilla…"
                value={draft.defaultEdgeBandId}
                onChange={(defaultEdgeBandId) =>
                  setDraft({ ...draft, defaultEdgeBandId })
                }
                items={edgePickerItems(activeEdges)}
                data-testid="material-edge-picker"
              />
              <button
                type="button"
                className="btn btn--small"
                onClick={onOpenCreateEdge}
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Crear cintilla
              </button>
            </div>
            <p className="catalog-form__hint">
              Link por id. Se usa cuando la pieza tiene cantos y la cotización
              no elige un grupo EDGE.
            </p>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-notes">Notas</label>
            <textarea
              id="mat-notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </fieldset>

        <div className="catalog-form__disclosure" data-testid="material-preview-3d">
          <button
            type="button"
            className="catalog-form__disclosure-header"
            aria-expanded={preview3dOpen}
            onClick={() => setPreview3dOpen((o) => !o)}
            data-testid="material-preview-3d-toggle"
          >
            {preview3dOpen ? (
              <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
            )}
            <span className="catalog-form__disclosure-title">
              Vista 3D y textura
            </span>
            <span className="catalog-form__disclosure-summary">
              {hasPreview3dConfig(draft)
                ? 'Configurado'
                : 'Opcional — color, foto y escala'}
            </span>
          </button>
          {preview3dOpen ? (
            <div
              className="catalog-form__disclosure-body"
              data-testid="material-preview-3d-body"
            >
              <div
                className="catalog-form__field"
                data-testid="material-preview-color-field"
              >
                <label htmlFor="mat-preview-color">Color de vista previa</label>
                <div className="material-preview-color-row">
                  <input
                    id="mat-preview-color-picker"
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
                    data-testid="material-preview-color-picker"
                  />
                  <input
                    id="mat-preview-color"
                    className="material-preview-color-hex"
                    value={draft.previewColor}
                    onChange={(e) =>
                      setDraft({ ...draft, previewColor: e.target.value })
                    }
                    placeholder="#F5F5F0"
                    autoComplete="off"
                    data-testid="material-preview-color-input"
                  />
                </div>
                <p className="catalog-form__hint">
                  Color sólido para el 3D (#RRGGBB). Vacío = color genérico.
                </p>
              </div>
              <div className="catalog-form__field catalog-form__row-check">
                <input
                  id="mat-use-photo-texture"
                  type="checkbox"
                  checked={Boolean(
                    draft.previewTextureUrl &&
                      draft.imageUrl &&
                      draft.previewTextureUrl === draft.imageUrl,
                  )}
                  disabled={!draft.imageUrl}
                  onChange={(e) => {
                    if (e.target.checked && draft.imageUrl) {
                      setDraft({
                        ...draft,
                        previewTextureUrl: draft.imageUrl,
                      });
                    } else {
                      setDraft({ ...draft, previewTextureUrl: '' });
                    }
                  }}
                  data-testid="material-use-photo-texture"
                />
                <label htmlFor="mat-use-photo-texture">
                  Usar foto como textura 3D
                </label>
              </div>
              <p className="catalog-form__hint">
                Con textura se muestra la foto en las caras. Sin textura, si hay
                veta se dibuja veta procedural sobre el color.
              </p>
              <div className="catalog-form__field-row">
                <div className="catalog-form__field catalog-form__field--grow">
                  <label htmlFor="mat-tex-tile-l">
                    Muestra textura — Largo / Veta (mm)
                  </label>
                  <input
                    id="mat-tex-tile-l"
                    type="number"
                    min={0}
                    step="1"
                    value={draft.previewTextureTileLengthMm || ''}
                    placeholder="280"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        previewTextureTileLengthMm:
                          Number(e.target.value) || 0,
                      })
                    }
                    data-testid="material-texture-tile-length"
                  />
                </div>
                <div className="catalog-form__field catalog-form__field--grow">
                  <label htmlFor="mat-tex-tile-w">
                    Muestra textura — Ancho (mm)
                  </label>
                  <input
                    id="mat-tex-tile-w"
                    type="number"
                    min={0}
                    step="1"
                    value={draft.previewTextureTileWidthMm || ''}
                    placeholder="280"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        previewTextureTileWidthMm:
                          Number(e.target.value) || 0,
                      })
                    }
                    data-testid="material-texture-tile-width"
                  />
                </div>
              </div>
              <div className="catalog-form__inline-actions">
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={tileSuggestBusy || !textureImagePath || !canMutate}
                  onClick={onSuggestTiles}
                  data-testid="material-texture-tile-suggest"
                >
                  {tileSuggestBusy
                    ? 'Leyendo imagen…'
                    : 'Sugerir medidas desde la imagen'}
                </button>
              </div>
              {tileSuggestMsg ? (
                <p
                  className="catalog-form__hint"
                  data-testid="material-texture-tile-suggest-msg"
                >
                  {tileSuggestMsg}
                </p>
              ) : null}
              <p className="catalog-form__hint">
                Tamaño real de una imagen completa de textura (mm). Vacío =
                280 mm. Más mm = textura más grande en la pieza.
              </p>
              <div className="catalog-form__field" data-testid="material-pbr-section">
                <label>Acabado y Brillo 3D (PBR)</label>
                <div className="catalog-form__inline-actions catalog-form__inline-actions--wrap">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        previewRoughness: 0.85,
                        previewClearcoat: 0,
                        previewMetalness: 0,
                      }))
                    }
                    data-testid="material-pbr-preset-mate"
                  >
                    Mate
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        previewRoughness: 0.5,
                        previewClearcoat: 0.15,
                        previewMetalness: 0,
                      }))
                    }
                    data-testid="material-pbr-preset-satin"
                  >
                    Satinado
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        previewRoughness: 0.08,
                        previewClearcoat: 0.85,
                        previewMetalness: 0,
                      }))
                    }
                    data-testid="material-pbr-preset-gloss"
                  >
                    Alto Brillo / Laca
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        previewRoughness: 0.3,
                        previewClearcoat: 0,
                        previewMetalness: 0.85,
                      }))
                    }
                    data-testid="material-pbr-preset-metallic"
                  >
                    Metálico
                  </button>
                </div>
                <div className="catalog-form__field-row">
                  <div className="catalog-form__field catalog-form__field--grow">
                    <label htmlFor="mat-pbr-roughness">
                      Rugosidad / Mate (0..1)
                    </label>
                    <input
                      id="mat-pbr-roughness"
                      type="number"
                      min={0}
                      max={1}
                      step="0.05"
                      value={draft.previewRoughness ?? ''}
                      placeholder="Estándar (~0.44-0.68)"
                      onChange={(e) => {
                        const val =
                          e.target.value === '' ? '' : Number(e.target.value);
                        setDraft({ ...draft, previewRoughness: val });
                      }}
                      data-testid="material-pbr-roughness-input"
                    />
                  </div>
                  <div className="catalog-form__field catalog-form__field--grow">
                    <label htmlFor="mat-pbr-clearcoat">
                      Capa Laca / Brillo (0..1)
                    </label>
                    <input
                      id="mat-pbr-clearcoat"
                      type="number"
                      min={0}
                      max={1}
                      step="0.05"
                      value={draft.previewClearcoat ?? ''}
                      placeholder="Estándar (~0.08-0.28)"
                      onChange={(e) => {
                        const val =
                          e.target.value === '' ? '' : Number(e.target.value);
                        setDraft({ ...draft, previewClearcoat: val });
                      }}
                      data-testid="material-pbr-clearcoat-input"
                    />
                  </div>
                  <div className="catalog-form__field catalog-form__field--grow">
                    <label htmlFor="mat-pbr-metalness">Metálico (0..1)</label>
                    <input
                      id="mat-pbr-metalness"
                      type="number"
                      min={0}
                      max={1}
                      step="0.05"
                      value={draft.previewMetalness ?? ''}
                      placeholder="0.00"
                      onChange={(e) => {
                        const val =
                          e.target.value === '' ? '' : Number(e.target.value);
                        setDraft({ ...draft, previewMetalness: val });
                      }}
                      data-testid="material-pbr-metalness-input"
                    />
                  </div>
                </div>
                <p className="catalog-form__hint">
                  Opcional. Permite diferenciar superficies mates de alto
                  brillo/laca o metálicas en el visor 3D.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
