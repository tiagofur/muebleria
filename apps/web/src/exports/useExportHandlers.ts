/**
 * useExportHandlers — the 14 export/workflow handlers of the shell (F120
 * extract from App.tsx). Thin configuration over runExport: project
 * resolution, RBAC gate, builder args and stamps stay per-handler; the
 * shared flow (busy + issues + deliver + toaths + guard) lives in runExport.
 */

import { useCallback } from 'react';

import type {
  Catalog,
  Customer,
  Project,
  ProjectTechnicalStatus,
  WorkshopSettings,
} from '@muebles/domain';
import { canExportProductionForProject } from '@muebles/domain';
import { resolveCustomerName } from '@muebles/ui';

import type { SessionMode } from '../session';
import type { ToastFn } from '../stores/catalogStore';
import { useUiStore } from '../stores/uiStore';

import { buildCommercialQuoteExport } from '../exportCommercialQuote';
import { buildCommercialQuotePdfExport } from '../exportCommercialQuotePdf';
import { buildHardwareListExport } from '../exportHardwareList';
import {
  buildPieceLabelsExport,
  type PieceLabelsExportOptions,
} from '../exportPieceLabels';
import {
  buildModuleLabelsExport,
  type ModuleLabelsExportOptions,
} from '../exportModuleLabels';
import {
  buildOptimizerExport,
} from '../exportOptimizer';
import { buildProductionPackExport } from '../exportProductionPack';
import { buildWallElevationsExport } from '../exportWallElevations';
import { buildCutListCsvExport } from '../exportCutListCsv';
import { buildCncPilotExport } from '../exportCncPilot';
import { buildAssemblySheetsExport } from '../exportAssemblySheets';
import { downloadDespiecePdf } from '../exportDespiecePdf';
import { downloadCutPlanPdf } from '../exportCutPlanPdf';
import { runExport, type ExportDelivery } from './runExport';

export interface ExportHandlersDeps {
  readonly projects: readonly Project[];
  readonly selectedProject: Project | null | undefined;
  readonly catalog: Catalog | null;
  readonly customers: readonly Customer[];
  readonly session: SessionMode | null;
  readonly actorRole: Parameters<typeof canExportProductionForProject>[0];
  readonly workspaceSettings: WorkshopSettings | undefined;
  readonly toast: ToastFn;
  /** Stamps generatedBy/At on the project's engineering log. */
  readonly stampEngineeringGeneration: (projectId?: string) => void;
  /** PROD-3.2 OP export revision stamp. */
  readonly recordProductionExport: (projectId: string) => void;
  readonly updateProjectTechnicalWorkflow: (
    projectId: string,
    updates: {
      technicalStatus?: ProjectTechnicalStatus;
      comment?: string;
    },
  ) => Promise<unknown>;
}

