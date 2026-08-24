/**
 * Embarques — Project list (loading staging).
 *
 * Cross-project view of what's EMBALADO waiting to be loaded onto transport.
 * Shows a card per project with a loading progress summary. Clicking a card
 * navigates to the detail view (EmbarquesProjectDetail) where the operator
 * can scan QR codes and mark bultos as loaded.
 *
 * Read-derive only; advancing goes through the shell callback so the server
 * enforces station scoping and writes the floor-status event (F094).
 */

import { useMemo, type ReactNode } from 'react';
import { Truck } from 'lucide-react';

import {
  calculateLoadingProgress,
  normalizeItemFloorStatus,
  type Project,
} from '@muebles/domain';
import { EmptyState, PageHeader } from '../common';

type EmbarquesProjectCard = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerLabel: string;
  readonly totalBultos: number;
  readonly loadedBultos: number;
  readonly percentage: number;
};

/** Derive project summary cards for the Embarques list (pure, testable). */
export function embarquesProjects(
  projects: readonly Project[],
  customerLabelFor?: (customerId: string) => string,
): readonly EmbarquesProjectCard[] {
  const result: EmbarquesProjectCard[] = [];
  for (const project of projects) {
    if (project.status !== 'accepted' && project.status !== 'produced') continue;
    // A project qualifies if it has at least one item in 'packaged' or later
    // manufacturing status (packaged, loaded) — i.e. it has been through
    // embalaje and is relevant to dispatch.
    const hasRelevantItems = project.items.some((item) => {
      const status = normalizeItemFloorStatus(item.floorStatus);
      return status === 'packaged' || status === 'loaded';
    });
    if (!hasRelevantItems) continue;

    const progress = calculateLoadingProgress(project);
    const totalBultos = progress.totalPackages ?? progress.totalUnits ?? 0;
    const loadedBultos = progress.loadedPackages ?? progress.loadedUnits ?? 0;

    result.push({
      projectId: project.id,
      projectName: project.name,
      customerLabel: customerLabelFor?.(project.customerId) ?? '',
      totalBultos,
      loadedBultos,
      percentage: progress.percentage ?? 0,
    });
  }
  return result;
}

export function EmbarquesScreen({
  projects,
  customerLabelFor,
  onOpenProject,
  testId,
}: {
  /** Projects in the factory (accepted/produced), already role-filtered. */
  readonly projects: readonly Project[];
  readonly customerLabelFor?: (customerId: string) => string;
  /** Navigate to the project's loading detail view. */
  readonly onOpenProject?: (projectId: string) => void;
  readonly testId?: string;
}): ReactNode {
  const cards = useMemo(
    () => embarquesProjects(projects, customerLabelFor),
    [projects, customerLabelFor],
  );
  const totalPending = cards.reduce(
    (acc, c) => acc + (c.totalBultos - c.loadedBultos),
    0,
  );

  return (
    <section
      className="ship-board"
      aria-label="Embarques"
      data-testid={testId ?? 'embarques-screen'}
    >
      <PageHeader
        title="Embarques"
        subtitle="Obras con muebles embalados esperando carga al transporte. Seleccioná una obra para ver el checklist de carga."
        icon={<Truck size={16} strokeWidth={1.5} />}
        contextualControls={
          <span className="ship-board__stat" data-testid="embarques-to-load">
            {totalPending} bultos por cargar
          </span>
        }
      />

      {cards.length === 0 ? (
        <EmptyState
          title="Nada para cargar"
          description="Cuando haya muebles embalados esperando transporte, aparecen acá organizados por obra."
        />
      ) : (
        <ul className="ship-board__cards">
          {cards.map((card) => (
            <li
              key={card.projectId}
              className={`ship-board__card${onOpenProject ? ' card-open-host' : ''}`}
              data-testid={`embarques-card-${card.projectId}`}
            >
              <div className="ship-board__card-header">
                <div className="ship-board__card-info">
                  {onOpenProject ? (
                    <h3 className="ship-board__card-title">
                      <button
                        type="button"
                        className="card-open"
                        onClick={() => onOpenProject(card.projectId)}
                        data-testid={`embarques-open-${card.projectId}`}
                        aria-label={`Abrir carga ${card.projectName}`}
                      >
                        {card.projectName}
                      </button>
                    </h3>
                  ) : (
                    <h3 className="ship-board__card-title">{card.projectName}</h3>
                  )}
                  {card.customerLabel ? (
                    <p className="ship-board__card-customer">
                      {card.customerLabel}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Loading progress summary */}
              <div className="ship-board__section">
                <div className="ship-board__progress-row">
                  <span className="ship-board__progress-label">
                    {card.loadedBultos} de {card.totalBultos} bultos cargados
                  </span>
                  <span className="ship-board__progress-pct">
                    {card.percentage}%
                  </span>
                </div>
                <div className="ship-board__progress-bar-bg">
                  <div
                    className={`ship-board__progress-bar-fill ${
                      card.percentage === 100
                        ? 'ship-board__progress-bar-fill--complete'
                        : ''
                    }`}
                    style={{ width: `${card.percentage}%` }}
                  />
                </div>
                {card.percentage === 100 ? (
                  <span className="ship-board__complete-badge">
                    ✓ Lista para enviar
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
