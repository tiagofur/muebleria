/**
 * Component editor — default edge flags tab.
 *
 * The four board edges are edited via PlankEdgeDiagram (a clickable front view of
 * the plank) so a carpenter maps L1/L2/W1/W2 to the physical edge instead of
 * guessing codes. A compact checkbox list stays as an accessible fallback.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { EdgeSide } from '@granete/domain';
import type { ComponentDraft } from '../componentDraft';
import { PlankEdgeDiagram, type EdgeStates } from './PlankEdgeDiagram';

export type ComponentEditorEdgesPanelProps = {
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly hidden: boolean;
  /**
   * Resolved/preview board dims (formulas evaluated). When formulas drive size,
   * base mm may be 0 — prefer these so the diagram is never 0×0 (JD R3-S2).
   */
  readonly previewLengthMm?: number;
  readonly previewWidthMm?: number;
};

const EDGE_KEYS = ['edgeL1', 'edgeL2', 'edgeW1', 'edgeW2'] as const;

export function ComponentEditorEdgesPanel({
  draft,
  setDraft,
  hidden,
  previewLengthMm,
  previewWidthMm,
}: ComponentEditorEdgesPanelProps): ReactNode {
  const edgeStates: EdgeStates = {
    L1: draft.edgeL1,
    L2: draft.edgeL2,
    W1: draft.edgeW1,
    W2: draft.edgeW2,
  };

  const toggle = (side: EdgeSide) => {
    const key = `edge${side}` as (typeof EDGE_KEYS)[number];
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Prefer resolved preview dims when base is 0 / formulas present (R3-S2).
  const lengthMm =
    previewLengthMm != null && previewLengthMm > 0
      ? previewLengthMm
      : draft.lengthMm;
  const widthMm =
    previewWidthMm != null && previewWidthMm > 0
      ? previewWidthMm
      : draft.widthMm;

  return (
    <div
      role="tabpanel"
      id="component-editor-panel-edges"
      aria-labelledby="component-editor-tab-edges"
      hidden={hidden}
      data-testid="component-editor-panel-edges"
    >
      <p className="component-edges__intro">
        Tocá un borde de la placa para marcarlo como <strong>encintado</strong> por
        defecto. Los bordes encintados llevan cintilla en todas las piezas de este
        componente.
      </p>

      <PlankEdgeDiagram
        edges={edgeStates}
        onToggle={toggle}
        lengthMm={lengthMm}
        widthMm={widthMm}
      />

      <details className="component-edges__fallback">
        <summary>Lista de cantos</summary>
        <div
          className="module-edge-flags"
          role="group"
          aria-label="Cantos por defecto"
          data-testid="component-edges-group"
        >
          {(
            [
              ['edgeL1', 'L1', 'Largo arriba'],
              ['edgeL2', 'L2', 'Largo abajo'],
              ['edgeW1', 'W1', 'Ancho izquierda'],
              ['edgeW2', 'W2', 'Ancho derecha'],
            ] as const
          ).map(([key, label, sub]) => (
            <label key={key} className="component-edge-check">
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, [key]: e.target.checked }))
                }
              />
              <span>{label}</span>
              <span className="component-edge-check__sub">{sub}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
