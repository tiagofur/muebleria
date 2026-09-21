/**
 * EngineeringWorkspace — Tabbed workspace for a single project's engineering.
 *
 * Tabs: Resumen, Módulos, Despiece, Etiquetas, Herrajes, Vistas, Optimización, Documentos.
 * Documentos has all download buttons (Pack ZIP, Optimizer, CSV, etc.).
 *
 * Reuses existing production panels where possible; the Resumen tab
 * is extracted to EngineeringResumenTab.
 *
 * #738 — a canonical obra pins its EXACT ProductionRelease context; tabs
 * that still read the live editable project/catalog are labeled as a
 * working view. #739 — when the frozen cutting demand of the pinned release
 * is available, Despiece and Optimización consume THAT exact content (never
 * the mutable project), engineering preparation becomes explicit and the
 * plan exports (PDF/PTX/ZIP) connect to the same generated plan.
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Factory, FileCheck, Printer, Send } from 'lucide-react';

import './engineering.css';
import '../production/production.css';

import {
  canSendToProduction,
  engineeringEntryStatus,
  engineeringStatus,
  ENGINEERING_ENTRY_STATUS_LABELS_ES,
  fabricationFlowOf,
  releaseAuthorityLabel,
  releaseAuthorityOf,
  type FabricationEngineeringEvidence,
  type CutPlan,
  type Project,
  type Module,
  type Catalog,
  type ProductionCutRow,
  type PieceLabel,
  type ModuleLabel,
  type HardwarePurchaseRow,
  type NestingImportResult,
  type ReleaseCuttingDemandBase,
} from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { ProcessStrip } from '../common/ProcessStrip';
import { WorkspaceTabs } from '../common/Tabs';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';
import { ProductionOrderModulesPanel } from '../production/ProductionOrderModulesPanel';
import { ProductionOrderDespiecePanel } from '../production/ProductionOrderDespiecePanel';
import { ProductionOrderViewsPanel } from '../production/ProductionOrderViewsPanel';
import { ProductionOrderOptimizationPanel } from '../production/ProductionOrderOptimizationPanel';
import type {
  CuttingOutputTargetView,
  OptimizationDemandGate,
} from '../production/ProductionOrderOptimizationPanel';
import type { ReleaseCutPlanSaveResult } from '@granete/storage';
import { ProductionOrderDocumentsPanel } from '../production/ProductionOrderDocumentsPanel';
import { ProductionOrderLabelsPanel } from '../production/ProductionOrderLabelsPanel';
import { ProductionOrderHardwarePanel } from '../production/ProductionOrderHardwarePanel';
import { EngineeringResumenTab } from './components/EngineeringResumenTab';
import { useEngineeringDocuments } from './components/useEngineeringDocuments';

/* ── Tab model ──────────────────────────────────────────────────────────── */

const ENGINEERING_TABS = [
  'resumen',
  'modulos',
  'despiece',
  'etiquetas',
  'herrajes',
  'vistas',
  'optimizacion',
  'documentos',
] as const;

type EngineeringTab = (typeof ENGINEERING_TABS)[number];

const TAB_LABELS: Readonly<Record<EngineeringTab, string>> = {
  resumen: 'Resumen',
  modulos: 'Módulos',
  despiece: 'Despiece',
  etiquetas: 'Etiquetas',
  herrajes: 'Herrajes',
  vistas: 'Vistas',
  optimizacion: 'Optimización',
  documentos: 'Documentos',
};

/**
 * #738 — the EXACT ProductionRelease this workspace was opened with (pinned
 * in the URL). Presentation view resolved from authoritative read models by
 * the shell; the workspace never derives it from "latest".
 */
export interface EngineeringReleasePinView {
  readonly releaseNumber: number;
  readonly designRevisionNumber: number;
  readonly quoteLabel: string | null;
  readonly releasedAt: string;
}

export type EngineeringReleaseContextProp =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly view: EngineeringReleasePinView };

/**
 * #739 — frozen cutting demand of the pinned release, resolved by the shell
 * from the generated projection (never the mutable project/catalog).
 */
export type EngineeringReleaseCuttingDemandProp =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string; readonly retry: () => void }
  | {
      readonly status: 'ready';
      readonly rows: readonly ProductionCutRow[];
      readonly base: ReleaseCuttingDemandBase;
    };

