/**
 * Module create/edit form shell — primary groups + composition sub-tabs.
 * Critique pack: sticky tabs, keyboard roving, structure empty badge.
 */

import {
  useRef,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  Agregado,
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
import { StructureEditorAgregadosPanel } from '../../structures/components/StructureEditorAgregadosPanel';
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
  readonly catalogAgregados?: readonly Agregado[];
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
  readonly previewError?: string | null;
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
  catalogAgregados = [],
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
  previewError,
  missingGroups,
  groupLabels,
  boardEditorSlot,
  costAsideVisible = false,
}: ModuleEditorFormProps): ReactNode {
  const tabs = costAsideVisible
    ? MODULE_EDITOR_TABS.filter((t) => t.id !== 'cost')
    : MODULE_EDITOR_TABS;
  const structureMissing = !draft.structureId.trim();

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const onTabListKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    const n = tabs.length;
    const current = tabs.findIndex((t) => t.id === editorTab);
    if (current < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = (current + 1) % n;
      setEditorTab(tabs[next]!.id);
      tabRefs.current[next]?.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (current - 1 + n) % n;
      setEditorTab(tabs[next]!.id);
      tabRefs.current[next]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      setEditorTab(tabs[0]!.id);
      tabRefs.current[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      setEditorTab(tabs[n - 1]!.id);
      tabRefs.current[n - 1]?.focus();
    }
  };

  return (
    <form
      id={formId}
      className="catalog-form catalog-form--wide module-editor"
      onSubmit={onSubmit}
      noValidate
    >
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className="module-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de mueble"
        data-testid="module-editor-tabs"
        onKeyDown={onTabListKeyDown}
      >
        {tabs.map((tab, index) => {
          const selected = editorTab === tab.id;
          const requiresStructure =
            tab.id === 'components' ||
            tab.id === 'measures' ||
            tab.id === 'hardware';
          const gated = requiresStructure && structureMissing;
          const compLen = draft.components?.length ?? 0;
          const agrLen = draft.agregados?.length ?? 0;
          const presLen = draft.presets?.length ?? 0;
          const hwLen = draft.hardwareLines?.length ?? 0;
          let badge = '';
          if (tab.id === 'components' && compLen > 0) {
            badge = ` (${compLen})`;
          } else if (tab.id === 'agregados' && agrLen > 0) {
            badge = ` (${agrLen})`;
          } else if (tab.id === 'measures' && presLen > 0) {
            badge = ` (${presLen})`;
          } else if (tab.id === 'hardware' && hwLen > 0) {
            badge = ` (${hwLen})`;
          }
          const showStructureBadge =
            tab.id === 'structure' && structureMissing;
          const tabId = `module-editor-tab-${tab.id}`;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={tabId}
              aria-selected={selected}
              aria-controls={`module-editor-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={[
                selected
                  ? 'module-editor__tab module-editor__tab--active'
                  : 'module-editor__tab',
                gated ? 'module-editor__tab--gated' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid={tabId}
              onClick={() => setEditorTab(tab.id)}
              title={
                gated ? 'Elegí una estructura base primero' : undefined
              }
            >
              {tab.label}
              {badge}
              {showStructureBadge ? (
                <span
                  className="module-editor__tab-badge"
                  data-testid="module-editor-structure-badge"
                  title="Sin estructura base"
                >
                  !
                </span>
              ) : null}
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
        editingId={editingId}
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
        catalogHardware={activeHardware}
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

      <StructureEditorAgregadosPanel
        draft={draft}
        setDraft={setDraft}
        catalogAgregados={catalogAgregados}
        catalogHardware={activeHardware}
        optionGroups={hardwareRoles}
        hidden={editorTab !== 'agregados'}
      />

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
          previewError={previewError}
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
