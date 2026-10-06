import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Activity, Camera, ClipboardList, MessageSquare, Ruler, Wrench } from 'lucide-react';
import { surveyFabricationBlockers } from '@granete/domain';
import { useProjectDetail } from '../projectDetailContext';

export type QuoteToolsPanel =
  | 'overview'
  | 'lifecycle'
  | 'survey'
  | 'kitchen'
  | 'scenarios'
  | 'checklist'
  | 'photos'
  | 'internal_comms'
  | 'warranties'
  | null;

/** #1124: IDs válidos para el deep-link ?panel= de la URL. */
export const QUOTE_TOOLS_PANEL_IDS: readonly Exclude<QuoteToolsPanel, null>[] = [
  'overview',
  'lifecycle',
  'survey',
  'kitchen',
  'scenarios',
  'checklist',
  'photos',
  'internal_comms',
  'warranties',
];

export interface ProjectDetailToolsNavProps {
  readonly toolsPanel: QuoteToolsPanel;
  readonly onToggleTools: (panel: Exclude<QuoteToolsPanel, null>) => void;
  readonly kitchenUnplacedCount: number;
}

export function ProjectDetailToolsNav({
  toolsPanel,
  onToggleTools,
  kitchenUnplacedCount,
}: ProjectDetailToolsNavProps): ReactNode {
  const ctx = useProjectDetail();
  const tablistRef = useRef<HTMLDivElement>(null);
  const surveyBlockers = ctx.project.siteSurvey
    ? surveyFabricationBlockers(ctx.project.siteSurvey).length
    : 0;

  // #1124: roving tabindex + flechas — los toggles no fuerzan Tab×9 para
  // atravesarlos (§4.8; Sam).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-tools-tab]',
      ) ?? [],
    );
    if (buttons.length === 0) return;
    const currentIndex = buttons.findIndex(
      (button) => button.tabIndex === 0,
    );
    const nextIndex = (() => {
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          return (currentIndex + 1 + buttons.length) % buttons.length;
        case 'ArrowUp':
        case 'ArrowLeft':
          return (currentIndex - 1 + buttons.length) % buttons.length;
        case 'Home':
          return 0;
        case 'End':
          return buttons.length - 1;
        default:
          return null;
      }
    })();
    if (nextIndex === null) return;
    event.preventDefault();
    buttons.forEach((button, index) => {
      button.tabIndex = index === nextIndex ? 0 : -1;
    });
    buttons[nextIndex]?.focus();
  };

  const tabProps = (panel: Exclude<QuoteToolsPanel, null>) => ({
    'aria-pressed': toolsPanel === panel,
    'aria-controls': toolsPanel === panel ? 'project-tools-panel' : undefined,
    className:
      toolsPanel === panel
        ? 'project-detail__tools-tab project-detail__tools-tab--active'
        : 'project-detail__tools-tab',
    tabIndex: toolsPanel === panel || toolsPanel === null ? 0 : -1,
    'data-tools-tab': true,
    onClick: () => onToggleTools(panel),
  });

  return (
    <div className="project-detail__tools-header">
      <h3 className="project-detail__section-title">Herramientas</h3>
      <div
        ref={tablistRef}
        className="project-detail__tools-tabs"
        role="group"
        aria-label="Paneles avanzados"
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          {...tabProps('overview')}
          data-testid="project-tools-overview"
        >
          <ClipboardList size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Resumen de obra
        </button>
        <button
          type="button"
          {...tabProps('lifecycle')}
          data-testid="project-tools-lifecycle"
        >
          <Activity size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Ciclo de vida y entregas
        </button>
        <button
          type="button"
          {...tabProps('survey')}
          data-testid="project-tools-survey"
        >
          <Ruler size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Levantamiento
          {surveyBlockers > 0 ? (
            <span
              className="project-detail__tools-badge"
              data-testid="project-tools-survey-blockers"
              title={`${surveyBlockers} medidas pendientes de levantar/aprobar`}
            >
              {surveyBlockers}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          {...tabProps('kitchen')}
          data-testid="project-tools-kitchen"
        >
          Plano / ambiente
          {kitchenUnplacedCount > 0 ? (
            <span
              className="project-detail__tools-badge"
              data-testid="project-tools-kitchen-unplaced"
              title={`${kitchenUnplacedCount} sin colocar en el plano`}
            >
              {kitchenUnplacedCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          {...tabProps('scenarios')}
          data-testid="project-tools-scenarios"
        >
          Escenarios A/B
        </button>
        <button
          type="button"
          {...tabProps('checklist')}
          data-testid="project-tools-checklist"
        >
          Checklist instalación
        </button>
        <button
          type="button"
          {...tabProps('photos')}
          data-testid="project-tools-photos"
        >
          <Camera size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Fotos / Galería
          {ctx.photos && ctx.photos.length > 0 ? (
            <span
              className="project-detail__tools-badge"
              title={`${ctx.photos.length} fotos`}
            >
              {ctx.photos.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          {...tabProps('internal_comms')}
          data-testid="project-tools-internal-comms"
        >
          <MessageSquare size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Comunicaciones
          {ctx.internalMessages && ctx.internalMessages.length > 0 ? (
            <span
              className="project-detail__tools-badge"
              title={`${ctx.internalMessages.length} mensajes`}
            >
              {ctx.internalMessages.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          {...tabProps('warranties')}
          data-testid="project-tools-warranties"
        >
          <Wrench size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Garantías
          {ctx.warranties && ctx.warranties.length > 0 ? (
            <span
              className="project-detail__tools-badge"
              title={`${ctx.warranties.length} tickets de garantía`}
            >
              {ctx.warranties.length}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}