/**
 * #740 — durable per-release Engineering state of the PINNED release,
 * resolved by the shell from the exact-release endpoint. `pending` is the
 * honest absence of evidence; `completed` is final and server-authored.
 * Completion never implies material authorization or physical work.
 */
export type EngineeringReleaseStateProp =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string; readonly retry?: () => void }
  | {
      readonly status: 'ready';
      readonly phase: 'pending' | 'in_progress' | 'completed';
      readonly version: number;
      /** Human label of the completion actor when the shell can resolve it. */
      readonly completedByLabel: string | null;
      readonly completedAtLabel: string | null;
    };

/** Tabs whose panels read the live editable project/catalog state. */
const LIVE_DATA_TABS: ReadonlySet<EngineeringTab> = new Set([
  'resumen',
  'modulos',
  'despiece',
  'etiquetas',
  'herrajes',
  'vistas',
  'optimizacion',
]);

/** Tabs that consume the FROZEN release content when it is available (#739). */
const FROZEN_CONTENT_TABS: ReadonlySet<EngineeringTab> = new Set([
  'despiece',
  'optimizacion',
]);

/** What the live data tab names for the working-view notice. */
const LIVE_TAB_NOUN_ES: Readonly<Partial<Record<EngineeringTab, string>>> = {
  resumen: 'el resumen',
  modulos: 'los módulos',
  despiece: 'el despiece',
  etiquetas: 'las etiquetas',
  herrajes: 'los herrajes',
  vistas: 'las vistas',
  optimizacion: 'la optimización',
};

/* ── Main workspace ─────────────────────────────────────────────────────── */

