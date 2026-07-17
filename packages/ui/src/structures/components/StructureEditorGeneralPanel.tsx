/**
 * Structure editor — General tab.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { StructureDraft } from '../structureDraft';

export type StructureEditorGeneralPanelProps = {
  readonly formId: string;
  readonly draft: StructureDraft;
  readonly setDraft: Dispatch<SetStateAction<StructureDraft>>;
  readonly editingId: string | null;
  readonly hidden: boolean;
};

export function StructureEditorGeneralPanel({
  formId,
  draft,
  setDraft,
  editingId,
  hidden,
}: StructureEditorGeneralPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="structure-editor-panel-general"
      aria-labelledby="structure-editor-tab-general"
      hidden={hidden}
    >
      <div className="module-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-code`}>Código de Estructura</label>
          <input
            id={`${formId}-code`}
            value={draft.code}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, code: e.target.value }))
            }
            placeholder="Ej: EST-GAB-720"
            required
            disabled={!!editingId}
            data-testid="input-code"
          />
        </div>

        <div className="catalog-form__field">
          <label htmlFor={`${formId}-name`}>Nombre</label>
          <input
            id={`${formId}-name`}
            value={draft.name}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="Ej: Cuerpo Gabinete Bajo"
            required
            data-testid="input-name"
          />
        </div>
      </div>

      <div className="module-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-width`}>Ancho Externo (mm)</label>
          <input
            id={`${formId}-width`}
            type="number"
            min={0}
            value={draft.widthMm || ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                widthMm: Math.max(0, Number(e.target.value)),
              }))
            }
            placeholder="Opcional"
            data-testid="input-width"
          />
        </div>

        <div className="catalog-form__field">
          <label htmlFor={`${formId}-height`}>Alto Externo (mm)</label>
          <input
            id={`${formId}-height`}
            type="number"
            min={0}
            value={draft.heightMm || ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                heightMm: Math.max(0, Number(e.target.value)),
              }))
            }
            placeholder="Opcional"
            data-testid="input-height"
          />
        </div>

        <div className="catalog-form__field">
          <label htmlFor={`${formId}-depth`}>Profundidad (mm)</label>
          <input
            id={`${formId}-depth`}
            type="number"
            min={0}
            value={draft.depthMm || ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                depthMm: Math.max(0, Number(e.target.value)),
              }))
            }
            placeholder="Opcional"
            data-testid="input-depth"
          />
        </div>
      </div>

      <div className="catalog-form__field">
        <label htmlFor={`${formId}-notes`}>Notas / Descripción técnica</label>
        <textarea
          id={`${formId}-notes`}
          rows={4}
          value={draft.notes}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, notes: e.target.value }))
          }
          placeholder="Detalles sobre el armado, cantos especiales..."
          data-testid="input-notes"
        />
      </div>
    </div>
  );
}
