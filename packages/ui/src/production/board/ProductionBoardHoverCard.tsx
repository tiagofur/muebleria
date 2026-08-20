/**
 * Floating interactive hover card for piece details in ProductionBoardView.
 */

import type { ReactNode } from 'react';
import type { CutPlanPlacedPiece } from '@muebles/domain';

export interface ProductionBoardHoverCardProps {
  readonly piece: CutPlanPlacedPiece | null;
}

export function ProductionBoardHoverCard({
  piece,
}: ProductionBoardHoverCardProps): ReactNode {
  if (!piece) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        background: 'rgba(15, 23, 42, 0.95)',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: 6,
        fontSize: 11,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        pointerEvents: 'none',
        zIndex: 10,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 2 }}>
        [{piece.partCode}] {piece.partName}
      </div>
      <div>Módulo: {piece.moduleCode || '—'}</div>
      <div>
        Corte sierra:{' '}
        <strong>
          {piece.lengthMm} × {piece.widthMm} mm
        </strong>
      </div>
      <div>
        Medida final: {piece.originalLengthMm} × {piece.originalWidthMm} mm
      </div>
      <div>
        Veta: {piece.grain === 1 ? 'Longitudinal' : 'Sin veta'}{' '}
        {piece.rotated ? '(Rotada 90°)' : ''}
      </div>
      <div>
        Cantos: L1={piece.L1 ? '✓' : '-'} L2={piece.L2 ? '✓' : '-'} W1=
        {piece.W1 ? '✓' : '-'} W2={piece.W2 ? '✓' : '-'}
        {piece.edgeBandThicknessMm ? ` (${piece.edgeBandThicknessMm}mm)` : ''}
      </div>
    </div>
  );
}
