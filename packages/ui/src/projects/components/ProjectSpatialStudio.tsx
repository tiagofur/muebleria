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
  addKitchenSpace,
  allKitchenPlacements,
  BASE_CLEARANCE_PRESETS_MM,
  createDefaultLWalls,
  createPlanUnderlay,
  DEFAULT_BASE_CLEARANCE_MM,
  DEFAULT_WALL_CABINET_Z_MM,
  defaultMeasurePresetId,
  emptyKitchenLayout,
  ensureKitchenSpaces,
  isFreePlacement,
  kitchenLayoutWarnings,
  nextOffsetOnWall,
  parseDxfToKitchenWalls,
  planEditSessionHeldByOther,
  pruneKitchenLayout,
  removeKitchenSpace,
  renameKitchenSpace,
  repackPlacementsOnWall,
  reorderPlacementOnWall,
  resolveBaseClearanceMm,
  resolveModuleMeasurePreset,
  resolveWallCabinetZMm,
  resolveWallFrames,
  scalePlanUnderlay,
  seedDefaultLWallsIfEmpty,
  setActiveKitchenSpace,
  snapOffsetOnWall,
  syncActiveKitchenSpace,
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
  FileUp,
  Lock,
  Map as MapIcon,
  Move3d,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  RefreshCw,
  Scan,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  canUseWebGL,
  materialColorMap,
  materialTextureMap,
  DEFAULT_MATERIAL_SURFACE_MODE,
  DEFAULT_SCENE_LIGHTING_MODE,
  type BoardColorMode,
  type MaterialSurfaceMode,
  type SceneLightingMode,
} from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';
import { allFootprints, itemLabel, moduleWidth } from '../kitchenPlanHelpers';
import {
  estimateLineSalePrice,
  formatProjectMoney,
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  setItemOptionChoice,
} from '../projectHelpers';
import type { Catalog } from '@muebles/domain';
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
  /** Project sale total (read-only context in chrome). */
  readonly quoteSalePrice?: number | null;
  /**
   * Open/focus studio without forcing after every quote add.
   * Used by "Colocar en Proyectar" cue, tools CTA, and re-focus when
   * adding while the studio is already open (re-applies when prop changes).
   */
  readonly bootstrap?: {
    readonly listFilter?: ListFilter;
    readonly selectKey?: string | null;
  } | null;
  /** Open quote add-item modal while keeping Proyectar open. */
  readonly onRequestAddItem?: () => void;
  /**
   * Soft lock actor for multi-user Proyectar. When omitted, no lock protocol.
   */
  readonly planActor?: { readonly userId: string; readonly userName: string };
  readonly onAcquirePlanEdit?: () => boolean;
  readonly onRenewPlanEdit?: () => boolean;
  readonly onReleasePlanEdit?: () => void;
};

