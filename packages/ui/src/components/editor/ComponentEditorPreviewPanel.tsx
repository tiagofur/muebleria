/**
 * Component editor — 3D preview tab.
 */

import type { ReactNode } from 'react';
import { Part3DViewer } from '../../common';
import type { ComponentDraft } from '../componentDraft';

export type ComponentEditorPreviewPanelProps = {
  readonly draft: ComponentDraft;
  readonly previewParts: Parameters<typeof Part3DViewer>[0]['parts'];
  readonly hidden: boolean;
};

export function ComponentEditorPreviewPanel({
  draft,
  previewParts,
  hidden,
}: ComponentEditorPreviewPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="component-editor-panel-preview3d"
      aria-labelledby="component-editor-tab-preview3d"
      hidden={hidden}
      data-testid="component-editor-panel-preview3d"
    >
      <p className="text-small text-muted mb-4">
        Vista previa tridimensional del componente según sus dimensiones y rotación.
      </p>
      <div className="component-editor__preview-section mt-4 mb-4">
        <Part3DViewer
          parts={previewParts}
          width={(draft.widthMm || 300) * 1.5}
          height={(draft.thicknessMm || 18) * 1.5}
          depth={(draft.lengthMm || 500) * 1.5}
        />
      </div>
    </div>
  );
}
