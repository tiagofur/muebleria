/**
 * Module editor — Structure tab (body picker + base measure).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Structure } from '@muebles/domain';
import { StructureRevisionBadge } from '../../structures';
import type { ModuleDraft } from '../moduleHelpers';

export type ModuleEditorStructurePanelProps = {
  readonly draft: ModuleDraft;
  readonly setDraft: Dispatch<SetStateAction<ModuleDraft>>;
  readonly structures: readonly Structure[];
  readonly selectedStructure: Structure | undefined;
  readonly hidden: boolean;
};

export function ModuleEditorStructurePanel({
  draft,
  setDraft,
  structures,
  selectedStructure,
  hidden,
}: ModuleEditorStructurePanelProps): ReactNode {
  return (
    <div
      className="module-editor__section"
      role="tabpanel"
      id="module-editor-panel-structure"
      aria-labelledby="module-editor-tab-structure"
      hidden={hidden}
      data-testid="module-editor-panel-structure"
    >
      <h4 className="module-editor__section-title">Estructura (cuerpo)</h4>
      <p className="catalog-empty" style={{ marginTop: 0 }}>
        El cuerpo se arma en Ingeniería → Estructuras (solo componentes). Acá
        elegís cuál usa este mueble y la medida base.
      </p>
      <div className="catalog-form__field">
        <label htmlFor="mod-structure">Estructura base</label>
        <select
          id="mod-structure"
          value={draft.structureId}
          onChange={(e) => {
            const sid = e.target.value;
            const struct = structures.find((s) => s.id === sid);
            setDraft((prev) => ({
              ...prev,
              structureId: sid,
              components: sid ? prev.components : [],
              ...(struct?.externalDims
                ? {
                    externalWidth: String(struct.externalDims.width),
                    externalHeight: String(struct.externalDims.height),
                    externalDepth: String(struct.externalDims.depth),
                  }
                : {}),
            }));
          }}
          data-testid="structure-picker"
        >
          <option value="">— Sin estructura —</option>
          {structures
            .filter((s) => s.active !== false)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
        </select>
        {selectedStructure ? (
          <StructureRevisionBadge
            structure={selectedStructure}
            testId="module-editor-selected-structure-revision"
          />
        ) : null}
      </div>
      {selectedStructure?.components &&
      selectedStructure.components.length > 0 ? (
        <p className="catalog-empty" data-testid="structure-body-hint">
          Esta estructura aporta {selectedStructure.components.length}{' '}
          componente
          {selectedStructure.components.length === 1 ? '' : 's'} de cuerpo. Los
          del mueble (puertas, entrepaños…) van en la pestaña Componentes.
        </p>
      ) : null}

      <fieldset className="module-editor__dims-legend">
        <legend className="module-editor__section-title">
          Medida base (mm)
          {draft.structureId.trim() ? ' *' : ' (opcional)'}
        </legend>
        <p className="catalog-empty" style={{ marginTop: 0 }}>
          {draft.structureId.trim()
            ? 'Obligatoria con estructura: tamaño de referencia (preview y cotización cuando no hay más opciones).'
            : 'Opcional sin estructura. Opciones comerciales para el vendedor: pestaña Medidas.'}
        </p>
        <div className="module-editor__grid module-editor__grid--dims">
          <div className="catalog-form__field">
            <label htmlFor="mod-w">Ancho</label>
            <input
              id="mod-w"
              type="number"
              min={0}
              step="any"
              value={draft.externalWidth}
              onChange={(e) =>
                setDraft({ ...draft, externalWidth: e.target.value })
              }
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mod-h">Alto</label>
            <input
              id="mod-h"
              type="number"
              min={0}
              step="any"
              value={draft.externalHeight}
              onChange={(e) =>
                setDraft({ ...draft, externalHeight: e.target.value })
              }
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mod-d">Profundidad</label>
            <input
              id="mod-d"
              type="number"
              min={0}
              step="any"
              value={draft.externalDepth}
              onChange={(e) =>
                setDraft({ ...draft, externalDepth: e.target.value })
              }
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}
