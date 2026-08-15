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
import { LayoutTemplate } from 'lucide-react';
import { EmptyState } from '../../common';
import {
  allFootprints,
  getCategoryTheme,
  itemLabel,
  moduleDepth,
  moduleHeight,
  moduleWidth,
  resolvePlacement2D,
  resolvePlanBounds,
  type ResolvedPlacement2D,
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
  /** Optional: leave presentation and open Proyectar. */
  readonly onGoToProyectar?: () => void;
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

  const resolvedPlacements = useMemo(() => {
    const list: ResolvedPlacement2D[] = [];
    for (const p of space.placements) {
      const item =
        project.items.find((i) => i.id === p.itemId) ??
        placeholderItem(p.itemId);
      const mod = modules.find((m) => m.id === item.moduleId);
      const w = moduleWidth(item, modules);
      const d = moduleDepth(item, modules);
      const h = moduleHeight(item, modules);
      const label = itemLabel(p.itemId, p.instanceIndex, project, modules);
      const shortCode = mod?.code ?? label.split('—')[0]?.trim() ?? '';
      const wall = frames.find((f) => f.id === p.wallId);

      const r = resolvePlacement2D({
        placement: p,
        wallFrame: wall,
        widthMm: w,
        depthMm: d,
        heightMm: h,
        furnitureType: mod?.furnitureType,
        label,
        shortCode,
      });
      if (r) list.push(r);
    }
    return list;
  }, [space.placements, frames, project.items, modules]);

  const bounds = useMemo(
    () => resolvePlanBounds({ wallFrames: frames, placements: resolvedPlacements }),
    [frames, resolvedPlacements],
  );

  const pad = 40;
  const scale = 0.08;
  const svgW = Math.max(400, bounds.widthMm * scale + pad * 2);
  const svgH = Math.max(280, bounds.heightMm * scale + pad * 2);

  const toSvgX = (xMm: number) => pad + (xMm - bounds.minX) * scale;
  const toSvgY = (yMm: number) => pad + (yMm - bounds.minY) * scale;

  const hasLayout = space.walls.length > 0 || space.placements.length > 0;
  const hasPlacements = resolvedPlacements.length > 0;
  const hasFree = resolvedPlacements.some((p) => p.isFree);
  const hasAlto = resolvedPlacements.some((p) => p.category === 'alto');

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
      <div className="presentation-kitchen-plan__svg-wrap">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        className="kitchen-plan-svg presentation-kitchen-plan__svg"
        role="img"
        aria-label={`Planta de ${space.name}`}
        data-testid={`presentation-kitchen-svg-${space.id}`}
      >
        {frames.map((f) => {
          const x1 = toSvgX(f.originXMm);
          const y1 = toSvgY(f.originYMm);
          const x2 = toSvgX(f.endXMm);
          const y2 = toSvgY(f.endYMm);
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

        {resolvedPlacements.map((p) => {
          const rx = toSvgX(p.boxMm.minX);
          const ry = toSvgY(p.boxMm.minY);
          const rw = Math.max(8, (p.boxMm.maxX - p.boxMm.minX) * scale);
          const rh = Math.max(8, (p.boxMm.maxY - p.boxMm.minY) * scale);

          const fx1 = toSvgX(p.frontFaceMm.x1);
          const fy1 = toSvgY(p.frontFaceMm.y1);
          const fx2 = toSvgX(p.frontFaceMm.x2);
          const fy2 = toSvgY(p.frontFaceMm.y2);

          const theme = getCategoryTheme(p.category);

          const testId = p.isFree
            ? `presentation-plan-free-${p.itemId}-${p.instanceIndex}`
            : `presentation-plan-wall-${p.itemId}-${p.instanceIndex}`;

          return (
            <g
              key={`${p.itemId}#${p.instanceIndex}`}
              data-testid={testId}
              className={`presentation-kitchen-plan__module presentation-kitchen-plan__module--${p.category}`}
            >
              <title>{p.label} ({p.widthMm} × {p.depthMm} mm)</title>
              {/* Cabinet Body Rect */}
              <rect
                x={rx}
                y={ry}
                width={rw}
                height={rh}
                fill={theme.fillColor}
                stroke={theme.strokeColor}
                strokeWidth={1.5}
                strokeDasharray={theme.isDashed ? '4 2' : undefined}
                opacity={0.88}
                rx={2}
              />

              {/* Front Face / Door Opening Indicator */}
              <path
                d={`M ${fx1} ${fy1} L ${fx2} ${fy2}`}
                className="kitchen-plan__front-face"
                stroke="var(--bg-card, #ffffff)"
                strokeWidth={2.5}
                strokeLinecap="round"
                opacity={0.95}
              />

              {/* Label inside cabinet */}
              {rw > 28 && rh > 12 ? (
                <text
                  x={rx + rw / 2}
                  y={ry + rh / 2 + 3}
                  fontSize={rw > 45 ? 9 : 7.5}
                  fill="white"
                  textAnchor="middle"
                  fontWeight={600}
                  pointerEvents="none"
                >
                  {p.shortCode || p.label.split('—')[0]?.trim()}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      </div>

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
          <span className="presentation-kitchen-plan__legend-item">
            <span
              className="presentation-kitchen-plan__swatch presentation-kitchen-plan__swatch--alto"
              aria-hidden
            />
            Despensa (alto)
          </span>
          <span className="presentation-kitchen-plan__legend-item">
            <span
              className="presentation-kitchen-plan__swatch presentation-kitchen-plan__swatch--free"
              aria-hidden
            />
            Isla (libre)
          </span>
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
  onGoToProyectar,
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
        <EmptyState
          icon={LayoutTemplate}
          title="Sin planta definida"
          description="Definí muros y ubicá los muebles en Proyectar para mostrar la planta al cliente."
          actionLabel={onGoToProyectar ? 'Ir a Proyectar' : undefined}
          onAction={onGoToProyectar}
        />
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

