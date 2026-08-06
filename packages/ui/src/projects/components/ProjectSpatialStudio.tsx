/**
 * Project spatial studio (“Proyectar”) — place & move quote units on walls in 3D.
 * Phase A: walls + place/select/move. Phase B: Promob-like properties (measure
 * presets + finishes) editing the same ProjectItem as the quote.
 */

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Module,
  PlacementElevation,
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from '@muebles/domain';
import {
  BASE_CLEARANCE_PRESETS_MM,
  createDefaultLWalls,
  DEFAULT_BASE_CLEARANCE_MM,
  DEFAULT_WALL_CABINET_Z_MM,
  defaultMeasurePresetId,
  emptyKitchenLayout,
  kitchenLayoutWarnings,
  nextOffsetOnWall,
  pruneKitchenLayout,
  repackPlacementsOnWall,
  reorderPlacementOnWall,
  resolveBaseClearanceMm,
  resolveModuleMeasurePreset,
  resolveWallCabinetZMm,
  resolveWallFrames,
  snapOffsetOnWall,
  WALL_CABINET_Z_PRESETS_MM,
} from '@muebles/domain';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Eye,
  EyeOff,
  Lock,
  Map as MapIcon,
  Move3d,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  RefreshCw,
  Scan,
  Undo2,
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
import {
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  setItemOptionChoice,
} from '../projectHelpers';
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
  /** Update a quote line (measures / options) — same as list editor. */
  readonly onUpdateItem?: (item: ProjectItem) => void;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

type InspectorTab = 'props' | 'position';
type ListFilter = 'all' | 'unplaced' | 'placed';

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

function listEntryMeta(
  itemId: string,
  instanceIndex: number,
  project: Project,
  modules: readonly Module[],
): { code: string; name: string; copy: string | null } {
  const item = project.items.find((i) => i.id === itemId);
  const mod = modules.find((m) => m.id === item?.moduleId);
  const code = mod?.code?.trim() || '—';
  const name = mod?.name?.trim() || itemId;
  const qty = item?.quantity ?? 1;
  const copy = qty > 1 ? `copia ${instanceIndex + 1}` : null;
  return { code, name, copy };
}

function resolveItemDims(
  item: ProjectItem,
  module: Module | undefined,
): { width: number; height: number; depth: number } {
  if (!module) return { width: 600, height: 720, depth: 560 };
  try {
    const preset = resolveModuleMeasurePreset(
      module,
      item.measurePresetId?.trim() ||
        defaultMeasurePresetId(module) ||
        undefined,
    );
    if (preset) {
      return {
        width: preset.width,
        height: preset.height,
        depth: preset.depth,
      };
    }
  } catch {
    /* fall through */
  }
  if (module.externalDims) {
    return {
      width: module.externalDims.width,
      height: module.externalDims.height,
      depth: module.externalDims.depth,
    };
  }
  return { width: 600, height: 720, depth: 560 };
}

