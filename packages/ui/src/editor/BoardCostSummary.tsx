/**
 * BoardCostSummary — muestra m², ML de canto y totales en vivo
 * del scratch space del editor (Fase 1 slice 1.6).
 *
 * Usa calcBoardLineMetrics del domain engine (puro, sin React).
 */

import { useMemo, type ReactNode } from 'react';
import type { ResolvedBoardPart, Catalog } from '@muebles/domain';
import { calcBoardLineMetrics } from '@muebles/domain';
import './boardCostSummary.css';

export interface BoardCostSummaryProps {
  readonly parts: readonly ResolvedBoardPart[];
  readonly catalog?: Catalog;
}

export function BoardCostSummary({
  parts,
  catalog,
}: BoardCostSummaryProps): ReactNode {
  const summary = useMemo(() => {
    let totalAreaM2 = 0;
    let totalEdgeMl = 0;
    let partsCount = 0;

    for (const part of parts) {
      if (part.lengthMm > 0 && part.widthMm > 0) {
        const { areaM2, edgeMl } = calcBoardLineMetrics(part);
        totalAreaM2 += areaM2;
        totalEdgeMl += edgeMl;
        partsCount++;
      }
    }

    // Material cost (optional, needs catalog).
    let materialCost = 0;
    if (catalog) {
      for (const part of parts) {
        if (part.lengthMm <= 0 || part.widthMm <= 0) continue;
        try {
          const material = catalog.materials.find(
            (m) => m.id === part.materialId,
          );
          if (material) {
            const { areaM2 } = calcBoardLineMetrics(part);
            materialCost += areaM2 * material.costPerM2;
          }
        } catch {
          // skip if material not found
        }
      }
    }

    return { totalAreaM2, totalEdgeMl, partsCount, materialCost };
  }, [parts, catalog]);

  return (
    <div className="board-cost" data-testid="board-cost-summary">
      <div className="board-cost__item">
        <span className="board-cost__label">Piezas</span>
        <span className="board-cost__value">{summary.partsCount}</span>
      </div>
      <div className="board-cost__item">
        <span className="board-cost__label">Superficie</span>
        <span className="board-cost__value">
          {summary.totalAreaM2.toFixed(2)} m²
        </span>
      </div>
      <div className="board-cost__item">
        <span className="board-cost__label">Cantos</span>
        <span className="board-cost__value">
          {summary.totalEdgeMl.toFixed(1)} ML
        </span>
      </div>
      {catalog && summary.materialCost > 0 ? (
        <div className="board-cost__item board-cost__item--highlight">
          <span className="board-cost__label">Material</span>
          <span className="board-cost__value">
            ${summary.materialCost.toFixed(2)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
