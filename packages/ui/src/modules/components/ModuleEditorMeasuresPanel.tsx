/**
 * Module editor — Medidas tab (commercial presets for sales).
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Structure } from '@muebles/domain';
import type { ModuleDraft } from '../moduleHelpers';
import { ModuleMeasureSection } from './ModuleMeasureSection';

export type ModuleEditorMeasuresPanelProps = {
  readonly draft: ModuleDraft;
  readonly setDraft: Dispatch<SetStateAction<ModuleDraft>>;
  readonly selectedStructure: Structure | undefined;
  readonly canMutate: boolean;
  readonly hidden: boolean;
};

function nextPresetId(): string {
  return typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ModuleEditorMeasuresPanel({
  draft,
  setDraft,
  selectedStructure,
  canMutate,
  hidden,
}: ModuleEditorMeasuresPanelProps): ReactNode {
  return (
    <div
      className="module-editor__section"
      role="tabpanel"
      id="module-editor-panel-measures"
      aria-labelledby="module-editor-tab-measures"
      hidden={hidden}
      data-testid="module-editor-panel-measures"
    >
      <ModuleMeasureSection
        presets={draft.presets}
        disabled={!canMutate}
        onPresetsChange={(presets) =>
          setDraft((prev) => ({ ...prev, presets }))
        }
        nextId={nextPresetId}
        canImportFromStructure={(selectedStructure?.presets?.length ?? 0) > 0}
        onImportFromStructure={() => {
          const fromStructure = (selectedStructure?.presets ?? []).map(
            (pr) => ({
              id: nextPresetId(),
              name: pr.name ?? '',
              width: pr.width,
              height: pr.height,
              depth: pr.depth,
            }),
          );
          setDraft((prev) => ({
            ...prev,
            presets: [...prev.presets, ...fromStructure],
          }));
        }}
        canSeedFromBase={
          Number(draft.externalWidth) > 0 &&
          Number(draft.externalHeight) > 0 &&
          Number(draft.externalDepth) > 0
        }
        onSeedFromBase={() => {
          const w = Number(draft.externalWidth);
          const h = Number(draft.externalHeight);
          const d = Number(draft.externalDepth);
          if (!(w > 0 && h > 0 && d > 0)) return;
          setDraft((prev) => ({
            ...prev,
            presets: [
              ...prev.presets,
              {
                id: nextPresetId(),
                name: 'Medida base',
                width: w,
                height: h,
                depth: d,
              },
            ],
          }));
        }}
      />
    </div>
  );
}
