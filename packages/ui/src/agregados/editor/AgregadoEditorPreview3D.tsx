/**
 * Agregado editor — live 3D preview panel (sticky).
 *
 * Mirrors the structure-components-3d block of StructureEditorComponentsPanel:
 * resolves the agregado draft into board parts on every draft change and renders
 * a Furniture3DViewer. Pieces only (V1); hardware 3D meshes and real textures
 * are follow-ups consistent with the structure editor behavior.
 */

import { useMemo, type ReactNode } from 'react';
import { Furniture3DViewer } from '../../common';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveAgregado3DPreview } from '../agregado3dPreview';
import type { AgregadoDraft } from '../agregadoDraft';

export type AgregadoEditorPreview3DProps = {
  readonly draft: AgregadoDraft;
  readonly catalogInput: Module3DCatalogInput;
  // Reserved for the texture follow-up (V1 renders colors/grain only, matching
  // the structure editor embed).
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

export function AgregadoEditorPreview3D({
  draft,
  catalogInput,
}: AgregadoEditorPreview3DProps): ReactNode {
  const preview = useMemo(
    () => resolveAgregado3DPreview(draft, catalogInput),
    [draft, catalogInput],
  );

  return (
    <div
      className="module-part-card agregado-editor-3d"
      data-testid="agregado-editor-3d-preview"
    >
      <div className="agregado-editor__panel-header">
        <h4 className="module-editor__section-title">Vista 3D</h4>
      </div>
      <p className="agregado-editor-3d__hint">
        Preview en vivo al armar el sub-ensamble (única vista 3D del editor).
      </p>

      {preview.error ? (
        <p className="catalog-form__error">{preview.error}</p>
      ) : null}

      {preview.empty && !preview.error ? (
        <p className="catalog-empty">
          Vista previa vacía. Agregá piezas a la izquierda.
        </p>
      ) : null}

      {!preview.empty ? (
        <div className="agregado-editor-3d__viewport">
          <Furniture3DViewer
            parts={preview.parts}
            width={preview.width}
            height={preview.height}
            depth={preview.depth}
            testId="agregado-editor-3d-viewer"
          />
        </div>
      ) : null}
    </div>
  );
}