export function ProjectSpatialStudio({
  open,
  project,
  modules,
  catalog,
  canEdit,
  onClose,
  onChangeLayout,
  onUpdateItem,
  resolveMediaUrl,
}: ProjectSpatialStudioProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [targetWallId, setTargetWallId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('props');
  const [showOutlines, setShowOutlines] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showPlan2d, setShowPlan2d] = useState(false);
  const [cameraView, setCameraView] = useState<{
    readonly type: 'front' | 'top' | 'side' | 'isometric';
    readonly ts: number;
  } | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [undoStack, setUndoStack] = useState<ProjectKitchenLayout[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectKitchenLayout[]>([]);
  const [showFloorGrid, setShowFloorGrid] = useState(true);
  const wallDragSession = useRef(false);

  useEffect(() => {
    if (!open) return;
    setUseR3f(canUseWebGL());
  }, [open]);

  useEffect(() => {
    if (!open) {
      setUndoStack([]);
      setRedoStack([]);
      wallDragSession.current = false;
    }
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

  const placedEntries = useMemo(
    () =>
      layout.placements.map((p) => ({
        itemId: p.itemId,
        instanceIndex: p.instanceIndex,
        elevation: p.elevation,
        offsetMm: p.offsetMm,
      })),
    [layout.placements],
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

  const selectedRef = useMemo(() => {
    if (!selectedKey) return null;
    const hash = selectedKey.lastIndexOf('#');
    if (hash < 0) return null;
    const itemId = selectedKey.slice(0, hash);
    const instanceIndex = Number(selectedKey.slice(hash + 1)) || 0;
    return { itemId, instanceIndex };
  }, [selectedKey]);

  const selectedItem = useMemo(() => {
    if (!selectedRef) return null;
    return project.items.find((i) => i.id === selectedRef.itemId) ?? null;
  }, [selectedRef, project.items]);

  const selectedModule = useMemo(() => {
    if (!selectedItem) return undefined;
    return modules.find((m) => m.id === selectedItem.moduleId);
  }, [selectedItem, modules]);

  const selectedPlacement = useMemo(() => {
    if (!selectedRef) return null;
    return (
      layout.placements.find(
        (p) =>
          p.itemId === selectedRef.itemId &&
          p.instanceIndex === selectedRef.instanceIndex,
      ) ?? null
    );
  }, [selectedRef, layout.placements]);

  const selectedDims = useMemo(
    () =>
      selectedItem
        ? resolveItemDims(selectedItem, selectedModule)
        : null,
    [selectedItem, selectedModule],
  );

  const optionGroupsForItem = useMemo(
    () =>
      groupsForModuleItem(
        selectedModule,
        catalog.optionGroups,
        catalog.components,
        catalog.structures,
      ),
    [selectedModule, catalog],
  );

  const pickerCatalogs = useMemo(
    () => ({
      materials: catalog.materials,
      edges: catalog.edges,
      hardware: catalog.hardware,
    }),
    [catalog.materials, catalog.edges, catalog.hardware],
  );

  /** Wall frames in displayed (shifted) space for 3D drag along wall. */
  const wallDragByKey = useMemo(() => {
    const wallById = new Map(preview.walls.map((w) => [w.id, w]));
    const out: Record<
      string,
      {
        originXMm: number;
        originYMm: number;
        angleDeg: number;
        lengthMm: number;
        moduleWidthMm: number;
      }
    > = {};
    for (const p of layout.placements) {
      const wall = wallById.get(p.wallId);
      if (!wall) continue;
      const key = `${p.itemId}#${p.instanceIndex}`;
      const modInstance = preview.modules.find((m) => m.instanceKey === key);
      out[key] = {
        originXMm: wall.originXMm,
        originYMm: wall.originYMm,
        angleDeg: wall.angleDeg,
        lengthMm: wall.lengthMm,
        moduleWidthMm: modInstance?.width ?? 600,
      };
    }
    return out;
  }, [layout.placements, preview.walls, preview.modules]);

  const planFrames = useMemo(
    () => resolveWallFrames(layout.walls),
    [layout.walls],
  );

  const planMini = useMemo(() => {
    if (planFrames.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of planFrames) {
      minX = Math.min(minX, f.originXMm, f.endXMm);
      minY = Math.min(minY, f.originYMm, f.endYMm);
      maxX = Math.max(maxX, f.originXMm, f.endXMm);
      maxY = Math.max(maxY, f.originYMm, f.endYMm);
    }
    const pad = 24;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const size = 200;
    const scale = (size - pad * 2) / Math.max(spanX, spanY);
    return { minX, minY, pad, scale, size };
  }, [planFrames]);

  if (!open) return null;

  const fireCamera = (type: 'front' | 'top' | 'side' | 'isometric') => {
    setCameraView({ type, ts: Date.now() });
  };

  const commit = (
    next: ProjectKitchenLayout,
    opts?: { readonly history?: 'push' | 'none' },
  ) => {
    const history = opts?.history ?? 'push';
    if (history === 'push' && !wallDragSession.current) {
      setUndoStack((s) => [...s.slice(-29), layout]);
      setRedoStack([]);
    }
    onChangeLayout(pruneKitchenLayout(next, project.items));
  };

  const undoPlan = () => {
    if (!canEdit || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, layout]);
    onChangeLayout(pruneKitchenLayout(prev, project.items));
  };

  const redoPlan = () => {
    if (!canEdit || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, layout]);
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
      placements: layout.placements.map((p) => {
        if (p.itemId !== itemId || p.instanceIndex !== instanceIndex) return p;
        const next: ProjectItemPlacement = { ...p, ...patch };
        // Allow clearing optional override (inherit plan default).
        if (
          'baseClearanceMm' in patch &&
          patch.baseClearanceMm === undefined
        ) {
          const { baseClearanceMm: _drop, ...rest } = next;
          return rest;
        }
        return next;
      }),
    });
  };

  const nudgeOffset = (delta: number) => {
    if (!canEdit || !selectedPlacement) return;
    applyOffsetOnWall(
      selectedPlacement.itemId,
      selectedPlacement.instanceIndex,
      selectedPlacement.offsetMm + delta,
      { history: 'push', snap: true },
    );
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
    baseClearanceMm: m.baseClearanceMm,
    showCountertop: m.showCountertop,
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

  const applyOffsetOnWall = (
    itemId: string,
    instanceIndex: number,
    rawOffset: number,
    opts?: { readonly history?: 'push' | 'none'; readonly snap?: boolean },
  ) => {
    const placement = layout.placements.find(
      (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
    );
    if (!placement) return;
    const wall = layout.walls.find((w) => w.id === placement.wallId);
    const width = moduleWidth(
      project.items.find((i) => i.id === itemId) ?? {
        id: itemId,
        moduleId: '',
        quantity: 1,
        optionChoices: {},
      },
      modules,
    );
    const peers = layout.placements
      .filter(
        (p) =>
          p.wallId === placement.wallId &&
          !(p.itemId === itemId && p.instanceIndex === instanceIndex),
      )
      .map((p) => ({
        offsetMm: p.offsetMm,
        widthMm: moduleWidth(
          project.items.find((i) => i.id === p.itemId) ?? {
            id: p.itemId,
            moduleId: '',
            quantity: 1,
            optionChoices: {},
          },
          modules,
        ),
      }));
    const offsetMm =
      opts?.snap === false
        ? Math.max(
            0,
            Math.min(
              Math.max(0, (wall?.lengthMm ?? 3000) - width),
              Math.round(rawOffset),
            ),
          )
        : snapOffsetOnWall({
            offsetMm: rawOffset,
            moduleWidthMm: width,
            wallLengthMm: wall?.lengthMm ?? 3000,
            peers,
            thresholdMm: 18,
            gapMm: 20,
          });
    commit(
      {
        ...layout,
        placements: layout.placements.map((p) =>
          p.itemId === itemId && p.instanceIndex === instanceIndex
            ? { ...p, offsetMm }
            : p,
        ),
      },
      { history: opts?.history ?? 'push' },
    );
  };

  const handleModuleWallDragStart = (_moduleKey: string) => {
    if (!canEdit || wallDragSession.current) return;
    wallDragSession.current = true;
    setUndoStack((s) => [...s.slice(-29), layout]);
    setRedoStack([]);
  };

  const handleModuleWallOffset = (moduleKey: string, offsetMm: number) => {
    if (!canEdit) return;
    const hash = moduleKey.lastIndexOf('#');
    if (hash < 0) return;
    const itemId = moduleKey.slice(0, hash);
    const instanceIndex = Number(moduleKey.slice(hash + 1)) || 0;
    // Live drag: no per-frame history; light snap while moving.
    applyOffsetOnWall(itemId, instanceIndex, offsetMm, {
      history: 'none',
      snap: true,
    });
  };

  const handleModuleWallDragEnd = (moduleKey: string) => {
    wallDragSession.current = false;
    if (!canEdit) return;
    const hash = moduleKey.lastIndexOf('#');
    if (hash < 0) return;
    const itemId = moduleKey.slice(0, hash);
    const instanceIndex = Number(moduleKey.slice(hash + 1)) || 0;
    const placement = layout.placements.find(
      (p) => p.itemId === itemId && p.instanceIndex === instanceIndex,
    );
    if (!placement) return;
    // Final snap without stacking another undo (session already recorded).
    applyOffsetOnWall(itemId, instanceIndex, placement.offsetMm, {
      history: 'none',
      snap: true,
    });
  };

  const repackSelectedWall = () => {
    if (!canEdit || !selectedPlacement) return;
    commit(
      repackPlacementsOnWall(
        layout,
        selectedPlacement.wallId,
        footprints,
        20,
      ),
    );
  };

  const moveSelectedToWall = (wallId: string) => {
    if (!canEdit || !selectedPlacement) return;
    if (selectedPlacement.wallId === wallId) return;
    const offset = nextOffsetOnWall(layout, wallId, footprints, 20);
    commit({
      ...layout,
      placements: layout.placements.map((p) =>
        p.itemId === selectedPlacement.itemId &&
        p.instanceIndex === selectedPlacement.instanceIndex
          ? { ...p, wallId, offsetMm: offset }
          : p,
      ),
    });
    setTargetWallId(wallId);
  };

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

      <div
        className={
          listCollapsed
            ? 'spatial-studio__body spatial-studio__body--list-collapsed'
            : 'spatial-studio__body'
        }
      >
        {listCollapsed ? (
          <aside
            className="spatial-studio__rail"
            data-testid="spatial-studio-list-rail"
          >
            <button
              type="button"
              className="btn btn--small spatial-studio__rail-btn"
              onClick={() => setListCollapsed(false)}
              title="Mostrar lista"
              data-testid="spatial-studio-expand-list"
            >
              <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {unplaced.length > 0 ? (
              <span
                className="spatial-studio__rail-badge"
                title={`${unplaced.length} sin colocar`}
                data-testid="spatial-studio-rail-unplaced"
              >
                {unplaced.length}
              </span>
            ) : null}
          </aside>
        ) : null}

        <aside
          className={
            listCollapsed
              ? 'spatial-studio__sidebar spatial-studio__sidebar--hidden'
              : 'spatial-studio__sidebar'
          }
          data-testid="spatial-studio-sidebar"
          hidden={listCollapsed}
        >
          <div className="spatial-studio__sidebar-head">
            <h3 className="spatial-studio__section-title" style={{ margin: 0 }}>
              Muebles
            </h3>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setListCollapsed(true)}
              title="Ocultar lista"
              data-testid="spatial-studio-collapse-list"
              aria-label="Ocultar lista"
            >
              <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </div>

          <div
            className="spatial-studio__filter-row"
            role="group"
            aria-label="Filtro de lista"
          >
            <button
              type="button"
              className={
                listFilter === 'all'
                  ? 'spatial-studio__filter spatial-studio__filter--on'
                  : 'spatial-studio__filter'
              }
              onClick={() => setListFilter('all')}
              data-testid="spatial-studio-filter-all"
            >
              Todos ({footprints.length})
            </button>
            <button
              type="button"
              className={
                listFilter === 'unplaced'
                  ? 'spatial-studio__filter spatial-studio__filter--on'
                  : 'spatial-studio__filter'
              }
              onClick={() => setListFilter('unplaced')}
              data-testid="spatial-studio-filter-unplaced"
            >
              Sin colocar
              {unplaced.length > 0 ? (
                <span className="spatial-studio__filter-badge">
                  {unplaced.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={
                listFilter === 'placed'
                  ? 'spatial-studio__filter spatial-studio__filter--on'
                  : 'spatial-studio__filter'
              }
              onClick={() => setListFilter('placed')}
              data-testid="spatial-studio-filter-placed"
            >
              En plano ({layout.placements.length})
            </button>
          </div>

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

            {layout.walls.length > 0 ? (
              <div
                className="spatial-studio__field"
                style={{ marginTop: 'var(--space-3)' }}
              >
                <span className="spatial-studio__field-label">
                  Zoclo / patas (bajos)
                </span>
                <p className="spatial-studio__hint">
                  Espacio bajo los muebles de piso para zoclo o patas. Default del
                  plano: {resolveBaseClearanceMm(layout, { elevation: 'floor' })}{' '}
                  mm.
                </p>
                <div
                  className="spatial-studio__preset-grid"
                  role="listbox"
                  aria-label="Altura de zoclo del plano"
                >
                  {BASE_CLEARANCE_PRESETS_MM.map((mm) => {
                    const current = resolveBaseClearanceMm(layout, {
                      elevation: 'floor',
                    });
                    const active = current === mm;
                    return (
                      <button
                        key={mm}
                        type="button"
                        role="option"
                        aria-selected={active}
                        disabled={!canEdit}
                        className={
                          active
                            ? 'spatial-studio__preset spatial-studio__preset--active'
                            : 'spatial-studio__preset'
                        }
                        onClick={() =>
                          commit({
                            ...layout,
                            baseClearanceMm: mm,
                          })
                        }
                        data-testid={`spatial-studio-layout-plinth-${mm}`}
                      >
                        <span className="spatial-studio__preset-name">
                          {mm === 0 ? 'Sin' : `${mm}`}
                        </span>
                        <span className="spatial-studio__preset-dims">
                          {mm === 0 ? 'al piso' : 'mm'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <label className="spatial-studio__field">
                  <span>Personalizado (mm)</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    disabled={!canEdit}
                    value={
                      layout.baseClearanceMm ?? DEFAULT_BASE_CLEARANCE_MM
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commit({
                        ...layout,
                        baseClearanceMm: Math.max(0, Math.round(v)),
                      });
                    }}
                    data-testid="spatial-studio-layout-plinth-custom"
                  />
                </label>

                <span className="spatial-studio__field-label">
                  Alacenas (altura de instalación)
                </span>
                <p className="spatial-studio__hint">
                  Base inferior de los altos:{' '}
                  {resolveWallCabinetZMm(layout)} mm del piso.
                </p>
                <div
                  className="spatial-studio__preset-grid"
                  role="listbox"
                  aria-label="Altura de alacenas"
                >
                  {WALL_CABINET_Z_PRESETS_MM.map((mm) => {
                    const active = resolveWallCabinetZMm(layout) === mm;
                    return (
                      <button
                        key={mm}
                        type="button"
                        role="option"
                        aria-selected={active}
                        disabled={!canEdit}
                        className={
                          active
                            ? 'spatial-studio__preset spatial-studio__preset--active'
                            : 'spatial-studio__preset'
                        }
                        onClick={() =>
                          commit({ ...layout, wallCabinetZMm: mm })
                        }
                        data-testid={`spatial-studio-wall-z-${mm}`}
                      >
                        <span className="spatial-studio__preset-name">
                          {mm}
                        </span>
                        <span className="spatial-studio__preset-dims">mm</span>
                      </button>
                    );
                  })}
                </div>
                <label className="spatial-studio__field">
                  <span>Personalizado altos (mm)</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    disabled={!canEdit}
                    value={
                      layout.wallCabinetZMm ?? DEFAULT_WALL_CABINET_Z_MM
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      commit({
                        ...layout,
                        wallCabinetZMm: Math.max(0, Math.round(v)),
                      });
                    }}
                    data-testid="spatial-studio-wall-z-custom"
                  />
                </label>

                <label className="spatial-studio__field spatial-studio__check-row">
                  <input
                    type="checkbox"
                    checked={layout.showCountertop !== false}
                    disabled={!canEdit}
                    onChange={(e) =>
                      commit({
                        ...layout,
                        showCountertop: e.target.checked,
                      })
                    }
                    data-testid="spatial-studio-toggle-countertop"
                  />
                  <span>Mesada visual sobre bajos</span>
                </label>
              </div>
            ) : null}
          </section>

          {listFilter !== 'placed' ? (
            <section className="spatial-studio__section">
              <h3 className="spatial-studio__section-title">
                Sin colocar ({unplaced.length})
              </h3>
              {unplaced.length === 0 ? (
                <p className="spatial-studio__hint">
                  Todos los muebles están en el plano.
                </p>
              ) : (
                <ul className="spatial-studio__item-list">
                  {unplaced.map((f) => {
                    const key = `${f.itemId}#${f.instanceIndex}`;
                    const active = selectedKey === key;
                    const meta = listEntryMeta(
                      f.itemId,
                      f.instanceIndex,
                      project,
                      modules,
                    );
                    return (
                      <li key={key}>
                        <div
                          className={
                            active
                              ? 'spatial-studio__item-row spatial-studio__item-row--active'
                              : 'spatial-studio__item-row'
                          }
                        >
                          <button
                            type="button"
                            className="spatial-studio__item-pick"
                            title="Doble click para colocar en el muro activo"
                            onClick={() => {
                              setSelectedKey(key);
                              setInspectorTab('props');
                            }}
                            onDoubleClick={() => {
                              if (!canEdit || !activeWallId) return;
                              placeOnWall(
                                f.itemId,
                                f.instanceIndex,
                                activeWallId,
                              );
                            }}
                            data-testid={`spatial-studio-unplaced-${f.itemId}-${f.instanceIndex}`}
                          >
                            <span className="spatial-studio__item-code">
                              {meta.code}
                            </span>
                            <span className="spatial-studio__item-name">
                              {meta.name}
                              {meta.copy ? (
                                <span className="spatial-studio__item-copy">
                                  {' '}
                                  · {meta.copy}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {canEdit && activeWallId ? (
                            <button
                              type="button"
                              className="btn btn--small btn--primary"
                              onClick={() =>
                                placeOnWall(
                                  f.itemId,
                                  f.instanceIndex,
                                  activeWallId,
                                )
                              }
                              data-testid={`spatial-studio-place-${f.itemId}-${f.instanceIndex}`}
                            >
                              Colocar
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {unplaced.length > 0 ? (
                <p className="spatial-studio__hint" style={{ marginTop: 8 }}>
                  Tip: doble click coloca en el muro activo
                  {activeWallId
                    ? ` (${layout.walls.find((w) => w.id === activeWallId)?.name ?? 'muro'})`
                    : ''}.
                </p>
              ) : null}
            </section>
          ) : null}

          {listFilter !== 'unplaced' ? (
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
                  {placedEntries.map((p) => {
                    const key = `${p.itemId}#${p.instanceIndex}`;
                    const active = selectedKey === key;
                    const meta = listEntryMeta(
                      p.itemId,
                      p.instanceIndex,
                      project,
                      modules,
                    );
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={
                            active
                              ? 'spatial-studio__item-btn spatial-studio__item-btn--active'
                              : 'spatial-studio__item-btn'
                          }
                          onClick={() => {
                            setSelectedKey(key);
                            setInspectorTab('props');
                          }}
                          data-testid={`spatial-studio-placed-${p.itemId}-${p.instanceIndex}`}
                        >
                          <span className="spatial-studio__item-code">
                            {meta.code}
                          </span>
                          <span className="spatial-studio__item-name">
                            {meta.name}
                            {meta.copy ? (
                              <span className="spatial-studio__item-copy">
                                {' '}
                                · {meta.copy}
                              </span>
                            ) : null}
                          </span>
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
          ) : null}

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
          <div
            className="spatial-studio__scene-toolbar"
            role="toolbar"
            aria-label="Herramientas de escena 3D"
            data-testid="spatial-studio-scene-toolbar"
          >
            <span className="spatial-studio__mode-pill" data-testid="spatial-studio-mode-pill">
              <Move3d size={14} strokeWidth={1.5} aria-hidden />
              Mueble = arrastrar · muro = activar · vacío = orbitar
            </span>
            <div className="spatial-studio__toolbar-group" role="group" aria-label="Cámara">
              <button
                type="button"
                className="btn btn--small"
                onClick={() => fireCamera('isometric')}
                title="Vista 3/4"
                data-testid="spatial-studio-cam-iso"
              >
                3/4
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => fireCamera('front')}
                title="Vista frontal"
                data-testid="spatial-studio-cam-front"
              >
                Frente
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => fireCamera('top')}
                title="Vista planta"
                data-testid="spatial-studio-cam-top"
              >
                Planta
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => fireCamera('side')}
                title="Vista lateral"
                data-testid="spatial-studio-cam-side"
              >
                Lateral
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => fireCamera('isometric')}
                title="Reset vista"
                data-testid="spatial-studio-cam-reset"
              >
                <RefreshCw size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <div className="spatial-studio__toolbar-group" role="group" aria-label="Historial del plano">
              <button
                type="button"
                className="btn btn--small"
                disabled={!canEdit || undoStack.length === 0}
                onClick={undoPlan}
                title="Deshacer plano"
                data-testid="spatial-studio-undo"
              >
                <Undo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className="btn btn--small"
                disabled={!canEdit || redoStack.length === 0}
                onClick={redoPlan}
                title="Rehacer plano"
                data-testid="spatial-studio-redo"
              >
                <Redo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <div className="spatial-studio__toolbar-group" role="group" aria-label="Visualización">
              <button
                type="button"
                className={
                  showOutlines
                    ? 'btn btn--small spatial-studio__tool--on'
                    : 'btn btn--small'
                }
                aria-pressed={showOutlines}
                onClick={() => setShowOutlines((v) => !v)}
                title="Contornos de piezas"
                data-testid="spatial-studio-toggle-outlines"
              >
                <Scan size={14} strokeWidth={1.5} aria-hidden /> Contornos
              </button>
              <button
                type="button"
                className={
                  showWireframe
                    ? 'btn btn--small spatial-studio__tool--on'
                    : 'btn btn--small'
                }
                aria-pressed={showWireframe}
                onClick={() => setShowWireframe((v) => !v)}
                title="Rayos X (ver interior)"
                data-testid="spatial-studio-toggle-xray"
              >
                {showWireframe ? (
                  <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                ) : (
                  <Eye size={14} strokeWidth={1.5} aria-hidden />
                )}{' '}
                Rayos X
              </button>
              <button
                type="button"
                className={
                  showPlan2d
                    ? 'btn btn--small spatial-studio__tool--on'
                    : 'btn btn--small'
                }
                aria-pressed={showPlan2d}
                onClick={() => setShowPlan2d((v) => !v)}
                title="Mostrar planta 2D"
                data-testid="spatial-studio-toggle-plan2d"
              >
                <MapIcon size={14} strokeWidth={1.5} aria-hidden /> Plano
              </button>
              <button
                type="button"
                className={
                  showFloorGrid
                    ? 'btn btn--small spatial-studio__tool--on'
                    : 'btn btn--small'
                }
                aria-pressed={showFloorGrid}
                onClick={() => setShowFloorGrid((v) => !v)}
                title="Grilla de piso (500 mm)"
                data-testid="spatial-studio-toggle-grid"
              >
                Grilla
              </button>
            </div>
          </div>

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
                fillViewport
                showHint={false}
                cameraView={cameraView}
                testId="spatial-studio-scene"
                colorMode="material"
                materialColors={materialColors}
                materialTextures={materialTextures}
                surfaceMode={DEFAULT_MATERIAL_SURFACE_MODE}
                showOutlines={showOutlines}
                showWireframe={showWireframe}
                showFloorGrid={showFloorGrid}
                selectedModuleKey={selectedKey}
                onSelectModule={(key) => {
                  setSelectedKey(key);
                  if (key) setInspectorTab('position');
                }}
                wallDragEnabled={canEdit}
                wallDragByKey={wallDragByKey}
                onModuleWallOffset={handleModuleWallOffset}
                onModuleWallDragStart={handleModuleWallDragStart}
                onModuleWallDragEnd={handleModuleWallDragEnd}
                selectedWallId={activeWallId}
                onSelectWall={(wallId) => {
                  setTargetWallId(wallId);
                }}
              />
            </Suspense>
          ) : (
            <p className="catalog-empty">
              WebGL no disponible. Usá un navegador con aceleración 3D.
            </p>
          )}

          {showPlan2d && planMini ? (
            <div
              className="spatial-studio__plan-mini"
              data-testid="spatial-studio-plan-mini"
            >
              <div className="spatial-studio__plan-mini-head">
                <span>Planta 2D</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setShowPlan2d(false)}
                  aria-label="Cerrar planta"
                >
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              <svg
                width={planMini.size}
                height={planMini.size}
                viewBox={`0 0 ${planMini.size} ${planMini.size}`}
                className="spatial-studio__plan-svg"
                aria-hidden
              >
                {planFrames.map((f) => {
                  const x1 =
                    planMini.pad + (f.originXMm - planMini.minX) * planMini.scale;
                  const y1 =
                    planMini.pad + (f.originYMm - planMini.minY) * planMini.scale;
                  const x2 =
                    planMini.pad + (f.endXMm - planMini.minX) * planMini.scale;
                  const y2 =
                    planMini.pad + (f.endYMm - planMini.minY) * planMini.scale;
                  const active = f.id === activeWallId;
                  return (
                    <g key={f.id}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={
                          active
                            ? 'var(--accent-500, #3b82f6)'
                            : 'var(--text-primary, #e2e8f0)'
                        }
                        strokeWidth={active ? 5 : 3}
                        strokeLinecap="square"
                      />
                    </g>
                  );
                })}
                {layout.placements.map((p) => {
                  const wall = planFrames.find((f) => f.id === p.wallId);
                  if (!wall) return null;
                  const angle = ((wall.angleDeg % 360) + 360) % 360;
                  const w = moduleWidth(
                    project.items.find((i) => i.id === p.itemId) ?? {
                      id: p.itemId,
                      moduleId: '',
                      quantity: 1,
                      optionChoices: {},
                    },
                    modules,
                  );
                  let rx =
                    planMini.pad +
                    (wall.originXMm - planMini.minX) * planMini.scale;
                  let ry =
                    planMini.pad +
                    (wall.originYMm - planMini.minY) * planMini.scale;
                  let rw = Math.max(6, w * planMini.scale);
                  let rh = 10;
                  if (angle > 45 && angle < 135) {
                    rx =
                      planMini.pad +
                      (wall.originXMm - planMini.minX) * planMini.scale -
                      5;
                    ry =
                      planMini.pad +
                      (wall.originYMm + p.offsetMm - planMini.minY) *
                        planMini.scale;
                    rw = 10;
                    rh = Math.max(6, w * planMini.scale);
                  } else {
                    rx =
                      planMini.pad +
                      (wall.originXMm + p.offsetMm - planMini.minX) *
                        planMini.scale;
                    ry =
                      planMini.pad +
                      (wall.originYMm - planMini.minY) * planMini.scale -
                      5;
                  }
                  const key = `${p.itemId}#${p.instanceIndex}`;
                  const selected = selectedKey === key;
                  return (
                    <rect
                      key={key}
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      fill={
                        selected
                          ? 'var(--accent-500, #3b82f6)'
                          : p.elevation === 'wall'
                            ? '#64748b'
                            : '#22c55e'
                      }
                      opacity={0.85}
                      rx={1}
                      onClick={() => {
                        setSelectedKey(key);
                        setInspectorTab('position');
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  );
                })}
              </svg>
            </div>
          ) : null}
        </main>

        <aside
          className="spatial-studio__inspector"
          data-testid="spatial-studio-inspector"
        >
          <h3 className="spatial-studio__section-title">Propiedades</h3>
          {!selectedItem || !selectedRef ? (
            <p className="spatial-studio__hint">
              Seleccioná un mueble en la lista o en el 3D — como en Promob: a la
              derecha editás medida, acabados y posición.
            </p>
          ) : (
            <div className="spatial-studio__inspector-body">
              <div className="spatial-studio__identity">
                <p className="spatial-studio__item-label">
                  {selectedModule
                    ? `${selectedModule.code} — ${selectedModule.name}`
                    : selectedItem.moduleId}
                </p>
                {selectedDims ? (
                  <p
                    className="spatial-studio__dims-hero"
                    data-testid="spatial-studio-dims"
                  >
                    <span>{selectedDims.width}</span>
                    <span className="spatial-studio__dims-sep">×</span>
                    <span>{selectedDims.height}</span>
                    <span className="spatial-studio__dims-sep">×</span>
                    <span>{selectedDims.depth}</span>
                    <span className="spatial-studio__dims-unit">mm</span>
                  </p>
                ) : null}
                <p className="spatial-studio__item-meta">
                  A × H × P ·{' '}
                  {selectedPlacement
                    ? selectedPlacement.elevation === 'wall'
                      ? 'en muro (alto)'
                      : 'en piso'
                    : 'sin colocar'}
                </p>
              </div>

              <div
                className="spatial-studio__tabs"
                role="tablist"
                aria-label="Inspector"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'props'}
                  className={
                    inspectorTab === 'props'
                      ? 'spatial-studio__tab spatial-studio__tab--active'
                      : 'spatial-studio__tab'
                  }
                  onClick={() => setInspectorTab('props')}
                  data-testid="spatial-studio-tab-props"
                >
                  Mueble
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === 'position'}
                  className={
                    inspectorTab === 'position'
                      ? 'spatial-studio__tab spatial-studio__tab--active'
                      : 'spatial-studio__tab'
                  }
                  onClick={() => setInspectorTab('position')}
                  data-testid="spatial-studio-tab-position"
                >
                  Posición
                </button>
              </div>

              {inspectorTab === 'props' ? (
                <div
                  className="spatial-studio__tab-panel"
                  data-testid="spatial-studio-panel-props"
                >
                  {(selectedModule?.presets?.length ?? 0) > 0 ? (
                    <div className="spatial-studio__field">
                      <span className="spatial-studio__field-label">
                        Medida comercial
                      </span>
                      <div
                        className="spatial-studio__preset-grid"
                        role="listbox"
                        aria-label="Presets de medida"
                      >
                        {selectedModule!.presets!.map((pr) => {
                          const active =
                            (selectedItem.measurePresetId ??
                              defaultMeasurePresetId(selectedModule!)) ===
                            pr.id;
                          const label = pr.name?.trim()
                            ? pr.name
                            : `${pr.width}×${pr.height}`;
                          return (
                            <button
                              key={pr.id}
                              type="button"
                              role="option"
                              aria-selected={active}
                              disabled={!canEdit || !onUpdateItem}
                              className={
                                active
                                  ? 'spatial-studio__preset spatial-studio__preset--active'
                                  : 'spatial-studio__preset'
                              }
                              onClick={() =>
                                onUpdateItem?.({
                                  ...selectedItem,
                                  measurePresetId: pr.id,
                                })
                              }
                              data-testid={`spatial-studio-preset-${pr.id}`}
                            >
                              <span className="spatial-studio__preset-name">
                                {label}
                              </span>
                              <span className="spatial-studio__preset-dims">
                                {pr.width}×{pr.height}×{pr.depth}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="spatial-studio__hint">
                      Este mueble no tiene presets comerciales — las medidas
                      vienen del módulo base.
                    </p>
                  )}

                  {optionGroupsForItem.length > 0 ? (
                    <div className="spatial-studio__finishes">
                      <span className="spatial-studio__field-label">
                        Acabados y herrajes
                      </span>
                      {optionGroupsForItem.map((group) => {
                        const options = optionsForGroup(group, pickerCatalogs);
                        const lineValue =
                          selectedItem.optionChoices[group.code]?.trim() ?? '';
                        const projectDefault =
                          project.projectLevelChoices?.[group.code]?.trim() ??
                          '';
                        const inheritLabel = projectDefault
                          ? `Proyecto (${optionLabelForId(projectDefault, group, pickerCatalogs)})`
                          : 'Default del proyecto';
                        return (
                          <label
                            key={group.id}
                            className="spatial-studio__field"
                          >
                            <span>{group.name}</span>
                            <select
                              value={lineValue}
                              disabled={!canEdit || !onUpdateItem}
                              onChange={(e) => {
                                if (!onUpdateItem) return;
                                onUpdateItem({
                                  ...selectedItem,
                                  optionChoices: setItemOptionChoice(
                                    selectedItem.optionChoices,
                                    group.code,
                                    e.target.value,
                                  ),
                                });
                              }}
                              data-testid={`spatial-studio-choice-${group.code}`}
                            >
                              <option value="">{inheritLabel}</option>
                              {options.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="spatial-studio__hint">
                      Sin grupos de opción requeridos para este mueble.
                    </p>
                  )}
                </div>
              ) : null}

              {inspectorTab === 'position' ? (
                <div
                  className="spatial-studio__tab-panel"
                  data-testid="spatial-studio-panel-position"
                >
                  {!selectedPlacement ? (
                    <div className="spatial-studio__empty-walls">
                      <p className="spatial-studio__hint">
                        Este mueble aún no está en el plano.
                      </p>
                      {canEdit && activeWallId ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--small"
                          onClick={() =>
                            placeOnWall(
                              selectedRef.itemId,
                              selectedRef.instanceIndex,
                              activeWallId,
                            )
                          }
                          data-testid="spatial-studio-place-selected"
                        >
                          Colocar en muro activo
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <>
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
                            applyOffsetOnWall(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              v,
                              { history: 'push', snap: true },
                            );
                          }}
                          data-testid="spatial-studio-offset"
                        />
                      </label>

                      <label className="spatial-studio__field">
                        <span>Muro</span>
                        <select
                          value={selectedPlacement.wallId}
                          disabled={!canEdit}
                          onChange={(e) => moveSelectedToWall(e.target.value)}
                          data-testid="spatial-studio-move-wall"
                        >
                          {layout.walls.map((w, i) => (
                            <option key={w.id} value={w.id}>
                              {w.name?.trim() || `Muro ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>

                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={repackSelectedWall}
                          title="Reempaquetar todos los muebles del muro con gap 20 mm"
                          data-testid="spatial-studio-repack-wall"
                        >
                          Compactar muro
                        </button>
                      ) : null}

                      <div
                        className="spatial-studio__nudge"
                        role="group"
                        aria-label="Mover en muro"
                      >
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

                      {selectedPlacement.elevation === 'floor' ? (
                        <div className="spatial-studio__field">
                          <span className="spatial-studio__field-label">
                            Zoclo / patas de este mueble
                          </span>
                          <p className="spatial-studio__hint">
                            Efectivo:{' '}
                            {resolveBaseClearanceMm(layout, selectedPlacement)} mm
                            {selectedPlacement.baseClearanceMm === undefined
                              ? ' (default del plano)'
                              : ' (override)'}
                          </p>
                          <div
                            className="spatial-studio__preset-grid"
                            role="listbox"
                            aria-label="Altura de zoclo del mueble"
                          >
                            <button
                              type="button"
                              role="option"
                              aria-selected={
                                selectedPlacement.baseClearanceMm === undefined
                              }
                              disabled={!canEdit}
                              className={
                                selectedPlacement.baseClearanceMm === undefined
                                  ? 'spatial-studio__preset spatial-studio__preset--active'
                                  : 'spatial-studio__preset'
                              }
                              onClick={() =>
                                patchPlacement(
                                  selectedPlacement.itemId,
                                  selectedPlacement.instanceIndex,
                                  { baseClearanceMm: undefined },
                                )
                              }
                              data-testid="spatial-studio-item-plinth-default"
                            >
                              <span className="spatial-studio__preset-name">
                                Plano
                              </span>
                              <span className="spatial-studio__preset-dims">
                                {resolveBaseClearanceMm(layout, {
                                  elevation: 'floor',
                                })}{' '}
                                mm
                              </span>
                            </button>
                            {BASE_CLEARANCE_PRESETS_MM.map((mm) => {
                              const active =
                                selectedPlacement.baseClearanceMm === mm;
                              return (
                                <button
                                  key={mm}
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  disabled={!canEdit}
                                  className={
                                    active
                                      ? 'spatial-studio__preset spatial-studio__preset--active'
                                      : 'spatial-studio__preset'
                                  }
                                  onClick={() =>
                                    patchPlacement(
                                      selectedPlacement.itemId,
                                      selectedPlacement.instanceIndex,
                                      { baseClearanceMm: mm },
                                    )
                                  }
                                  data-testid={`spatial-studio-item-plinth-${mm}`}
                                >
                                  <span className="spatial-studio__preset-name">
                                    {mm === 0 ? 'Sin' : `${mm}`}
                                  </span>
                                  <span className="spatial-studio__preset-dims">
                                    {mm === 0 ? 'al piso' : 'mm'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

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
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <p className="spatial-studio__phase-note">
            Medidas = presets del catálogo. En el 3D: arrastrá un mueble para
            deslizarlo a lo largo del muro (órbita con arrastre en el vacío).
          </p>
        </aside>
      </div>
    </div>
  );
}
