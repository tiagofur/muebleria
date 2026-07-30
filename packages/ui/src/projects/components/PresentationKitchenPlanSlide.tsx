/**
 * Read-only kitchen plan slide for client presentation (#136 enhanced).
 * Renders a clean SVG of walls + placed modules — no editing controls.
 */

import { useMemo, type ReactNode } from 'react';
import type {
  Module,
  Project,
} from '@muebles/domain';
import {
  emptyKitchenLayout,
  pruneKitchenLayout,
  resolveWallFrames,
} from '@muebles/domain';
import { itemLabel, moduleWidth } from '../kitchenPlanHelpers';

export type PresentationKitchenPlanSlideProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
};

export function PresentationKitchenPlanSlide({
  project,
  modules,
}: PresentationKitchenPlanSlideProps): ReactNode {
  const layout = useMemo(
    () => pruneKitchenLayout(project.kitchenLayout ?? emptyKitchenLayout(), project.items),
    [project.kitchenLayout, project.items],
  );
  const frames = useMemo(() => resolveWallFrames(layout.walls), [layout.walls]);

  const pad = 40;
  const scale = 0.08;
  let maxX = 100;
  let maxY = 100;
  for (const f of frames) {
    maxX = Math.max(maxX, f.originXMm, f.endXMm);
    maxY = Math.max(maxY, f.originYMm, f.endYMm);
  }
  const svgW = Math.max(400, maxX * scale + pad * 2);
  const svgH = Math.max(280, maxY * scale + pad * 2);

  const hasLayout = layout.walls.length > 0;
  const hasPlacements = layout.placements.length > 0;

  if (!hasLayout) {
    return (
      <div className="catalog-empty" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <p>Sin plano de cocina definido.</p>
      </div>
    );
  }

  return (
    <div className="presentation-kitchen-plan" data-testid="presentation-kitchen-plan">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="kitchen-plan-svg"
        style={{
          maxWidth: '100%',
          background: 'var(--surface-muted)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-default)',
        }}
      >
        {/* Walls */}
        {frames.map((f) => {
          const x1 = pad + f.originXMm * scale;
          const y1 = pad + f.originYMm * scale;
          const x2 = pad + f.endXMm * scale;
          const y2 = pad + f.endYMm * scale;
          return (
            <g key={f.id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="var(--text-primary)" strokeWidth={4} strokeLinecap="square" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}
                fontSize={11} fill="var(--text-muted)" textAnchor="middle">
                {f.name} ({f.lengthMm} mm)
              </text>
            </g>
          );
        })}

        {/* Placed modules */}
        {layout.placements.map((p) => {
          const wall = frames.find((f) => f.id === p.wallId);
          if (!wall) return null;
          const w = moduleWidth(
            project.items.find((i) => i.id === p.itemId) ?? {
              id: p.itemId, moduleId: '', quantity: 1, optionChoices: {},
            },
            modules,
          );
          const angle = ((wall.angleDeg % 360) + 360) % 360;
          let rx = pad + wall.originXMm * scale;
          let ry = pad + wall.originYMm * scale;
          let rw = Math.max(8, w * scale);
          let rh = 14;
          if (angle > 45 && angle < 135) {
            rx = pad + wall.originXMm * scale - 7;
            ry = pad + (wall.originYMm + p.offsetMm) * scale;
            rw = 14;
            rh = Math.max(8, w * scale);
          } else {
            rx = pad + (wall.originXMm + p.offsetMm) * scale;
            ry = pad + wall.originYMm * scale - 7;
          }
          return (
            <g key={`${p.itemId}#${p.instanceIndex}`}>
              <rect x={rx} y={ry} width={rw} height={rh}
                fill={p.elevation === 'wall' ? 'var(--accent-500)' : 'var(--success-500)'}
                opacity={0.8} />
              {rw > 30 && rh > 12 ? (
                <text x={rx + rw / 2} y={ry + rh / 2 + 3}
                  fontSize={8} fill="white" textAnchor="middle" fontWeight={600}>
                  {itemLabel(p.itemId, p.instanceIndex, project, modules).split('—')[0]?.trim()}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {hasPlacements ? (
        <div className="presentation-kitchen-plan__legend" style={{
          display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.85rem',
          color: 'var(--text-secondary)', flexWrap: 'wrap',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 12, background: 'var(--success-500)', borderRadius: 2, opacity: 0.8 }} />
            Base (piso)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 12, background: 'var(--accent-500)', borderRadius: 2, opacity: 0.8 }} />
            Alacena (muro)
          </span>
        </div>
      ) : null}
    </div>
  );
}
