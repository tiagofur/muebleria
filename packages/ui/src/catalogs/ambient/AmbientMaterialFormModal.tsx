/**
 * Create/edit ambient material modal (SM) — identity + 3-level category
 * cascade + Vista 3D y textura section. Presentational (F117 split).
 */

import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { AmbientCategory } from '@muebles/domain';
import {
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
} from '@muebles/domain';
import { Modal } from '../../common';
import type { AmbientMaterialDraft } from './ambientMaterialDraft';

export interface AmbientMaterialFormModalProps {
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: AmbientMaterialDraft;
  readonly setDraft: Dispatch<SetStateAction<AmbientMaterialDraft>>;
  readonly categories: readonly AmbientCategory[];
  readonly error: string | null;
  readonly canMutate: boolean;
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onClose: () => void;
}

export function AmbientMaterialFormModal({
  open,
  editingId,
  formId,
  draft,
  setDraft,
  categories,
  error,
  canMutate,
  onUploadImage,
  resolveImageUrl,
  onSubmit,
  onClose,
}: AmbientMaterialFormModalProps): ReactNode {
  // Draft category cascade for 3-level selector
  const draftCascade = cascadeFromCategoryId(
    draft.categoryId || undefined,
    categories,
  );
  const draftCascadeOpts = cascadeOptions(categories, draftCascade);

  const setDraftCascadeLevel = (level: 1 | 2 | 3, value: string) => {
    const next = {
      level1Id:
        level >= 1
          ? level === 1
            ? value || undefined
            : draftCascade.level1Id
          : undefined,
      level2Id:
        level >= 2
          ? level === 2
            ? value || undefined
            : draftCascade.level2Id
          : undefined,
      level3Id:
        level >= 3
          ? level === 3
            ? value || undefined
            : draftCascade.level3Id
          : undefined,
    };
    if (level === 1) {
      next.level2Id = undefined;
      next.level3Id = undefined;
      next.level1Id = value || undefined;
    } else if (level === 2) {
      next.level3Id = undefined;
      next.level2Id = value || undefined;
    } else {
      next.level3Id = value || undefined;
    }
    setDraft((prev) => ({
      ...prev,
      categoryId: cascadeSelectedCategoryId(next) ?? '',
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId ? 'Editar acabado' : 'Nuevo acabado'}
      size="sm"
      dataTestId="ambient-material-form-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
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
      <form id={formId} className="catalog-form" onSubmit={onSubmit}>
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

          {/* 3-Level Category Cascade */}
          <div className="catalog-form__field">
            <label htmlFor="amb-category-l1">Categoría</label>
            <select
              id="amb-category-l1"
              value={draftCascade.level1Id ?? ''}
              onChange={(e) => setDraftCascadeLevel(1, e.target.value)}
              data-testid="ambient-material-category-l1"
            >
              <option value="">Sin categoría</option>
              {draftCascadeOpts.level1.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {draftCascade.level1Id && draftCascadeOpts.level2.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="amb-category-l2">Subcategoría 1 (opcional)</label>
              <select
                id="amb-category-l2"
                value={draftCascade.level2Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(2, e.target.value)}
                data-testid="ambient-material-category-l2"
              >
                <option value="">Ninguna</option>
                {draftCascadeOpts.level2.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {draftCascade.level2Id && draftCascadeOpts.level3.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="amb-category-l3">Subcategoría 2 (opcional)</label>
              <select
                id="amb-category-l3"
                value={draftCascade.level3Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(3, e.target.value)}
                data-testid="ambient-material-category-l3"
              >
                <option value="">Ninguna</option>
                {draftCascadeOpts.level3.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
  );
}