export function EngineeringWorkspace({
  project,
  modules,
  catalog,
  catalog3d,
  cutRows,
  cutError,
  readiness,
  labels,
  labelsError,
  moduleLabels,
  moduleLabelsError,
  hardwareRows,
  hardwareError,
  customerLabel,
  defaultCutStrategy,
  onBack,
  resolveMediaUrl,
  // Export callbacks
  onExportCsv,
  onExportPdf,
  onExportModulePdf,
  onExportHardware,
  onExportElevations,
  onExportOptimizer,
  onExportProductionPack,
  onExportCutListCsv,
  onExportPieceLabels,
  onExportModuleLabels: _onExportModuleLabels,
  onExportAssemblySheets,
  onExportCncPilot,
  onExportDespiecePdf,
  onSaveCutPlan,
  onExportCutPlanPdf,
  onExportCutPlanDxf,
  onExportCutPlanPtx,
  manufacturingLabels,
  partLabels,
  cuttingOutputTarget,
  resolveCuttingOutputTarget,
  onImportNesting: _onImportNesting,
  // Permissions
  canImportNesting: _canImportNesting,
  exportBusy,
  onSendToProduction,
  onMarkDocumented,
  /**
   * #738 — exact release context pinned by the navigation. When present the
   * obra is canonical: the header shows THIS liberation (not the server's
   * "latest" authority) and live data tabs are labeled as a working view.
   * #739 — when its frozen cutting demand is available, Despiece and
   * Optimización switch to that exact content and the plan exports connect.
   */
  releaseContext,
  releaseCuttingDemand,
  releaseCutPlan,
  onSaveReleaseCutPlan,
  releaseEngineeringState,
  onStartReleaseEngineering,
  onCompleteReleaseEngineering,
  onAuthorizeMaterials,
  releaseEngineeringBusy,
  releaseEngineeringError,
}: {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly catalog: Catalog | null;
  readonly catalog3d?: Module3DCatalogInput | null;
  readonly cutRows: readonly ProductionCutRow[] | null;
  readonly cutError?: string | null;
  readonly readiness: ProductionOrderReadiness;
  readonly labels: readonly PieceLabel[] | null;
  readonly labelsError?: string | null;
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly moduleLabelsError?: string | null;
  readonly hardwareRows: readonly HardwarePurchaseRow[] | null;
  readonly hardwareError?: string | null;
  readonly customerLabel?: string;
  /** Workshop-level cut strategy default (F133) passed to the Optimización tab. */
  readonly defaultCutStrategy?: import('@granete/domain').CutStrategy;
  readonly onBack: () => void;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly onExportCsv?: () => void | Promise<void>;
  readonly onExportPdf?: (
    labels: readonly PieceLabel[],
    perUnit: boolean,
  ) => void | Promise<void>;
  readonly onExportModulePdf?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly onExportHardware?: () => void | Promise<void>;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly onExportOptimizer?: () => void | Promise<void>;
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onExportCutListCsv?: () => void | Promise<void>;
  readonly onExportPieceLabels?: (
    labels: readonly PieceLabel[],
    options: { perUnit: boolean },
  ) => void | Promise<void>;
  readonly onExportModuleLabels?: (
    labels: readonly ModuleLabel[],
  ) => void | Promise<void>;
  readonly onExportAssemblySheets?: () => void | Promise<void>;
  readonly onExportCncPilot?: () => void | Promise<void>;
  readonly onExportDespiecePdf?: () => void | Promise<void>;
  readonly onSaveCutPlan?: (cutPlan: import('@granete/domain').CutPlan) => void;
  readonly onExportCutPlanPdf?: (
    cutPlan: import('@granete/domain').CutPlan,
  ) => void | Promise<void>;
  readonly onExportCutPlanDxf?: (
    cutPlan: import('@granete/domain').CutPlan,
    variant: 'sheets' | 'pieces',
  ) => void | Promise<void>;
  readonly onExportCutPlanPtx?: (
    cutPlan: import('@granete/domain').CutPlan,
    mode?: 'unified' | 'by-material',
    manufacturingLabels?: import('@granete/domain').ManufacturingLabelProjection,
  ) => void | Promise<void>;
  /**
   * #793 — frozen manufacturing label projection of the exact release this
   * workspace shows; forwarded to the optimización panel so the r5 PTX
   * export consumes its PARTS_INF/PARTS_UDI authority from release truth.
   */
  readonly manufacturingLabels?: import('@granete/domain').ManufacturingLabelProjection;
  /** #793 — precomputed export-layer mapping of the projection (readiness parity). */
  readonly partLabels?: readonly unknown[];
  /** #591 display summary of the configured cutting target (Optimización). */
  readonly cuttingOutputTarget?: CuttingOutputTargetView | null;
  readonly resolveCuttingOutputTarget?: (
    cutPlan: import('@granete/domain').CutPlan,
  ) => CuttingOutputTargetView | null;
  readonly onImportNesting?: (nesting: NestingImportResult) => void;
  readonly canImportNesting?: boolean;
  readonly exportBusy?: boolean;
  /**
   * roadmap-screens 2a.15 — the engineering→factory handshake. Button is
   * rendered for accepted projects; the shell stamps the engineering log
   * (sentToProductionBy/At + revision) and transitions to produced.
   */
  readonly onSendToProduction?: () => void;
  readonly onMarkDocumented?: () => void;
  readonly releaseContext?: EngineeringReleaseContextProp;
  /** #739 — frozen cutting demand of the pinned release (canonical obras). */
  readonly releaseCuttingDemand?: EngineeringReleaseCuttingDemandProp;
  /** #739 — plan persisted for the exact pinned release (undefined = legacy). */
  readonly releaseCutPlan?: CutPlan | null;
  /**
   * Persists the plan for the exact release; returns the honest storage
   * outcome so the panel never reports an unconfirmed write (#739 review).
   */
  readonly onSaveReleaseCutPlan?: (cutPlan: CutPlan) => ReleaseCutPlanSaveResult | void;
  /** #740 — durable Engineering state of the pinned release. */
  readonly releaseEngineeringState?: EngineeringReleaseStateProp;
  /**
   * #740 — explicit user commands. Wired by the shell to the exact-release
   * endpoints; NEVER fired by reads, navigation or exports.
   */
  readonly onStartReleaseEngineering?: () => void;
  readonly onCompleteReleaseEngineering?: () => void;
  /**
   * #768 — navigation to the EXISTING material authorization surface
   * (Almacén) once Engineering is complete and materials are derived. Pure
   * navigation: the authorization command itself lives there, gated by the
   * server.
   */
  readonly onAuthorizeMaterials?: () => void;
  readonly releaseEngineeringBusy?: boolean;
  readonly releaseEngineeringError?: string | null;
}): ReactNode {
  const [activeTab, setActiveTab] = useState<EngineeringTab>('resumen');

  // #738 — canonical obra: the release context governs presentation. The
  // legacy per-project log actions are not offered and the live-data
  // document exports are never presented as release content.
  const hasReleaseContext = releaseContext !== undefined;
  const releaseView = releaseContext?.state === 'ready' ? releaseContext.view : null;
  const entryStatus = engineeringEntryStatus(project);

  // #740 — durable per-release Engineering state of the pinned release. When
  // resolved it owns the status chip and the explicit commands; while it
  // loads (or fails, fail-closed: no commands) the #738 projection stands.
  const durableState =
    releaseEngineeringState?.status === 'ready' ? releaseEngineeringState : null;
  const durablePhase = durableState?.phase ?? null;

  // #768 — compact fabrication flow of the canonical obra, derived ONLY from
  // existing authorities (release, durable engineering state, correlated
  // material evidence, physical executions). Rendered with the pinned
  // release; the legacy (no-release) workspace keeps its #738 presentation.
  const engineeringEvidence: FabricationEngineeringEvidence =
    releaseEngineeringState === undefined
      ? { kind: 'unknown' }
      : releaseEngineeringState.status === 'loading'
        ? { kind: 'loading' }
        : releaseEngineeringState.status === 'error'
          ? { kind: 'unconfirmed' }
          : { kind: 'phase', phase: releaseEngineeringState.phase };
  const fabResult = fabricationFlowOf(project, engineeringEvidence, {
    unknownEngineeringLabel: ENGINEERING_ENTRY_STATUS_LABELS_ES[entryStatus],
  });
  const fabFlow = releaseView && fabResult.kind === 'flow' ? fabResult.flow : null;
  // The stepper action mirrors the explicit #740 commands (only user actions
  // fire them) plus #768 navigation to the existing material surface. No
  // callback → the next step renders as honest text, never a dead button.
  const fabAction = fabFlow?.nextAction
    ? fabFlow.nextAction === 'start-engineering' && onStartReleaseEngineering
      ? {
          label: 'Iniciar Ingeniería',
          onActivate: onStartReleaseEngineering,
          busy: releaseEngineeringBusy,
          testId: 'eng-start-engineering',
          title:
            'Registra el inicio de la preparación de Ingeniería para esta liberación (quién/cuándo, autoridad del servidor)',
        }
      : fabFlow.nextAction === 'complete-engineering' && onCompleteReleaseEngineering
        ? {
            label: 'Completar Ingeniería',
            onActivate: onCompleteReleaseEngineering,
            busy: releaseEngineeringBusy,
            testId: 'eng-complete-engineering',
            title:
              'Confirma que la preparación de esta liberación terminó. Es final, con actor y fecha del servidor. No autoriza materiales ni inicia producción.',
          }
        : fabFlow.nextAction === 'prepare-materials' && onAuthorizeMaterials
          ? {
              label: 'Autorizar materiales',
              onActivate: onAuthorizeMaterials,
              testId: 'eng-authorize-materials',
              title:
                'Abre Almacén, la superficie existente donde se derivan y autorizan los materiales de esta liberación',
            }
          : null
    : null;

  // #739 — frozen demand wiring. Only surfaces connected to the exact
  // content get unlocked; everything else keeps its live working view. While
  // the shell hasn't resolved the demand yet (undefined) the frozen tabs keep
  // the #738 interim behavior: live rows labeled as a working view.
  const frozenDemand =
    releaseCuttingDemand?.status === 'ready' ? releaseCuttingDemand : null;
  const demandResolved = releaseCuttingDemand !== undefined;
  const demandLoading = releaseCuttingDemand?.status === 'loading';
  const demandError =
    releaseCuttingDemand?.status === 'error' ? releaseCuttingDemand : null;
  const frozenTabActive =
    hasReleaseContext && FROZEN_CONTENT_TABS.has(activeTab);
  const tabUsesFrozenContent = frozenTabActive && demandResolved;

  // Live-data document exports: on a canonical obra these can't prove
  // anything about THIS release, so the Documentos tab is not offered (#738).
  const documentExportsDisabled = hasReleaseContext;
  const tabs = hasReleaseContext
    ? ENGINEERING_TABS.filter((tab) => tab !== 'documentos')
    : ENGINEERING_TABS;

  const documents = useEngineeringDocuments({
    readiness,
    labels,
    moduleLabels,
    onExportProductionPack: documentExportsDisabled ? undefined : onExportProductionPack,
    onExportOptimizer: documentExportsDisabled ? undefined : onExportOptimizer,
    onExportCutListCsv: documentExportsDisabled ? undefined : onExportCutListCsv,
    onExportHardware: documentExportsDisabled ? undefined : onExportHardware,
    onExportElevations: documentExportsDisabled ? undefined : onExportElevations,
    onExportPieceLabels: documentExportsDisabled ? undefined : onExportPieceLabels,
    onExportModulePdf: documentExportsDisabled ? undefined : onExportModulePdf,
    onExportAssemblySheets: documentExportsDisabled ? undefined : onExportAssemblySheets,
    onExportCncPilot: documentExportsDisabled ? undefined : onExportCncPilot,
    onNavigateToTab: (tabId) => setActiveTab(tabId as EngineeringTab),
  });

  // #739 review — the optimization gate is EXPLICIT about the context:
  // legacy | canonical-loading | canonical-error | canonical-ready. While a
  // canonical obra's base is not verified (release context or demand still
  // resolving, or the demand failed) the panel may keep showing rows, but it
  // can neither generate nor export — absence of a verified base is never
  // equivalent to legacy.
  const optimizationGate: OptimizationDemandGate = !hasReleaseContext
    ? { mode: 'legacy' }
    : releaseCuttingDemand === undefined
      ? { mode: 'canonical', status: 'loading' }
      : releaseCuttingDemand.status === 'loading'
        ? { mode: 'canonical', status: 'loading' }
        : releaseCuttingDemand.status === 'error'
          ? { mode: 'canonical', status: 'error', message: releaseCuttingDemand.message }
          : { mode: 'canonical', status: 'ready', base: releaseCuttingDemand.base };

  // Despiece rows for the active context: frozen release content when
  // available (canonical obra), live derivation otherwise (legacy view).
  const despieceRows = tabUsesFrozenContent
    ? (frozenDemand?.rows ?? null)
    : cutRows;
  const despieceError = tabUsesFrozenContent
    ? (demandError?.message ?? null)
    : (cutError ?? null);

  return (
    <section
      className="eng-workspace"
      aria-label={`Ingeniería — ${project.name}`}
    >
      {/* Header */}
      <header className="eng-workspace__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.5} />
          Volver
        </button>
        <div className="eng-workspace__header-info">
          <div className="eng-workspace__title-row">
            <h2 className="eng-workspace__title">{project.name}</h2>
            {/* Release badge integrated into title row */}
            {releaseView ? (
              <span
                className="eng-workspace__release-badge"
                title="Liberación exacta con la que se abrió esta pantalla"
                data-testid="eng-release-context"
              >
                <Factory size={14} strokeWidth={1.5} aria-hidden />
                Liberación #{releaseView.releaseNumber} · R{releaseView.designRevisionNumber}
                {releaseView.quoteLabel ? ` · ${releaseView.quoteLabel}` : ''}
              </span>
            ) : releaseAuthorityOf(project)?.source === 'canonical' ? (
              <span
                className="eng-workspace__release-badge"
                data-testid="eng-canonical-release"
                title="Liberación canónica: producción desbloqueada por la liberación del Digital Thread"
              >
                <Factory size={14} strokeWidth={1.5} aria-hidden />
                {releaseAuthorityLabel(project)}
              </span>
            ) : null}
          </div>
          {customerLabel ? (
            <span className="eng-workspace__customer">{customerLabel}</span>
          ) : null}
        </div>
        {/* #577 / OPS-DT-1: with a canonical ProductionRelease the obra is
            ALREADY in production — the legacy handshake CTA is hidden (no
            dual-write, no second liberation); the release pins are shown
            instead. Legacy-only projects keep the handshake. */}
        {project.status === 'accepted' &&
        onSendToProduction &&
        releaseAuthorityOf(project)?.source !== 'canonical' ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={onSendToProduction}
            disabled={!canSendToProduction(project)}
            data-testid="eng-send-to-production"
            title={
              canSendToProduction(project)
                ? 'Registra el envío en el log de ingeniería (quién/cuándo/rev.) y pasa la obra a Almacén'
                : 'Primero marcá la ingeniería como documentada (generar documentos)'
            }
          >
            <Send size={16} strokeWidth={1.5} aria-hidden />
            Enviar a Producción
          </button>
        ) : null}
        {/* Legacy workspace: release context loading */}
        {releaseContext?.state === 'loading' ? (
          <span
            className="status-badge status-badge--progress"
            data-testid="eng-release-context-loading"
          >
            Verificando liberación…
          </span>
        ) : null}
        {!hasReleaseContext &&
        engineeringStatus(project.engineeringLog) === 'in_progress' &&
        onMarkDocumented ? (
          <button
            type="button"
            className="btn btn--small"
            onClick={onMarkDocumented}
            data-testid="eng-mark-documented"
            title="Marca la ingeniería como documentada (quién/cuándo)"
          >
            <FileCheck size={14} strokeWidth={1.5} aria-hidden />
            Marcar documentado
          </button>
        ) : null}
      </header>

      {/* #768 — compact horizontal "Preparación para fabricar" strip:
          one cohesive view of design → release → engineering → materials →
          production, derived only from existing authorities. Replaces the
          former vertical stepper for canonical obras to recover vertical space. */}
      {fabFlow ? (
        <ProcessStrip
          flow={fabFlow}
          action={fabAction}
          stateTestIds={{ engineering: 'eng-entry-status' }}
          testIdPrefix="eng"
        />
      ) : null}
      {/* #740 — durable engineering completion fact: shown below the strip
          when engineering is complete, providing actor/date evidence. */}
      {fabFlow && durablePhase === 'completed' && durableState ? (
        <div className="eng-workspace__engineering-fact" data-testid="eng-engineering-completed">
          Ingeniería completa
          {durableState.completedAtLabel ? ` · ${durableState.completedAtLabel}` : ''}
          {durableState.completedByLabel ? ` · por ${durableState.completedByLabel}` : ''}
          <span className="eng-workspace__engineering-next">
            {' '}· Siguiente etapa: autorización de materiales (pendiente)
          </span>
        </div>
      ) : null}
      {releaseEngineeringError ? (
        <span
          className="status-badge status-badge--open"
          data-testid="eng-engineering-error"
          role="alert"
        >
          {releaseEngineeringError}
        </span>
      ) : null}

      {/* Tab bar */}
      <WorkspaceTabs
        tabs={tabs.map((tab) => ({
          id: tab,
          label: TAB_LABELS[tab],
        }))}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as EngineeringTab)}
        ariaLabel="Tabs de ingeniería"
        idPrefix="eng"
        testIdPrefix="eng"
      />

      {/* #739 — the exact base is connected: preparation is editable without
          touching what was commercially agreed. */}
      {frozenDemand && tabUsesFrozenContent ? (
        <p className="eng-workspace__live-notice eng-workspace__live-notice--compact" data-testid="eng-release-prep-notice">
          <span className="eng-workspace__live-notice-icon" aria-hidden>ⓘ</span>
          Preparación editable: {LIVE_TAB_NOUN_ES[activeTab] ?? 'estos datos'} del contenido congelado de la liberación #{frozenDemand.base.releaseNumber} (R{frozenDemand.base.designRevisionNumber}). Ajustar el corte no modifica la cotización ni la liberación.
        </p>
      ) : null}
      {/* #738 — canonical obra: the data tabs that still read the live
          editable project/catalog stay explicitly separated from the frozen
          release content (never labeled as liberation documents). */}
      {hasReleaseContext && !tabUsesFrozenContent && activeTab !== 'documentos' ? (
        <p className="eng-workspace__live-notice eng-workspace__live-notice--compact" data-testid="eng-live-view-notice">
          <span className="eng-workspace__live-notice-icon" aria-hidden>ⓘ</span>
          Vista provisional: {LIVE_TAB_NOUN_ES[activeTab] ?? 'estos datos'} calculados desde el proyecto/catálogo actuales. El despiece exacto de esta liberación no está disponible aún.
        </p>
      ) : null}

      {/* #739 — demand status for the frozen tabs: honest loading/error,
          never a silent fallback to the live rows. */}
      {demandError && tabUsesFrozenContent ? (
        <div
          className="eng-workspace__demand-error"
          data-testid="eng-demand-error"
          role="alert"
        >
          <p>{demandError.message}</p>
          <button type="button" className="btn btn--small" onClick={demandError.retry}>
            Reintentar
          </button>
        </div>
      ) : null}
      {demandLoading && tabUsesFrozenContent ? (
        <p className="eng-workspace__live-notice" data-testid="eng-demand-loading">
          Leyendo el despiece congelado de la liberación…
        </p>
      ) : null}

      {/* Tab panel */}
      <div
        className="eng-workspace__panel"
        role="tabpanel"
        id={`eng-panel-${activeTab}`}
        aria-labelledby={`eng-tab-${activeTab}`}
      >
        {activeTab === 'resumen' && (
          <EngineeringResumenTab
            readiness={readiness}
            cutRows={cutRows}
            hardwareRows={hardwareRows}
          />
        )}
        {activeTab === 'modulos' && (
          <ProductionOrderModulesPanel
            project={project}
            modules={modules}
            cutRows={cutRows}
          />
        )}
        {activeTab === 'despiece' && (
          <div className="eng-despiece">
            <ProductionOrderDespiecePanel
              cutRows={despieceRows}
              cutError={despieceError}
              onExportCsv={documentExportsDisabled ? undefined : onExportCsv}
              exportBusy={exportBusy}
            />
            {/* Imprimir A4 button — legacy working view only: the release
                despiece prints from the generated plan (Optimización → PDF). */}
            {!documentExportsDisabled ? (
              <div className="eng-despiece__print">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={onExportDespiecePdf}
                  disabled={exportBusy || !onExportDespiecePdf}
                >
                  <Printer size={14} strokeWidth={1.5} />
                  Imprimir A4
                </button>
              </div>
            ) : null}
          </div>
        )}
        {activeTab === 'etiquetas' && (
          <ProductionOrderLabelsPanel
            project={project}
            labels={labels}
            labelsError={labelsError}
            moduleLabels={moduleLabels}
            moduleLabelsError={moduleLabelsError}
            onExportPdf={documentExportsDisabled ? undefined : onExportPdf}
            onExportModulePdf={documentExportsDisabled ? undefined : onExportModulePdf}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'herrajes' && (
          <ProductionOrderHardwarePanel
            rows={hardwareRows}
            error={hardwareError}
            onExportHardware={documentExportsDisabled ? undefined : onExportHardware}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'vistas' && catalog3d && (
          <ProductionOrderViewsPanel
            project={project}
            modules={modules}
            catalog={catalog3d}
            resolveMediaUrl={resolveMediaUrl}
            onExportElevations={documentExportsDisabled ? undefined : onExportElevations}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'optimizacion' && (
          <ProductionOrderOptimizationPanel
            project={project}
            catalog={catalog}
            cutRows={despieceRows}
            defaultCutStrategy={defaultCutStrategy}
            initialCutPlan={hasReleaseContext ? (releaseCutPlan ?? null) : undefined}
            demandGate={optimizationGate}
            onSaveCutPlan={
              hasReleaseContext ? onSaveReleaseCutPlan : onSaveCutPlan
            }
            onExportCutPlanPdf={onExportCutPlanPdf}
            onExportOptimizer={
              documentExportsDisabled
                ? undefined
                : onExportOptimizer
            }
            optimizerUnavailableReason={
              documentExportsDisabled
                ? 'El Optimizer XLSX se calcula desde el proyecto vivo. Para la liberación exacta usá el PDF del plan de corte, generado desde las piezas congeladas.'
                : null
            }
            onExportCutPlanDxf={
              documentExportsDisabled ? undefined : onExportCutPlanDxf
            }
            dxfUnavailableReason={
              documentExportsDisabled
                ? 'El DXF de esta liberación queda pendiente: sus perforaciones se resuelven hoy desde el proyecto vivo. Usá el PDF/PTX del plan congelado.'
                : null
            }
            onExportCutPlanPtx={onExportCutPlanPtx}
            manufacturingLabels={manufacturingLabels}
            partLabels={partLabels}
            cuttingOutputTarget={cuttingOutputTarget}
            resolveCuttingOutputTarget={resolveCuttingOutputTarget}
            exportBusy={exportBusy}
          />
        )}
        {activeTab === 'documentos' && (
          <ProductionOrderDocumentsPanel
            documents={documents}
            exportBusy={exportBusy}
          />
        )}
      </div>
      {tabs.filter((tab) => tab !== activeTab).map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`eng-panel-${tab}`}
          aria-labelledby={`eng-tab-${tab}`}
          hidden
        />
      ))}
    </section>
  );
}
