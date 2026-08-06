/**
 * Structure create/edit form shell — tabs + panels.
 */

import type {
  Dispatch,
  FormEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import type { Component, DimensionPreset } from '@muebles/domain';
import {
  STRUCTURE_EDITOR_TABS,
  type StructureDraft,
  type StructureEditorTab,
} from '../structureDraft';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { StructureEditor3DPanel } from './StructureEditor3DPanel';
import { StructureEditorComponentsPanel } from './StructureEditorComponentsPanel';
import { StructureEditorGeneralPanel } from './StructureEditorGeneralPanel';
import { StructureEditorPresetsPanel } from './StructureEditorPresetsPanel';

export type StructureEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  /** @deprecated Footer moved to EntityEditorLayout chrome (Fase 5). */
  readonly onCancel?: () => void;
  readonly editorTab: StructureEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<StructureEditorTab>>;
  readonly draft: StructureDraft;
  readonly setDraft: Dispatch<SetStateAction<StructureDraft>>;
  readonly editingId: string | null;
  readonly catalogComponents: readonly Component[];
  readonly catalogInput?: Module3DCatalogInput;
  readonly onRequestAddComponent: () => void;
  readonly previewPresetId: string;
  readonly onPreviewPresetChange: (id: string) => void;
  readonly onAddPreset: () => void;
  readonly onRemovePreset: (id: string) => void;
  readonly onUpdatePreset: (id: string, patch: Partial<DimensionPreset>) => void;
};

export function StructureEditorForm({
  formId,
  error,
  onSubmit,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  editingId,
  catalogComponents,
  catalogInput = {
    modules: [],
    structures: [],
    components: catalogComponents,
    materials: [],
    edges: [],
    hardware: [],
    optionGroups: [],
  },
  onRequestAddComponent,
  previewPresetId,
  onPreviewPresetChange,
  onAddPreset,
  onRemovePreset,
  onUpdatePreset,
}: StructureEditorFormProps): ReactNode {
  return (
    <form id={formId} onSubmit={onSubmit} className="catalog-form">
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className="module-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de estructura"
        data-testid="structure-editor-tabs"
      >
        {STRUCTURE_EDITOR_TABS.map((tab) => {
          const selected = editorTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`structure-editor-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`structure-editor-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={
                selected
                  ? 'module-editor__tab module-editor__tab--active'
                  : 'module-editor__tab'
              }
              data-testid={`structure-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'presets' && draft.presets.length > 0
                ? ` (${draft.presets.length})`
                : ''}
              {tab.id === 'components' && draft.components.length > 0
                ? ` (${draft.components.length})`
                : ''}
            </button>
          );
        })}
      </div>

      <StructureEditorGeneralPanel
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        editingId={editingId}
        hidden={editorTab !== 'general'}
      />

      <StructureEditorPresetsPanel
        presets={draft.presets}
        previewPresetId={previewPresetId}
        onPreviewPresetChange={onPreviewPresetChange}
        onAdd={onAddPreset}
        onRemove={onRemovePreset}
        onUpdate={onUpdatePreset}
        hidden={editorTab !== 'presets'}
      />

      <StructureEditorComponentsPanel
        draft={draft}
        setDraft={setDraft}
        catalogComponents={catalogComponents}
        onRequestAdd={onRequestAddComponent}
        hidden={editorTab !== 'components'}
        catalogInput={catalogInput}
        previewPresetId={previewPresetId}
        onPreviewPresetChange={onPreviewPresetChange}
      />

      <StructureEditor3DPanel
        draft={draft}
        catalogInput={catalogInput}
        previewPresetId={previewPresetId}
        onPreviewPresetChange={onPreviewPresetChange}
        hidden={editorTab !== 'preview3d'}
      />
    </form>
  );
}
