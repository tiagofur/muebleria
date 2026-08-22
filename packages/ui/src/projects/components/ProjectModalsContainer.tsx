/**
 * Container for all secondary modals in ProjectsScreen (CRUD, templates, 3D, etc.).
 */

import type { ReactNode } from 'react';
import type {
  Agregado,
  Component,
  Customer,
  EdgeBand,
  FurnitureType,
  Hardware,
  MaterialBoard,
  Module,
  ModuleBaseMode,
  ModuleCategory,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectTemplate,
  QuoteBreakdown,
  Structure,
  WorkshopSettings,
} from '@muebles/domain';
import { Project3DModal } from './Project3DModal';
import { ProjectAddItemModal } from './ProjectAddItemModal';
import { ProjectConfirmDeleteModal } from './ProjectConfirmDeleteModal';
import { ProjectConfirmReopenModal } from './ProjectConfirmReopenModal';
import { ProjectMetaModal } from './ProjectMetaModal';
import { ProjectSaveAsTemplateModal } from './ProjectSaveAsTemplateModal';
import { ProjectTemplatePickerModal } from './ProjectTemplatePickerModal';
import { ProjectTemplatesManagementModal } from './ProjectTemplatesManagementModal';
import { ProjectPresentationMode } from './ProjectPresentationMode';
import { ProjectSpatialStudio } from './ProjectSpatialStudio';
import type { ProjectDraft } from '../projectHelpers';

export interface ProjectModalsContainerProps {
  readonly selectedProject: Project | null;
  readonly modules: readonly Module[];
  readonly categories: readonly ModuleCategory[];
  readonly optionGroups: readonly OptionGroup[];
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  readonly catalogComponents?: readonly Component[];
  readonly catalogStructures?: readonly Structure[];
  readonly catalogAgregados?: readonly Agregado[];
  readonly customers: readonly Customer[];
  readonly workshopSettings?: WorkshopSettings | null;
  readonly canAssignOwner?: boolean;
  readonly assignableOwners?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
  }[];
  readonly showCosts?: boolean;
  readonly canMutate?: boolean;
  readonly canReopen?: boolean;
  readonly canMarkProduced?: boolean;
  readonly metaModalOpen: boolean;
  readonly metaEditingId: string | null;
  readonly metaDraft: ProjectDraft;
  readonly addItemModalOpen: boolean;
  readonly confirmDelete: boolean;
  readonly confirmReopen: boolean;
  readonly showPresentation: boolean;
  readonly showSpatialStudio: boolean;
  readonly show3DModal: boolean;
  readonly viewerItem: { item: ProjectItem; mod: Module } | null;
  readonly viewerQuoteRun: boolean;
  readonly templatePickerOpen: boolean;
  readonly saveAsTemplateOpen: boolean;
  readonly templatesManagementOpen: boolean;
  readonly projectTemplates?: readonly ProjectTemplate[];
  readonly catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  };
  readonly project3dCatalog: {
    readonly modules: readonly Module[];
    readonly structures?: readonly Structure[];
    readonly components?: readonly Component[];
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
    readonly optionGroups: readonly OptionGroup[];
    readonly ambientMaterials?: readonly import('@muebles/domain').AmbientMaterial[];
    readonly ambientCategories?: readonly import('@muebles/domain').AmbientCategory[];
    readonly agregados?: readonly Agregado[];
  };
  readonly breakdown?: QuoteBreakdown | null;
  readonly projectEstimates?: Readonly<Record<string, number | null>>;
  readonly spatialBootstrap: {
    listFilter?: 'all' | 'unplaced' | 'placed';
    selectKey?: string | null;
  } | null;
  readonly planActor?: {
    readonly userId: string;
    readonly userName: string;
  };
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  readonly onCloseMetaModal: () => void;
  readonly onSubmitMeta: (payload: ProjectDraft) => void;
  readonly onCloseAddItemModal: () => void;
  readonly onAddItemSubmit: (payload: {
    moduleId: string;
    quantity: number;
    optionChoices: OptionChoices;
    measurePresetId?: string;
    baseMode?: ModuleBaseMode;
  }) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (projectId: string) => void;
  readonly onCancelReopen: () => void;
  readonly onConfirmReopen: (projectId: string) => void;
  readonly onClosePresentation: () => void;
  readonly onGoToProyectar?: () => void;
  readonly onOpenAddItemModal: () => void;
  /** F141 (#309): insert desde la biblioteca de Proyectar; devuelve el id del ítem creado. */
  readonly onInsertCatalogItem?: (moduleId: string) => string | null;
  readonly onAcquirePlanEdit?: () => boolean;
  readonly onRenewPlanEdit?: () => boolean;
  readonly onReleasePlanEdit?: () => void;
  readonly onCloseSpatialStudio: () => void;
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@muebles/domain').ProjectKitchenLayout,
  ) => void;
  readonly onUpdateItem?: (projectId: string, item: ProjectItem) => void;
  readonly onClose3DModal: () => void;
  readonly onCloseTemplatePicker: () => void;
  readonly onConfirmFromTemplate: (payload: {
    templateId: string;
    draft: ProjectDraft;
  }) => void;
  readonly onCloseSaveAsTemplate: () => void;
  readonly onSaveAsTemplate?: (projectId: string, name: string) => void;
  readonly onCloseTemplatesManagement: () => void;
  readonly onDeleteTemplate: (templateId: string) => void;
}

