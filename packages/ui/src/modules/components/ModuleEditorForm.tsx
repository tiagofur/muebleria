/**
 * Module create/edit form shell — primary groups + composition sub-tabs.
 * Fase 4 UI: General / Composición / Costo (reduces 6 equal tabs).
 */

import type {
  Dispatch,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import type {
  Component,
  Hardware,
  OptionGroup,
  QuoteBreakdown,
  Structure,
} from '@muebles/domain';
import type { HardwareLineDraft, ModuleDraft } from '../moduleHelpers';
import {
  ModuleEditorComponentsPanel,
} from './ModuleEditorComponentsPanel';
import { ModuleEditorCostPanel } from './ModuleEditorCostPanel';
import {
  ModuleEditorGeneralPanel,
  type CategoryCascadeOpts,
  type CategoryCascadeState,
} from './ModuleEditorGeneralPanel';
import { ModuleEditorHardwarePanel } from './ModuleEditorHardwarePanel';
import { ModuleEditorMeasuresPanel } from './ModuleEditorMeasuresPanel';
import { ModuleEditorStructurePanel } from './ModuleEditorStructurePanel';
import {
  DEFAULT_COMPOSITION_TAB,
  isCompositionTab,
  MODULE_EDITOR_COMPOSITION_TABS,
  MODULE_EDITOR_PRIMARY_TABS,
  primaryTabFor,
  type ModuleEditorPrimaryTab,
  type ModuleEditorTab,
} from './moduleEditorTabs';

export type ModuleEditorFormProps = {
  readonly formId: string;
  readonly error: string | null;
  readonly onSubmit: (e: FormEvent) => void;
  readonly editorTab: ModuleEditorTab;
  readonly setEditorTab: Dispatch<SetStateAction<ModuleEditorTab>>;
  readonly draft: ModuleDraft;
  readonly setDraft: Dispatch<SetStateAction<ModuleDraft>>;
  readonly draftCascade: CategoryCascadeState;
  readonly draftCascadeOpts: CategoryCascadeOpts;
  readonly setDraftCascadeLevel: (level: 1 | 2 | 3, value: string) => void;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly structures: readonly Structure[];
  readonly selectedStructure: Structure | undefined;
  readonly catalogComponents: readonly Component[];
  readonly composedEnabled: boolean;
  readonly onRequestAddComponent: () => void;
  readonly canMutate: boolean;
  readonly hardwareRoles: readonly OptionGroup[];
  readonly activeHardware: readonly Hardware[];
  readonly onAddHardware: () => void;
  readonly onRemoveHardware: (id: string) => void;
  readonly onUpdateHardware: (
    id: string,
    patch: Partial<HardwareLineDraft>,
  ) => void;
  readonly onHardwareGridKeyDown: (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => void;
  readonly editingId: string | null;
  readonly costPreview: QuoteBreakdown | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  /**
   * Board-first editor slot (canvas + properties). When provided, it is shown
   * **below** the Components instance list — never replaces “Agregar componente”.
   */
  readonly boardEditorSlot?: ReactNode;
  /**
   * When true (full-page editor with sticky cost aside), hide the Costo primary
   * tab and the duplicate CostPreviewPanel — cost lives in the aside only.
   */
  readonly costAsideVisible?: boolean;
};

function compositionBadge(draft: ModuleDraft): string {
  const parts: string[] = [];
  if (draft.components.length > 0) parts.push(`${draft.components.length} comp.`);
  if (draft.presets.length > 0) parts.push(`${draft.presets.length} med.`);
  if (draft.hardwareLines.length > 0) {
    parts.push(`${draft.hardwareLines.length} herr.`);
  }
  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}

export function ModuleEditorForm({
  formId,
  error,
  onSubmit,
  editorTab,
  setEditorTab,
  draft,
  setDraft,
  draftCascade,
  draftCascadeOpts,
  setDraftCascadeLevel,
  resolveImageUrl,
  onUploadImage,
  structures,
  selectedStructure,
  catalogComponents,
  composedEnabled,
  onRequestAddComponent,
  canMutate,
  hardwareRoles,
  activeHardware,
  onAddHardware,
  onRemoveHardware,
  onUpdateHardware,
  onHardwareGridKeyDown,
  editingId,
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  boardEditorSlot,
  costAsideVisible = false,
}: ModuleEditorFormProps): ReactNode {
  const primary = primaryTabFor(editorTab);
  const compositionActive = isCompositionTab(editorTab);
  const primaryTabs = costAsideVisible
    ? MODULE_EDITOR_PRIMARY_TABS.filter((t) => t.id !== 'cost')
    : MODULE_EDITOR_PRIMARY_TABS;

  const selectPrimary = (id: ModuleEditorPrimaryTab): void => {
    if (id === 'general') setEditorTab('general');
    else if (id === 'cost' && !costAsideVisible) setEditorTab('cost');
    else if (id === 'composition' && !compositionActive) {
      setEditorTab(DEFAULT_COMPOSITION_TAB);
    }
  };

  return (
    <form
      id={formId}
      className="catalog-form catalog-form--wide module-editor"
      onSubmit={onSubmit}
      noValidate
    >
      {error ? <p className="catalog-form__error">{error}</p> : null}

      <div
        className="module-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de mueble"
        data-testid="module-editor-tabs"
      >
        {primaryTabs.map((tab) => {
          const selected =
            tab.id === 'composition' ? compositionActive : primary === tab.id;
          const tabId =
            tab.id === 'general'
              ? 'module-editor-tab-general'
              : tab.id === 'cost'
                ? 'module-editor-tab-cost'
                : 'module-editor-tab-composition';
          const controls =
            tab.id === 'general'
              ? 'module-editor-panel-general'
              : tab.id === 'cost'
                ? 'module-editor-panel-cost'
                : 'module-editor-panel-structure';
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={selected}
              aria-controls={controls}
              tabIndex={selected ? 0 : -1}
              className={
                selected
                  ? 'module-editor__tab module-editor__tab--active'
                  : 'module-editor__tab'
              }
              data-testid={tabId}
              onClick={() => selectPrimary(tab.id)}
            >
              {tab.label}
              {tab.id === 'composition' ? compositionBadge(draft) : ''}
            </button>
          );
        })}
      </div>

      {compositionActive ? (
        <div
          className="module-editor__subtabs"
          role="tablist"
          aria-label="Composición del mueble"
          data-testid="module-editor-composition-tabs"
        >
          {MODULE_EDITOR_COMPOSITION_TABS.map((tab) => {
            const selected = editorTab === tab.id;
            let badge = '';
            if (tab.id === 'components' && draft.components.length > 0) {
              badge = ` (${draft.components.length})`;
            } else if (tab.id === 'measures' && draft.presets.length > 0) {
              badge = ` (${draft.presets.length})`;
            } else if (tab.id === 'hardware' && draft.hardwareLines.length > 0) {
              badge = ` (${draft.hardwareLines.length})`;
            }
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`module-editor-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`module-editor-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                className={
                  selected
                    ? 'module-editor__subtab module-editor__subtab--active'
                    : 'module-editor__subtab'
                }
                data-testid={`module-editor-tab-${tab.id}`}
                onClick={() => setEditorTab(tab.id)}
              >
                {tab.label}
                {badge}
              </button>
            );
          })}
        </div>
      ) : null}

      <ModuleEditorGeneralPanel
        draft={draft}
        setDraft={setDraft}
        draftCascade={draftCascade}
        draftCascadeOpts={draftCascadeOpts}
        setDraftCascadeLevel={setDraftCascadeLevel}
        resolveImageUrl={resolveImageUrl}
        onUploadImage={onUploadImage}
        hidden={editorTab !== 'general'}
      />

      <ModuleEditorStructurePanel
        draft={draft}
        setDraft={setDraft}
        structures={structures}
        selectedStructure={selectedStructure}
        hidden={editorTab !== 'structure'}
      />

      <ModuleEditorComponentsPanel
        draft={draft}
        setDraft={setDraft}
        catalogComponents={catalogComponents}
        composedEnabled={composedEnabled}
        onRequestAdd={onRequestAddComponent}
        hidden={editorTab !== 'components'}
      />
      {boardEditorSlot && editorTab === 'components' ? (
        <div
          className="module-editor__board-slot"
          data-testid="module-editor-board-slot"
          data-hybrid="true"
        >
          {boardEditorSlot}
        </div>
      ) : null}

      <ModuleEditorMeasuresPanel
        draft={draft}
        setDraft={setDraft}
        selectedStructure={selectedStructure}
        canMutate={canMutate}
        hidden={editorTab !== 'measures'}
      />

      <ModuleEditorHardwarePanel
        hardwareLines={draft.hardwareLines}
        hardwareRoles={hardwareRoles}
        activeHardware={activeHardware}
        onAdd={onAddHardware}
        onRemove={onRemoveHardware}
        onUpdate={onUpdateHardware}
        onGridKeyDown={onHardwareGridKeyDown}
        hidden={editorTab !== 'hardware'}
      />

      {!costAsideVisible ? (
        <ModuleEditorCostPanel
          editingId={editingId}
          costPreview={costPreview}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
          hidden={editorTab !== 'cost'}
        />
      ) : editorTab === 'cost' ? (
        <p
          className="catalog-form__hint"
          id="module-editor-panel-cost"
          role="tabpanel"
          aria-labelledby="module-editor-tab-cost"
          data-testid="module-editor-panel-cost"
        >
          El costo y el desglose están en el panel lateral.
        </p>
      ) : null}
    </form>
  );
}
