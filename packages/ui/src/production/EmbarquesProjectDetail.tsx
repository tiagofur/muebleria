/**
 * Embarques — Project detail: loading checklist, QR scanner, release gate.
 *
 * Wraps ProductionOrderDispatchPanel with:
 * - Back navigation to the Embarques list
 * - Cross-project validation: scanning a bulto from another project shows
 *   a red alert and prevents marking as loaded
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, AlertTriangle, X } from 'lucide-react';
import type {
  Catalog,
  ItemFloorStatus,
  Module,
  ModuleLabel,
  Project,
} from '@granete/domain';
import {
  calculateLoadingProgress,
  generateModuleLabels,
  parsePieceLabelScan,
} from '@granete/domain';
import { ProductionOrderDispatchPanel } from './ProductionOrderDispatchPanel';

type CrossProjectAlert = {
  readonly scannedCode: string;
  readonly expectedProject: string;
  readonly actualProject: string;
};

export type EmbarquesProjectDetailProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly catalog?: Catalog | null;
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly customerName?: string;
  readonly onSetFloorStatus?: (
    itemId: string,
    status: ItemFloorStatus,
  ) => void | Promise<void>;
  readonly canSetFloorStatus?: boolean;
  readonly onReleaseToDelivery?: () => void | Promise<void>;
  readonly canReleaseToDelivery?: boolean;
  readonly isReleasing?: boolean;
  readonly onBack?: () => void;
  readonly testId?: string;
};

export function EmbarquesProjectDetail({
  project,
  modules,
  catalog,
  moduleLabels,
  customerName = '',
  onSetFloorStatus,
  canSetFloorStatus = true,
  onReleaseToDelivery,
  canReleaseToDelivery = true,
  isReleasing = false,
  onBack,
  testId,
}: EmbarquesProjectDetailProps): ReactNode {
  const [crossAlert, setCrossAlert] = useState<CrossProjectAlert | null>(null);

  // Resolve module labels for cross-project validation and checklist
  const labels = useMemo(() => {
    if (moduleLabels && moduleLabels.length > 0) return moduleLabels;
    if (!catalog) return [];
    try {
      return generateModuleLabels(project, catalog, {
        customerName,
        revision: project.production?.revision?.toString(),
      });
    } catch {
      return [];
    }
  }, [moduleLabels, project, catalog, customerName]);

  // Wrapped onSetFloorStatus with cross-project validation
  const handleSetFloorStatus = useCallback(
    (itemId: string, status: ItemFloorStatus) => {
      if (!onSetFloorStatus) return;

      // Check if this itemId belongs to the current project
      const belongsToProject = project.items.some((item) => item.id === itemId);
      if (!belongsToProject && status === 'loaded') {
        // Find the label to get a human-readable name
        const label = labels.find((l) => l.itemId === itemId);
        setCrossAlert({
          scannedCode: label?.factoryCode ?? label?.moduleCode ?? itemId,
          expectedProject: project.name,
          actualProject: label?.moduleName ?? 'Otra obra',
        });
        return; // Block the advance
      }

      void onSetFloorStatus(itemId, status);
    },
    [onSetFloorStatus, project, labels],
  );

  return (
    <section
      className="embarques-detail"
      aria-label={`Control de carga — ${project.name}`}
      data-testid={testId ?? 'embarques-detail'}
    >
      {/* Back navigation + project summary */}
      <header className="embarques-detail__header">
        {onBack ? (
          <button
            type="button"
            className="btn btn--ghost embarques-detail__back"
            onClick={onBack}
            data-testid="embarques-back"
          >
            <ArrowLeft size={18} /> Embarques
          </button>
        ) : null}
        <div className="embarques-detail__project-info">
          <h2 className="embarques-detail__title">{project.name}</h2>
          {customerName ? (
            <p className="embarques-detail__customer">{customerName}</p>
          ) : null}
        </div>
      </header>

      {/* Cross-project alert banner */}
      {crossAlert ? (
        <div
          className="embarques-detail__alert"
          role="alert"
          data-testid="embarques-cross-alert"
        >
          <AlertTriangle size={20} className="embarques-detail__alert-icon" />
          <div className="embarques-detail__alert-content">
            <strong>Bulto no pertenece a esta obra</strong>
            <p>
              El código <code>{crossAlert.scannedCode}</code> pertenece a{' '}
              <strong>{crossAlert.actualProject}</strong>, no a{' '}
              <strong>{crossAlert.expectedProject}</strong>.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setCrossAlert(null)}
            data-testid="embarques-dismiss-alert"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {/* Dispatch panel (scanner, checklist, release gate) */}
      <ProductionOrderDispatchPanel
        project={project}
        modules={modules}
        moduleLabels={labels}
        customerName={customerName}
        onSetFloorStatus={handleSetFloorStatus}
        canSetFloorStatus={canSetFloorStatus}
        onReleaseToDelivery={onReleaseToDelivery}
        canReleaseToDelivery={canReleaseToDelivery && !crossAlert}
        isReleasing={isReleasing}
      />
    </section>
  );
}