export function useExportHandlers(deps: ExportHandlersDeps) {
  const {
    projects,
    selectedProject,
    catalog,
    customers,
    session,
    actorRole,
    workspaceSettings,
    toast,
    stampEngineeringGeneration,
    recordProductionExport,
    updateProjectTechnicalWorkflow,
  } = deps;
  const setExportBusy = useUiStore((s) => s.setExportBusy);

  const handleExportOptimizer = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () => buildOptimizerExport(project, catalog),
        onIssues:
          projectId != null
            ? () =>
                toast({
                  type: 'error',
                  message:
                    'No se pudo exportar el corte: revisá las opciones del pedido',
                })
            : undefined,
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportHardwareList = useCallback(
    async (projectId?: string) => {
      const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
      if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () => buildHardwareListExport(project, catalog),
        onIssues:
          projectId != null
            ? () =>
                toast({
                  type: 'error',
                  message: 'No se pudo exportar herrajes: revisá el pedido',
                })
            : undefined,
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportPieceLabels = useCallback(
    async (
      projectId?: string,
      labelOptions?: PieceLabelsExportOptions,
    ) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () =>
          buildPieceLabelsExport(project, catalog, customers, labelOptions ?? {}),
        onIssues:
          projectId != null
            ? () =>
                toast({
                  type: 'error',
                  message: 'No se pudo exportar etiquetas: revisá el pedido',
                })
            : undefined,
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportModuleLabels = useCallback(
    async (
      projectId?: string,
      labelOptions?: ModuleLabelsExportOptions,
    ) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () =>
          buildModuleLabelsExport(project, catalog, customers, labelOptions ?? {}),
        onIssues:
          projectId != null
            ? () =>
                toast({
                  type: 'error',
                  message: 'No se pudo exportar etiquetas de módulo: revisá el pedido',
                })
            : undefined,
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportElevations = useCallback(
    async (projectId?: string) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      await runExport({
        build: () =>
          buildWallElevationsExport(
            project,
            catalog,
            resolveCustomerName(project.customerId, customers),
          ),
        onIssues: (issues) =>
          toast({
            type: 'error',
            message:
              issues[0]?.message ??
              'No se pudo exportar elevaciones (¿hay muros en el layout?)',
          }),
        stamp: () => recordProductionExport(project.id),
      });
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole, recordProductionExport],
  );

  const handleExportCncPilot = useCallback(
    async (projectId?: string) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () => buildCncPilotExport(project, catalog),
        onIssues: () =>
          toast({ type: 'error', message: 'No se pudo generar CNC pilot JSON' }),
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportAssemblySheets = useCallback(
    async (projectId?: string) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () =>
          buildAssemblySheetsExport(
            project,
            catalog,
            resolveCustomerName(project.customerId, customers),
          ),
        onIssues: () =>
          toast({ type: 'error', message: 'No se pudo generar hojas de armado' }),
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportCutListCsv = useCallback(
    async (projectId?: string) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      await runExport({
        build: () => buildCutListCsvExport(project, catalog),
        onIssues: () =>
          toast({ type: 'error', message: 'No se pudo exportar cut-list CSV' }),
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, toast, session, actorRole],
  );

  const handleExportDespiecePdf = useCallback(
    async (projectId?: string) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      const stampId = projectId ?? project.id;
      // downloadDespiecePdf performs its own delivery and reports the mode.
      let performed: ExportDelivery = 'cancelled';
      await runExport({
        build: async () => {
          const result = await downloadDespiecePdf(
            project,
            catalog,
            resolveCustomerName(project.customerId, customers),
          );
          if (!result.ok) return result;
          performed = result.delivery === 'saved' ? 'saved' : 'downloaded';
          return { ok: true, bytes: result.fileName, fileName: result.fileName };
        },
        deliver: async () => performed,
        onIssues: () =>
          toast({ type: 'error', message: 'No se pudo exportar despiece PDF' }),
        stamp: () => stampEngineeringGeneration(stampId),
      });
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole],
  );

  const handleExportCutPlanPdf = useCallback(
    async (cutPlan: import('@muebles/domain').CutPlan) => {
      setExportBusy(true);
      try {
        const fileName = `${cutPlan.projectName || 'proyecto'}-plan-de-corte.pdf`;
        await downloadCutPlanPdf(cutPlan, fileName);
        toast({
          type: 'success',
          message: `✓ ${fileName} descargado`,
        });
      } catch (err) {
        toast({
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Error al exportar plan de corte PDF',
        });
      } finally {
        setExportBusy(false);
      }
    },
    [toast],
  );

  const handleReleaseToDelivery = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      try {
        await updateProjectTechnicalWorkflow(projectId, {
          technicalStatus: 'ready_to_install',
          comment:
            '✓ 100% de los bultos cargados en el transporte. Orden liberada para entrega.',
        });
        toast({
          type: 'success',
          message: '✓ Orden liberada exitosamente a entrega / transporte',
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Error al liberar orden a entrega';
        toast({
          type: 'error',
          message: msg,
        });
      }
    },
    [projects, updateProjectTechnicalWorkflow, toast],
  );

  const handleExportProductionPack = useCallback(
    async (projectId?: string) => {
            const project =
        projectId != null
          ? projects.find((p) => p.id === projectId)
          : selectedProject;
      if (!project || !catalog) return;
            if (
        session === 'auth' &&
        !canExportProductionForProject(actorRole, project.status)
      ) {
        toast({
          type: 'error',
          message:
            'Export de producción solo para Aceptado/En producción y roles de planta/ingeniería',
        });
        return;
      }
      // Optional annexes that failed are listed — never silently missing.
      let omissionNote = '';
      await runExport({
        build: async () => {
          const result = await buildProductionPackExport(
            project,
            catalog,
            resolveCustomerName(project.customerId, customers),
          );
          if (result.ok && result.omissions.length > 0) {
            omissionNote = ` (sin: ${result.omissions.join(', ')})`;
          }
          return result;
        },
        onIssues: () =>
          toast({
            type: 'error',
            message:
              'No se pudo armar el pack: revisá el pedido (falta el corte Optimizer)',
          }),
        // PROD-3.2 — stamp OP export revision so stale detection works.
        stamp: () => {
          recordProductionExport(project.id);
          stampEngineeringGeneration(project.id);
        },
        successMessage: (fileName, delivery) =>
          delivery === 'saved'
            ? `✓ ${fileName} guardado${omissionNote}`
            : `✓ ${fileName} descargado${omissionNote}`,
      });
    },
    [selectedProject, projects, catalog, customers, toast, session, actorRole, recordProductionExport],
  );

  const handleExportCommercialQuote = useCallback(async () => {
    if (!selectedProject || !catalog) return;
    await runExport({
      build: () => buildCommercialQuoteExport(selectedProject, catalog, customers),
    });
  }, [selectedProject, catalog, customers]);

  const handleExportCommercialQuotePdf = useCallback(
    async (variant: 'detailed' | 'summary') => {
      if (!selectedProject || !catalog) return;
      await runExport({
        build: () =>
          buildCommercialQuotePdfExport(
            selectedProject,
            catalog,
            customers,
            variant,
            workspaceSettings,
          ),
      });
    },
    [selectedProject, catalog, customers, workspaceSettings],
  );

  return {
    handleExportOptimizer,
    handleExportHardwareList,
    handleExportPieceLabels,
    handleExportModuleLabels,
    handleExportElevations,
    handleExportCncPilot,
    handleExportAssemblySheets,
    handleExportCutListCsv,
    handleExportDespiecePdf,
    handleExportCutPlanPdf,
    handleReleaseToDelivery,
    handleExportProductionPack,
    handleExportCommercialQuote,
    handleExportCommercialQuotePdf,
  };
}
