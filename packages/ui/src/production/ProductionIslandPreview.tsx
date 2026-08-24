/**
 * Ficha de isla (free-place) para producción (#255): alzado simple dibujado
 * con medidas y código. Las islas no se proyectan en alzados de muro —
 * esta ficha es el artefacto de reemplazo (UI + PDF por hoja).
 */

import type { ReactNode } from 'react';
import type { ProductionIslandUnit } from '@muebles/domain';
import { getCategoryTheme } from '../projects/kitchenPlanHelpers';

export type ProductionIslandPreviewProps = {
  readonly island: ProductionIslandUnit;
};

export function ProductionIslandPreview({
  island,
}: ProductionIslandPreviewProps): ReactNode {
  // Mismo tema 'isla' que la planta 2D — color de categoría, no inventado.
  const theme = getCategoryTheme('isla');
  const pad = 40;
  const maxZ = Math.max(1600, island.bottomZMm + island.heightMm + 160);
  const scale = Math.min(0.14, 520 / Math.max(island.widthMm, 1));
  const svgW = Math.max(280, island.widthMm * scale + pad * 2 + 70);
  const svgH = Math.max(220, maxZ * scale + pad * 2);
  const floorY = svgH - pad;
  const x = pad;
  const w = Math.max(island.widthMm * scale, 10);
  const h = Math.max(island.heightMm * scale, 10);
  const y = floorY - (island.bottomZMm + island.heightMm) * scale;
  const axisX = Math.min(svgW - 10, x + w + 34);

  return (
    <div
      className="prod-island-preview"
      data-testid={`prod-island-sheet-${island.itemId}-${island.instanceIndex}`}
    >
      <h4 className="prod-elev-preview__title">
        Isla {island.label}{' '}
        <span className="prod-modulos__muted">· {island.spaceName}</span>
      </h4>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="prod-island-preview__svg"
        role="img"
        aria-label={`Ficha de isla ${island.label}: ${island.widthMm} de ancho por ${island.heightMm} de alto por ${island.depthMm} de fondo, en ${island.spaceName}`}
      >
        {/* Piso */}
        <line
          x1={pad - 16}
          y1={floorY}
          x2={x + w + 24}
          y2={floorY}
          stroke="var(--text-primary)"
          strokeWidth={2}
        />
        <text x={pad - 16} y={floorY + 14} fontSize={9} fill="var(--text-muted)">
          piso
        </text>
        {/* Cuerpo de la isla */}
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={theme.fillColor}
          stroke={theme.strokeColor}
          strokeWidth={1.5}
          rx={2}
        />
        {w > 34 ? (
          <text
            x={x + w / 2}
            y={y + h / 2 + 3}
            fontSize={9}
            fontWeight={600}
            fill="var(--text-primary)"
            textAnchor="middle"
          >
            {island.moduleCode}
          </text>
        ) : null}
        {/* Cota ancho */}
        <text
          x={x + w / 2}
          y={floorY + 14}
          fontSize={9}
          fill="var(--text-muted)"
          textAnchor="middle"
        >
          {island.widthMm}
        </text>
        {/* Cota alto */}
        <line
          x1={axisX}
          y1={y}
          x2={axisX}
          y2={floorY}
          stroke="var(--text-muted)"
          strokeWidth={1}
        />
        <text x={axisX + 4} y={y + h / 2} fontSize={9} fill="var(--text-muted)">
          {island.heightMm}
        </text>
        {/* Zócalo / patas */}
        {island.bottomZMm > 0 ? (
          <text
            x={x + 3}
            y={floorY - (island.bottomZMm * scale) / 2 + 3}
            fontSize={8}
            fill="var(--text-muted)"
          >
            zócalo {island.baseClearanceMm}
          </text>
        ) : null}
      </svg>
      <p className="prod-island-preview__meta">
        {island.moduleName} · {island.widthMm} × {island.heightMm} ×{' '}
        {island.depthMm} mm · planta: X {island.freeXMm} · Y {island.freeYMm} ·
        rotación {island.freeYawDeg}°
      </p>
    </div>
  );
}
