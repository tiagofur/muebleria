/**
 * Structure editor — 3D Preview tab.
 */

import { useMemo, type ReactNode } from 'react';
import { Furniture3DViewer } from '../../common';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveStructure3DPreview } from '../structure3dPreview';
import type { StructureDraft } from '../structureDraft';

export type StructureEditor3DPanelProps = {
  readonly draft: StructureDraft;
  readonly catalogInput: Module3DCatalogInput;
  readonly previewPresetId: string;
  readonly onPreviewPresetChange: (id: string) => void;
  readonly hidden: boolean;
};

export function StructureEditor3DPanel({
  draft,
  catalogInput,
  previewPresetId,
  onPreviewPresetChange,
  hidden,
}: StructureEditor3DPanelProps): ReactNode {
  const preview = useMemo(() => {
    return resolveStructure3DPreview(
      draft,
      catalogInput,
      previewPresetId || undefined,
    );
  }, [draft, catalogInput, previewPresetId]);

  return (
    <div
      role="tabpanel"
      id="structure-editor-panel-preview3d"
      aria-labelledby="structure-editor-tab-preview3d"
      hidden={hidden}
      data-testid="structure-editor-panel-preview3d"
      className="structure-editor-3d-tab"
    >
      {preview.presets.length > 0 ? (
        <div className="catalog-form__field">
          <label htmlFor="structure-3d-preset">Medida de prueba (preset)</label>
          <select
            id="structure-3d-preset"
            value={previewPresetId || preview.presetId || ''}
            onChange={(e) => onPreviewPresetChange(e.target.value)}
            data-testid="structure-3d-preset-select"
          >
            {preview.presets.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name?.trim()
                  ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth})`
                  : `${pr.width}×${pr.height}×${pr.depth} mm`}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="catalog-empty">
          Mostrando dimensiones de la estructura: {preview.width}×
          {preview.height}×{preview.depth} mm. (Podés definir presets en la
          pestaña &quot;Presets&quot;).
        </p>
      )}

      {preview.error ? (
        <p className="catalog-form__error" data-testid="structure-3d-error">
          {preview.error}
        </p>
      ) : null}

      {preview.empty && !preview.error ? (
        <p className="catalog-empty" data-testid="structure-3d-empty">
          Sin componentes para mostrar en el cuerpo. Agregá componentes en la
          pestaña &quot;Componentes&quot;.
        </p>
      ) : null}

      {!preview.empty ? (
        <Furniture3DViewer
          parts={preview.parts}
          width={preview.width}
          height={preview.height}
          depth={preview.depth}
          testId="structure-3d-viewer"
        />
      ) : null}
    </div>
  );
}
