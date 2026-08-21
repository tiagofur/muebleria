import type { ReactNode } from 'react';
import { Activity, Camera, MessageSquare, Wrench } from 'lucide-react';
import { useProjectDetail } from '../projectDetailContext';

export type QuoteToolsPanel =
  | 'lifecycle'
  | 'kitchen'
  | 'scenarios'
  | 'checklist'
  | 'photos'
  | 'internal_comms'
  | 'warranties'
  | null;

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

  return (
    <div className="project-detail__tools-header">
      <h3 className="project-detail__section-title">Herramientas</h3>
      <div
        className="project-detail__tools-tabs"
        role="group"
        aria-label="Paneles avanzados"
      >
        <button
          type="button"
          aria-pressed={toolsPanel === 'lifecycle'}
          className={
            toolsPanel === 'lifecycle'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-lifecycle"
          onClick={() => onToggleTools('lifecycle')}
        >
          <Activity size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
          Lifecycle / Entregas
        </button>
        <button
          type="button"
          aria-pressed={toolsPanel === 'kitchen'}
          className={
            toolsPanel === 'kitchen'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-kitchen"
          onClick={() => onToggleTools('kitchen')}
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
          aria-pressed={toolsPanel === 'scenarios'}
          className={
            toolsPanel === 'scenarios'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-scenarios"
          onClick={() => onToggleTools('scenarios')}
        >
          Escenarios A/B
        </button>
        <button
          type="button"
          aria-pressed={toolsPanel === 'checklist'}
          className={
            toolsPanel === 'checklist'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-checklist"
          onClick={() => onToggleTools('checklist')}
        >
          Checklist instalación
        </button>
        <button
          type="button"
          aria-pressed={toolsPanel === 'photos'}
          className={
            toolsPanel === 'photos'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-photos"
          onClick={() => onToggleTools('photos')}
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
          aria-pressed={toolsPanel === 'internal_comms'}
          className={
            toolsPanel === 'internal_comms'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-internal-comms"
          onClick={() => onToggleTools('internal_comms')}
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
          aria-pressed={toolsPanel === 'warranties'}
          className={
            toolsPanel === 'warranties'
              ? 'project-detail__tools-tab project-detail__tools-tab--active'
              : 'project-detail__tools-tab'
          }
          data-testid="project-tools-warranties"
          onClick={() => onToggleTools('warranties')}
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
