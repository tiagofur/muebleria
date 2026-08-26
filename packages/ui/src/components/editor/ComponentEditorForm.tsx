/**
 * Component create/edit form shell — tabs + panels.
 * Critique fix: sticky tabs, keyboard roving, options badge when empty.
 */

import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { OptionGroup, PlacementDims, ResolvedBoardPart } from '@granete/domain';
import { WorkspaceTabs, type TabDefinition } from '../../common/Tabs';
import type {
  MaterialColorLookup,
  MaterialTextureLookup,
} from '../../preview3d';
import {
  COMPONENT_EDITOR_TABS,
  countOptionRoles,
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
  const roleCount = countOptionRoles(draft.optionRoles);
  const optionsMissing = roleCount === 0;

  const tabDefs: readonly TabDefinition<ComponentEditorTab>[] =
    COMPONENT_EDITOR_TABS.map((tab) => ({
      id: tab.id,
      label: tab.label,
      alert: tab.id === 'options' && optionsMissing ? true : undefined,
      title:
        tab.id === 'options' && optionsMissing
          ? 'Falta al menos un rol de opción'
          : undefined,
    }));

  return (
    <form id={formId} onSubmit={onSubmit} className="catalog-form component-editor" noValidate>
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <WorkspaceTabs
        tabs={tabDefs}
        activeTab={editorTab}
        onTabChange={setEditorTab}
        ariaLabel="Secciones del editor de componente"
        idPrefix="component-editor"
        testIdPrefix="component-editor"
      />

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
        previewLengthMm={previewParts[0]?.lengthMm}
        previewWidthMm={previewParts[0]?.widthMm}
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
