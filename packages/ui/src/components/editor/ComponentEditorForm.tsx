/**
 * Component create/edit form shell — tabs + panels.
 */

import type {
  Dispatch,
  FormEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import type { OptionGroup } from '@muebles/domain';
import { Part3DViewer } from '../../common';
import {
  COMPONENT_EDITOR_TABS,
  type ComponentDraft,
  type ComponentEditorTab,
} from '../componentDraft';
import { ComponentEditorEdgesPanel } from './ComponentEditorEdgesPanel';
import { ComponentEditorGeneralPanel } from './ComponentEditorGeneralPanel';
import { ComponentEditorGeometryPanel } from './ComponentEditorGeometryPanel';
import { ComponentEditorOptionsPanel } from './ComponentEditorOptionsPanel';
import { ComponentEditorPreviewPanel } from './ComponentEditorPreviewPanel';

export type ComponentEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onCancel: () => void;
  readonly editorTab: ComponentEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<ComponentEditorTab>>;
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly editingId: string | null;
  readonly optionGroups: readonly OptionGroup[];
  readonly previewParts: Parameters<typeof Part3DViewer>[0]['parts'];
};

export function ComponentEditorForm({
  formId,
  error,
  onSubmit,
  onCancel,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  editingId,
  optionGroups,
  previewParts,
}: ComponentEditorFormProps): ReactNode {
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
        aria-label="Secciones del editor de componente"
        data-testid="component-editor-tabs"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1.5rem',
        }}
      >
        {COMPONENT_EDITOR_TABS.map((tab) => {
          const selected = editorTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`component-editor-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`component-editor-panel-${tab.id}`}
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
                  ? '2px solid var(--primary)'
                  : '2px solid transparent',
                color: selected ? 'var(--primary)' : 'var(--text-muted)',
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                fontWeight: selected ? '600' : '400',
                transition: 'all 0.2s',
              }}
              data-testid={`component-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <ComponentEditorGeneralPanel
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        editingId={editingId}
        hidden={editorTab !== 'general'}
      />

      <ComponentEditorGeometryPanel
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        hidden={editorTab !== 'geometry'}
      />

      <ComponentEditorEdgesPanel
        draft={draft}
        setDraft={setDraft}
        hidden={editorTab !== 'edges'}
      />

      <ComponentEditorOptionsPanel
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        optionGroups={optionGroups}
        hidden={editorTab !== 'options'}
      />

      <ComponentEditorPreviewPanel
        draft={draft}
        previewParts={previewParts}
        hidden={editorTab !== 'preview3d'}
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
