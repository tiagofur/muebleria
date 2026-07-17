/**
 * Component editor — default edge flags tab.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { ComponentDraft } from '../componentDraft';

export type ComponentEditorEdgesPanelProps = {
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly hidden: boolean;
};

export function ComponentEditorEdgesPanel({
  draft,
  setDraft,
  hidden,
}: ComponentEditorEdgesPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="component-editor-panel-edges"
      aria-labelledby="component-editor-tab-edges"
      hidden={hidden}
      data-testid="component-editor-panel-edges"
    >
      <p className="text-small text-muted mb-4">
        Seleccioná los cantos que llevan cintilla por defecto.
      </p>
      <div
        className="module-edge-flags"
        role="group"
        aria-label="Cantos por defecto"
        data-testid="component-edges-group"
      >
        {(
          [
            ['edgeL1', 'L1'],
            ['edgeL2', 'L2'],
            ['edgeW1', 'W1'],
            ['edgeW2', 'W2'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="component-edge-check">
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, [key]: e.target.checked }))
              }
              data-testid={`edge-${label}`}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
