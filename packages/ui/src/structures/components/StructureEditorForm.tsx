/**
 * Structure create/edit form shell — tabs + panels.
 * Critique: General → Componentes → Presets; sticky tabs; badges; no dual 3D tab.
 */

import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { Agregado, Component, DimensionPreset } from '@muebles/domain';
import { WorkspaceTabs, type TabDefinition } from '../../common/Tabs';
import {
  STRUCTURE_EDITOR_TABS,
  type StructureDraft,
  type StructureEditorTab,
} from '../structureDraft';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { StructureEditorAgregadosPanel } from './StructureEditorAgregadosPanel';
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
  readonly catalogAgregados?: readonly Agregado[];
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
  catalogAgregados = [],
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
  const componentsEmpty = draft.components.length === 0;

  const counts: Partial<Record<StructureEditorTab, number>> = {
    components: draft.components?.length ?? 0,
    agregados: draft.agregados?.length ?? 0,
    presets: draft.presets?.length ?? 0,
  };

  const tabDefs: readonly TabDefinition<StructureEditorTab>[] =
    STRUCTURE_EDITOR_TABS.map((tab) => ({
      id: tab.id,
      label: tab.label,
      count: counts[tab.id] || undefined,
      alert:
        tab.id === 'components' && componentsEmpty ? true : undefined,
      title:
        tab.id === 'components' && componentsEmpty
          ? 'Agregá al menos un componente'
          : undefined,
    }));

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className="catalog-form structure-editor"
      noValidate
    >
      {error ? (
        <p className="catalog-form__error" data-testid="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <WorkspaceTabs
        tabs={tabDefs}
        activeTab={editorTab}
        onTabChange={setEditorTab}
        ariaLabel="Secciones del editor de estructura"
        idPrefix="structure-editor"
        testIdPrefix="structure-editor"
      />

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

      <StructureEditorAgregadosPanel
        draft={draft}
        setDraft={setDraft}
        catalogAgregados={catalogAgregados}
        catalogHardware={catalogInput?.hardware}
        optionGroups={catalogInput?.optionGroups}
        hidden={editorTab !== 'agregados'}
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
