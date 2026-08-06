/**
 * Component create/edit form shell — tabs + panels.
 */

import type {
  Dispatch,
  FormEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import type { OptionGroup, PlacementDims, ResolvedBoardPart } from '@muebles/domain';
import type {
  MaterialColorLookup,
  MaterialTextureLookup,
} from '../../preview3d';
import {
  COMPONENT_EDITOR_TABS,
  type ComponentDraft,
  type ComponentEditorTab,
} from '../componentDraft';
import { ComponentEditorEdgesPanel } from './ComponentEditorEdgesPanel';
import { ComponentEditorGeneralPanel } from './ComponentEditorGeneralPanel';
import { ComponentEditorGeometryPanel } from './ComponentEditorGeometryPanel';
import { ComponentEditorOptionsPanel } from './ComponentEditorOptionsPanel';

export type ComponentEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  /** @deprecated Footer moved to EntityEditorLayout chrome (Fase 5). */
  readonly onCancel?: () => void;
  readonly editorTab: ComponentEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<ComponentEditorTab>>;
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly editingId: string | null;
  readonly optionGroups: readonly OptionGroup[];
  readonly previewParts: readonly ResolvedBoardPart[];
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly containerDims: PlacementDims;
  readonly onContainerDimsChange: (dims: PlacementDims) => void;
  readonly showInContext: boolean;
  readonly onShowInContextChange: (v: boolean) => void;
};

export function ComponentEditorForm({
  formId,
  error,
  onSubmit,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  editingId,
  optionGroups,
  previewParts,
  materialColors,
  materialTextures,
  containerDims,
  onContainerDimsChange,
  showInContext,
  onShowInContextChange,
}: ComponentEditorFormProps): ReactNode {
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
        aria-label="Secciones del editor de componente"
        data-testid="component-editor-tabs"
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
        previewParts={previewParts}
        materialColors={materialColors}
        materialTextures={materialTextures}
        containerDims={containerDims}
        onContainerDimsChange={onContainerDimsChange}
        showInContext={showInContext}
        onShowInContextChange={onShowInContextChange}
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
    </form>
  );
}
