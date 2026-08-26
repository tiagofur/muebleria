/**
 * SVG preview of a single wall elevation (PROD-1.1 UI).
 */

import type { ReactNode } from 'react';
import type { ProductionWallElevation } from '@granete/domain';

export type ProductionElevationPreviewProps = {
  readonly wall: ProductionWallElevation;
};

export function ProductionElevationPreview({
  wall,
}: ProductionElevationPreviewProps): ReactNode {
  const pad = 40;
  const maxZ = Math.max(
    2200,
    ...wall.units.map((u) => u.bottomZMm + u.heightMm + 80),
  );
  const scale = Math.min(0.12, 720 / Math.max(wall.wallLengthMm, 1));
  const svgW = Math.max(320, wall.wallLengthMm * scale + pad * 2);
  const svgH = Math.max(200, maxZ * scale + pad * 2);
  const floorY = svgH - pad;

  return (
    <div
      className="prod-elev-preview"
      data-testid={`prod-elev-preview-${wall.wallId}`}
    >
      <h4 className="prod-elev-preview__title">
        {wall.wallName}{' '}
        <span className="prod-modulos__muted">({wall.wallLengthMm} mm)</span>
      </h4>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="prod-elev-preview__svg"
        role="img"
        aria-label={`Elevación ${wall.wallName}`}
      >
        <line
          x1={pad}
          y1={floorY}
          x2={pad + wall.wallLengthMm * scale}
          y2={floorY}
          stroke="var(--text-primary)"
          strokeWidth={2}
        />
        <text
          x={pad}
          y={floorY + 14}
          fontSize={10}
          fill="var(--text-muted)"
        >
          0
        </text>
        <text
          x={pad + wall.wallLengthMm * scale - 24}
          y={floorY + 14}
          fontSize={10}
          fill="var(--text-muted)"
        >
          {wall.wallLengthMm}
        </text>
        {wall.units.map((u) => {
          const x = pad + u.offsetMm * scale;
          const w = Math.max(u.widthMm * scale, 4);
          const h = Math.max(u.heightMm * scale, 4);
          const y = floorY - (u.bottomZMm + u.heightMm) * scale;
          return (
            <g key={`${u.itemId}-${u.instanceIndex}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={
                  u.elevation === 'wall'
                    ? 'hsl(210 40% 88%)'
                    : 'hsl(35 30% 88%)'
                }
                stroke="var(--text-primary)"
                strokeWidth={1}
              />
              {w > 36 ? (
                <text
                  x={x + 3}
                  y={y + h / 2 + 3}
                  fontSize={9}
                  fill="var(--text-primary)"
                >
                  {u.label}
                </text>
              ) : null}
              <text
                x={x + w / 2}
                y={floorY - u.bottomZMm * scale + 10}
                fontSize={8}
                fill="var(--text-muted)"
                textAnchor="middle"
              >
                {u.widthMm}
              </text>
            </g>
          );
        })}
      </svg>
      {wall.units.length === 0 ? (
        <p className="prod-modulos__muted">Sin módulos en este muro.</p>
      ) : null}
    </div>
  );
}
