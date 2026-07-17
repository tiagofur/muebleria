/**
 * Simple kitchen plan editor (#133): walls + place/reorder quote modules.
 */

import { useMemo, type ReactNode } from 'react';
import type {
  Module,
  Project,
  ProjectItem,
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
  resolveWallFrames,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveModuleMeasurePreset,
} from '@muebles/domain';

export type KitchenPlanPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly canEdit: boolean;
  readonly onChange: (layout: ProjectKitchenLayout) => void;
};

function moduleWidth(
  item: ProjectItem,
  modules: readonly Module[],
): number {
  const mod = modules.find((m) => m.id === item.moduleId);
  if (!mod) return 600;
  try {
    const preset = resolveModuleMeasurePreset(
      mod,
      item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
    );
    if (preset) return preset.width;
  } catch {
    /* fall through */
  }
  return mod.externalDims?.width ?? 600;
}

function allFootprints(
  project: Project,
  modules: readonly Module[],
): {
  itemId: string;
  instanceIndex: number;
  width: number;
  height: number;
  depth: number;
}[] {
  const out: {
    itemId: string;
    instanceIndex: number;
    width: number;
    height: number;
    depth: number;
  }[] = [];
  for (const item of project.items) {
    const mod = modules.find((m) => m.id === item.moduleId);
    let w = 600;
    let h = 720;
    let d = 560;
    if (mod) {
      try {
        const preset = resolveModuleMeasurePreset(
          mod,
          item.measurePresetId?.trim() ||
            defaultMeasurePresetId(mod) ||
            undefined,
        );
        if (preset) {
          w = preset.width;
          h = preset.height;
          d = preset.depth;
        } else if (mod.externalDims) {
          w = mod.externalDims.width;
          h = mod.externalDims.height;
          d = mod.externalDims.depth;
        }
      } catch {
        if (mod.externalDims) {
          w = mod.externalDims.width;
          h = mod.externalDims.height;
          d = mod.externalDims.depth;
        }
      }
    }
    const qty = Math.max(1, item.quantity);
    for (let i = 0; i < qty; i++) {
      out.push({ itemId: item.id, instanceIndex: i, width: w, height: h, depth: d });
    }
  }
  return out;
}

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
    const placement: ProjectItemPlacement = {
      itemId,
      instanceIndex,
      wallId,
      offsetMm: offset,
      elevation: 'floor',
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
    const wallId = layout.placements.find(
      (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
    )?.wallId;
    if (!wallId) return;
    const onWall = layout.placements
      .filter((p) => p.wallId === wallId)
      .sort((a, b) => a.offsetMm - b.offsetMm);
    const idx = onWall.findIndex(
      (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
    );
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= onWall.length) return;
    const a = onWall[idx]!;
    const b = onWall[j]!;
    // swap offsets
    commit({
      ...layout,
      placements: layout.placements.map((p) => {
        if (p.itemId === a.itemId && p.instanceIndex === a.instanceIndex) {
          return { ...p, offsetMm: b.offsetMm };
        }
        if (p.itemId === b.itemId && p.instanceIndex === b.instanceIndex) {
          return { ...p, offsetMm: a.offsetMm };
        }
        return p;
      }),
    });
  };

  const itemLabel = (itemId: string, instanceIndex: number): string => {
    const item = project.items.find((i) => i.id === itemId);
    const mod = modules.find((m) => m.id === item?.moduleId);
    const base = mod ? `${mod.code} — ${mod.name}` : itemId;
    const qty = item?.quantity ?? 1;
    return qty > 1 ? `${base} (copia ${instanceIndex + 1})` : base;
  };

  // SVG plan scale
  const pad = 40;
  const scale = 0.08;
  let maxX = 100;
  let maxY = 100;
  for (const f of frames) {
    maxX = Math.max(maxX, f.originXMm, f.endXMm);
    maxY = Math.max(maxY, f.originYMm, f.endYMm);
  }
  const svgW = Math.max(320, maxX * scale + pad * 2);
  const svgH = Math.max(220, maxY * scale + pad * 2);

  return (
    <div
      className="project-detail__section"
      data-testid="kitchen-plan-panel"
    >
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">Plano de cocina</h3>
        {canEdit ? (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {layout.walls.length === 0 ? (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={addDefaultL}
                data-testid="kitchen-plan-add-l"
              >
                Crear L (2 muros)
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={addWall}
              data-testid="kitchen-plan-add-wall"
            >
              Añadir muro
            </button>
          </div>
        ) : null}
      </div>

      <p className="catalog-form__hint" style={{ marginTop: 0 }}>
        Dibujá muros simples y colocá los muebles de la cotización. La vista 3D
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
            className="kitchen-plan-svg"
            data-testid="kitchen-plan-svg"
            style={{
              maxWidth: '100%',
              background: 'var(--surface-2, #f4f4f5)',
              borderRadius: 8,
              border: '1px solid var(--border, #e4e4e7)',
            }}
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
                    stroke="var(--text, #18181b)"
                    strokeWidth={4}
                    strokeLinecap="square"
                  />
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 8}
                    fontSize={11}
                    fill="var(--text-muted, #71717a)"
                    textAnchor="middle"
                  >
                    {f.name} ({f.lengthMm} mm)
                  </text>
                </g>
              );
            })}
            {layout.placements.map((p) => {
              const wall = frames.find((f) => f.id === p.wallId);
              if (!wall) return null;
              const w = moduleWidth(
                project.items.find((i) => i.id === p.itemId) ?? {
                  id: p.itemId,
                  moduleId: '',
                  quantity: 1,
                  optionChoices: {},
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
                <rect
                  key={`${p.itemId}#${p.instanceIndex}`}
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill={
                    p.elevation === 'wall'
                      ? 'var(--accent, #2563eb)'
                      : 'var(--success, #16a34a)'
                  }
                  opacity={0.75}
                  data-testid={`kitchen-plan-box-${p.itemId}-${p.instanceIndex}`}
                />
              );
            })}
          </svg>

          <div className="module-editor__grid" style={{ marginTop: '1rem' }}>
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
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: 6 }}>
                      <input
                        type="number"
                        value={wall.lengthMm}
                        onChange={(e) =>
                          updateWall(wall.id, {
                            lengthMm: Number(e.target.value) || 1,
                          })
                        }
                        aria-label="Largo mm"
                        style={{ width: 100 }}
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
                        className="btn btn--ghost btn--sm"
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
                  style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}
                >
                  {layout.placements
                    .filter((p) => p.wallId === wall.id)
                    .sort((a, b) => a.offsetMm - b.offsetMm)
                    .map((p) => (
                      <li
                        key={`${p.itemId}#${p.instanceIndex}`}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.35rem',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                        data-testid={`kitchen-placed-${p.itemId}-${p.instanceIndex}`}
                      >
                        <span style={{ flex: '1 1 140px' }}>
                          {itemLabel(p.itemId, p.instanceIndex)}
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
                              style={{ width: 72 }}
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
                              className="btn btn--ghost btn--sm"
                              onClick={() =>
                                movePlacement(p.itemId, p.instanceIndex, -1)
                              }
                              aria-label="Mover antes"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() =>
                                movePlacement(p.itemId, p.instanceIndex, 1)
                              }
                              aria-label="Mover después"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
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
            <div style={{ marginTop: '1rem' }} data-testid="kitchen-unplaced">
              <h4 className="project-detail__section-title">Sin colocar</h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {unplaced.map((f) => (
                  <li
                    key={`${f.itemId}#${f.instanceIndex}`}
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      {itemLabel(f.itemId, f.instanceIndex)}
                    </span>
                    {layout.walls.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        className="btn btn--secondary btn--sm"
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
          className="catalog-form__error"
          data-testid="kitchen-plan-warnings"
          style={{ marginTop: '0.75rem' }}
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
