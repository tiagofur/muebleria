/**
 * Component editor — 3D preview tab.
 * Uses the unified Furniture3DViewer from common.
 */

import type { ReactNode } from 'react';
import { Furniture3DViewer, type Furniture3DViewerProps } from '../../common';
import type { ComponentDraft } from '../componentDraft';
import type { ResolvedBoardPart } from '@muebles/domain';

export type ComponentEditorPreviewPanelProps = {
  readonly draft: ComponentDraft;
  readonly previewParts: readonly ResolvedBoardPart[];
  readonly hidden: boolean;
  readonly materialColors?: Furniture3DViewerProps['materialColors'];
};

export function ComponentEditorPreviewPanel({
  draft,
  previewParts,
  hidden,
  materialColors,
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

      <Furniture3DViewer
        parts={previewParts}
        width={draft.widthMm || 300}
        height={draft.thicknessMm || 18}
        depth={draft.lengthMm || 500}
        materialColors={materialColors}
        initialColorMode="material"
        initialProjection="perspective"
        initialWireframe={false}
        hideControls={false}
        testId="component-editor-3d-viewer"
      />
    </div>
  );
}