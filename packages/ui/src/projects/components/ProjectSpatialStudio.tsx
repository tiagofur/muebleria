/**
 * Project spatial studio (“Proyectar”) — place & move quote units on walls in 3D.
 * Phase A: walls + place/select/move offset/elevation. Measures/pricing later.
 */

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  Module,
  PlacementElevation,
  Project,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from '@muebles/domain';
import {
  createDefaultLWalls,
  emptyKitchenLayout,
  kitchenLayoutWarnings,
  nextOffsetOnWall,
  pruneKitchenLayout,
  reorderPlacementOnWall,
} from '@muebles/domain';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Lock,
  X,
} from 'lucide-react';
import {
  canUseWebGL,
  materialColorMap,
  materialTextureMap,
  DEFAULT_MATERIAL_SURFACE_MODE,
} from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';
import { allFootprints, itemLabel, moduleWidth } from '../kitchenPlanHelpers';
import './projectSpatialStudio.css';

const FurnitureScene3D = lazy(() =>
  import('../../preview3d').then((m) => ({ default: m.FurnitureScene3D })),
);

export type ProjectSpatialStudioProps = {
  readonly open: boolean;
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly catalog: Module3DCatalogInput;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  readonly onChangeLayout: (layout: ProjectKitchenLayout) => void;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultElevationForModule(
  module: Module | undefined,
): PlacementElevation {
  const t = module?.furnitureType;
  if (t === 'superior' || t === 'alto') return 'wall';
  return 'floor';
}

export function ProjectSpatialStudio({
  open,
  project,
  modules,
  catalog,
  canEdit,
  onClose,
  onChangeLayout,
  resolveMediaUrl,
}: ProjectSpatialStudioProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [targetWallId, setTargetWallId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUseR3f(canUseWebGL());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const layout = useMemo(
    () =>
      pruneKitchenLayout(
        project.kitchenLayout ?? emptyKitchenLayout(),
        project.items,
      ),
    [project.kitchenLayout, project.items],
  );

  const footprints = useMemo(
    () => allFootprints(project, modules),
    [project, modules],
  );

  const placedKeys = useMemo(
    () =>
      new Set(
        layout.placements.map((p) => `${p.itemId}#${p.instanceIndex}`),
      ),
    [layout.placements],
  );

  const unplaced = useMemo(
    () =>
      footprints.filter(
        (f) => !placedKeys.has(`${f.itemId}#${f.instanceIndex}`),
      ),
    [footprints, placedKeys],
  );

  const warnings = useMemo(
    () => kitchenLayoutWarnings(layout, project.items, footprints),
    [layout, project.items, footprints],
  );

  const activeWallId =
    targetWallId && layout.walls.some((w) => w.id === targetWallId)
      ? targetWallId
      : (layout.walls[0]?.id ?? null);

  const preview = useMemo(
    () =>
      resolveProject3DPreview(project, catalog, {
        unplacedPolicy: 'hide',
        kitchenWallsOnly: true,
      }),
    [project, catalog],
  );

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );

  const selectedPlacement = useMemo(() => {
    if (!selectedKey) return null;
    const hash = selectedKey.lastIndexOf('#');
    if (hash < 0) return null;
    const itemId = selectedKey.slice(0, hash);
    const instanceIndex = Number(selectedKey.slice(hash + 1)) || 0;
    return (
      layout.placements.find(
        (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
      ) ?? null
    );
  }, [selectedKey, layout.placements]);

  if (!open) return null;

  const commit = (next: ProjectKitchenLayout) => {
    onChangeLayout(pruneKitchenLayout(next, project.items));
  };

  const ensureWalls = (): ProjectKitchenLayout => {
    if (layout.walls.length > 0) return layout;
    return {
      walls: createDefaultLWalls(newId),
      placements: layout.placements,
    };
  };

  const createL = () => {
    if (!canEdit) return;
    commit({
      walls: createDefaultLWalls(newId),
      placements: layout.placements,
    });
  };

  const placeOnWall = (itemId: string, instanceIndex: number, wallId: string) => {
    if (!canEdit) return;
    const base = ensureWalls();
    const wall =
      base.walls.find((w) => w.id === wallId) ?? base.walls[0];
    if (!wall) return;
    const offset = nextOffsetOnWall(base, wall.id, footprints, 20);
    const item = project.items.find((it) => it.id === itemId);
    const mod = item
      ? modules.find((m) => m.id === item.moduleId)
      : undefined;
    const placement: ProjectItemPlacement = {
      itemId,
      instanceIndex,
      wallId: wall.id,
      offsetMm: offset,
      elevation: defaultElevationForModule(mod),
    };
    commit({
      ...base,
      placements: [...base.placements, placement],
    });
    setSelectedKey(`${itemId}#${instanceIndex}`);
    setTargetWallId(wall.id);
  };

  const removePlacement = (itemId: string, instanceIndex: number) => {
    if (!canEdit) return;
    commit({
      ...layout,
      placements: layout.placements.filter(
        (p) => !(p.itemId === itemId && p.instanceIndex === instanceIndex),
      ),
    });
    if (selectedKey === `${itemId}#${instanceIndex}`) setSelectedKey(null);
  };

  const patchPlacement = (
    itemId: string,
    instanceIndex: number,
    patch: Partial<ProjectItemPlacement>,
  ) => {
    if (!canEdit) return;
    commit({
      ...layout,
      placements: layout.placements.map((p) =>
        p.itemId === itemId && p.instanceIndex === instanceIndex
          ? { ...p, ...patch }
          : p,
      ),
    });
  };

  const nudgeOffset = (delta: number) => {
    if (!canEdit || !selectedPlacement) return;
    const wall = layout.walls.find((w) => w.id === selectedPlacement.wallId);
    const w = moduleWidth(
      project.items.find((i) => i.id === selectedPlacement.itemId) ?? {
        id: selectedPlacement.itemId,
        moduleId: '',
        quantity: 1,
        optionChoices: {},
      },
      modules,
    );
    const maxOff = Math.max(0, (wall?.lengthMm ?? 3000) - w);
    const next = Math.max(
      0,
      Math.min(maxOff, Math.round(selectedPlacement.offsetMm + delta)),
    );
    patchPlacement(selectedPlacement.itemId, selectedPlacement.instanceIndex, {
      offsetMm: next,
    });
  };

  const moveAlongWall = (dir: -1 | 1) => {
    if (!canEdit || !selectedPlacement) return;
    commit(
      reorderPlacementOnWall(
        layout,
        selectedPlacement.itemId,
        selectedPlacement.instanceIndex,
        dir,
        footprints,
        20,
      ),
    );
  };

  const sceneModules = preview.modules.map((m) => ({
    key: m.instanceKey,
    parts: m.parts,
    width: m.width,
    height: m.height,
    depth: m.depth,
    originX: m.originX,
    originY: m.originY,
    originZ: m.originZ,
    yawDeg: m.yawDeg,
    showOuterGhost: true,
  }));

  const sceneWalls = preview.walls.map((w) => ({
    id: w.id,
    originXMm: w.originXMm,
    originYMm: w.originYMm,
    endXMm: w.endXMm,
    endYMm: w.endYMm,
    heightMm: 2400,
  }));

  return (
    <div
      className="spatial-studio"
      role="dialog"
      aria-modal="true"
      aria-label="Proyectar — diseño espacial"
      data-testid="project-spatial-studio"
    >
      <header className="spatial-studio__chrome">
        <div className="spatial-studio__chrome-lead">
          <Box size={18} strokeWidth={1.5} aria-hidden />
          <div>
            <h2 className="spatial-studio__title">Proyectar</h2>
            <p className="spatial-studio__subtitle">{project.name}</p>
          </div>
        </div>
        <div className="spatial-studio__chrome-actions">
          {!canEdit ? (
            <span className="spatial-studio__frozen" data-testid="spatial-studio-frozen">
              <Lock size={14} strokeWidth={1.5} aria-hidden /> Plano congelado
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            data-testid="spatial-studio-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden /> Cerrar
          </button>
        </div>
      </header>

      <div className="spatial-studio__body">
        <aside className="spatial-studio__sidebar" data-testid="spatial-studio-sidebar">
          <section className="spatial-studio__section">
            <h3 className="spatial-studio__section-title">Ambiente</h3>
            {layout.walls.length === 0 ? (
              <div className="spatial-studio__empty-walls">
                <p className="spatial-studio__hint">
                  Todavía no hay muros. Creá una L para empezar a colocar.
                </p>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    onClick={createL}
                    data-testid="spatial-studio-create-l"
                  >
                    Crear cocina en L
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="spatial-studio__wall-list">
                {layout.walls.map((w, i) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className={
                        activeWallId === w.id
                          ? 'spatial-studio__wall-btn spatial-studio__wall-btn--active'
                          : 'spatial-studio__wall-btn'
                      }
                      onClick={() => setTargetWallId(w.id)}
                      data-testid={`spatial-studio-wall-${w.id}`}
                    >
                      {w.name?.trim() || `Muro ${i + 1}`} · {w.lengthMm} mm
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="spatial-studio__section">
            <h3 className="spatial-studio__section-title">
              Sin colocar ({unplaced.length})
            </h3>
            {unplaced.length === 0 ? (
              <p className="spatial-studio__hint">Todos los muebles están en el plano.</p>
            ) : (
              <ul className="spatial-studio__item-list">
                {unplaced.map((f) => (
                  <li key={`${f.itemId}#${f.instanceIndex}`}>
                    <div className="spatial-studio__item-row">
                      <span className="spatial-studio__item-label">
                        {itemLabel(f.itemId, f.instanceIndex, project, modules)}
                      </span>
                      {canEdit && activeWallId ? (
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          onClick={() =>
                            placeOnWall(f.itemId, f.instanceIndex, activeWallId)
                          }
                          data-testid={`spatial-studio-place-${f.itemId}-${f.instanceIndex}`}
                        >
                          Colocar
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="spatial-studio__section">
            <h3 className="spatial-studio__section-title">
              En el plano ({layout.placements.length})
            </h3>
            {layout.placements.length === 0 ? (
              <p className="spatial-studio__hint">
                Colocá unidades desde la lista. Se anclan al muro activo.
              </p>
            ) : (
              <ul className="spatial-studio__item-list">
                {layout.placements.map((p) => {
                  const key = `${p.itemId}#${p.instanceIndex}`;
                  const active = selectedKey === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={
                          active
                            ? 'spatial-studio__item-btn spatial-studio__item-btn--active'
                            : 'spatial-studio__item-btn'
                        }
                        onClick={() => setSelectedKey(key)}
                        data-testid={`spatial-studio-placed-${p.itemId}-${p.instanceIndex}`}
                      >
                        {itemLabel(p.itemId, p.instanceIndex, project, modules)}
                        <span className="spatial-studio__item-meta">
                          {p.elevation === 'wall' ? 'Alto' : 'Piso'} ·{' '}
                          {Math.round(p.offsetMm)} mm
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {warnings.length > 0 ? (
            <section className="spatial-studio__section">
              <h3 className="spatial-studio__section-title">Avisos</h3>
              <ul className="spatial-studio__warnings" data-testid="spatial-studio-warnings">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>

        <main className="spatial-studio__viewport" data-testid="spatial-studio-viewport">
          {useR3f ? (
            <Suspense
              fallback={
                <div className="module-scene-3d__loading" role="status">
                  <div className="module-scene-3d__loading-spinner" />
                  <p className="module-scene-3d__loading-text">Cargando 3D…</p>
                </div>
              }
            >
              <FurnitureScene3D
                modules={sceneModules}
                walls={sceneWalls}
                totalWidth={preview.totalWidth}
                totalHeight={preview.totalHeight}
                totalDepth={preview.totalDepth}
                showFloor
                testId="spatial-studio-scene"
                colorMode="material"
                materialColors={materialColors}
                materialTextures={materialTextures}
                surfaceMode={DEFAULT_MATERIAL_SURFACE_MODE}
                showOutlines
                selectedModuleKey={selectedKey}
                onSelectModule={setSelectedKey}
              />
            </Suspense>
          ) : (
            <p className="catalog-empty">
              WebGL no disponible. Usá un navegador con aceleración 3D.
            </p>
          )}
        </main>

        <aside
          className="spatial-studio__inspector"
          data-testid="spatial-studio-inspector"
        >
          <h3 className="spatial-studio__section-title">Inspector</h3>
          {!selectedPlacement ? (
            <p className="spatial-studio__hint">
              Seleccioná un mueble en la lista o en el 3D para moverlo a lo largo
              del muro.
            </p>
          ) : (
            <div className="spatial-studio__inspector-body">
              <p className="spatial-studio__item-label">
                {itemLabel(
                  selectedPlacement.itemId,
                  selectedPlacement.instanceIndex,
                  project,
                  modules,
                )}
              </p>

              <label className="spatial-studio__field">
                <span>Offset en muro (mm)</span>
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={Math.round(selectedPlacement.offsetMm)}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    patchPlacement(
                      selectedPlacement.itemId,
                      selectedPlacement.instanceIndex,
                      { offsetMm: Math.max(0, Math.round(v)) },
                    );
                  }}
                  data-testid="spatial-studio-offset"
                />
              </label>

              <div className="spatial-studio__nudge" role="group" aria-label="Mover en muro">
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!canEdit}
                  onClick={() => nudgeOffset(-50)}
                  title="−50 mm"
                  data-testid="spatial-studio-nudge-left"
                >
                  <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!canEdit}
                  onClick={() => nudgeOffset(50)}
                  title="+50 mm"
                  data-testid="spatial-studio-nudge-right"
                >
                  <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!canEdit}
                  onClick={() => moveAlongWall(-1)}
                  title="Reordenar antes"
                  data-testid="spatial-studio-reorder-prev"
                >
                  <ArrowUp size={16} strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!canEdit}
                  onClick={() => moveAlongWall(1)}
                  title="Reordenar después"
                  data-testid="spatial-studio-reorder-next"
                >
                  <ArrowDown size={16} strokeWidth={1.5} aria-hidden />
                </button>
              </div>

              <label className="spatial-studio__field">
                <span>Elevación</span>
                <select
                  value={selectedPlacement.elevation}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patchPlacement(
                      selectedPlacement.itemId,
                      selectedPlacement.instanceIndex,
                      {
                        elevation:
                          e.target.value === 'wall' ? 'wall' : 'floor',
                      },
                    )
                  }
                  data-testid="spatial-studio-elevation"
                >
                  <option value="floor">Piso (base)</option>
                  <option value="wall">Muro (alto)</option>
                </select>
              </label>

              {canEdit ? (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() =>
                    removePlacement(
                      selectedPlacement.itemId,
                      selectedPlacement.instanceIndex,
                    )
                  }
                  data-testid="spatial-studio-unplace"
                >
                  Sacar del plano
                </button>
              ) : null}
            </div>
          )}

          <p className="spatial-studio__phase-note">
            Fase 1: colocar y mover. Medidas y precio en el ambiente vienen en
            la siguiente etapa.
          </p>
        </aside>
      </div>
    </div>
  );
}
