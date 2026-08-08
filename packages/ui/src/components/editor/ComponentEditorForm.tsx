/**
 * Component create/edit form shell — tabs + panels.
 * Critique fix: sticky tabs, keyboard roving, options badge when empty.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { OptionGroup, PlacementDims, ResolvedBoardPart } from '@muebles/domain';
import type {
  MaterialColorLookup,
  MaterialPhysicalLookup,
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
  readonly materialPhysical?: MaterialPhysicalLookup;
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
  materialPhysical,
  containerDims,
  onContainerDimsChange,
  showInContext,
  onShowInContextChange,
}: ComponentEditorFormProps): ReactNode {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const roleCount = countOptionRoles(draft.optionRoles);
  const optionsMissing = roleCount === 0;

  useEffect(() => {
    const tabsEl = tabRefs.current[0]?.parentElement;
    if (tabsEl && typeof tabsEl.scrollIntoView === 'function') {
      tabsEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [editorTab]);

  const focusTab = useCallback((index: number) => {
    const tab = COMPONENT_EDITOR_TABS[index];
    if (!tab) return;
    setEditorTab(tab.id);
    tabRefs.current[index]?.focus();
  }, [setEditorTab]);

  const onTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const n = COMPONENT_EDITOR_TABS.length;
    const current = COMPONENT_EDITOR_TABS.findIndex((t) => t.id === editorTab);
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
    <form id={formId} onSubmit={onSubmit} className="catalog-form component-editor" noValidate>
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className="component-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de componente"
        data-testid="component-editor-tabs"
        onKeyDown={onTabListKeyDown}
      >
        {COMPONENT_EDITOR_TABS.map((tab, index) => {
          const selected = editorTab === tab.id;
          const showBadge = tab.id === 'options' && optionsMissing;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`component-editor-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`component-editor-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={
                selected
                  ? 'component-editor__tab component-editor__tab--active'
                  : 'component-editor__tab'
              }
              data-testid={`component-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
              {showBadge ? (
                <span
                  className="component-editor__tab-badge"
                  data-testid="component-editor-options-badge"
                  title="Falta al menos un rol de opción"
                >
                  !
                </span>
              ) : null}
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
        materialPhysical={materialPhysical}
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
