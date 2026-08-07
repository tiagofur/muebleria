/**
 * Read-only kitchen plan slide for client presentation (#136 enhanced).
 * Multi-ambiente: one SVG per KitchenSpace with tabs when 2+.
 * Wall-anchored + free/island placements.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  KitchenSpace,
  Module,
  Project,
  ProjectKitchenLayout,
} from '@muebles/domain';
import {
  emptyKitchenLayout,
  ensureKitchenSpaces,
  isFreePlacement,
  isKitchenLayoutEmpty,
  pruneKitchenLayout,
  resolveWallFrames,
} from '@muebles/domain';
import {
  allFootprints,
  itemLabel,
  moduleDepth,
  moduleWidth,
} from '../kitchenPlanHelpers';

export type PresentationKitchenPlanSlideProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  /**
   * Controlled selected space id (multi-ambiente). When omitted, internal state
   * defaults to active space or first space with content.
   */
  readonly selectedSpaceId?: string;
  readonly onSelectedSpaceIdChange?: (spaceId: string) => void;
};

type SpacePlanModel = {
  readonly id: string;
  readonly name: string;
  readonly walls: KitchenSpace['walls'];
  readonly placements: KitchenSpace['placements'];
};

function spacesFromLayout(layout: ProjectKitchenLayout): readonly SpacePlanModel[] {
  const ensured = ensureKitchenSpaces(layout);
  const spaces = ensured.spaces ?? [];
  if (spaces.length === 0) {
    return [
      {
        id: ensured.activeSpaceId ?? 'default',
        name: 'Planta',
        walls: ensured.walls,
        placements: ensured.placements,
      },
    ];
  }
  return spaces.map((s) => ({
    id: s.id,
    name: s.name?.trim() || 'Ambiente',
    walls: s.walls,
    placements: s.placements,
  }));
}

function pickDefaultSpaceId(
  spaces: readonly SpacePlanModel[],
  preferredId: string | undefined,
): string {
  if (preferredId && spaces.some((s) => s.id === preferredId)) {
    return preferredId;
  }
  const withContent = spaces.find(
    (s) => s.walls.length > 0 || s.placements.length > 0,
  );
  return (withContent ?? spaces[0])!.id;
}

function placeholderItem(itemId: string): {
  id: string;
  moduleId: string;
  quantity: number;
  optionChoices: Record<string, string>;
} {
  return { id: itemId, moduleId: '', quantity: 1, optionChoices: {} };
}

