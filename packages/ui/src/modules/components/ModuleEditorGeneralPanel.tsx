/**
 * Module editor — General tab (identity, category, notes, photo).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { ModuleCategory } from '@muebles/domain';
import { CatalogImage } from '../../common';
import type { ModuleDraft } from '../moduleHelpers';

export type CategoryCascadeState = {
  readonly level1Id?: string;
  readonly level2Id?: string;
  readonly level3Id?: string;
};

export type CategoryCascadeOpts = {
  readonly level1: readonly ModuleCategory[];
  readonly level2: readonly ModuleCategory[];
  readonly level3: readonly ModuleCategory[];
};

export type ModuleEditorGeneralPanelProps = {
  readonly draft: ModuleDraft;
  readonly setDraft: Dispatch<SetStateAction<ModuleDraft>>;
  readonly draftCascade: CategoryCascadeState;
  readonly draftCascadeOpts: CategoryCascadeOpts;
  readonly setDraftCascadeLevel: (level: 1 | 2 | 3, value: string) => void;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly hidden: boolean;
};

export function ModuleEditorGeneralPanel({
  draft,
  setDraft,
  draftCascade,
  draftCascadeOpts,
  setDraftCascadeLevel,
  resolveImageUrl,
  onUploadImage,
  hidden,
}: ModuleEditorGeneralPanelProps): ReactNode {
  return (
    <div
      className="module-editor__section"
      role="tabpanel"
      id="module-editor-panel-general"
      aria-labelledby="module-editor-tab-general"
      hidden={hidden}
      data-testid="module-editor-panel-general"
    >
      <h4 className="module-editor__section-title">Datos generales</h4>
      <div className="module-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor="mod-code">Código</label>
          <input
            id="mod-code"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            autoComplete="off"
            required
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor="mod-name">Nombre</label>
          <input
            id="mod-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor="mod-labor">Mano de obra base</label>
          <input
            id="mod-labor"
            type="number"
            min={0}
            step="any"
            value={draft.baseLaborCost}
            onChange={(e) =>
              setDraft({ ...draft, baseLaborCost: e.target.value })
            }
            placeholder="Opcional"
          />
        </div>
        <div className="catalog-form__field" data-testid="module-image-field">
          <label htmlFor="mod-image">Foto (vitrina)</label>
          <div className="module-editor__image-row">
            <CatalogImage
              src={resolveImageUrl(draft.imageUrl || undefined)}
              alt={draft.name || 'Mueble'}
              size="md"
            />
            {onUploadImage ? (
              <input
                id="mod-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void onUploadImage(file)
                    .then((url) => setDraft({ ...draft, imageUrl: url }))
                    .catch(() => {
                      /* shell toasts */
                    });
                  e.target.value = '';
                }}
              />
            ) : (
              <p className="module-editor__hint">
                {draft.imageUrl ? draft.imageUrl : 'Sin imagen'}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="catalog-form__field" data-testid="module-furniture-type-field">
        <label htmlFor="mod-furniture-type">Tipo de mueble</label>
        <select
          id="mod-furniture-type"
          value={draft.furnitureType}
          onChange={(e) =>
            setDraft({
              ...draft,
              furnitureType: e.target.value as ModuleDraft['furnitureType'],
            })
          }
          data-testid="module-furniture-type"
        >
          <option value="inferior">Inferior (gabinete)</option>
          <option value="superior">Superior (alacena)</option>
          <option value="alto">Alto (despensa)</option>
        </select>
        <p className="module-editor__hint">
          Define el tipo fundamental. Los defaults de medida del proyecto se
          aplican por tipo al agregar el mueble a una cotización.
        </p>
      </div>
      <div
        className="module-editor__grid module-editor__grid--spaced"
        data-testid="module-category-cascade"
      >
        <div className="catalog-form__field">
          <label htmlFor="mod-cat-l1">Categoría (nivel 1)</label>
          <select
            id="mod-cat-l1"
            value={draftCascade.level1Id ?? ''}
            onChange={(e) => setDraftCascadeLevel(1, e.target.value)}
          >
            <option value="">Sin categoría</option>
            {draftCascadeOpts.level1.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {draftCascadeOpts.level2.length > 0 ? (
          <div className="catalog-form__field">
            <label htmlFor="mod-cat-l2">Subcategoría (nivel 2)</label>
            <select
              id="mod-cat-l2"
              value={draftCascade.level2Id ?? ''}
              onChange={(e) => setDraftCascadeLevel(2, e.target.value)}
            >
              <option value="">— (usar nivel 1)</option>
              {draftCascadeOpts.level2.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {draftCascadeOpts.level3.length > 0 ? (
          <div className="catalog-form__field">
            <label htmlFor="mod-cat-l3">Subcategoría (nivel 3)</label>
            <select
              id="mod-cat-l3"
              value={draftCascade.level3Id ?? ''}
              onChange={(e) => setDraftCascadeLevel(3, e.target.value)}
            >
              <option value="">— (usar nivel 2)</option>
              {draftCascadeOpts.level3.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="catalog-form__field catalog-form__field--spaced">
        <label htmlFor="mod-notes">Notas</label>
        <input
          id="mod-notes"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>
    </div>
  );
}
