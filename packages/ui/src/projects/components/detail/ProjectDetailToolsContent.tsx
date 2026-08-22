/**
 * Renders the active secondary tool panel in ProjectDetailView.
 */

import type { ReactNode } from 'react';
import type { QuoteToolsPanel } from './ProjectDetailToolsNav';
import { LifecyclePanel } from '../LifecyclePanel';
import { ProjectOverviewPanel } from '../ProjectOverviewPanel';
import { SiteSurveyPanel } from '../SiteSurveyPanel';
import { KitchenPlanPanel } from '../KitchenPlanPanel';
import { QuoteScenarioCompare } from '../QuoteScenarioCompare';
import { InstallationChecklistPanel } from '../InstallationChecklistPanel';
import { ProjectPhotosGallery } from '../ProjectPhotosGallery';
import { InternalCommsPanel } from '../InternalCommsPanel';
import { WarrantyTicketsPanel } from '../WarrantyTicketsPanel';
import { useProjectDetail } from '../projectDetailContext';

export interface ProjectDetailToolsContentProps {
  readonly toolsPanel: QuoteToolsPanel;
  readonly canEditContent: boolean;
}

export function ProjectDetailToolsContent({
  toolsPanel,
  canEditContent,
}: ProjectDetailToolsContentProps): ReactNode {
  const ctx = useProjectDetail();
  const {
    project,
    modules,
    catalogs,
    optionGroups,
    onUpdateKitchenLayout,
    onApplyScenarioB,
    onDuplicateWithScenarioB,
    onExportScenarioPdf,
    onUpdateInstallationChecklist,
    onUploadPhotos,
    onUpdatePhoto,
    onDeletePhoto,
    onSendInternalMessage,
    onUpdateTechnicalWorkflow,
    assignableOwners,
    currentUserId,
    warranties,
    availableCutRows,
    onCreateWarrantyTicket,
    onUpdateWarrantyTicket,
    onDeleteWarrantyTicket,
    onUploadWarrantyPhoto,
    onExportWarrantyRefabricationOptimizer,
  } = ctx;

  if (!toolsPanel) return null;

  return (
    <div
      className="project-detail__tools-body"
      data-testid={`project-tools-panel-${toolsPanel}`}
    >
      {toolsPanel === 'overview' ? (
        <ProjectOverviewPanel project={project} nav={ctx.overviewNav ?? {}} />
      ) : null}

      {toolsPanel === 'survey' ? (
        <SiteSurveyPanel
          projectId={project.id}
          survey={project.siteSurvey}
          handlers={ctx.surveyHandlers ?? {}}
          canCapture={ctx.canCaptureSurvey ?? false}
          canVerify={ctx.canVerifySurvey ?? false}
          canApprove={ctx.canApproveSurvey ?? false}
        />
      ) : null}

      {toolsPanel === 'lifecycle' ? (
        <LifecyclePanel
          project={project}
          onOpenReleaseModal={ctx.onOpenReleaseModal ?? (() => {})}
          onOpenChangeOrderModal={ctx.onOpenChangeOrderModal ?? (() => {})}
          onCreateRevision={ctx.onCreateRevision}
          onDecideApproval={ctx.onDecideApproval}
          onRequestApproval={ctx.onRequestApproval}
          onChangeCommercialStatus={
            ctx.onChangeCommercialStatus
              ? (status) => ctx.onChangeCommercialStatus?.(status)
              : undefined
          }
          onRecordDeposit={
            ctx.onRecordDeposit
              ? (params) => ctx.onRecordDeposit?.(params)
              : undefined
          }
        />
      ) : null}

      {toolsPanel === 'kitchen' ? (
        <KitchenPlanPanel
          project={project}
          modules={modules}
          canEdit={canEditContent}
          onChange={
            canEditContent && onUpdateKitchenLayout
              ? (layout) => onUpdateKitchenLayout(project.id, layout)
              : () => {}
          }
        />
      ) : null}

      {toolsPanel === 'scenarios' ? (
        <QuoteScenarioCompare
          project={project}
          catalog={{
            materials: catalogs.materials,
            edges: catalogs.edges,
            hardware: catalogs.hardware,
            optionGroups,
            modules,
          }}
          optionGroups={optionGroups}
          canApply={canEditContent && Boolean(onApplyScenarioB)}
          currency={project.currency}
          onApplyB={
            canEditContent && onApplyScenarioB
              ? (role, choiceId) => onApplyScenarioB(project.id, role, choiceId)
              : () => {}
          }
          onDuplicateWithB={
            onDuplicateWithScenarioB
              ? (role, choiceId) =>
                  onDuplicateWithScenarioB(project.id, role, choiceId)
              : undefined
          }
          onExportScenarioPdf={
            onExportScenarioPdf
              ? (role, choiceId) =>
                  onExportScenarioPdf(project.id, role, choiceId)
              : undefined
          }
        />
      ) : null}

      {toolsPanel === 'checklist' ? (
        <InstallationChecklistPanel
          project={project}
          canEdit={canEditContent}
          onChange={
            canEditContent && onUpdateInstallationChecklist
              ? (items) => onUpdateInstallationChecklist(project.id, items)
              : () => {}
          }
        />
      ) : null}

      {toolsPanel === 'photos' ? (
        <ProjectPhotosGallery
          projectId={project.id}
          photos={ctx.photos ?? []}
          readOnly={!ctx.canMutate}
          onUploadPhotos={onUploadPhotos ?? (async () => {})}
          onUpdatePhoto={onUpdatePhoto ?? (async () => {})}
          onDeletePhoto={onDeletePhoto ?? (async () => {})}
        />
      ) : null}

      {toolsPanel === 'internal_comms' ? (
        <InternalCommsPanel
          project={project}
          messages={ctx.internalMessages ?? []}
          assignableOwners={
            assignableOwners?.map((o) => ({ id: o.id, label: o.name })) ?? []
          }
          currentUserId={currentUserId}
          onSendMessage={onSendInternalMessage ?? (() => {})}
          onUpdateTechnicalWorkflow={onUpdateTechnicalWorkflow ?? (() => {})}
        />
      ) : null}

      {toolsPanel === 'warranties' ? (
        <WarrantyTicketsPanel
          projectId={project.id}
          projectName={project.name}
          tickets={warranties ?? []}
          availableCutRows={availableCutRows ?? []}
          onCreateTicket={onCreateWarrantyTicket ?? (async () => {})}
          onUpdateTicket={onUpdateWarrantyTicket ?? (async () => {})}
          onDeleteTicket={onDeleteWarrantyTicket}
          onUploadPhoto={onUploadWarrantyPhoto}
          onExportRefabricationOptimizer={onExportWarrantyRefabricationOptimizer}
        />
      ) : null}
    </div>
  );
}