function SpacePlanSvg({
  space,
  project,
  modules,
}: {
  readonly space: SpacePlanModel;
  readonly project: Project;
  readonly modules: readonly Module[];
}): ReactNode {
  const frames = useMemo(
    () => resolveWallFrames(space.walls),
    [space.walls],
  );

  const pad = 40;
  const scale = 0.08;
  let maxX = 100;
  let maxY = 100;
  for (const f of frames) {
    maxX = Math.max(maxX, f.originXMm, f.endXMm);
    maxY = Math.max(maxY, f.originYMm, f.endYMm);
  }
  for (const p of space.placements) {
    if (!isFreePlacement(p)) continue;
    const item =
      project.items.find((i) => i.id === p.itemId) ?? placeholderItem(p.itemId);
    const w = moduleWidth(item, modules);
    const d = moduleDepth(item, modules);
    const fx = Number.isFinite(p.freeXMm) ? (p.freeXMm as number) : 0;
    const fy = Number.isFinite(p.freeYMm) ? (p.freeYMm as number) : 0;
    maxX = Math.max(maxX, fx + w, fx);
    maxY = Math.max(maxY, fy + d, fy);
  }

  const svgW = Math.max(400, maxX * scale + pad * 2);
  const svgH = Math.max(280, maxY * scale + pad * 2);

  const hasLayout = space.walls.length > 0 || space.placements.length > 0;
  const hasPlacements = space.placements.length > 0;
  const hasFree = space.placements.some((p) => isFreePlacement(p));

  if (!hasLayout) {
    return (
      <p
        className="presentation-kitchen-plan__empty-space"
        data-testid="presentation-kitchen-space-empty"
      >
        Este ambiente aún no tiene muros ni muebles en planta.
      </p>
    );
  }

  return (
    <>
      {!hasPlacements ? (
        <p
          className="presentation-kitchen-plan__hint"
          data-testid="presentation-kitchen-no-placements"
        >
          Hay muros, pero aún no se colocaron muebles en este ambiente.
        </p>
      ) : null}
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="kitchen-plan-svg presentation-kitchen-plan__svg"
        data-testid={`presentation-kitchen-svg-${space.id}`}
      >
        {frames.map((f) => {
          const x1 = pad + f.originXMm * scale;
          const y1 = pad + f.originYMm * scale;
          const x2 = pad + f.endXMm * scale;
          const y2 = pad + f.endYMm * scale;
          return (
            <g key={f.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--text-primary)"
                strokeWidth={4}
                strokeLinecap="square"
              />
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 8}
                fontSize={11}
                fill="var(--text-muted)"
                textAnchor="middle"
              >
                {f.name} ({f.lengthMm} mm)
              </text>
            </g>
          );
        })}

        {space.placements.map((p) => {
          const item =
            project.items.find((i) => i.id === p.itemId) ??
            placeholderItem(p.itemId);
          const w = moduleWidth(item, modules);
          const d = moduleDepth(item, modules);
          const label = itemLabel(
            p.itemId,
            p.instanceIndex,
            project,
            modules,
          )
            .split('—')[0]
            ?.trim();

          if (isFreePlacement(p)) {
            const fx = Number.isFinite(p.freeXMm) ? (p.freeXMm as number) : 0;
            const fy = Number.isFinite(p.freeYMm) ? (p.freeYMm as number) : 0;
            const rw = Math.max(8, w * scale);
            const rh = Math.max(8, d * scale);
            const rx = pad + fx * scale;
            const ry = pad + fy * scale;
            return (
              <g
                key={`free-${p.itemId}#${p.instanceIndex}`}
                data-testid={`presentation-plan-free-${p.itemId}-${p.instanceIndex}`}
              >
                <rect
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill="var(--info-500)"
                  opacity={0.8}
                  rx={2}
                />
                {rw > 30 && rh > 12 ? (
                  <text
                    x={rx + rw / 2}
                    y={ry + rh / 2 + 3}
                    fontSize={8}
                    fill="white"
                    textAnchor="middle"
                    fontWeight={600}
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          }

          const wall = frames.find((f) => f.id === p.wallId);
          if (!wall) return null;
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
          } else if (angle > 225 && angle < 315) {
            rx = pad + wall.originXMm * scale - 7;
            ry = pad + (wall.originYMm - p.offsetMm - w) * scale;
            rw = 14;
            rh = Math.max(8, w * scale);
          } else if (angle >= 135 && angle <= 225) {
            rx = pad + (wall.originXMm - p.offsetMm - w) * scale;
            ry = pad + wall.originYMm * scale - 7;
          } else {
            rx = pad + (wall.originXMm + p.offsetMm) * scale;
            ry = pad + wall.originYMm * scale - 7;
          }
          return (
            <g
              key={`${p.itemId}#${p.instanceIndex}`}
              data-testid={`presentation-plan-wall-${p.itemId}-${p.instanceIndex}`}
            >
              <rect
                x={rx}
                y={ry}
                width={rw}
                height={rh}
                fill={
                  p.elevation === 'wall'
                    ? 'var(--accent-500)'
                    : 'var(--success-500)'
                }
                opacity={0.8}
              />
              {rw > 30 && rh > 12 ? (
                <text
                  x={rx + rw / 2}
                  y={ry + rh / 2 + 3}
                  fontSize={8}
                  fill="white"
                  textAnchor="middle"
                  fontWeight={600}
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {hasPlacements ? (
        <div
          className="presentation-kitchen-plan__legend"
          data-testid="presentation-kitchen-legend"
        >
          <span className="presentation-kitchen-plan__legend-item">
            <span
              className="presentation-kitchen-plan__swatch presentation-kitchen-plan__swatch--floor"
              aria-hidden
            />
            Base (piso)
          </span>
          <span className="presentation-kitchen-plan__legend-item">
            <span
              className="presentation-kitchen-plan__swatch presentation-kitchen-plan__swatch--wall"
              aria-hidden
            />
            Alacena (muro)
          </span>
          {hasFree ? (
            <span className="presentation-kitchen-plan__legend-item">
              <span
                className="presentation-kitchen-plan__swatch presentation-kitchen-plan__swatch--free"
                aria-hidden
              />
              Isla (libre)
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function countPlacedKeys(
  spaces: readonly SpacePlanModel[],
): Set<string> {
  const keys = new Set<string>();
  for (const s of spaces) {
    for (const p of s.placements) {
      keys.add(`${p.itemId}#${p.instanceIndex}`);
    }
  }
  return keys;
}

export function PresentationKitchenPlanSlide({
  project,
  modules,
  selectedSpaceId: controlledSpaceId,
  onSelectedSpaceIdChange,
}: PresentationKitchenPlanSlideProps): ReactNode {
  const layout = useMemo(() => {
    const raw = project.kitchenLayout ?? emptyKitchenLayout();
    return pruneKitchenLayout(raw, project.items);
  }, [project.kitchenLayout, project.items]);

  const spaces = useMemo(() => spacesFromLayout(layout), [layout]);

  const [internalSpaceId, setInternalSpaceId] = useState(() =>
    pickDefaultSpaceId(spaces, layout.activeSpaceId),
  );

  const isControlled = controlledSpaceId !== undefined;
  const selectedSpaceId = isControlled
    ? pickDefaultSpaceId(spaces, controlledSpaceId)
    : pickDefaultSpaceId(spaces, internalSpaceId);

  useEffect(() => {
    if (isControlled) return;
    const next = pickDefaultSpaceId(spaces, internalSpaceId);
    if (next !== internalSpaceId) setInternalSpaceId(next);
  }, [spaces, internalSpaceId, isControlled]);

  const setSelectedSpaceId = (id: string) => {
    if (!isControlled) setInternalSpaceId(id);
    onSelectedSpaceIdChange?.(id);
  };

  const selectedSpace =
    spaces.find((s) => s.id === selectedSpaceId) ?? spaces[0]!;

  const multiSpace = spaces.length > 1;
  /** Parent chrome (ProjectPresentationMode) owns ambient tabs when controlled. */
  const showLocalTabs = multiSpace && !isControlled;

  const fps = useMemo(
    () => allFootprints(project, modules),
    [project, modules],
  );
  const placedKeys = useMemo(() => countPlacedKeys(spaces), [spaces]);
  const unplacedCount = fps.filter(
    (f) => !placedKeys.has(`${f.itemId}#${f.instanceIndex}`),
  ).length;

  if (isKitchenLayoutEmpty(layout)) {
    return (
      <div
        className="presentation-kitchen-plan presentation-kitchen-plan--empty"
        data-testid="presentation-kitchen-plan"
      >
        <p className="presentation-kitchen-plan__empty">
          Sin planta definida.
        </p>
      </div>
    );
  }

  return (
    <div
      className="presentation-kitchen-plan"
      data-testid="presentation-kitchen-plan"
    >
      {showLocalTabs ? (
        <div
          className="presentation-kitchen-plan__tabs"
          role="tablist"
          aria-label="Ambientes de la planta"
          data-testid="presentation-kitchen-space-tabs"
        >
          {spaces.map((s) => {
            const active = s.id === selectedSpace.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? 'presentation-kitchen-plan__tab presentation-kitchen-plan__tab--active'
                    : 'presentation-kitchen-plan__tab'
                }
                onClick={() => setSelectedSpaceId(s.id)}
                data-testid={`presentation-kitchen-space-tab-${s.id}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <h3
        className="presentation-kitchen-plan__space-title"
        data-testid="presentation-kitchen-space-title"
      >
        {selectedSpace.name || 'Planta'}
      </h3>

      {unplacedCount > 0 ? (
        <p
          className="presentation-kitchen-plan__warn"
          data-testid="presentation-kitchen-unplaced"
        >
          {unplacedCount} unidad{unplacedCount === 1 ? '' : 'es'} de la
          cotización sin colocar en ninguna planta (no aparecen en este
          plano).
        </p>
      ) : null}

      <SpacePlanSvg
        space={selectedSpace}
        project={project}
        modules={modules}
      />
    </div>
  );
}

