/**
 * Structure create/edit form shell — tabs + panels.
 * Critique: General → Componentes → Presets; sticky tabs; badges; no dual 3D tab.
 */

import {
  useCallback,
  useRef,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Component, DimensionPreset } from '@muebles/domain';
import {
  STRUCTURE_EDITOR_TABS,
  type StructureDraft,
  type StructureEditorTab,
} from '../structureDraft';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const componentsEmpty = draft.components.length === 0;

  const focusTab = useCallback(
    (index: number) => {
      const tab = STRUCTURE_EDITOR_TABS[index];
      if (!tab) return;
      setEditorTab(tab.id);
      tabRefs.current[index]?.focus();
    },
    [setEditorTab],
  );

  const onTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const n = STRUCTURE_EDITOR_TABS.length;
    const current = STRUCTURE_EDITOR_TABS.findIndex((t) => t.id === editorTab);
    if (current < 0) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusTab((current + 1) % n);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusTab((current - 1 + n) % n);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(n - 1);
    }
  };

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className="catalog-form structure-editor"
    >
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className="structure-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de estructura"
        data-testid="structure-editor-tabs"
        onKeyDown={onTabListKeyDown}
      >
        {STRUCTURE_EDITOR_TABS.map((tab, index) => {
          const selected = editorTab === tab.id;
          const showEmptyBadge = tab.id === 'components' && componentsEmpty;
          const countLabel =
            tab.id === 'presets' && draft.presets.length > 0
              ? ` (${draft.presets.length})`
              : tab.id === 'components' && draft.components.length > 0
                ? ` (${draft.components.length})`
                : '';
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`structure-editor-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`structure-editor-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={
                selected
                  ? 'structure-editor__tab structure-editor__tab--active'
                  : 'structure-editor__tab'
              }
              data-testid={`structure-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
              {countLabel}
              {showEmptyBadge ? (
                <span
                  className="structure-editor__tab-badge"
                  data-testid="structure-editor-components-badge"
                  title="Agregá al menos un componente"
                >
                  !
                </span>
              ) : null}
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

      <StructureEditorPresetsPanel
        presets={draft.presets}
        exteriorDims={{
          width: draft.widthMm,
          height: draft.heightMm,
          depth: draft.depthMm,
        }}
        onAdd={onAddPreset}
        onRemove={onRemovePreset}
        onUpdate={onUpdatePreset}
        hidden={editorTab !== 'presets'}
      />
    </form>
  );
}
