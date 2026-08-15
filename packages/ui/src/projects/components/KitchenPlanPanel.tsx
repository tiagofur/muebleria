/**
 * Simple kitchen plan editor (#133): walls + place/reorder quote modules.
 */

import {
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  Module,
  Project,
  ProjectKitchenLayout,
  ProjectItemPlacement,
  KitchenWall,
} from '@muebles/domain';
import {
  createDefaultLWalls,
  emptyKitchenLayout,
  kitchenLayoutWarnings,
  nextOffsetOnWall,
  pruneKitchenLayout,
  reorderPlacementOnWall,
  resolveWallFrames,
} from '@muebles/domain';
import type { PlacementElevation } from '@muebles/domain';
import { Lock } from 'lucide-react';
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
import './kitchenPlan.css';

function defaultElevationForModule(
  module: Module | undefined,
): PlacementElevation {
  const t = module?.furnitureType;
  if (t === 'superior' || t === 'alto') return 'wall';
  return 'floor';
}

export type KitchenPlanPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly canEdit: boolean;
  readonly onChange: (layout: ProjectKitchenLayout) => void;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function KitchenPlanPanel({
  project,
  modules,
  canEdit,
  onChange,
}: KitchenPlanPanelProps): ReactNode {
  const layout = useMemo(
    () => pruneKitchenLayout(project.kitchenLayout ?? emptyKitchenLayout(), project.items),
    [project.kitchenLayout, project.items],
  );
  const footprints = useMemo(
    () => allFootprints(project, modules),
    [project, modules],
  );
  const frames = useMemo(() => resolveWallFrames(layout.walls), [layout.walls]);
  const warnings = useMemo(
    () => kitchenLayoutWarnings(layout, project.items, footprints),
    [layout, project.items, footprints],
  );

  const placedKeys = new Set(
    layout.placements.map((p) => `${p.itemId}#${p.instanceIndex}`),
  );
  const unplaced = footprints.filter(
    (f) => !placedKeys.has(`${f.itemId}#${f.instanceIndex}`),
  );

  const commit = (next: ProjectKitchenLayout) => {
    onChange(pruneKitchenLayout(next, project.items));
  };

  const ensureLayout = (): ProjectKitchenLayout =>
    layout.walls.length > 0 ? layout : emptyKitchenLayout();

  const addDefaultL = () => {
    commit({
      walls: createDefaultLWalls(newId),
      placements: layout.placements,
    });
  };

  const addWall = () => {
    const base = ensureLayout();
    const wall: KitchenWall = {
      id: newId(),
      name: `Muro ${base.walls.length + 1}`,
      lengthMm: 3000,
      angleDeg: base.walls.length === 0 ? 0 : 90,
    };
    commit({ ...base, walls: [...base.walls, wall] });
  };

  const updateWall = (id: string, patch: Partial<KitchenWall>) => {
    commit({
      ...layout,
      walls: layout.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    });
  };

  const removeWall = (id: string) => {
    commit({
      walls: layout.walls.filter((w) => w.id !== id),
      placements: layout.placements.filter((p) => p.wallId !== id),
    });
  };

  const placeOnWall = (
    itemId: string,
    instanceIndex: number,
    wallId: string,
  ) => {
    const base = ensureLayout();
    const offset = nextOffsetOnWall(base, wallId, footprints, 20);
    const item = project.items.find((it) => it.id === itemId);
    const mod = item
      ? modules.find((m) => m.id === item.moduleId)
      : undefined;
    const placement: ProjectItemPlacement = {
      itemId,
      instanceIndex,
      wallId,
      offsetMm: offset,
      elevation: defaultElevationForModule(mod),
    };
    commit({
      ...base,
      placements: [...base.placements, placement],
    });
  };

  const removePlacement = (itemId: string, instanceIndex: number) => {
    commit({
      ...layout,
      placements: layout.placements.filter(
        (p) => !(p.itemId === itemId && p.instanceIndex === instanceIndex),
      ),
    });
  };

  const updatePlacement = (
    itemId: string,
    instanceIndex: number,
    patch: Partial<ProjectItemPlacement>,
  ) => {
    commit({
      ...layout,
      placements: layout.placements.map((p) =>
        p.itemId === itemId && p.instanceIndex === instanceIndex
          ? { ...p, ...patch }
          : p,
      ),
    });
  };

  const movePlacement = (
    itemId: string,
    instanceIndex: number,
    dir: -1 | 1,
  ) => {
    commit(
      reorderPlacementOnWall(
        layout,
        itemId,
        instanceIndex,
        dir,
        footprints,
        20,
      ),
    );
  };

  // Resolved 2D placements with exact workshop millimeter coordinates
  const resolvedPlacements = useMemo(() => {
    const list: ResolvedPlacement2D[] = [];
    for (const p of layout.placements) {
      const item = project.items.find((i) => i.id === p.itemId) ?? {
        id: p.itemId,
        moduleId: '',
        quantity: 1,
        optionChoices: {},
      };
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
  }, [layout.placements, frames, project.items, modules]);

  const bounds = useMemo(
    () => resolvePlanBounds({ wallFrames: frames, placements: resolvedPlacements }),
    [frames, resolvedPlacements],
  );

  // SVG plan scale
  const pad = 40;
  const scale = 0.08;
  const svgW = Math.max(360, bounds.widthMm * scale + pad * 2);
  const svgH = Math.max(240, bounds.heightMm * scale + pad * 2);

  const toSvgX = (xMm: number) => pad + (xMm - bounds.minX) * scale;
  const toSvgY = (yMm: number) => pad + (yMm - bounds.minY) * scale;

  const hasAlto = resolvedPlacements.some((p) => p.category === 'alto');
  const hasFree = resolvedPlacements.some((p) => p.isFree);

  // --- Drag state for placements (Fase 2) ---
  const dragRef = useRef<{
    itemId: string;
    instanceIndex: number;
    wallId: string;
    startPx: number;
    startPy: number;
    origOffset: number;
    wallAngleDeg: number;
    wallLength: number;
    itemWidth: number;
  } | null>(null);

  const handlePlacementPointerDown = useCallback(
    (
      e: ReactPointerEvent<SVGRectElement>,
      p: ProjectItemPlacement,
    ) => {
      if (!canEdit) return;
      e.stopPropagation();
      const wall = frames.find((f) => f.id === p.wallId);
      if (!wall) return;
      const w = moduleWidth(
        project.items.find((i) => i.id === p.itemId) ?? {
          id: p.itemId,
          moduleId: '',
          quantity: 1,
          optionChoices: {},
        },
        modules,
      );
      dragRef.current = {
        itemId: p.itemId,
        instanceIndex: p.instanceIndex,
        wallId: p.wallId,
        startPx: e.clientX,
        startPy: e.clientY,
        origOffset: p.offsetMm,
        wallAngleDeg: wall.angleDeg,
        wallLength: wall.lengthMm,
        itemWidth: w,
      };
      (e.target as SVGRectElement).setPointerCapture(e.pointerId);
    },
    [canEdit, frames, project.items, modules],
  );

  const handlePlacementPointerMove = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      let deltaMm = 0;
      const angle = ((drag.wallAngleDeg % 360) + 360) % 360;
      if (angle > 45 && angle < 135) {
        // Wall along +Y (downwards)
        deltaMm = (e.clientY - drag.startPy) / scale;
      } else if (angle > 225 && angle < 315) {
        // Wall along -Y (upwards)
        deltaMm = -(e.clientY - drag.startPy) / scale;
      } else if (angle >= 135 && angle <= 225) {
        // Wall along -X (leftwards)
        deltaMm = -(e.clientX - drag.startPx) / scale;
      } else {
        // Wall along +X (rightwards)
        deltaMm = (e.clientX - drag.startPx) / scale;
      }

      let newOffset = drag.origOffset + deltaMm;
      // Clamp: 0 ≤ offset ≤ wallLength - itemWidth.
      newOffset = Math.max(0, Math.min(newOffset, drag.wallLength - drag.itemWidth));
      newOffset = Math.round(newOffset);

      // Snap to peer placement edges (other items on the same wall).
      const SNAP_THRESHOLD_MM = 15;
      const peerEdges: number[] = [0, drag.wallLength]; // wall start + end
      for (const p of layout.placements) {
        if (p.wallId !== drag.wallId) continue;
        if (p.itemId === drag.itemId && p.instanceIndex === drag.instanceIndex) continue;
        const peerW = moduleWidth(
          project.items.find((i) => i.id === p.itemId) ?? {
            id: p.itemId,
            moduleId: '',
            quantity: 1,
            optionChoices: {},
          },
          modules,
        );
        peerEdges.push(p.offsetMm);            // left edge of peer
        peerEdges.push(p.offsetMm + peerW);    // right edge of peer
      }
      // Check left edge of dragged item.
      for (const edge of peerEdges) {
        if (Math.abs(newOffset - edge) <= SNAP_THRESHOLD_MM) {
          newOffset = edge;
          break;
        }
        // Check right edge of dragged item aligning to peer edge.
        if (Math.abs(newOffset + drag.itemWidth - edge) <= SNAP_THRESHOLD_MM) {
          newOffset = edge - drag.itemWidth;
          break;
        }
      }
      // Re-clamp after snap.
      newOffset = Math.max(0, Math.min(newOffset, drag.wallLength - drag.itemWidth));

      updatePlacement(drag.itemId, drag.instanceIndex, { offsetMm: newOffset });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout.placements, project.items, modules],
  );

  const handlePlacementPointerUp = useCallback(
    (e: ReactPointerEvent<SVGRectElement>) => {
      dragRef.current = null;
      try {
        (e.target as SVGRectElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [],
  );

  return (
    <div
      className="project-detail__section"
      data-testid="kitchen-plan-panel"
    >
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">Plano de cocina</h3>
        {!canEdit && project.status !== 'draft' ? (
          <span
            className="kitchen-plan__frozen-note"
            title="El plano se congela al enviar la cotización para preservar el diseño aprobado. Reabrí a borrador si necesitás editarlo."
            data-testid="kitchen-plan-frozen-note"
          >
            <Lock size={13} strokeWidth={1.5} aria-hidden />
            Plano congelado
          </span>
        ) : null}
        {canEdit ? (
          <div className="kitchen-plan__actions">
            {layout.walls.length === 0 ? (
              <button
                type="button"
                className="btn btn--small"
                onClick={addDefaultL}
                data-testid="kitchen-plan-add-l"
              >
                Crear L (2 muros)
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--small"
              onClick={addWall}
              data-testid="kitchen-plan-add-wall"
            >
              Añadir muro
            </button>
          </div>
        ) : null}
      </div>

      <p className="catalog-form__hint">
        Dibujá muros simples y colocá los muebles de la cotización en la cara interna del muro. La vista 3D
        usa este plano si hay colocaciones; si no, usa la corrida lineal.
      </p>

      {layout.walls.length === 0 ? (
        <p className="project-detail__empty" data-testid="kitchen-plan-empty">
          Sin plano todavía. Creá un L de 2 muros o añadí muros a mano.
        </p>
      ) : (
        <>
          <svg
            width={svgW}
            height={svgH}
            viewBox={`0 0 ${svgW} ${svgH}`}
            className="kitchen-plan-svg kitchen-plan__svg"
            data-testid="kitchen-plan-svg"
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
              const rawPlacement = layout.placements.find(
                (lp) => lp.itemId === p.itemId && lp.instanceIndex === p.instanceIndex,
              );
              const rx = toSvgX(p.boxMm.minX);
              const ry = toSvgY(p.boxMm.minY);
              const rw = Math.max(8, (p.boxMm.maxX - p.boxMm.minX) * scale);
              const rh = Math.max(8, (p.boxMm.maxY - p.boxMm.minY) * scale);

              const fx1 = toSvgX(p.frontFaceMm.x1);
              const fy1 = toSvgY(p.frontFaceMm.y1);
              const fx2 = toSvgX(p.frontFaceMm.x2);
              const fy2 = toSvgY(p.frontFaceMm.y2);

              const theme = getCategoryTheme(p.category);

              return (
                <g
                  key={`${p.itemId}#${p.instanceIndex}`}
                  className="kitchen-plan__module-group"
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
                    data-testid={`kitchen-plan-box-${p.itemId}-${p.instanceIndex}`}
                    onPointerDown={
                      canEdit && rawPlacement && !p.isFree
                        ? (e) => handlePlacementPointerDown(e, rawPlacement)
                        : undefined
                    }
                    onPointerMove={handlePlacementPointerMove}
                    onPointerUp={handlePlacementPointerUp}
                    className={`kitchen-plan__box ${canEdit && !p.isFree ? 'kitchen-plan__box--draggable' : ''}`.trim()}
                  />

                  {/* Front Face / Door Opening Indicator */}
                  <path
                    d={`M ${fx1} ${fy1} L ${fx2} ${fy2}`}
                    className="kitchen-plan__front-face"
                    stroke="var(--bg-card, #ffffff)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    opacity={0.95}
                    pointerEvents="none"
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

          {resolvedPlacements.length > 0 ? (
            <div
              className="kitchen-plan__legend"
              data-testid="kitchen-plan-legend"
            >
              <span className="kitchen-plan__legend-item">
                <span
                  className="kitchen-plan__swatch kitchen-plan__swatch--floor"
                  aria-hidden
                />
                Base (piso)
              </span>
              <span className="kitchen-plan__legend-item">
                <span
                  className="kitchen-plan__swatch kitchen-plan__swatch--wall"
                  aria-hidden
                />
                Alacena (muro)
              </span>
              <span className="kitchen-plan__legend-item">
                <span
                  className="kitchen-plan__swatch kitchen-plan__swatch--alto"
                  aria-hidden
                />
                Despensa (alto)
              </span>
              <span className="kitchen-plan__legend-item">
                <span
                  className="kitchen-plan__swatch kitchen-plan__swatch--free"
                  aria-hidden
                />
                Isla (libre)
              </span>
            </div>
          ) : null}

          <div className="module-editor__grid kitchen-plan__walls">
            {layout.walls.map((wall, wi) => (
              <div
                key={wall.id}
                className="catalog-form__field"
                data-testid={`kitchen-wall-${wall.id}`}
              >
                <label htmlFor={`kw-name-${wall.id}`}>
                  {wall.name ?? `Muro ${wi + 1}`}
                </label>
                {canEdit ? (
                  <>
                    <input
                      id={`kw-name-${wall.id}`}
                      value={wall.name ?? ''}
                      onChange={(e) =>
                        updateWall(wall.id, { name: e.target.value })
                      }
                      placeholder="Nombre"
                    />
                    <div className="kitchen-wall__controls">
                      <input
                        type="number"
                        value={wall.lengthMm}
                        onChange={(e) =>
                          updateWall(wall.id, {
                            lengthMm: Number(e.target.value) || 1,
                          })
                        }
                        aria-label="Largo mm"
                        className="kitchen-wall__length"
                      />
                      <select
                        value={wall.angleDeg}
                        onChange={(e) =>
                          updateWall(wall.id, {
                            angleDeg: Number(e.target.value),
                          })
                        }
                        aria-label="Ángulo"
                      >
                        <option value={0}>0° (+X)</option>
                        <option value={90}>90° (+Y)</option>
                        <option value={180}>180° (−X)</option>
                        <option value={270}>270° (−Y)</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => removeWall(wall.id)}
                      >
                        Quitar
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="catalog-form__hint">
                    {wall.lengthMm} mm · {wall.angleDeg}°
                  </p>
                )}
                <ul
                  className="kitchen-wall__placements"
                >
                  {layout.placements
                    .filter((p) => p.wallId === wall.id)
                    .sort((a, b) => a.offsetMm - b.offsetMm)
                    .map((p) => (
                      <li
                        key={`${p.itemId}#${p.instanceIndex}`}
                        className="kitchen-placed__item"
                        data-testid={`kitchen-placed-${p.itemId}-${p.instanceIndex}`}
                      >
                        <span className="kitchen-placed__label">
                          {itemLabel(p.itemId, p.instanceIndex, project, modules)}
                        </span>
                        {canEdit ? (
                          <>
                            <input
                              type="number"
                              value={p.offsetMm}
                              onChange={(e) =>
                                updatePlacement(p.itemId, p.instanceIndex, {
                                  offsetMm: Number(e.target.value) || 0,
                                })
                              }
                              aria-label="Offset mm"
                              className="kitchen-placed__offset"
                            />
                            <select
                              value={p.elevation}
                              onChange={(e) =>
                                updatePlacement(p.itemId, p.instanceIndex, {
                                  elevation:
                                    e.target.value === 'wall'
                                      ? 'wall'
                                      : 'floor',
                                })
                              }
                              aria-label="Elevación"
                            >
                              <option value="floor">Piso</option>
                              <option value="wall">Muro</option>
                            </select>
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() =>
                                movePlacement(p.itemId, p.instanceIndex, -1)
                              }
                              aria-label="Mover antes"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() =>
                                movePlacement(p.itemId, p.instanceIndex, 1)
                              }
                              aria-label="Mover después"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() =>
                                removePlacement(p.itemId, p.instanceIndex)
                              }
                            >
                              Quitar
                            </button>
                          </>
                        ) : (
                          <span className="catalog-form__hint">
                            offset {p.offsetMm} · {p.elevation}
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>

          {canEdit && unplaced.length > 0 ? (
            <div className="kitchen-plan__unplaced" data-testid="kitchen-unplaced">
              <h4 className="project-detail__section-title">Sin colocar</h4>
              <ul className="kitchen-plan__unplaced-list">
                {unplaced.map((f) => (
                  <li
                    key={`${f.itemId}#${f.instanceIndex}`}
                    className="kitchen-unplaced__item"
                  >
                    <span className="kitchen-unplaced__label">
                      {itemLabel(f.itemId, f.instanceIndex, project, modules)}
                    </span>
                    {layout.walls.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className="btn btn--small"
                        onClick={() =>
                          placeOnWall(f.itemId, f.instanceIndex, w.id)
                        }
                      >
                        → {w.name ?? 'Muro'}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {warnings.length > 0 ? (
        <ul
          className="catalog-form__error kitchen-plan__warnings"
          data-testid="kitchen-plan-warnings"
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