export function ProjectModalsContainer({
  selectedProject,
  modules,
  categories,
  optionGroups,
  materials,
  edges,
  hardware,
  catalogComponents,
  catalogStructures,
  catalogAgregados,
  customers,
  workshopSettings,
  canAssignOwner,
  assignableOwners,
  showCosts,
  canMutate,
  canReopen,
  canMarkProduced,
  metaModalOpen,
  metaEditingId,
  metaDraft,
  addItemModalOpen,
  confirmDelete,
  confirmReopen,
  showPresentation,
  showSpatialStudio,
  show3DModal,
  viewerItem,
  viewerQuoteRun,
  templatePickerOpen,
  saveAsTemplateOpen,
  templatesManagementOpen,
  projectTemplates,
  catalogs,
  project3dCatalog,
  breakdown,
  projectEstimates = {},
  spatialBootstrap,
  planActor,
  resolveImageUrl,
  onCloseMetaModal,
  onSubmitMeta,
  onCloseAddItemModal,
  onAddItemSubmit,
  onCancelDelete,
  onConfirmDelete,
  onCancelReopen,
  onConfirmReopen,
  onClosePresentation,
  onGoToProyectar,
  onOpenAddItemModal,
  onInsertCatalogItem,
  onAcquirePlanEdit,
  onRenewPlanEdit,
  onReleasePlanEdit,
  onCloseSpatialStudio,
  onUpdateKitchenLayout,
  onUpdateItem,
  onClose3DModal,
  onCloseTemplatePicker,
  onConfirmFromTemplate,
  onCloseSaveAsTemplate,
  onSaveAsTemplate,
  onCloseTemplatesManagement,
  onDeleteTemplate,
}: ProjectModalsContainerProps): ReactNode {
  return (
    <>
      <ProjectMetaModal
        open={metaModalOpen}
        editingId={metaEditingId}
        initialDraft={metaDraft}
        onClose={onCloseMetaModal}
        onSubmit={onSubmitMeta}
        customers={customers}
        canAssignOwner={canAssignOwner ?? false}
        assignableOwners={assignableOwners ?? []}
        showCosts={showCosts ?? false}
        canMutate={canMutate}
        canReopen={canReopen}
        canMarkProduced={canMarkProduced}
      />

      <ProjectAddItemModal
        open={addItemModalOpen}
        onClose={onCloseAddItemModal}
        onSubmit={onAddItemSubmit}
        modules={modules}
        categories={categories}
        optionGroups={optionGroups}
        catalogs={catalogs}
        catalogComponents={catalogComponents ?? []}
        catalogStructures={catalogStructures ?? []}
        catalogAgregados={catalogAgregados}
        projectLevelChoices={selectedProject?.projectLevelChoices ?? {}}
        measureDefaults={selectedProject?.measureDefaults}
      />

      <ProjectConfirmDeleteModal
        open={confirmDelete && selectedProject != null}
        projectName={selectedProject?.name ?? ''}
        onCancel={onCancelDelete}
        onConfirm={() => {
          if (selectedProject) onConfirmDelete(selectedProject.id);
        }}
      />

      <ProjectConfirmReopenModal
        open={confirmReopen && selectedProject != null}
        projectName={selectedProject?.name ?? ''}
        onCancel={onCancelReopen}
        onConfirm={() => {
          if (selectedProject) onConfirmReopen(selectedProject.id);
        }}
      />

      {selectedProject ? (
        <ProjectPresentationMode
          open={showPresentation}
          project={selectedProject}
          modules={modules}
          customers={customers}
          optionGroups={optionGroups}
          catalog={{
            modules,
            structures: catalogStructures ?? [],
            components: catalogComponents ?? [],
            materials,
            edges,
            hardware,
            optionGroups,
          }}
          salePrice={
            breakdown?.salePrice ??
            (typeof projectEstimates[selectedProject.id] === 'number'
              ? (projectEstimates[selectedProject.id] as number)
              : null)
          }
          workshopName={workshopSettings?.workshopName}
          resolveMediaUrl={resolveImageUrl}
          onClose={onClosePresentation}
          onGoToProyectar={onGoToProyectar}
        />
      ) : null}

      {selectedProject && onUpdateKitchenLayout ? (
        <ProjectSpatialStudio
          open={showSpatialStudio}
          project={selectedProject}
          modules={modules}
          categories={categories}
          catalog={{
            ...project3dCatalog,
            structures: catalogStructures ?? [],
            components: catalogComponents ?? [],
          }}
          canEdit={Boolean(canMutate && selectedProject.status === 'draft')}
          resolveMediaUrl={resolveImageUrl}
          quoteSalePrice={
            breakdown?.salePrice ??
            (typeof projectEstimates[selectedProject.id] === 'number'
              ? (projectEstimates[selectedProject.id] as number)
              : null)
          }
          bootstrap={spatialBootstrap}
          onRequestAddItem={
            canMutate && selectedProject.status === 'draft'
              ? onOpenAddItemModal
              : undefined
          }
          onInsertFromCatalog={
            canMutate && selectedProject.status === 'draft'
              ? onInsertCatalogItem
              : undefined
          }
          planActor={planActor}
          onAcquirePlanEdit={onAcquirePlanEdit}
          onRenewPlanEdit={onRenewPlanEdit}
          onReleasePlanEdit={onReleasePlanEdit}
          onClose={onCloseSpatialStudio}
          onChangeLayout={(layout) =>
            onUpdateKitchenLayout(selectedProject.id, layout)
          }
          onUpdateItem={
            canMutate && selectedProject.status === 'draft' && onUpdateItem
              ? (item) => onUpdateItem(selectedProject.id, item)
              : undefined
          }
        />
      ) : null}

      <Project3DModal
        open={show3DModal}
        project={selectedProject}
        catalog={{
          ...project3dCatalog,
          structures: catalogStructures ?? [],
          components: catalogComponents ?? [],
        }}
        resolveMediaUrl={resolveImageUrl}
        focus={
          viewerQuoteRun || !viewerItem
            ? null
            : { item: viewerItem.item, module: viewerItem.mod }
        }
        onClose={onClose3DModal}
      />

      <ProjectTemplatePickerModal
        open={templatePickerOpen}
        templates={projectTemplates ?? []}
        customers={customers}
        workshopSettings={workshopSettings ?? null}
        onClose={onCloseTemplatePicker}
        onConfirm={onConfirmFromTemplate}
      />

      <ProjectSaveAsTemplateModal
        open={saveAsTemplateOpen}
        initialName={selectedProject?.name ?? ''}
        onClose={onCloseSaveAsTemplate}
        onConfirm={(name) => {
          if (selectedProject) {
            onSaveAsTemplate?.(selectedProject.id, name);
          }
        }}
      />

      <ProjectTemplatesManagementModal
        open={templatesManagementOpen}
        templates={projectTemplates ?? []}
        onClose={onCloseTemplatesManagement}
        onDeleteTemplate={onDeleteTemplate}
      />
    </>
  );
}
