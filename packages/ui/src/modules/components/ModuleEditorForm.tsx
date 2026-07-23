/**
 * Module create/edit form shell — tablist + editor panels.
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
  MODULE_EDITOR_TABS,
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
   * F072: Board-first editor slot. When provided, replaces the Components tab
   * content with the BoardEditor (canvas + properties panel). The shell
   * (apps/web) constructs this from BoardEditor which has access to editorStore.
   */
  readonly boardEditorSlot?: ReactNode;
};

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
}: ModuleEditorFormProps): ReactNode {
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
        {MODULE_EDITOR_TABS.map((tab) => {
          const selected = editorTab === tab.id;
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
                  ? 'module-editor__tab module-editor__tab--active'
                  : 'module-editor__tab'
              }
              data-testid={`module-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'components' && draft.components.length > 0
                ? ` (${draft.components.length})`
                : ''}
              {tab.id === 'measures' && draft.presets.length > 0
                ? ` (${draft.presets.length})`
                : ''}
              {tab.id === 'hardware' && draft.hardwareLines.length > 0
                ? ` (${draft.hardwareLines.length})`
                : ''}
            </button>
          );
        })}
      </div>

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

      {/* F072: Board-first editor replaces Components tab when slot is provided. */}
      {boardEditorSlot && editorTab === 'components' ? (
        <div className="module-editor__board-slot" data-testid="module-editor-board-slot">
          {boardEditorSlot}
        </div>
      ) : (
        <ModuleEditorComponentsPanel
          draft={draft}
          setDraft={setDraft}
          catalogComponents={catalogComponents}
          composedEnabled={composedEnabled}
          onRequestAdd={onRequestAddComponent}
          hidden={editorTab !== 'components'}
        />
      )}

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

      <ModuleEditorCostPanel
        editingId={editingId}
        costPreview={costPreview}
        previewBlocked={previewBlocked}
        missingGroups={missingGroups}
        groupLabels={groupLabels}
        hidden={editorTab !== 'cost'}
      />
    </form>
  );
}
