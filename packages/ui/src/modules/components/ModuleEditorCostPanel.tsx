/**
 * Module editor — Cost tab (shell-provided preview only).
 */

import type { ReactNode } from 'react';
import type { QuoteBreakdown } from '@muebles/domain';
import { CostPreviewPanel } from './CostPreviewPanel';

export type ModuleEditorCostPanelProps = {
  readonly editingId: string | null;
  readonly costPreview: QuoteBreakdown | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly hidden: boolean;
};

export function ModuleEditorCostPanel({
  editingId,
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  hidden,
}: ModuleEditorCostPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="module-editor-panel-cost"
      aria-labelledby="module-editor-tab-cost"
      hidden={hidden}
      data-testid="module-editor-panel-cost"
    >
      {editingId ? (
        <CostPreviewPanel
          costPreview={costPreview}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
        />
      ) : (
        <CostPreviewPanel
          costPreview={null}
          previewBlocked={false}
          missingGroups={[]}
          allowEmptyHint
        />
      )}
    </div>
  );
}
