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
import { StructureEditorComponentsPanel } from './StructureEditorComponentsPanel';
import { StructureEditorGeneralPanel } from './StructureEditorGeneralPanel';
import { StructureEditorPresetsPanel } from './StructureEditorPresetsPanel';

export type StructureEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onCancel: () => void;
  readonly editorTab: StructureEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<StructureEditorTab>>;
  readonly draft: StructureDraft;
  readonly setDraft: Dispatch<SetStateAction<StructureDraft>>;
  readonly editingId: string | null;
  readonly catalogComponents: readonly Component[];
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
  onCancel,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  editingId,
  catalogComponents,
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
        <div className="alert alert--danger mb-4" data-testid="form-error">
          {error}
        </div>
      ) : null}

      <div
        className="module-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de estructura"
        data-testid="structure-editor-tabs"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-default)',
          marginBottom: '1.5rem',
        }}
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
              style={{
                background: 'none',
                border: 'none',
                borderBottom: selected
                  ? '2px solid var(--brand-500)'
                  : '2px solid transparent',
                color: selected ? 'var(--brand-500)' : 'var(--text-muted)',
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                fontWeight: selected ? '600' : '400',
                transition: 'all 0.2s',
              }}
              data-testid={`structure-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'presets' && draft.presets.length > 0
                ? ` (${draft.presets.length})`
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
      />

      <div className="modal__footer mt-6">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary" data-testid="save-btn">
          Guardar
        </button>
      </div>
    </form>
  );
}