type InspectorTab = 'props' | 'position';
export type ListFilter = 'all' | 'unplaced' | 'placed';

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
  canEdit: statusCanEdit,
  onClose,
  onChangeLayout,
  onUpdateItem,
  resolveMediaUrl,
  quoteSalePrice = null,
  bootstrap = null,
  onRequestAddItem,
  planActor,
  onAcquirePlanEdit,
  onRenewPlanEdit,
  onReleasePlanEdit,
}: ProjectSpatialStudioProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [planLockBlocked, setPlanLockBlocked] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [targetWallId, setTargetWallId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('props');
  const [showOutlines, setShowOutlines] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showPlan2d, setShowPlan2d] = useState(false);
  /** How boards are painted: catalog finishes vs workshop role tints. */
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');
  /** Solid / grain / photo texture when colorMode is material. */
  const [surfaceMode, setSurfaceMode] = useState<MaterialSurfaceMode>(
    DEFAULT_MATERIAL_SURFACE_MODE,
  );
  // Default 3/4 from first paint so FurnitureScene3D never mounts with
  // cameraView=null (that enables Bounds.fit and steals the isometric preset).
  const [cameraView, setCameraView] = useState<{
    readonly type: 'front' | 'top' | 'side' | 'isometric';
    readonly ts: number;
  }>({ type: 'isometric', ts: 0 });
  const [listCollapsed, setListCollapsed] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [undoStack, setUndoStack] = useState<ProjectKitchenLayout[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectKitchenLayout[]>([]);
  const [showFloorGrid, setShowFloorGrid] = useState(true);
  const [lightingMode, setLightingMode] = useState<SceneLightingMode>(
    DEFAULT_SCENE_LIGHTING_MODE,
  );
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [defaultWallsMsg, setDefaultWallsMsg] = useState<string | null>(null);
  /** Read-only space navigation — must not persist layout / activeSpaceId. */
  const [viewSpaceId, setViewSpaceId] = useState<string | null>(null);
  const wallDragSession = useRef(false);
  const lastBootstrapKey = useRef<string | null>(null);
  const seededDefaultWalls = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  // Soft-lock handlers often re-created each parent render. Keep them in refs
  // so the lock effect does not re-run → acquire → store patch → loop.
  const onAcquirePlanEditRef = useRef(onAcquirePlanEdit);
  const onRenewPlanEditRef = useRef(onRenewPlanEdit);
  const onReleasePlanEditRef = useRef(onReleasePlanEdit);
  onAcquirePlanEditRef.current = onAcquirePlanEdit;
  onRenewPlanEditRef.current = onRenewPlanEdit;
  onReleasePlanEditRef.current = onReleasePlanEdit;

  useEffect(() => {
    if (!open) return;
    setUseR3f(canUseWebGL());
  }, [open]);

  useEffect(() => {
    if (!open) {
      setUndoStack([]);
      setRedoStack([]);
      wallDragSession.current = false;
      lastBootstrapKey.current = null;
      seededDefaultWalls.current = false;
      setPlanLockBlocked(false);
      setDefaultWallsMsg(null);
      return;
    }
    // Default camera 3/4 (isometric) on every open for framing.
    setCameraView({ type: 'isometric', ts: Date.now() });
  }, [open]);

  // Re-apply bootstrap whenever the prop identity/content changes while open
  // (e.g. add while studio open → parent sets new { listFilter: 'unplaced' }).
  useEffect(() => {
    if (!open || !bootstrap) return;
    const key = JSON.stringify({
      listFilter: bootstrap.listFilter ?? null,
      selectKey: bootstrap.selectKey ?? null,
    });
    if (lastBootstrapKey.current === key) return;
    lastBootstrapKey.current = key;
    if (bootstrap.listFilter) setListFilter(bootstrap.listFilter);
    if (bootstrap.selectKey) {
      setSelectedKey(bootstrap.selectKey);
      setInspectorTab('props');
    } else if (bootstrap.selectKey === null) {
      // Explicit clear when parent wants list focus only.
    }
    setListCollapsed(false);
  }, [open, bootstrap]);

  // Multi-user soft lock for Proyectar.
  // Deps are ONLY open/status/actor/project — never callback identity.
  useEffect(() => {
    if (!open || !statusCanEdit || !planActor || !onAcquirePlanEditRef.current) {
      setPlanLockBlocked(false);
      return;
    }
    const ok = onAcquirePlanEditRef.current();
    setPlanLockBlocked(!ok);
    if (!ok) return;
    const interval = window.setInterval(() => {
      const renewed = onRenewPlanEditRef.current?.() ?? true;
      if (!renewed) setPlanLockBlocked(true);
    }, 45_000);
    return () => {
      window.clearInterval(interval);
      onReleasePlanEditRef.current?.();
    };
  }, [open, statusCanEdit, planActor?.userId, project.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Nested dialogs (e.g. Agregar mueble) own Esc; do not close the studio.
      if (document.querySelector('.ui-modal-root.is-open')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const baseLayout = useMemo(
    () =>
      ensureKitchenSpaces(
        pruneKitchenLayout(
          project.kitchenLayout ?? emptyKitchenLayout(),
          project.items,
        ),
      ),
    [project.kitchenLayout, project.items],
  );

  const heldByOther = Boolean(
    planActor &&
      planEditSessionHeldByOther(project.planEditSession, planActor.userId),
  );
  const editBlocked = planLockBlocked || heldByOther;
  // Shadow canEdit for the rest of the component: mutations + edit UI respect
  // soft lock. statusCanEdit remains for frozen-project chrome only.
  const canEdit = statusCanEdit && !editBlocked;

  // Clear view-only space override when editing becomes available or project changes.
  useEffect(() => {
    if (canEdit) setViewSpaceId(null);
  }, [canEdit, project.id]);

  const layout = useMemo(() => {
    if (canEdit || !viewSpaceId) return baseLayout;
    if (viewSpaceId === baseLayout.activeSpaceId) return baseLayout;
    return setActiveKitchenSpace(baseLayout, viewSpaceId);
  }, [baseLayout, canEdit, viewSpaceId]);

  // Seed default L walls once when opening an empty editable space.
  useEffect(() => {
    if (!open || !canEdit) return;
    if (seededDefaultWalls.current) return;
    if (layout.walls.length > 0) {
      seededDefaultWalls.current = true;
      return;
    }
    seededDefaultWalls.current = true;
    const seeded = seedDefaultLWallsIfEmpty(layout, newId);
    onChangeLayout(pruneKitchenLayout(seeded, project.items));
    setDefaultWallsMsg(
      'Ambiente en L por defecto (Muro A + Muro B). Ajustá o importá un plano si hace falta.',
    );
    // Re-fire isometric so framing updates after walls appear.
    setCameraView({ type: 'isometric', ts: Date.now() });
  }, [
    open,
    canEdit,
    layout,
    onChangeLayout,
    project.items,
  ]);

  const lockHolderName =
    heldByOther && project.planEditSession?.userName?.trim()
      ? project.planEditSession.userName.trim()
      : null;

  const spaces = layout.spaces ?? [];
  const activeSpaceId = layout.activeSpaceId ?? spaces[0]?.id ?? null;
  const activeSpaceName =
    spaces.find((s) => s.id === activeSpaceId)?.name ?? 'Cocina';

  const footprints = useMemo(
    () => allFootprints(project, modules),
    [project, modules],
  );

  /** Placed across ALL spaces so a unit in Baño is not "unplaced" in Cocina. */
  const placedKeys = useMemo(
    () =>
      new Set(
        allKitchenPlacements(layout).map(
          (p) => `${p.itemId}#${p.instanceIndex}`,
        ),
      ),
    [layout],
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
        free: isFreePlacement(p),
        freeXMm: p.freeXMm,
        freeYMm: p.freeYMm,
        freeYawDeg: p.freeYawDeg,
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

  /**
   * Resolve active space ambient refs (floor/wall) against the catalog's
   * ambientMaterials collection. Caller pre-resolves — FurnitureScene3D
   * receives ready AmbientMaterial props (consistent with materialColors).
   * Refs live on the top-level layout mirror (syncActiveKitchenSpace carries
   * them through, mirroring showCountertop).
   */
  const ambientFloor = useMemo(() => {
    const id = layout.floorMaterialId;
    if (!id) return undefined;
    return (
      (catalog.ambientMaterials ?? []).find(
        (m) => m.id === id && m.surfaceType === 'floor',
      ) ?? undefined
    );
  }, [catalog.ambientMaterials, layout.floorMaterialId]);

  const ambientWall = useMemo(() => {
    const id = layout.wallMaterialId;
    if (!id) return undefined;
    return (
      (catalog.ambientMaterials ?? []).find(
        (m) => m.id === id && m.surfaceType === 'wall',
      ) ?? undefined
    );
  }, [catalog.ambientMaterials, layout.wallMaterialId]);

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

  const pricingCatalog = useMemo((): Catalog => {
    return {
      materials: catalog.materials,
      edges: catalog.edges,
      hardware: catalog.hardware,
      optionGroups: catalog.optionGroups,
      modules: catalog.modules,
      structures: catalog.structures,
      components: catalog.components,
    };
  }, [catalog]);

  const selectedLineSale = useMemo(() => {
    if (!selectedItem) return null;
    return estimateLineSalePrice(project, selectedItem.id, pricingCatalog);
  }, [selectedItem, project, pricingCatalog]);

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
      if (isFreePlacement(p)) continue;
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

  /** Free-floor drag keys (islands). */
  const freeDragByKey = useMemo(() => {
    const out: Record<string, true> = {};
    for (const p of layout.placements) {
      if (!isFreePlacement(p)) continue;
      out[`${p.itemId}#${p.instanceIndex}`] = true;
    }
    return out;
  }, [layout.placements]);

  /**
   * Displayed kitchen layout is shifted to +X/+Y. Free plan coords are unshifted;
   * convert floor hits with this delta.
   */
  const planShiftMm = useMemo(() => {
    const raw = resolveWallFrames(layout.walls);
    const disp = preview.walls;
    if (raw.length === 0 || disp.length === 0) return { x: 0, y: 0 };
    const d0 = disp[0]!;
    const r0 = raw.find((w) => w.id === d0.id) ?? raw[0]!;
    return {
      x: d0.originXMm - r0.originXMm,
      y: d0.originYMm - r0.originYMm,
    };
  }, [layout.walls, preview.walls]);

  const planFrames = useMemo(
    () => resolveWallFrames(layout.walls),
    [layout.walls],
  );

  const planMini = useMemo(() => {
    const underlay = layout.underlay;
    if (
      planFrames.length === 0 &&
      layout.placements.every((p) => !isFreePlacement(p)) &&
      !underlay
    ) {
      return null;
    }
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
    for (const p of layout.placements) {
      if (!isFreePlacement(p)) continue;
      const fx = p.freeXMm ?? 0;
      const fy = p.freeYMm ?? 0;
      minX = Math.min(minX, fx);
      minY = Math.min(minY, fy);
      maxX = Math.max(maxX, fx + 600);
      maxY = Math.max(maxY, fy + 400);
    }
    if (underlay) {
      const ox = underlay.originXMm ?? 0;
      const oy = underlay.originYMm ?? 0;
      minX = Math.min(minX, ox);
      minY = Math.min(minY, oy);
      maxX = Math.max(maxX, ox + underlay.widthMm);
      maxY = Math.max(maxY, oy + underlay.heightMm);
    }
    if (!Number.isFinite(minX)) return null;
    const pad = 24;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const size = 200;
    const scale = (size - pad * 2) / Math.max(spanX, spanY);
    return { minX, minY, pad, scale, size };
  }, [planFrames, layout.placements, layout.underlay]);

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
    // Keep multi-space metadata; write top-level edits into the active space.
    const merged = syncActiveKitchenSpace({
      ...layout,
      ...next,
      spaces: next.spaces ?? layout.spaces,
      activeSpaceId: next.activeSpaceId ?? layout.activeSpaceId,
    });
    onChangeLayout(pruneKitchenLayout(merged, project.items));
  };

  const switchSpace = (spaceId: string) => {
    if (!canEdit) {
      // Read-only: local view only — never persist activeSpaceId on frozen OP.
      setViewSpaceId(spaceId);
      setSelectedKey(null);
      setTargetWallId(null);
      return;
    }
    if (spaceId === activeSpaceId) return;
    commit(setActiveKitchenSpace(layout, spaceId));
    setSelectedKey(null);
    setTargetWallId(null);
  };

  const handleAddSpace = () => {
    if (!canEdit) return;
    const n = (layout.spaces?.length ?? 0) + 1;
    commit(addKitchenSpace(layout, `Espacio ${n}`, newId));
    setSelectedKey(null);
    setTargetWallId(null);
  };

  const handleRenameActiveSpace = (name: string) => {
    if (!canEdit || !activeSpaceId) return;
    commit(renameKitchenSpace(layout, activeSpaceId, name));
  };

  const handleRemoveActiveSpace = () => {
    if (!canEdit || !activeSpaceId) return;
    if ((layout.spaces?.length ?? 0) <= 1) return;
    commit(removeKitchenSpace(layout, activeSpaceId));
    setSelectedKey(null);
    setTargetWallId(null);
  };

  const handleImportPlanFile = async (file: File) => {
    if (!canEdit) return;
    setImportMessage(null);
    const name = file.name || 'plano';
    const lower = name.toLowerCase();

    if (lower.endsWith('.pdf')) {
      setImportMessage(
        'PDF: exportá la 1.ª página como PNG/JPG e importala, o usá un DXF con muros.',
      );
      return;
    }

    if (lower.endsWith('.dxf')) {
      try {
        const text = await readFileAsText(file);
        const result = parseDxfToKitchenWalls(text, { newId });
        if (result.walls.length === 0) {
          setImportMessage(
            result.warnings[0] ??
              'No se pudieron leer muros del DXF. ¿Unidades en metros?',
          );
          return;
        }
        commit({
          ...layout,
          walls: result.walls,
          // Keep existing placements; user can re-place if walls moved.
        });
        setShowPlan2d(true);
        setImportMessage(
          `DXF: ${result.walls.length} muro(s) importado(s)${
            result.warnings[0] ? ` · ${result.warnings[0]}` : ''
          }.`,
        );
      } catch {
        setImportMessage('No se pudo leer el archivo DXF.');
      }
      return;
    }

    if (
      !lower.endsWith('.png') &&
      !lower.endsWith('.jpg') &&
      !lower.endsWith('.jpeg') &&
      !lower.endsWith('.webp') &&
      !file.type.startsWith('image/')
    ) {
      setImportMessage('Formato no soportado. Usá DXF, PNG, JPG o WEBP.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const size = await loadImageSize(dataUrl);
      const underlay = createPlanUnderlay({
        imageUrl: dataUrl,
        pixelWidth: size.width,
        pixelHeight: size.height,
        fileName: name,
      });
      commit({ ...layout, underlay });
      setShowPlan2d(true);
      setImportMessage(
        `Plano «${name}» cargado como fondo. Ajustá el ancho real (mm) abajo.`,
      );
    } catch {
      setImportMessage('No se pudo cargar la imagen del plano.');
    }
  };

  const handleScaleUnderlay = (widthMm: number) => {
    if (!canEdit || !layout.underlay) return;
    if (!Number.isFinite(widthMm) || widthMm < 100) return;
    commit({
      ...layout,
      underlay: scalePlanUnderlay(layout.underlay, widthMm),
    });
  };

  const handleClearUnderlay = () => {
    if (!canEdit) return;
    commit({ ...layout, underlay: undefined });
    setImportMessage(null);
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

  const placeAsIsland = (itemId: string, instanceIndex: number) => {
    if (!canEdit) return;
    const base = ensureWalls();
    const item = project.items.find((it) => it.id === itemId);
    const mod = item
      ? modules.find((m) => m.id === item.moduleId)
      : undefined;
    const dims = item ? resolveItemDims(item, mod) : null;
    const width = dims?.width ?? 600;
    const depth = dims?.depth ?? 560;
    const frames = resolveWallFrames(base.walls);
    let freeXMm = 1200;
    let freeYMm = 1000;
    if (frames.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const f of frames) {
        minX = Math.min(minX, f.originXMm, f.endXMm);
        minY = Math.min(minY, f.originYMm, f.endYMm);
        maxX = Math.max(maxX, f.originXMm, f.endXMm);
        maxY = Math.max(maxY, f.originYMm, f.endYMm);
      }
      freeXMm = Math.round((minX + maxX) / 2 - width / 2);
      freeYMm = Math.round((minY + maxY) / 2 - depth / 2);
    }
    const placement: ProjectItemPlacement = {
      itemId,
      instanceIndex,
      wallId: '',
      offsetMm: 0,
      elevation: 'floor',
      mode: 'free',
      freeXMm,
      freeYMm,
      freeYawDeg: 0,
    };
    commit({
      ...base,
      placements: [...base.placements, placement],
    });
    setSelectedKey(`${itemId}#${instanceIndex}`);
    setInspectorTab('position');
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
    resolvedHardwarePlacements: m.resolvedHardwarePlacements,
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
    if (!placement || isFreePlacement(placement)) return;
    // Final snap without stacking another undo (session already recorded).
    applyOffsetOnWall(itemId, instanceIndex, placement.offsetMm, {
      history: 'none',
      snap: true,
    });
  };

  const applyFreePlanPosition = (
    itemId: string,
    instanceIndex: number,
    planXMm: number,
    planYMm: number,
    opts?: { readonly history?: 'push' | 'none' },
  ) => {
    // Soft 50 mm grid while free-dragging (obra feel without CAD snap).
    const freeXMm = Math.round(planXMm / 50) * 50;
    const freeYMm = Math.round(planYMm / 50) * 50;
    commit(
      {
        ...layout,
        placements: layout.placements.map((p) =>
          p.itemId === itemId && p.instanceIndex === instanceIndex
            ? {
                ...p,
                mode: 'free' as const,
                freeXMm,
                freeYMm,
                freeYawDeg: Number.isFinite(p.freeYawDeg) ? p.freeYawDeg : 0,
              }
            : p,
        ),
      },
      { history: opts?.history ?? 'push' },
    );
  };

  const handleModuleFreeMove = (
    moduleKey: string,
    planXMm: number,
    planYMm: number,
  ) => {
    if (!canEdit) return;
    const hash = moduleKey.lastIndexOf('#');
    if (hash < 0) return;
    const itemId = moduleKey.slice(0, hash);
    const instanceIndex = Number(moduleKey.slice(hash + 1)) || 0;
    applyFreePlanPosition(itemId, instanceIndex, planXMm, planYMm, {
      history: 'none',
    });
  };

  const handleModuleFreeDragStart = (_moduleKey: string) => {
    if (!canEdit || wallDragSession.current) return;
    wallDragSession.current = true;
    setUndoStack((s) => [...s.slice(-29), layout]);
    setRedoStack([]);
  };

  const handleModuleFreeDragEnd = (_moduleKey: string) => {
    wallDragSession.current = false;
  };

  const convertSelectedToIsland = () => {
    if (!canEdit || !selectedPlacement || !selectedRef) return;
    if (isFreePlacement(selectedPlacement)) return;
    const dims = selectedDims;
    const wall = planFrames.find((f) => f.id === selectedPlacement.wallId);
    let freeXMm = selectedPlacement.offsetMm;
    let freeYMm = 800;
    if (wall) {
      const angle = ((wall.angleDeg % 360) + 360) % 360;
      if (angle > 45 && angle < 135) {
        freeXMm = wall.originXMm;
        freeYMm = wall.originYMm + selectedPlacement.offsetMm;
      } else if (angle > 225 && angle < 315) {
        freeXMm = wall.originXMm;
        freeYMm = wall.originYMm - selectedPlacement.offsetMm;
      } else if (angle >= 135 && angle <= 225) {
        freeXMm = wall.originXMm - selectedPlacement.offsetMm;
        freeYMm = wall.originYMm;
      } else {
        freeXMm = wall.originXMm + selectedPlacement.offsetMm;
        freeYMm = wall.originYMm;
      }
    }
    // Nudge slightly into the room so it is not stuck in the wall plane.
    const depth = dims?.depth ?? 560;
    freeYMm = Math.round(freeYMm + depth * 0.15);
    commit({
      ...layout,
      placements: layout.placements.map((p) =>
        p.itemId === selectedPlacement.itemId &&
        p.instanceIndex === selectedPlacement.instanceIndex
          ? {
              itemId: p.itemId,
              instanceIndex: p.instanceIndex,
              wallId: '',
              offsetMm: 0,
              elevation: 'floor' as const,
              mode: 'free' as const,
              freeXMm: Math.round(freeXMm),
              freeYMm: Math.round(freeYMm),
              freeYawDeg: 0,
              ...(p.baseClearanceMm === undefined
                ? {}
                : { baseClearanceMm: p.baseClearanceMm }),
            }
          : p,
      ),
    });
  };

  const convertSelectedToWall = () => {
    if (!canEdit || !selectedPlacement || !activeWallId) return;
    if (!isFreePlacement(selectedPlacement)) return;
    const offset = nextOffsetOnWall(layout, activeWallId, footprints, 20);
    commit({
      ...layout,
      placements: layout.placements.map((p) => {
        if (
          p.itemId !== selectedPlacement.itemId ||
          p.instanceIndex !== selectedPlacement.instanceIndex
        ) {
          return p;
        }
        const {
          mode: _m,
          freeXMm: _x,
          freeYMm: _y,
          freeYawDeg: _yaw,
          ...rest
        } = p;
        return {
          ...rest,
          wallId: activeWallId,
          offsetMm: offset,
        };
      }),
    });
    setTargetWallId(activeWallId);
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
          {quoteSalePrice != null ? (
            <span
              className="spatial-studio__quote-total"
              data-testid="spatial-studio-quote-total"
              title="Total de venta de la cotización"
            >
              Total {formatProjectMoney(quoteSalePrice, project.currency)}
            </span>
          ) : null}
        </div>
        <div
          className="spatial-studio__spaces"
          role="tablist"
          aria-label="Ambientes del plano"
          data-testid="spatial-studio-spaces"
        >
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === activeSpaceId}
              className={
                s.id === activeSpaceId
                  ? 'spatial-studio__space-tab spatial-studio__space-tab--active'
                  : 'spatial-studio__space-tab'
              }
              onClick={() => switchSpace(s.id)}
              data-testid={`spatial-studio-space-${s.id}`}
            >
              {s.name}
            </button>
          ))}
          {canEdit ? (
            <button
              type="button"
              className="spatial-studio__space-tab spatial-studio__space-tab--add"
              onClick={handleAddSpace}
              title="Agregar ambiente (baño, living…)"
              data-testid="spatial-studio-add-space"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden /> Ambiente
            </button>
          ) : null}
        </div>
        <div className="spatial-studio__chrome-actions">
          {!statusCanEdit ? (
            <span className="spatial-studio__frozen" data-testid="spatial-studio-frozen">
              <Lock size={14} strokeWidth={1.5} aria-hidden /> Plano congelado
              (solo lectura)
            </span>
          ) : editBlocked ? (
            <span
              className="spatial-studio__plan-locked"
              data-testid="spatial-studio-plan-locked"
              title="Otro usuario tiene el plano abierto. Podés ver, no editar."
            >
              <Lock size={14} strokeWidth={1.5} aria-hidden />
              {lockHolderName
                ? `${lockHolderName} está editando el plano`
                : 'Otro usuario está editando el plano'}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            data-testid="spatial-studio-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden /> Volver a cotización
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
            <div className="spatial-studio__sidebar-head-actions">
              {canEdit && onRequestAddItem ? (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={onRequestAddItem}
                  data-testid="spatial-studio-add-item"
                  title="Agregar mueble a la cotización"
                >
                  <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar
                </button>
              ) : null}
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
          </div>

          {defaultWallsMsg ? (
            <p
              className="spatial-studio__import-msg"
              role="status"
              data-testid="spatial-studio-default-walls-msg"
            >
              {defaultWallsMsg}
            </p>
          ) : null}

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
            <h3 className="spatial-studio__section-title">
              Ambiente · {activeSpaceName}
            </h3>
            {canEdit ? (
              <label className="spatial-studio__field">
                <span>Nombre del ambiente</span>
                <input
                  type="text"
                  value={activeSpaceName}
                  disabled={!canEdit}
                  onChange={(e) => handleRenameActiveSpace(e.target.value)}
                  data-testid="spatial-studio-space-name"
                />
              </label>
            ) : null}
            {canEdit && spaces.length > 1 ? (
              <button
                type="button"
                className="btn btn--small"
                onClick={handleRemoveActiveSpace}
                title="Eliminar este ambiente y sus colocaciones"
                data-testid="spatial-studio-remove-space"
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden /> Eliminar
                ambiente
              </button>
            ) : null}

            {canEdit ? (
              <div className="spatial-studio__import">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".dxf,.png,.jpg,.jpeg,.webp,.pdf,image/*"
                  className="spatial-studio__import-input"
                  data-testid="spatial-studio-import-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void handleImportPlanFile(f);
                  }}
                />
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => importInputRef.current?.click()}
                  title="Importar DXF (muros) o imagen de plano (fondo)"
                  data-testid="spatial-studio-import-plan"
                >
                  <FileUp size={14} strokeWidth={1.5} aria-hidden /> Importar
                  plano
                </button>
                {layout.underlay ? (
                  <>
                    <label className="spatial-studio__field">
                      <span>
                        Ancho real del plano (mm)
                        {layout.underlay.fileName
                          ? ` · ${layout.underlay.fileName}`
                          : ''}
                      </span>
                      <input
                        type="number"
                        min={100}
                        step={50}
                        value={Math.round(layout.underlay.widthMm)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) handleScaleUnderlay(v);
                        }}
                        data-testid="spatial-studio-underlay-width"
                      />
                    </label>
                    <p className="spatial-studio__hint">
                      Alto efectivo:{' '}
                      {Math.round(layout.underlay.heightMm)} mm · opacity{' '}
                      {Math.round((layout.underlay.opacity ?? 0.45) * 100)}%
                    </p>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={handleClearUnderlay}
                      data-testid="spatial-studio-clear-underlay"
                    >
                      Quitar fondo
                    </button>
                  </>
                ) : (
                  <p className="spatial-studio__hint">
                    DXF → muros · PNG/JPG → fondo para trazar. PDF: exportá a
                    imagen.
                  </p>
                )}
                {importMessage ? (
                  <p
                    className="spatial-studio__import-msg"
                    data-testid="spatial-studio-import-msg"
                    role="status"
                  >
                    {importMessage}
                  </p>
                ) : null}
              </div>
            ) : null}

            {layout.walls.length === 0 ? (
              <div className="spatial-studio__empty-walls">
                <p className="spatial-studio__hint">
                  Todavía no hay muros en «{activeSpaceName}». Creá una L para
                  empezar a colocar.
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

                <label className="spatial-studio__field">
                  <span>Piso (escena 3D)</span>
                  <select
                    value={layout.floorMaterialId ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      commit({
                        ...layout,
                        floorMaterialId: e.target.value || undefined,
                      })
                    }
                    data-testid="spatial-studio-floor-picker"
                  >
                    <option value="">— Sin piso —</option>
                    {(catalog.ambientMaterials ?? [])
                      .filter((m) => m.active && m.surfaceType === 'floor')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.code})
                        </option>
                      ))}
                  </select>
                </label>

                <label className="spatial-studio__field">
                  <span>Pared (escena 3D)</span>
                  <select
                    value={layout.wallMaterialId ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      commit({
                        ...layout,
                        wallMaterialId: e.target.value || undefined,
                      })
                    }
                    data-testid="spatial-studio-wall-picker"
                  >
                    <option value="">— Sin pared —</option>
                    {(catalog.ambientMaterials ?? [])
                      .filter((m) => m.active && m.surfaceType === 'wall')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.code})
                        </option>
                      ))}
                  </select>
                </label>

                <label className="spatial-studio__field spatial-studio__check-row">
                  <input
                    type="checkbox"
                    checked={layout.showCeiling === true}
                    disabled={!canEdit}
                    onChange={(e) =>
                      commit({
                        ...layout,
                        showCeiling: e.target.checked,
                      })
                    }
                    data-testid="spatial-studio-toggle-ceiling"
                  />
                  <span>Mostrar techo</span>
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
                          {canEdit ? (
                            <span className="spatial-studio__place-actions">
                              {activeWallId ? (
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
                              <button
                                type="button"
                                className="btn btn--small"
                                title="Colocar como isla libre en el plano"
                                onClick={() =>
                                  placeAsIsland(f.itemId, f.instanceIndex)
                                }
                                data-testid={`spatial-studio-place-island-${f.itemId}-${f.instanceIndex}`}
                              >
                                Isla
                              </button>
                            </span>
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
                    : ''}
                  . «Isla» coloca libre en el piso.
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
                            {p.free
                              ? `Isla · ${Math.round(p.freeXMm ?? 0)}, ${Math.round(p.freeYMm ?? 0)}`
                              : `${p.elevation === 'wall' ? 'Alto' : 'Piso'} · ${Math.round(p.offsetMm)} mm`}
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
              Mueble = arrastrar (muro/isla) · muro = activar · vacío = orbitar
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
              <label
                className="spatial-studio__lighting-field"
                title="Iluminación de la escena 3D"
              >
                <span className="spatial-studio__sr-only">Iluminación</span>
                <select
                  value={lightingMode}
                  onChange={(e) =>
                    setLightingMode(e.target.value as SceneLightingMode)
                  }
                  data-testid="spatial-studio-lighting"
                  aria-label="Modo de iluminación"
                >
                  <option value="present">Luz: Presentación</option>
                  <option value="workshop">Luz: Taller</option>
                  <option value="soft">Luz: Suave</option>
                </select>
              </label>
              <label
                className="spatial-studio__lighting-field"
                title="Cómo se pinta: acabados del material o colores por rol de taller"
              >
                <span className="spatial-studio__sr-only">Cómo se pinta</span>
                <select
                  value={colorMode}
                  onChange={(e) =>
                    setColorMode(e.target.value as BoardColorMode)
                  }
                  data-testid="spatial-studio-color-mode"
                  aria-label="Cómo se pinta la escena"
                >
                  <option value="material">Pintura: Acabados</option>
                  <option value="role">Pintura: Roles taller</option>
                </select>
              </label>
              {colorMode === 'material' ? (
                <label
                  className="spatial-studio__lighting-field"
                  title="Vista del acabado: solo color, color con veta, o textura foto"
                >
                  <span className="spatial-studio__sr-only">
                    Vista del acabado
                  </span>
                  <select
                    value={surfaceMode}
                    onChange={(e) =>
                      setSurfaceMode(e.target.value as MaterialSurfaceMode)
                    }
                    data-testid="spatial-studio-surface-mode"
                    aria-label="Vista del acabado del material"
                  >
                    <option value="color">Relleno: Solo color</option>
                    <option value="grain">Relleno: Color + veta</option>
                    <option value="texture">Relleno: Textura</option>
                  </select>
                </label>
              ) : null}
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
                colorMode={colorMode}
                materialColors={materialColors}
                materialTextures={materialTextures}
                surfaceMode={surfaceMode}
                lightingMode={lightingMode}
                showOutlines={showOutlines}
                showWireframe={showWireframe}
                showFloorGrid={showFloorGrid}
                ambientFloor={ambientFloor}
                ambientWall={ambientWall}
                showCeiling={layout.showCeiling}
                hardwareCatalog={catalog.hardware}
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
                freeDragByKey={freeDragByKey}
                planShiftMm={planShiftMm}
                onModuleFreeMove={handleModuleFreeMove}
                onModuleFreeDragStart={handleModuleFreeDragStart}
                onModuleFreeDragEnd={handleModuleFreeDragEnd}
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
                {layout.underlay ? (
                  <image
                    href={
                      resolveMediaUrl?.(layout.underlay.imageUrl) ??
                      layout.underlay.imageUrl
                    }
                    x={
                      planMini.pad +
                      ((layout.underlay.originXMm ?? 0) - planMini.minX) *
                        planMini.scale
                    }
                    y={
                      planMini.pad +
                      ((layout.underlay.originYMm ?? 0) - planMini.minY) *
                        planMini.scale
                    }
                    width={layout.underlay.widthMm * planMini.scale}
                    height={layout.underlay.heightMm * planMini.scale}
                    opacity={layout.underlay.opacity ?? 0.45}
                    preserveAspectRatio="none"
                    data-testid="spatial-studio-underlay-image"
                  />
                ) : null}
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
                  const key = `${p.itemId}#${p.instanceIndex}`;
                  const selected = selectedKey === key;
                  const itemStub =
                    project.items.find((i) => i.id === p.itemId) ?? {
                      id: p.itemId,
                      moduleId: '',
                      quantity: 1,
                      optionChoices: {},
                    };
                  const w = moduleWidth(itemStub, modules);
                  const item = project.items.find((i) => i.id === p.itemId);
                  const mod = item
                    ? modules.find((m) => m.id === item.moduleId)
                    : undefined;
                  const depth =
                    resolveItemDims(itemStub, mod)?.depth ?? 560;

                  if (isFreePlacement(p)) {
                    const fx = p.freeXMm ?? 0;
                    const fy = p.freeYMm ?? 0;
                    const rx =
                      planMini.pad + (fx - planMini.minX) * planMini.scale;
                    const ry =
                      planMini.pad + (fy - planMini.minY) * planMini.scale;
                    const rw = Math.max(6, w * planMini.scale);
                    const rh = Math.max(6, depth * planMini.scale * 0.35);
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
                            : '#eab308'
                        }
                        opacity={0.9}
                        rx={1}
                        onClick={() => {
                          setSelectedKey(key);
                          setInspectorTab('position');
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  }

                  const wall = planFrames.find((f) => f.id === p.wallId);
                  if (!wall) return null;
                  const angle = ((wall.angleDeg % 360) + 360) % 360;
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
                {selectedLineSale != null ? (
                  <p
                    className="spatial-studio__line-price"
                    data-testid="spatial-studio-line-price"
                  >
                    Línea{' '}
                    {formatProjectMoney(selectedLineSale, project.currency)}
                    <span className="spatial-studio__line-price-hint">
                      {' '}
                      · est. sin MO fija
                    </span>
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
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() =>
                            placeAsIsland(
                              selectedRef.itemId,
                              selectedRef.instanceIndex,
                            )
                          }
                          data-testid="spatial-studio-place-island-selected"
                        >
                          Colocar como isla
                        </button>
                      ) : null}
                    </div>
                  ) : isFreePlacement(selectedPlacement) ? (
                    <>
                      <p
                        className="spatial-studio__hint"
                        data-testid="spatial-studio-free-mode"
                      >
                        Isla libre — arrastrá en el piso 3D (grilla 50 mm).
                      </p>
                      <label className="spatial-studio__field">
                        <span>X plano (mm)</span>
                        <input
                          type="number"
                          step={50}
                          value={Math.round(selectedPlacement.freeXMm ?? 0)}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            applyFreePlanPosition(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              v,
                              selectedPlacement.freeYMm ?? 0,
                            );
                          }}
                          data-testid="spatial-studio-free-x"
                        />
                      </label>
                      <label className="spatial-studio__field">
                        <span>Y plano (mm)</span>
                        <input
                          type="number"
                          step={50}
                          value={Math.round(selectedPlacement.freeYMm ?? 0)}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            applyFreePlanPosition(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              selectedPlacement.freeXMm ?? 0,
                              v,
                            );
                          }}
                          data-testid="spatial-studio-free-y"
                        />
                      </label>
                      <label className="spatial-studio__field">
                        <span>Rotación (°)</span>
                        <select
                          value={Math.round(selectedPlacement.freeYawDeg ?? 0)}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const yaw = Number(e.target.value);
                            if (!Number.isFinite(yaw)) return;
                            patchPlacement(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              { freeYawDeg: yaw, mode: 'free' },
                            );
                          }}
                          data-testid="spatial-studio-free-yaw"
                        >
                          <option value={0}>0° — +X</option>
                          <option value={90}>90° — +Y</option>
                          <option value={180}>180°</option>
                          <option value={270}>270°</option>
                        </select>
                      </label>
                      {canEdit && activeWallId ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={convertSelectedToWall}
                          data-testid="spatial-studio-to-wall"
                        >
                          Anclar a muro activo
                        </button>
                      ) : null}
                      {canEdit ? (
                        <>
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
                            Sacar del plano (sigue en cotización)
                          </button>
                          <p className="spatial-studio__hint">
                            Sacar del plano no borra el mueble de la cotización.
                          </p>
                        </>
                      ) : null}
                    </>
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

                      {canEdit ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={convertSelectedToIsland}
                          data-testid="spatial-studio-to-island"
                        >
                          Convertir a isla
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
                        <>
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
                            Sacar del plano (sigue en cotización)
                          </button>
                          <p className="spatial-studio__hint">
                            Cambiar muro con el selector de arriba. Sacar del
                            plano no borra el mueble de la cotización.
                          </p>
                        </>
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

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('read failed'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('read failed'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function loadImageSize(
  src: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || img.width || 1,
        height: img.naturalHeight || img.height || 1,
      });
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}
