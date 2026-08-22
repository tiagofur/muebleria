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
  EnvironmentCommandResult,
  KitchenWall,
  MaterialCategory,
  Module,
  ModuleCategory,
  PlacementElevation,
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from '@muebles/domain';
import {
  addKitchenSpace,
  addOpening,
  addWall,
  allKitchenPlacements,
  alignSelectionCommand,
  BASE_CLEARANCE_PRESETS_MM,
  centerSelectionOnWallCommand,
  compactSelectionOnWallCommand,
  copySelectionToClipboard,
  createDefaultLWalls,
  createPlanUnderlay,
  DEFAULT_BASE_CLEARANCE_MM,
  DEFAULT_WALL_CABINET_Z_MM,
  defaultMeasurePresetId,
  distributeSelectionCommand,
  duplicateSelectionCommand,
  emptyKitchenLayout,
  MIN_WALL_LENGTH_MM,
  moduleAcceptsCustomDims,
  nudgeSelectionCommand,
  parsePlacementKey,
  ensureKitchenSpaces,
  isFreePlacement,
  kitchenLayoutWarnings,
  nextOffsetOnWall,
  parseDxfToKitchenWalls,
  pasteClipboardCommand,
  pasteRelativeCommand,
  placedModuleCollides,
  planEditSessionHeldByOther,
  pruneKitchenLayout,
  removeKitchenSpace,
  removeOpening,
  removeWall,
  renameKitchenSpace,
  repackPlacementsOnWall,
  reorderPlacementOnWall,
  resolveAmbientMaterials,
  resolveBaseClearanceMm,
  resolveItemDims as domainResolveItemDims,
  resolveModuleBaseMode,
  updateOpening,
  updateWall,
  validateItemCustomDims,
  resolveWallCabinetZMm,
  resolveWallFrames,
  scalePlanUnderlay,
  seedDefaultLWallsIfEmpty,
  setActiveKitchenSpace,
  snapOffsetOnWall,
  splitWallSegments,
  syncActiveKitchenSpace,
  WALL_OPENING_DEFAULTS_MM,
  WALL_OPENING_KIND_LABELS_ES,
  PATAS_ROLE,
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
  WALL_CABINET_Z_PRESETS_MM,
  type ClipboardEntry,
  type LayoutCommandResult,
  type WallOpeningKind,
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
  Focus,
  Lock,
  Map as MapIcon,
  Move3d,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  RefreshCw,
  Ruler,
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
  type PaintDrop,
  type PaintSurface,
  type SceneLightingMode,
} from '../../preview3d';
import { MaterialPalette } from '../../preview3d/MaterialPalette';
import {
  BoardMaterialPalette,
  BOARD_APPLY_SCOPES,
  type BoardApplyScope,
} from '../../preview3d/BoardMaterialPalette';
import {
  PAINT_DRAG_MIME,
  UNPLACED_DRAG_MIME,
  canApplyMaterial,
  decodePaintDrag,
  encodeUnplacedDrag,
} from '../../preview3d/paintMaterial';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';
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
import {
  estimateLineSalePrice,
  formatProjectMoney,
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  setItemOptionChoice,
} from '../projectHelpers';
import type { Catalog, ModuleBaseMode } from '@muebles/domain';
import { WorkspaceTabs } from '../../common/Tabs';
import { ModuleLibraryPanel, moduleDefaultDims } from './library/ModuleLibraryPanel';
import { useLibraryCollections } from './library/useLibraryFavorites';
import {
  applySelectionClick,
  applySelectionRange,
  EMPTY_STUDIO_SELECTION,
  isSelected,
  modifiersFromPointer,
  primarySelectionKey,
  pruneSelection,
  type StudioSelection,
} from './studioSelection';
import { StudioSelectionBar } from './StudioSelectionBar';
import {
  pushPlanHistory,
  redoLabelOf,
  undoLabelOf,
  type PlanHistoryEntry,
} from './studioHistory';
import {
  useStudioPrecisionSettings,
} from './studioPrecisionSettings';
import './projectSpatialStudio.css';

const FurnitureScene3D = lazy(() =>
  import('../../preview3d').then((m) => ({ default: m.FurnitureScene3D })),
);

export type ProjectSpatialStudioProps = {
  readonly open: boolean;
  readonly project: Project;
  readonly modules: readonly Module[];
  /** F141 (#309): categorías jerárquicas para la biblioteca lateral. */
  readonly categories?: readonly ModuleCategory[];
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
  /**
   * F141 (#309): insert rápido desde la biblioteca (mismo camino que el modal
   * add-item). Devuelve el id del ítem creado o null si no se pudo crear.
   */
  readonly onInsertFromCatalog?: (moduleId: string) => string | null;
  /** F142: subgrupos de tableros para el dock de materiales. */
  readonly materialCategories?: readonly MaterialCategory[];
  /**
   * F142: aplica un choice a nivel proyecto (scope "Frentes de toda la obra").
   */
  readonly onUpdateProjectLevelChoice?: (groupCode: string, optionId: string) => void;
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
/**
 * Tabs del sidebar izquierdo = fuentes de inserción (¿qué puedo insertar?).
 * Las propiedades del ambiente viven en el inspector derecho (¿qué puedo
 * cambiar?) cuando no hay mueble seleccionado (North Star §8.3).
 */
export type SidebarTab = 'modules' | 'materials';

/**
 * F065/F141: estado del ghost durante un drag al viewport. `unplaced` arrastra
 * un ítem existente sin colocar; `library` arrastra una tarjeta del catálogo —
 * el ítem se crea recién al confirmar el drop (inserción atómica).
 */
type GhostDragState =
  | {
      readonly kind: 'unplaced';
      readonly itemId: string;
      readonly instanceIndex: number;
      readonly widthMm: number;
      readonly heightMm: number;
      readonly depthMm: number;
    }
  | {
      readonly kind: 'library';
      readonly moduleId: string;
      readonly widthMm: number;
      readonly heightMm: number;
      readonly depthMm: number;
    };

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * F145 — input numérico/texto que commitea en blur/Enter como UNA intención
 * (bar F144 §12: la ráfaga de teclas no genera una entrada de undo por tecla).
 * El draft local se re-sincroniza cuando la prop cambia (undo, comandos).
 */
function CommitOnBlurInput({
  value,
  onCommit,
  testId,
  type = 'number',
  min,
  max,
  step,
  title,
  ariaLabel,
}: {
  readonly value: string | number;
  readonly onCommit: (raw: string) => void;
  readonly testId: string;
  readonly type?: 'number' | 'text';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly title?: string;
  readonly ariaLabel?: string;
}): ReactNode {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type={type}
      value={draft}
      min={min}
      max={max}
      step={step}
      title={title}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== String(value)) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(String(value));
      }}
      data-testid={testId}
    />
  );
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
  // F144: fuente única de dims (a medida → preset → módulo).
  const resolved = domainResolveItemDims(
    {
      customDims: item.customDims,
      measurePresetId:
        item.measurePresetId?.trim() || defaultMeasurePresetId(module) || undefined,
    },
    module,
  );
  if (resolved.source === 'fallback') return { width: 600, height: 720, depth: 560 };
  return { width: resolved.width, height: resolved.height, depth: resolved.depth };
}

export function ProjectSpatialStudio({
  open,
  project,
  modules,
  categories = [],
  catalog,
  canEdit: statusCanEdit,
  onClose,
  onChangeLayout,
  onUpdateItem,
  resolveMediaUrl,
  quoteSalePrice = null,
  bootstrap = null,
  onInsertFromCatalog,
  materialCategories = [],
  onUpdateProjectLevelChoice,
  planActor,
  onAcquirePlanEdit,
  onRenewPlanEdit,
  onReleasePlanEdit,
}: ProjectSpatialStudioProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [planLockBlocked, setPlanLockBlocked] = useState(false);
  /**
   * F143 — selección múltiple: lista ordenada de claves `${itemId}#${i}`; la
   * primera es la primaria (alimenta el inspector y referencia "pegar a…").
   */
  const [selection, setSelection] = useState<StudioSelection>(
    EMPTY_STUDIO_SELECTION,
  );
  const selectedKey = primarySelectionKey(selection);
  /** F143 — clipboard interno del studio (snapshot de instancias copiadas). */
  const [clipboard, setClipboard] = useState<readonly ClipboardEntry[]>([]);
  const [pasteCursorByWall, setPasteCursorByWall] = useState<
    Record<string, number>
  >({});
  /** F143 — modo detalle: drill-down a pieza/herraje de la unidad primaria. */
  const [detailMode, setDetailMode] = useState(false);
  const [detailPartId, setDetailPartId] = useState<string | null>(null);
  const [detailHardwareId, setDetailHardwareId] = useState<string | null>(null);
  /** F143 — feedback de comandos (errores que enseñan, aria-live). */
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  /** F144 — issues de validación de "A medida" (no commitea inválido). */
  const [dimDraftIssues, setDimDraftIssues] = useState<
    readonly { readonly field: string; readonly message: string }[]
  >([]);
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
    readonly type: 'front' | 'top' | 'side' | 'isometric' | 'fit-selection';
    readonly ts: number;
    readonly fit?: {
      readonly centerX: number;
      readonly centerY: number;
      readonly heightMm: number;
      readonly spanMm: number;
    };
  }>({ type: 'isometric', ts: 0 });
  /**
   * F145 — vista recordada por ambiente: al cambiar de espacio se re-encuadra
   * con la vista que ese ambiente tenía (default 3/4), sin heredar el encuadre
   * del espacio anterior.
   */
  const cameraBySpaceRef = useRef<Record<string, 'front' | 'top' | 'side' | 'isometric'>>(
    {},
  );
  /** F145 — modo «ocultar muros»: fantasma los muros entre cámara y ambiente. */
  const [hideOccludingWalls, setHideOccludingWalls] = useState(false);
  /** F145 — mensajes que enseñan (agregar/quitar muro, huecos). */
  const [envMessage, setEnvMessage] = useState<string | null>(null);
  /** F145 — largo propuesto para el próximo muro (input «Agregar muro»). */
  const [newWallLengthMm, setNewWallLengthMm] = useState(3000);
  /** F144 — ajustes de precisión del taller (nudge/snap), persistentes. */
  const precision = useStudioPrecisionSettings();
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('modules');
  /** F141v2: sub-pestañas del tab Muebles — biblioteca (insert) vs ítems de la obra. */
  const [modulesSubTab, setModulesSubTab] = useState<'library' | 'items'>(
    'library',
  );
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [undoStack, setUndoStack] = useState<PlanHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<PlanHistoryEntry[]>([]);
  const [showFloorGrid, setShowFloorGrid] = useState(true);
  const [lightingMode, setLightingMode] = useState<SceneLightingMode>(
    DEFAULT_SCENE_LIGHTING_MODE,
  );
  const [paintHoverSurface, setPaintHoverSurface] = useState<PaintSurface | null>(
    null,
  );
  const [draggingInvalid, setDraggingInvalid] = useState(false);

  // F065/F141 — ghost drag al viewport 3D (ítem sin colocar o tarjeta de biblioteca)
  const [ghostDrag, setGhostDrag] = useState<GhostDragState | null>(null);
  const [ghostHit, setGhostHit] = useState<{
    readonly wallId: string | null;
    readonly offsetMm: number;
    readonly planXMm: number;
    readonly planYMm: number;
  } | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [defaultWallsMsg, setDefaultWallsMsg] = useState<string | null>(null);
  // F141 — favoritos/recientes/mi taller de la biblioteca (localStorage v1).
  const libraryCollections = useLibraryCollections();
  // F142 — dock de tableros: sub-tab, scope de aplicación, drag y feedback.
  const [materialsSubTab, setMaterialsSubTab] = useState<'ambient' | 'boards'>(
    'ambient',
  );
  const [boardScope, setBoardScope] = useState<BoardApplyScope>('fronts');
  const [boardPaintHoverKey, setBoardPaintHoverKey] = useState<string | null>(
    null,
  );
  const [boardStatus, setBoardStatus] = useState<string | null>(null);
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
      setModulesSubTab('library');
      setDetailMode(false);
      setDetailPartId(null);
      setDetailHardwareId(null);
      setCommandStatus(null);
      setPasteCursorByWall({});
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
    if (bootstrap.listFilter) {
      setListFilter(bootstrap.listFilter);
      // El cue "sin colocar" vive en la sub-pestaña de ítems de la obra.
      setModulesSubTab('items');
    }
    if (bootstrap.selectKey) {
      setSelection({ keys: [bootstrap.selectKey], anchorKey: bootstrap.selectKey });
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

  /** F143 — teclado: Esc con precedencia (ghost > detalle > selección > cerrar) + atajos. */
  useEffect(() => {
    if (!open) return;
    const isTyping = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable);
    /**
     * F144 — las flechas pertenecen al widget enfocado: el roving tabindex
     * de los tabs (a11y) navega tabs con ←/→; el nudge sólo aplica cuando
     * el foco no está en un widget que consume flechas.
     */
    const arrowsOwnedByWidget = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement && Boolean(t.closest('[role="tablist"]'));
    const onKey = (e: KeyboardEvent) => {
      const modalOpen = Boolean(document.querySelector('.ui-modal-root.is-open'));
      if (e.key === 'Escape') {
        // F065: si hay un ghost drag activo, cancelar el drag primero.
        if (ghostDrag) {
          setGhostDrag(null);
          setGhostHit(null);
          return;
        }
        // Nested dialogs (e.g. Agregar mueble) own Esc; do not close the studio.
        if (modalOpen) return;
        // F144: el popover de precisión se cierra antes que nada del studio.
        if (precisionOpen) {
          setPrecisionOpen(false);
          return;
        }
        if (detailPartId || detailHardwareId) {
          setDetailPartId(null);
          setDetailHardwareId(null);
          return;
        }
        if (selection.keys.length > 0) {
          setSelection(EMPTY_STUDIO_SELECTION);
          return;
        }
        onClose();
        return;
      }
      if (modalOpen || isTyping(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;
      const arrowsForNudge =
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown';
      if (arrowsForNudge && arrowsOwnedByWidget(e.target)) return;
      if (meta && (e.key === 'c' || e.key === 'C')) {
        handleCopySelection();
        return;
      }
      // F144 — undo/redo por intención (§12), sin pelear con el navegador.
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoPlan();
        else undoPlan();
        return;
      }
      // F144 — Enfocar selección (acción de vista; también en modo lectura).
      if (!meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        fitSelection();
        return;
      }
      // F144 — nudge de teclado: la selección gana sobre la órbita (#188).
      if (selection.keys.length > 0 && !detailMode && arrowsForNudge) {
        const step = precision.nudgeStepFor(e.shiftKey);
        const handled = handleNudgeSelection(
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        );
        if (handled) e.preventDefault();
        return;
      }
      if (!canEdit) return;
      if (meta && (e.key === 'v' || e.key === 'V')) {
        handlePaste();
        return;
      }
      if (meta && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        handleDuplicateSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleRemoveSelectionFromPlan();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  /** F143 — orden visible de la lista (sin colocar primero) para Shift+rango. */
  const listOrderedKeys = useMemo(
    () => [
      ...unplaced.map((f) => `${f.itemId}#${f.instanceIndex}`),
      ...placedEntries.map((p) => `${p.itemId}#${p.instanceIndex}`),
    ],
    [unplaced, placedEntries],
  );

  /** F143 — la selección se auto-purga cuando las instancias dejan de existir. */
  const validSelectionKeys = useMemo(
    () => footprints.map((f) => `${f.itemId}#${f.instanceIndex}`),
    [footprints],
  );
  useEffect(() => {
    setSelection((s) => pruneSelection(s, validSelectionKeys));
  }, [validSelectionKeys]);


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

  const availableAmbientMaterials = useMemo(
    () => resolveAmbientMaterials(catalog.ambientMaterials),
    [catalog.ambientMaterials],
  );

  /**
   * Resolve active space ambient refs (floor/wall) against custom + default
   * ambientMaterials collection. FurnitureScene3D receives ready AmbientMaterial
   * props (consistent with materialColors).
   */
  const ambientFloor = useMemo(() => {
    const id = layout.floorMaterialId;
    if (!id) return undefined;
    return availableAmbientMaterials.find((m) => m.id === id) ?? undefined;
  }, [availableAmbientMaterials, layout.floorMaterialId]);

  const ambientWall = useMemo(() => {
    const id = layout.wallMaterialId;
    if (!id) return undefined;
    return availableAmbientMaterials.find((m) => m.id === id) ?? undefined;
  }, [availableAmbientMaterials, layout.wallMaterialId]);

  const ambientCeiling = useMemo(() => {
    const id = layout.ceilingMaterialId;
    if (!id) return undefined;
    return availableAmbientMaterials.find((m) => m.id === id) ?? undefined;
  }, [availableAmbientMaterials, layout.ceilingMaterialId]);

  const ambientCountertop = useMemo(() => {
    const id = layout.countertopMaterialId;
    if (!id) return undefined;
    return availableAmbientMaterials.find((m) => m.id === id) ?? undefined;
  }, [availableAmbientMaterials, layout.countertopMaterialId]);

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

  /**
   * F143 — capacidades de la selección para la barra de acciones: comandos de
   * muro exigen muro común; alinear bordes es para islas (en 1D apilaría).
   */
  const selectionCapabilities = useMemo(() => {
    const placed = selection.keys
      .map((key) => {
        const hash = key.lastIndexOf('#');
        return layout.placements.find(
          (p) =>
            p.itemId === key.slice(0, hash) &&
            p.instanceIndex === Number(key.slice(hash + 1)),
        );
      })
      .filter((p): p is ProjectItemPlacement => Boolean(p));
    const onWall = placed.filter((p) => !isFreePlacement(p));
    const islands = placed.filter((p) => isFreePlacement(p));
    const wallIds = new Set(onWall.map((p) => p.wallId));
    const singleWall = wallIds.size === 1 && onWall.length > 0;
    const wall = singleWall
      ? layout.walls.find((w) => w.id === [...wallIds][0])
      : undefined;
    return {
      count: selection.keys.length,
      allPlacedOnWall: singleWall && onWall.length === selection.keys.length,
      allIslands: islands.length > 0 && islands.length === selection.keys.length,
      wallName: wall?.name?.trim() || null,
      primaryPlacedOnWall: Boolean(
        selectedPlacement && !isFreePlacement(selectedPlacement),
      ),
    };
  }, [selection.keys, layout.placements, layout.walls, selectedPlacement]);

  /**
   * F143 — target del modo detalle (pieza/herraje de la unidad primaria),
   * resuelto on-the-fly desde el preview del proyecto.
   */
  const detailTarget = useMemo(() => {
    if (!detailMode || !selectedKey) return null;
    const mod = preview.modules.find((m) => m.instanceKey === selectedKey);
    if (!mod) return null;
    if (detailPartId) {
      const part = mod.parts.find((p) => p.id === detailPartId);
      if (part) return { kind: 'part' as const, part };
    }
    if (detailHardwareId) {
      const sep = detailHardwareId.indexOf(':');
      const componentInstanceId = detailHardwareId.slice(0, sep);
      const hardwareId = detailHardwareId.slice(sep + 1);
      const placement = (mod.resolvedHardwarePlacements ?? []).find(
        (p) => p.componentInstanceId === componentInstanceId && p.hardwareId === hardwareId,
      );
      if (placement) {
        const hardware = catalog.hardware.find((h) => h.id === placement.hardwareId);
        return { kind: 'hardware' as const, placement, hardware };
      }
    }
    return null;
  }, [detailMode, selectedKey, detailPartId, detailHardwareId, preview.modules, catalog.hardware]);

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
        catalog.agregados,
        selectedItem?.baseMode,
      ),
    [selectedModule, catalog, selectedItem],
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

  const planPlacements2D = useMemo(() => {
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
      const wall = planFrames.find((f) => f.id === p.wallId);

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
  }, [layout.placements, planFrames, project.items, modules]);

  const planMini = useMemo(() => {
    const underlay = layout.underlay;
    if (
      planFrames.length === 0 &&
      planPlacements2D.length === 0 &&
      !underlay
    ) {
      return null;
    }
    const bounds = resolvePlanBounds({
      wallFrames: planFrames,
      placements: planPlacements2D,
      underlay,
      minDimensionMm: 500,
    });
    const pad = 24;
    const spanX = Math.max(bounds.widthMm, 1);
    const spanY = Math.max(bounds.heightMm, 1);
    const size = 200;
    const scale = (size - pad * 2) / Math.max(spanX, spanY);
    return { minX: bounds.minX, minY: bounds.minY, pad, scale, size };
  }, [planFrames, planPlacements2D, layout.underlay]);

  if (!open) return null;

  const fireCamera = (type: 'front' | 'top' | 'side' | 'isometric') => {
    // F145 — la vista queda recordada para este ambiente.
    if (activeSpaceId) {
      cameraBySpaceRef.current[activeSpaceId] = type;
    }
    setCameraView({ type, ts: Date.now() });
  };

  /**
   * F145 — fit room: encuadra todo el ambiente (muros + muebles) con la misma
   * cámara matemática del fit-selection. Sin selección requerida.
   */
  const fitRoom = () => {
    const boxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
    for (const w of preview.walls) {
      boxes.push({
        minX: Math.min(w.originXMm, w.endXMm),
        maxX: Math.max(w.originXMm, w.endXMm),
        minY: Math.min(w.originYMm, w.endYMm),
        maxY: Math.max(w.originYMm, w.endYMm),
      });
    }
    for (const m of preview.modules) {
      const yaw = ((Math.round(m.yawDeg / 90) * 90) % 360 + 360) % 360;
      const ex = yaw === 90 || yaw === 270 ? m.depth : m.width;
      const ey = yaw === 90 || yaw === 270 ? m.width : m.depth;
      boxes.push({
        minX: m.originX - ex / 2,
        maxX: m.originX + ex / 2,
        minY: m.originY - ey / 2,
        maxY: m.originY + ey / 2,
      });
    }
    if (boxes.length === 0) return;
    const minX = Math.min(...boxes.map((b) => b.minX));
    const maxX = Math.max(...boxes.map((b) => b.maxX));
    const minY = Math.min(...boxes.map((b) => b.minY));
    const maxY = Math.max(...boxes.map((b) => b.maxY));
    setCameraView({
      type: 'fit-selection',
      ts: Date.now(),
      fit: {
        centerX: Math.round((minX + maxX) / 2),
        centerY: Math.round((minY + maxY) / 2),
        heightMm: Math.max(preview.totalHeight, 1200),
        spanMm: Math.round(Math.max(maxX - minX, maxY - minY)),
      },
    });
  };

  const commit = (
    next: ProjectKitchenLayout,
    opts?: {
      readonly history?: 'push' | 'none';
      /** F144 — etiqueta de la intención para "Deshacer: …". */
      readonly intent?: string;
      /** F144 — clave de coalescing (ráfagas de nudge = 1 entrada). */
      readonly coalesceKey?: string;
      /** Ítems afectados por la intención (snapshot ANTES, completos). */
      readonly itemSnapshots?: readonly ProjectItem[];
      /**
       * F141: ids de ítems recién creados (biblioteca) que aún no están en
       * project.items — el prune no debe purgar sus placements.
       */
      readonly extraItemIds?: readonly string[];
      /**
       * F143: claves de instancias recién creadas (duplicate/paste) cuyo
       * instanceIndex aún excede el quantity visible — el prune no debe
       * purgarlas hasta que el bump llegue en project.items.
       */
      readonly extraInstanceKeys?: readonly string[];
    },
  ) => {
    const history = opts?.history ?? 'push';
    if (history === 'push' && !wallDragSession.current) {
      setUndoStack((s) => [
        ...pushPlanHistory(s, {
          intent: opts?.intent ?? 'Editar plano',
          layout,
          itemSnapshots: opts?.itemSnapshots ?? [],
          ...(opts?.coalesceKey ? { coalesceKey: opts.coalesceKey } : {}),
          ts: Date.now(),
        })]);
      setRedoStack([]);
    }
    // Keep multi-space metadata; write top-level edits into the active space.
    const merged = syncActiveKitchenSpace({
      ...layout,
      ...next,
      spaces: next.spaces ?? layout.spaces,
      activeSpaceId: next.activeSpaceId ?? layout.activeSpaceId,
    });
    onChangeLayout(
      pruneKitchenLayout(
        merged,
        project.items,
        opts?.extraItemIds ?? [],
        opts?.extraInstanceKeys ?? [],
      ),
    );
  };

  /**
   * F067 paint drag hover: FurnitureScene3D raycasted the surface under the
   * cursor. We store it to drive the green overlay on the matching ambient mesh.
   */
  const handlePaintHover = (surface: PaintSurface | null) => {
    setPaintHoverSurface(surface);
  };

  /**
   * F067 paint drop: a material was dropped on the canvas. Validate that the
   * material's surfaceType matches the hit surface (floor→floor, wall→wall),
   * then commit the floor/wallMaterialId. Mismatches are silently ignored
   * (cursor already showed 'copy' but the apply is a no-op).
   */
  const handlePaintDrop = (drop: PaintDrop | null) => {
    setPaintHoverSurface(null);
    if (!drop) return;
    const material = availableAmbientMaterials.find(
      (m) => m.id === drop.materialId,
    );
    if (!material) return;
    if (drop.surface.kind === 'floor') {
      commit({ ...layout, floorMaterialId: drop.materialId });
    } else if (drop.surface.kind === 'wall') {
      const targetWallId = drop.surface.wallId;
      const updatedWalls = (layout.walls ?? []).map((w) =>
        w.id === targetWallId ? { ...w, wallMaterialId: drop.materialId } : w,
      );
      commit({ ...layout, walls: updatedWalls });
    } else if (drop.surface.kind === 'ceiling') {
      commit({ ...layout, ceilingMaterialId: drop.materialId, showCeiling: true });
    } else if (drop.surface.kind === 'countertop') {
      commit({ ...layout, countertopMaterialId: drop.materialId, showCountertop: true });
    }
  };

  const switchSpace = (spaceId: string) => {
    if (!canEdit) {
      // Read-only: local view only — never persist activeSpaceId on frozen OP.
      setViewSpaceId(spaceId);
      setSelection(EMPTY_STUDIO_SELECTION);
      setTargetWallId(null);
      return;
    }
    if (spaceId === activeSpaceId) return;
    commit(setActiveKitchenSpace(layout, spaceId));
    setSelection(EMPTY_STUDIO_SELECTION);
    setTargetWallId(null);
    // F145 — re-encuadra con la vista recordada del ambiente destino (default
    // 3/4): el canvas nunca hereda el encuadre del espacio anterior.
    setCameraView({
      type: cameraBySpaceRef.current[spaceId] ?? 'isometric',
      ts: Date.now(),
    });
  };

  const handleAddSpace = () => {
    if (!canEdit) return;
    const n = (layout.spaces?.length ?? 0) + 1;
    commit(addKitchenSpace(layout, `Espacio ${n}`, newId));
    setSelection(EMPTY_STUDIO_SELECTION);
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
    setSelection(EMPTY_STUDIO_SELECTION);
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

  /**
   * F143/F144 — aplicar una entrada del historial restaura layout E ítems
   * completos (quantity, customDims…; viajan por onUpdateItem). Las claves
   * cuyos índices serían stale para el prune actual pasan como extra hasta
   * que el proyecto re-renderice con el quantity restaurado.
   */
  const applyHistoryEntry = (entry: PlanHistoryEntry) => {
    for (const snap of entry.itemSnapshots) {
      const item = project.items.find((i) => i.id === snap.id);
      if (item) {
        // customDims SIEMPRE explícito: deshacer "a medida" debe sacarlo
        // aunque el snapshot no lo tuviera (clave undefined = ausente).
        onUpdateItem?.({
          ...item,
          quantity: snap.quantity,
          customDims: snap.customDims,
        });
      }
    }
    const restoredItems = new Set(entry.itemSnapshots.map((p) => p.id));
    const extraKeys = entry.layout.placements
      .filter((p) => {
        if (!restoredItems.has(p.itemId)) return false;
        const current = project.items.find((i) => i.id === p.itemId)?.quantity;
        return current !== undefined && p.instanceIndex >= Math.max(1, current);
      })
      .map((p) => `${p.itemId}#${p.instanceIndex}`);
    onChangeLayout(
      pruneKitchenLayout(entry.layout, project.items, [], extraKeys),
    );
  };

  /** Contracara "después" de la entrada: snapshot de los ítems afectados tal como están ahora. */
  const currentItemSnapshotsOf = (
    snapshots: readonly ProjectItem[],
  ): readonly ProjectItem[] => {
    const ids = new Set(snapshots.map((s) => s.id));
    return project.items.filter((i) => ids.has(i.id));
  };

  const undoPlan = () => {
    if (!canEdit || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [
      ...s.slice(-29),
      {
        intent: prev.intent,
        layout,
        itemSnapshots: currentItemSnapshotsOf(prev.itemSnapshots),
        ts: Date.now(),
      },
    ]);
    applyHistoryEntry(prev);
  };

  const redoPlan = () => {
    if (!canEdit || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [
      ...s.slice(-29),
      {
        intent: next.intent,
        layout,
        itemSnapshots: currentItemSnapshotsOf(next.itemSnapshots),
        ts: Date.now(),
      },
    ]);
    applyHistoryEntry(next);
  };

  // ── F143: selección y comandos de productividad ───────────────────────────

  /** Click del canvas / plano 2D: null = click en vacío (sin modificadores). */
  const handleSceneSelectModule = (
    key: string | null,
    modifiers?: { readonly shift?: boolean; readonly ctrlOrMeta?: boolean },
  ) => {
    if (!key) {
      if (!modifiers?.shift && !modifiers?.ctrlOrMeta) {
        setSelection(EMPTY_STUDIO_SELECTION);
        setDetailPartId(null);
        setDetailHardwareId(null);
      }
      return;
    }
    setSelection((s) => applySelectionClick(s, key, modifiers ?? {}));
    if (key !== selectedKey) {
      setDetailPartId(null);
      setDetailHardwareId(null);
      setDimDraftIssues([]);
    }
    setInspectorTab('position');
  };

  /** Click de fila en "De la obra": Shift = rango según el orden visible. */
  const handleListSelect = (key: string, e: { nativeEvent: MouseEvent }) => {
    const mods = modifiersFromPointer(e.nativeEvent);
    if (mods.shift) {
      setSelection((s) => applySelectionRange(s, listOrderedKeys, key));
    } else {
      setSelection((s) => applySelectionClick(s, key, mods));
    }
    setInspectorTab('props');
  };

  /**
   * Ejecuta una intención de dominio como UNA entrada de undo: snapshot de
   * layout + ítems previos (completos), patches vía onUpdateItem, layout vía
   * commit sin historia (ya se pusheó a mano). Selecciona las copias creadas.
   * F144: la entrada lleva etiqueta y (opcional) clave de coalescing para
   * ráfagas (nudge).
   */
  const runCommand = (
    result: LayoutCommandResult,
    opts?: { readonly intent?: string; readonly coalesceKey?: string },
  ) => {
    if (!result.ok) {
      setCommandStatus(result.message);
      return result;
    }
    setCommandStatus(null);
    if (!wallDragSession.current) {
      const affectedIds = new Set<string>(result.itemPatches.map((p) => p.itemId));
      setUndoStack((s) => [
        ...pushPlanHistory(s, {
          intent: opts?.intent ?? 'Editar plano',
          layout,
          itemSnapshots: project.items.filter((i) => affectedIds.has(i.id)),
          ...(opts?.coalesceKey ? { coalesceKey: opts.coalesceKey } : {}),
          ts: Date.now(),
        })]);
      setRedoStack([]);
    }
    for (const patch of result.itemPatches) {
      const item = project.items.find((i) => i.id === patch.itemId);
      if (item) {
        onUpdateItem?.({ ...item, quantity: patch.quantity });
      }
    }
    commit(result.layout, {
      history: 'none',
      extraInstanceKeys: result.createdKeys,
    });
    if (result.nextCursorByWall) {
      setPasteCursorByWall(result.nextCursorByWall);
    }
    if (result.createdKeys.length > 0) {
      setSelection({
        keys: result.createdKeys,
        anchorKey: result.createdKeys[0] ?? null,
      });
      setDetailPartId(null);
      setDetailHardwareId(null);
    }
  };

  const commandContext = () => ({
    layout,
    items: project.items,
    footprints,
  });

  const handleDuplicateSelection = () => {
    if (!canEdit || selection.keys.length === 0) return;
    runCommand(
      duplicateSelectionCommand({ ...commandContext(), keys: selection.keys }),
      { intent: 'Duplicar' },
    );
  };

  const handleCopySelection = () => {
    if (selection.keys.length === 0) return;
    setClipboard(
      copySelectionToClipboard({
        layout,
        keys: selection.keys,
        footprints,
      }),
    );
    setPasteCursorByWall({});
  };

  const handlePaste = () => {
    if (!canEdit || clipboard.length === 0) return;
    runCommand(
      pasteClipboardCommand({
        ...commandContext(),
        entries: clipboard,
        cursorByWall: pasteCursorByWall,
      }),
      { intent: 'Pegar' },
    );
  };

  const handlePasteRelative = (side: 'left' | 'right' | 'corner') => {
    if (!canEdit || clipboard.length === 0 || !selectedKey) return;
    runCommand(
      pasteRelativeCommand({
        ...commandContext(),
        entries: clipboard,
        refKey: selectedKey,
        side,
      }),
      { intent: 'Pegar a referencia' },
    );
  };

  const handleCompactOnWall = () => {
    if (!canEdit) return;
    runCommand(
      compactSelectionOnWallCommand({
        layout,
        footprints,
        keys: selection.keys,
      }),
      { intent: 'Alinear en muro' },
    );
  };

  const handleDistribute = (axis: 'wall' | 'x' | 'y') => {
    if (!canEdit) return;
    runCommand(
      distributeSelectionCommand({ layout, footprints, keys: selection.keys, axis }),
      { intent: 'Distribuir' },
    );
  };

  const handleAlignIslands = (
    mode: 'left' | 'right' | 'centers-x' | 'front' | 'back' | 'centers-y',
  ) => {
    if (!canEdit) return;
    runCommand(alignSelectionCommand({ layout, footprints, keys: selection.keys, mode }), {
      intent: 'Alinear islas',
    });
  };

  const handleCenterOnWall = () => {
    if (!canEdit) return;
    runCommand(
      centerSelectionOnWallCommand({ layout, footprints, keys: selection.keys }),
      { intent: 'Centrar' },
    );
  };

  const handleRemoveSelectionFromPlan = () => {
    if (!canEdit || selection.keys.length === 0) return;
    const keys = new Set(selection.keys);
    commit(
      {
        ...layout,
        placements: layout.placements.filter(
          (p) => !keys.has(`${p.itemId}#${p.instanceIndex}`),
        ),
      },
      { intent: 'Quitar del plano' },
    );
  };

  // ── F144: precisión — nudge de teclado, fit selección, update de ítem ──

  /**
   * Nudge de la selección completa (North Star §10.2): unidades de muro por
   * su muro, islas en plano. Ráfaga = 1 entrada de undo (coalesceKey).
   */
  const handleNudgeSelection = (
    deltaWallMm: number,
    deltaXMm: number,
    deltaYMm: number,
  ) => {
    if (!canEdit || selection.keys.length === 0) return false;
    const res = nudgeSelectionCommand({
      layout,
      footprints,
      keys: selection.keys,
      ...(deltaWallMm !== 0 ? { deltaWallMm } : {}),
      ...(deltaXMm !== 0 ? { deltaXMm } : {}),
      ...(deltaYMm !== 0 ? { deltaYMm } : {}),
    });
    if (!res.ok && res.reason === 'not-placed') return false;
    runCommand(res, {
      intent:
        selection.keys.length === 1
          ? 'Mover mueble'
          : `Mover ${selection.keys.length} muebles`,
      coalesceKey: 'nudge',
    });
    return res.ok;
  };

  /**
   * F144 — actualizar el ítem seleccionado (medidas a medida / preset) como
   * UNA intención de undo: snapshot del ítem ANTES + onUpdateItem.
   */
  const updateSelectedItem = (
    patch: Partial<ProjectItem>,
    intent: string,
  ) => {
    if (!canEdit || !selectedItem || !onUpdateItem) return;
    setUndoStack((s) => [
      ...pushPlanHistory(s, {
        intent,
        layout,
        itemSnapshots: [selectedItem],
        ts: Date.now(),
      }),
    ]);
    setRedoStack([]);
    const next: ProjectItem = { ...selectedItem, ...patch };
    // Volver a preset = sacar el override a medida (clave ausente, no undefined).
    const resultItem =
      'customDims' in patch && patch.customDims === undefined
        ? (() => {
            const { customDims: _drop, ...rest } = next;
            return rest;
          })()
        : next;
    onUpdateItem(resultItem);
  };

  /**
   * F144 — editar una dimensión a medida: valida contra el módulo y commitea
   * como UNA intención (snapshot del ítem). Inválido no commitea; el mensaje
   * enseña el rango.
   */
  const handleCustomDimsBlur = (
    dimKey: 'widthMm' | 'heightMm' | 'depthMm',
    v: number,
  ) => {
    if (!selectedItem || !selectedModule || !canEdit || !onUpdateItem) return;
    const base =
      selectedItem.customDims ??
      {
        widthMm: selectedDims?.width ?? 600,
        heightMm: selectedDims?.height ?? 720,
        depthMm: selectedDims?.depth ?? 560,
      };
    if (v === (selectedItem.customDims?.[dimKey] ?? base[dimKey])) {
      setDimDraftIssues([]);
      return;
    }
    const candidate = { ...base, [dimKey]: Math.round(v) };
    const issues = validateItemCustomDims(selectedModule, candidate);
    if (issues.length > 0) {
      setDimDraftIssues(issues);
      return;
    }
    setDimDraftIssues([]);
    updateSelectedItem({ customDims: candidate }, 'Medida a medida');
    // Enseña si la nueva huella desborda el muro donde está colocado.
    if (selectedPlacement && !isFreePlacement(selectedPlacement)) {
      const wall = layout.walls.find((w) => w.id === selectedPlacement.wallId);
      const width = candidate.widthMm;
      if (
        wall &&
        selectedPlacement.offsetMm + width > wall.lengthMm + 1
      ) {
        setCommandStatus(
          `La nueva medida desborda ${wall.name?.trim() || 'el muro'} — usá Compactar muro o mové el mueble.`,
        );
      }
    }
  };

  /** F144 — encuadrar la cámara en la selección (funciona en modo lectura). */
  const fitSelection = () => {
    if (selection.keys.length === 0) return;
    const selected = new Set(selection.keys);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let heightMm = 0;
    for (const m of preview.modules) {
      if (!selected.has(m.instanceKey)) continue;
      // AABB en plano según yaw (múltiplos de 90° en el flujo actual).
      const yaw = ((Math.round(m.yawDeg / 90) * 90) % 360 + 360) % 360;
      const ex = yaw === 90 || yaw === 270 ? m.depth : m.width;
      const ey = yaw === 90 || yaw === 270 ? m.width : m.depth;
      minX = Math.min(minX, m.originX - ex / 2);
      maxX = Math.max(maxX, m.originX + ex / 2);
      minY = Math.min(minY, m.originY - ey / 2);
      maxY = Math.max(maxY, m.originY + ey / 2);
      heightMm = Math.max(heightMm, (m.baseClearanceMm ?? 0) + m.height);
    }
    if (!Number.isFinite(minX)) return;
    setCameraView({
      type: 'fit-selection',
      ts: Date.now(),
      fit: {
        centerX: Math.round((minX + maxX) / 2),
        centerY: Math.round((minY + maxY) / 2),
        heightMm: Math.round(heightMm),
        spanMm: Math.round(Math.max(maxX - minX, maxY - minY)),
      },
    });
  };

  const handleSceneSelectPart = (partId: string | null) => {
    setDetailPartId(partId);
    if (partId) setDetailHardwareId(null);
  };

  const handleSceneSelectHardware = (hardwareId: string | null) => {
    setDetailHardwareId(hardwareId);
    if (hardwareId) setDetailPartId(null);
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

  /* ── F145 — environment authoring: muros y huecos (intenciones de dominio) ── */

  const runEnvCommand = (
    result: EnvironmentCommandResult,
    intent: string,
    onSuccess?: (r: Extract<EnvironmentCommandResult, { ok: true }>) => void,
  ) => {
    if (!result.ok) {
      setEnvMessage(result.message);
      return;
    }
    setEnvMessage(null);
    commit(result.layout, { intent });
    onSuccess?.(result);
  };

  const handleAddWall = (lengthMm: number) => {
    if (!canEdit) return;
    const res = addWall(layout, { lengthMm }, newId);
    runEnvCommand(res, 'Agregar muro');
    if (res.ok) setTargetWallId(null);
  };

  const handleUpdateWall = (
    wallId: string,
    patch: Parameters<typeof updateWall>[2],
  ) => {
    if (!canEdit) return;
    runEnvCommand(
      updateWall(layout, wallId, patch),
      `Editar ${layout.walls.find((w) => w.id === wallId)?.name ?? 'muro'}`,
    );
  };

  const handleRemoveWall = (wallId: string) => {
    if (!canEdit) return;
    const wall = layout.walls.find((w) => w.id === wallId);
    const res = removeWall(layout, wallId);
    if (res.ok) {
      setEnvMessage(
        res.unplacedCount && res.unplacedCount > 0
          ? `Quitamos ${wall?.name ?? 'el muro'}: ${
              res.unplacedCount === 1
                ? '1 mueble quedó sin colocar'
                : `${res.unplacedCount} muebles quedaron sin colocar`
            } (los verás en la lista «Sin colocar»).`
          : null,
      );
      commit(res.layout, { intent: `Quitar ${wall?.name ?? 'muro'}` });
      if (targetWallId === wallId) setTargetWallId(null);
    } else {
      setEnvMessage(res.message);
    }
  };

  /**
   * Huecos: alta rápida con defaults del tipo en el primer tramo libre del
   * muro; los campos quedan editables en la tarjeta del muro.
   */
  const firstFreeOpeningOffset = (
    wall: KitchenWall,
    widthMm: number,
  ): number | null => {
    const spans = (wall.openings ?? [])
      .map((o) => ({ start: o.offsetMm, end: o.offsetMm + o.widthMm }))
      .sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const s of spans) {
      if (s.start - cursor >= widthMm) return cursor;
      cursor = Math.max(cursor, s.end);
    }
    if (wall.lengthMm - cursor >= widthMm) return cursor;
    return null;
  };

  const handleAddOpening = (wallId: string, kind: WallOpeningKind) => {
    if (!canEdit) return;
    const wall = layout.walls.find((w) => w.id === wallId);
    if (!wall) return;
    const width = kind === 'door' ? 800 : kind === 'window' ? 1200 : 900;
    const offset = firstFreeOpeningOffset(wall, width);
    if (offset === null) {
      setEnvMessage(
        `No queda lugar libre en ${wall.name ?? 'el muro'} para una ${
          WALL_OPENING_KIND_LABELS_ES[kind].toLowerCase()
        } de ${width} mm. Liberá un tramo o acortá otro hueco.`,
      );
      return;
    }
    runEnvCommand(
      addOpening(layout, wallId, { kind, offsetMm: offset, widthMm: width }, newId),
      `Agregar ${WALL_OPENING_KIND_LABELS_ES[kind].toLowerCase()}`,
    );
  };

  const handleUpdateOpening = (
    wallId: string,
    openingId: string,
    patch: Parameters<typeof updateOpening>[3],
  ) => {
    if (!canEdit) return;
    runEnvCommand(
      updateOpening(layout, wallId, openingId, patch),
      'Editar hueco',
    );
  };

  const handleRemoveOpening = (wallId: string, openingId: string) => {
    if (!canEdit) return;
    runEnvCommand(removeOpening(layout, wallId, openingId), 'Quitar hueco');
  };

  const placeOnWall = (
    itemId: string,
    instanceIndex: number,
    wallId: string,
    /** Offset en mm desde el origen del muro. Si se omite, usa nextOffsetOnWall. */
    offsetMm?: number,
    /**
     * F141: módulo del ítem cuando éste todavía no está en `project` (insert
     * desde biblioteca: el proyecto re-renderiza después del commit).
     */
    moduleHint?: Module,
  ) => {
    if (!canEdit) return;
    const base = ensureWalls();
    const wall =
      base.walls.find((w) => w.id === wallId) ?? base.walls[0];
    if (!wall) return;
    const resolvedOffset = (() => {
      if (offsetMm === undefined) {
        return nextOffsetOnWall(base, wall.id, footprints, precision.settings.wallGapMm);
      }
      const item2 = project.items.find((it) => it.id === itemId);
      const mod2 = item2
        ? modules.find((m) => m.id === item2.moduleId)
        : moduleHint;
      const dims2 = item2
        ? resolveItemDims(item2, mod2)
        : moduleHint
          ? moduleDefaultDims(moduleHint)
          : { width: 600, height: 720, depth: 560 };
      const wallLen = wall.lengthMm;
      const peers = base.placements
        .filter((p) => p.wallId === wall.id && !isFreePlacement(p))
        .map((p) => {
          const fp = footprints.find(
            (f) => f.itemId === p.itemId && f.instanceIndex === p.instanceIndex,
          );
          return { offsetMm: p.offsetMm, widthMm: fp?.width ?? 600 };
        });
      if (!precision.settings.wallSnap) {
        return Math.max(
          0,
          Math.min(Math.max(0, wallLen - dims2.width), Math.round(offsetMm)),
        );
      }
      return snapOffsetOnWall({
        offsetMm,
        moduleWidthMm: dims2.width,
        wallLengthMm: wallLen,
        peers,
        thresholdMm: precision.settings.wallSnapThresholdMm,
        gapMm: precision.settings.wallGapMm,
      });
    })();
    const item = project.items.find((it) => it.id === itemId);
    const mod = item
      ? modules.find((m) => m.id === item.moduleId)
      : moduleHint;
    const placement: ProjectItemPlacement = {
      itemId,
      instanceIndex,
      wallId: wall.id,
      offsetMm: resolvedOffset,
      elevation: defaultElevationForModule(mod),
    };
    commit(
      {
        ...base,
        placements: [...base.placements, placement],
      },
      // Ítems recién creados (biblioteca) aún no están en project.items.
      { extraItemIds: [itemId] },
    );
    setSelection({ keys: [`${itemId}#${instanceIndex}`], anchorKey: `${itemId}#${instanceIndex}` });
    setTargetWallId(wall.id);
  };

  const placeAsIsland = (
    itemId: string,
    instanceIndex: number,
    /** Plan X en mm (layout no-shifted). Si se omite, centra en el espacio. */
    planXMm?: number,
    /** Plan Y en mm (layout no-shifted). Si se omite, centra en el espacio. */
    planYMm?: number,
    /** F141: módulo cuando el ítem todavía no está en `project` (biblioteca). */
    moduleHint?: Module,
  ) => {
    if (!canEdit) return;
    const base = ensureWalls();
    const item = project.items.find((it) => it.id === itemId);
    const mod = item
      ? modules.find((m) => m.id === item.moduleId)
      : moduleHint;
    const dims = item
      ? resolveItemDims(item, mod)
      : moduleHint
        ? moduleDefaultDims(moduleHint)
        : null;
    const width = dims?.width ?? 600;
    const depth = dims?.depth ?? 560;
    const frames = resolveWallFrames(base.walls);
    let freeXMm = planXMm ?? 1200;
    let freeYMm = planYMm ?? 1000;
    if (planXMm === undefined && frames.length > 0) {
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
    // Snap a la grilla de islas configurada (0 = libre).
    freeXMm = precision.snapIsland(freeXMm);
    freeYMm = precision.snapIsland(freeYMm);
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
    commit(
      {
        ...base,
        placements: [...base.placements, placement],
      },
      // Ítems recién creados (biblioteca) aún no están en project.items.
      { extraItemIds: [itemId] },
    );
    setSelection({ keys: [`${itemId}#${instanceIndex}`], anchorKey: `${itemId}#${instanceIndex}` });
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
    const removedKey = `${itemId}#${instanceIndex}`;
    setSelection((s) =>
      s.keys.includes(removedKey)
        ? {
            keys: s.keys.filter((k) => k !== removedKey),
            anchorKey: s.anchorKey === removedKey ? null : s.anchorKey,
          }
        : s,
    );
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
      { history: 'push', snap: true, intent: 'Mover en muro', coalesceKey: 'nudge' },
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
    baseMode: m.baseMode,
    ...(m.plinthMaterialId ? { plinthMaterialId: m.plinthMaterialId } : {}),
    ...(m.plinthHardwareColor
      ? { plinthHardwareColor: m.plinthHardwareColor }
      : {}),
    ...(m.plinthMaterialThicknessMm
      ? { plinthThicknessMm: m.plinthMaterialThicknessMm }
      : {}),
    ...(m.plinthSides ? { plinthSides: m.plinthSides } : {}),
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
    wallMaterialId: w.wallMaterialId,
    ...(w.openings && w.openings.length > 0 ? { openings: w.openings } : {}),
  }));

  const applyOffsetOnWall = (
    itemId: string,
    instanceIndex: number,
    rawOffset: number,
    opts?: {
      readonly history?: 'push' | 'none';
      readonly snap?: boolean;
      readonly intent?: string;
      readonly coalesceKey?: string;
    },
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
    const snapEnabled = opts?.snap !== false && precision.settings.wallSnap;
    const offsetMm = snapEnabled
      ? snapOffsetOnWall({
          offsetMm: rawOffset,
          moduleWidthMm: width,
          wallLengthMm: wall?.lengthMm ?? 3000,
          peers,
          thresholdMm: precision.settings.wallSnapThresholdMm,
          gapMm: precision.settings.wallGapMm,
        })
      : Math.max(
          0,
          Math.min(
            Math.max(0, (wall?.lengthMm ?? 3000) - width),
            Math.round(rawOffset),
          ),
        );
    // Collision check: compute candidate origin by shifting along the wall
    // direction from the current resolved position, then test against peers.
    const currentMod = preview.modules.find(
      (m) => m.instanceKey === `${itemId}#${instanceIndex}`,
    );
    if (currentMod) {
      const delta = offsetMm - (placement.offsetMm ?? 0);
      const yaw = currentMod.yawDeg;
      let candX = currentMod.originX;
      let candY = currentMod.originY;
      if (yaw === 0) candX += delta;
      else if (yaw === 90) candY += delta;
      else if (yaw === 180) candX -= delta;
      else if (yaw === 270) candY -= delta;
      const collides = placedModuleCollides(
        {
          itemId,
          instanceIndex,
          instanceKey: `${itemId}#${instanceIndex}`,
          originX: candX,
          originY: candY,
          width: currentMod.width,
          depth: currentMod.depth,
          yawDeg: currentMod.yawDeg,
          elevation: currentMod.elevation,
        },
        preview.modules,
      );
      if (collides && wallDragSession.current) {
        setDraggingInvalid(true);
        return; // block commit during drag — mueble queda donde estaba
      }
    }
    setDraggingInvalid(false);
    commit(
      {
        ...layout,
        placements: layout.placements.map((p) =>
          p.itemId === itemId && p.instanceIndex === instanceIndex
            ? { ...p, offsetMm }
            : p,
        ),
      },
      {
        history: opts?.history ?? 'push',
        ...(opts?.intent ? { intent: opts.intent } : {}),
        ...(opts?.coalesceKey ? { coalesceKey: opts.coalesceKey } : {}),
      },
    );
  };

  const handleModuleWallDragStart = (_moduleKey: string) => {
    if (!canEdit || wallDragSession.current) return;
    wallDragSession.current = true;
    setUndoStack((s) => [
      ...pushPlanHistory(s, {
        intent: 'Mover en muro',
        layout,
        itemSnapshots: [],
        ts: Date.now(),
      })]);
    setRedoStack([]);
  };

  // ── F065 Handlers de drag de ítem sin colocar ──────────────────────────

  /**
   * Convierte el hit del raycaster de ítem-sin-colocar a posición Three.js
   * para posicionar el ghost mesh en la escena.
   *
   * Convenio Three.js: X=plan-X, Y=altura, Z=plan-Y
   * Para muros, pone el ghost tocando la cara interna del muro (~mm offset).
   * Para piso, Y=0 (base del módulo en el suelo).
   */
  const resolveGhostPosition = (
    hit: {
      readonly wallId: string | null;
      readonly offsetMm: number;
      readonly planXMm: number;
      readonly planYMm: number;
    },
    dims: { widthMm: number; heightMm: number; depthMm: number },
  ): { x: number; y: number; z: number } | null => {
    if (hit.wallId) {
      // Muro: posición a lo largo del muro (shifted display space).
      const displayWalls = preview.walls;
      const wall = displayWalls.find((w) => w.id === hit.wallId);
      if (!wall) return null;
      const dx = wall.endXMm - wall.originXMm;
      const dy = wall.endYMm - wall.originYMm;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / len;
      const uy = dy / len;
      // Perpendicular al muro (hacia el interior)
      const nx = -uy;
      const nz = ux;
      const x = wall.originXMm + ux * hit.offsetMm + nx * (dims.depthMm / 2 + 20);
      const z = wall.originYMm + uy * hit.offsetMm + nz * (dims.depthMm / 2 + 20);
      return { x, y: 0, z };
    }
    // Piso/isla: usar planXMm/planYMm + shift de display.
    const shiftX = planShiftMm.x;
    const shiftY = planShiftMm.y;
    return {
      x: hit.planXMm + shiftX,
      y: 0,
      z: hit.planYMm + shiftY,
    };
  };

  /**
   * Calcula si el drop en muro será válido (hay espacio libre).
   * Detección 1D simple: offset disponible ≥ ancho del módulo.
   */
  const calcGhostValid = (
    hit: { wallId: string | null; offsetMm: number } | null,
    ghost: { widthMm: number } | null,
  ): boolean | undefined => {
    if (!hit || !ghost) return undefined;
    if (!hit.wallId) return true; // piso siempre válido
    const base = layout;
    const wall = base.walls.find((w) => w.id === hit.wallId);
    if (!wall) return undefined;
    const wallLen = wall.lengthMm;
    const occupied = base.placements
      .filter((p) => p.wallId === hit.wallId && !isFreePlacement(p))
      .reduce((acc, p) => {
        const fp = footprints.find(
          (f) => f.itemId === p.itemId && f.instanceIndex === p.instanceIndex,
        );
        return acc + (fp?.width ?? ghost.widthMm) + 20;
      }, 0);
    return occupied + ghost.widthMm <= wallLen;
  };

  const handleUnplacedHover = (
    hit: {
      readonly wallId: string | null;
      readonly offsetMm: number;
      readonly planXMm: number;
      readonly planYMm: number;
    } | null,
  ) => {
    setGhostHit(hit);
  };

  const handleUnplacedDrop = (drop: {
    readonly wallId: string | null;
    readonly offsetMm: number;
    readonly planXMm: number;
    readonly planYMm: number;
  }) => {
    if (!ghostDrag || !canEdit) return;
    if (ghostDrag.kind === 'library') {
      // F141: inserción atómica — si el drop es inválido o la creación falla,
      // no se crea ningún ítem ni placement.
      if (!onInsertFromCatalog) {
        setGhostDrag(null);
        setGhostHit(null);
        return;
      }
      const valid = calcGhostValid(drop, ghostDrag);
      if (valid === false) {
        setGhostDrag(null);
        setGhostHit(null);
        return;
      }
      const itemId = onInsertFromCatalog(ghostDrag.moduleId);
      if (!itemId) {
        setGhostDrag(null);
        setGhostHit(null);
        return;
      }
      libraryCollections.trackInsert(ghostDrag.moduleId);
      const mod = modules.find((m) => m.id === ghostDrag.moduleId);
      if (drop.wallId) {
        placeOnWall(itemId, 0, drop.wallId, drop.offsetMm, mod);
      } else {
        placeAsIsland(itemId, 0, drop.planXMm, drop.planYMm, mod);
      }
      setGhostDrag(null);
      setGhostHit(null);
      return;
    }
    if (drop.wallId) {
      placeOnWall(
        ghostDrag.itemId,
        ghostDrag.instanceIndex,
        drop.wallId,
        drop.offsetMm,
      );
    } else {
      placeAsIsland(
        ghostDrag.itemId,
        ghostDrag.instanceIndex,
        drop.planXMm,
        drop.planYMm,
      );
    }
    setGhostDrag(null);
    setGhostHit(null);
  };

  // ── F142 Tableros: aplicación con scope + guards anti-leak ────────────────

  /**
   * Aplica un tablero (MaterialBoard) a un mueble o a la obra. Guard
   * anti-leak: el material debe existir en el catálogo de tableros — nunca
   * se escribe un id en superficies ambientales desde acá.
   */
  const applyBoardMaterial = (
    materialId: string,
    targetKey: string | null | undefined,
  ): void => {
    if (!canEdit) return;
    const material = catalog.materials.find((m) => m.id === materialId);
    if (!material) return;

    if (boardScope === 'project') {
      if (!onUpdateProjectLevelChoice) {
        setBoardStatus('Esta obra no permite cambios a nivel proyecto.');
        return;
      }
      onUpdateProjectLevelChoice('FRENTE', material.id);
      setBoardStatus(`✓ ${material.name} aplicado a frentes de toda la obra`);
      return;
    }

    const key = targetKey ?? selectedKey;
    if (!key) {
      setBoardStatus(
        'Seleccioná un mueble —o arrastrá el tablero sobre uno— para aplicarlo.',
      );
      return;
    }
    const hash = key.lastIndexOf('#');
    const itemId = hash > 0 ? key.slice(0, hash) : key;
    const item = project.items.find((it) => it.id === itemId);
    if (!item) {
      setBoardStatus('No se encontró el mueble de la selección.');
      return;
    }
    const mod = modules.find((m) => m.id === item.moduleId);
    const boardGroups = groupsForModuleItem(
      mod,
      catalog.optionGroups,
      catalog.components,
      catalog.structures,
    ).filter((g) => g.kind === 'board');
    const codes =
      boardScope === 'fronts'
        ? ['FRENTE']
        : boardScope === 'interior'
          ? ['INTERIOR']
          : boardGroups.map((g) => g.code);
    const applicable = codes.filter((code) =>
      boardGroups.some((g) => g.code === code),
    );
    if (applicable.length === 0) {
      setBoardStatus(
        `Este mueble no tiene grupo de ${
          boardScope === 'interior' ? 'interior' : 'frentes'
        } configurable.`,
      );
      return;
    }
    let choices = item.optionChoices;
    for (const code of applicable) {
      choices = setItemOptionChoice(choices, code, material.id);
    }
    onUpdateItem?.({ ...item, optionChoices: choices });
    setSelectedKey(key);
    setInspectorTab('props');
    const scopeLabel =
      BOARD_APPLY_SCOPES.find((s) => s.id === boardScope)?.label ?? '';
    setBoardStatus(
      `✓ ${material.name} aplicado a ${scopeLabel.toLowerCase()} · ${mod?.code ?? ''}`,
    );
  };

  const handleBoardPaintDrop = (drop: {
    readonly moduleKey: string | null;
    readonly materialId: string;
  }): void => {
    if (!canEdit) return;
    if (!drop.moduleKey) {
      // Superficie ambiental (o vacío): rechazo que enseña, nunca aplica.
      setBoardStatus(
        'Los tableros se aplican a los muebles — arrastrá sobre un mueble.',
      );
    } else {
      applyBoardMaterial(drop.materialId, drop.moduleKey);
    }
    setBoardPaintHoverKey(null);
  };

  // ── F141 Biblioteca: inserción por click/teclado ─────────────────────────

  /** F141v2: biblioteca disponible (editable + insert conectado). Read-only ⇒ sólo ítems. */
  const libraryAvailable = canEdit && Boolean(onInsertFromCatalog);

  const handleLibraryInsert = (moduleId: string) => {
    if (!onInsertFromCatalog) return;
    const itemId = onInsertFromCatalog(moduleId);
    if (!itemId) return;
    libraryCollections.trackInsert(moduleId);
    const mod = modules.find((m) => m.id === moduleId);
    if (activeWallId) {
      placeOnWall(itemId, 0, activeWallId, undefined, mod);
    } else {
      // Sin muro activo el ítem queda "Sin colocar"; lo hacemos visible.
      setListFilter('unplaced');
      setSelection({ keys: [`${itemId}#0`], anchorKey: `${itemId}#0` });
      setInspectorTab('props');
    }
  };

  const handleLibraryCardDragStart = (
    moduleId: string,
    dims: { readonly width: number; readonly height: number; readonly depth: number },
  ): void => {
    setGhostDrag({
      kind: 'library',
      moduleId,
      widthMm: dims.width,
      heightMm: dims.height,
      depthMm: dims.depth,
    });
  };

  const handleLibraryCardDragEnd = (): void => {
    setGhostDrag(null);
    setGhostHit(null);
  };
  /**
   * F144 — drag del grupo: si el módulo tomado pertenece a la selección,
   * sus compañeros seleccionados del mismo muro viajan con él (conserva el
   * arreglo; valida contra el resto vía nudgeSelectionCommand). Un módulo
   * solo (o fuera de la selección) usa el camino individual de siempre.
   */
  const handleModuleWallOffset = (moduleKey: string, offsetMm: number) => {
    if (!canEdit) return;
    const parsed = parsePlacementKey(moduleKey);
    if (!parsed) return;
    const dragged = layout.placements.find(
      (p) => p.itemId === parsed.itemId && p.instanceIndex === parsed.instanceIndex,
    );
    if (
      dragged &&
      !isFreePlacement(dragged) &&
      selection.keys.includes(moduleKey)
    ) {
      const groupKeys = selection.keys.filter((key) => {
        const pk = parsePlacementKey(key);
        const pl = pk
          ? layout.placements.find(
              (p) => p.itemId === pk.itemId && p.instanceIndex === pk.instanceIndex,
            )
          : undefined;
        return Boolean(pl && !isFreePlacement(pl) && pl.wallId === dragged.wallId);
      });
      if (groupKeys.length > 1) {
        const wall = layout.walls.find((w) => w.id === dragged.wallId);
        const fp = footprints.find(
          (f) => f.itemId === parsed.itemId && f.instanceIndex === parsed.instanceIndex,
        );
        const width = fp?.width ?? 600;
        const peers = layout.placements
          .filter(
            (p) =>
              p.wallId === dragged.wallId &&
              !groupKeys.includes(`${p.itemId}#${p.instanceIndex}`) &&
              !isFreePlacement(p),
          )
          .map((p) => {
            const pk = footprints.find(
              (f) => f.itemId === p.itemId && f.instanceIndex === p.instanceIndex,
            );
            return { offsetMm: p.offsetMm, widthMm: pk?.width ?? 600 };
          });
        const target = precision.settings.wallSnap
          ? snapOffsetOnWall({
              offsetMm,
              moduleWidthMm: width,
              wallLengthMm: wall?.lengthMm ?? 3000,
              peers,
              thresholdMm: precision.settings.wallSnapThresholdMm,
              gapMm: precision.settings.wallGapMm,
            })
          : Math.max(
              0,
              Math.min(
                Math.max(0, (wall?.lengthMm ?? 3000) - width),
                Math.round(offsetMm),
              ),
            );
        const delta = target - dragged.offsetMm;
        if (delta === 0) return;
        const res = nudgeSelectionCommand({
          layout,
          footprints,
          keys: groupKeys,
          deltaWallMm: delta,
          action: 'Mover',
        });
        if (!res.ok) {
          setDraggingInvalid(true);
          return;
        }
        setDraggingInvalid(false);
        commit(res.layout, { history: 'none' });
        return;
      }
    }
    // Live drag: no per-frame history; light snap while moving.
    applyOffsetOnWall(parsed.itemId, parsed.instanceIndex, offsetMm, {
      history: 'none',
      snap: true,
    });
  };

  const handleModuleWallDragEnd = (moduleKey: string) => {
    wallDragSession.current = false;
    setDraggingInvalid(false);
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
    opts?: { readonly history?: 'push' | 'none'; readonly intent?: string },
  ) => {
    // Grilla de islas configurable (0 = libre) mientras se arrastra.
    const freeXMm = precision.snapIsland(planXMm);
    const freeYMm = precision.snapIsland(planYMm);
    // Collision check for free/island placement.
    const currentMod = preview.modules.find(
      (m) => m.instanceKey === `${itemId}#${instanceIndex}`,
    );
    if (currentMod) {
      const collides = placedModuleCollides(
        {
          itemId,
          instanceIndex,
          originX: freeXMm,
          originY: freeYMm,
          width: currentMod.width,
          depth: currentMod.depth,
          yawDeg: currentMod.yawDeg,
          elevation: currentMod.elevation,
        },
        preview.modules,
      );
      if (collides) {
        setDraggingInvalid(true);
        return;
      }
    }
    setDraggingInvalid(false);
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
      {
        history: opts?.history ?? 'push',
        ...(opts?.intent ? { intent: opts.intent } : {}),
      },
    );
  };

  /** F144 — drag de grupo de islas: las islas seleccionadas viajan juntas. */
  const handleModuleFreeMove = (
    moduleKey: string,
    planXMm: number,
    planYMm: number,
  ) => {
    if (!canEdit) return;
    const parsed = parsePlacementKey(moduleKey);
    if (!parsed) return;
    const dragged = layout.placements.find(
      (p) => p.itemId === parsed.itemId && p.instanceIndex === parsed.instanceIndex,
    );
    if (dragged && isFreePlacement(dragged) && selection.keys.includes(moduleKey)) {
      const groupKeys = selection.keys.filter((key) => {
        const pk = parsePlacementKey(key);
        const pl = pk
          ? layout.placements.find(
              (p) => p.itemId === pk.itemId && p.instanceIndex === pk.instanceIndex,
            )
          : undefined;
        return Boolean(pl && isFreePlacement(pl));
      });
      if (groupKeys.length > 1) {
        const targetX = precision.snapIsland(planXMm);
        const targetY = precision.snapIsland(planYMm);
        const deltaX = targetX - (dragged.freeXMm ?? 0);
        const deltaY = targetY - (dragged.freeYMm ?? 0);
        if (deltaX === 0 && deltaY === 0) return;
        const res = nudgeSelectionCommand({
          layout,
          footprints,
          keys: groupKeys,
          deltaXMm: deltaX,
          deltaYMm: deltaY,
          action: 'Mover',
        });
        if (!res.ok) {
          setDraggingInvalid(true);
          return;
        }
        setDraggingInvalid(false);
        commit(res.layout, { history: 'none' });
        return;
      }
    }
    applyFreePlanPosition(parsed.itemId, parsed.instanceIndex, planXMm, planYMm, {
      history: 'none',
    });
  };

  const handleModuleFreeDragStart = (_moduleKey: string) => {
    if (!canEdit || wallDragSession.current) return;
    wallDragSession.current = true;
    setUndoStack((s) => [
      ...pushPlanHistory(s, {
        intent: 'Mover isla',
        layout,
        itemSnapshots: [],
        ts: Date.now(),
      })]);
    setRedoStack([]);
  };

  const handleModuleFreeDragEnd = (_moduleKey: string) => {
    wallDragSession.current = false;
    setDraggingInvalid(false);
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
        <div className="spatial-studio__spaces">
          <WorkspaceTabs
            tabs={spaces.map((s) => ({ id: s.id, label: s.name }))}
            activeTab={activeSpaceId ?? spaces[0]?.id ?? ''}
            onTabChange={switchSpace}
            ariaLabel="Ambientes del plano"
            idPrefix="spatial-studio-spaces"
            testIdPrefix="spatial-studio-space"
          />
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
          <div className="spatial-studio__sidebar-nav">
            <WorkspaceTabs
              tabs={[
                {
                  id: 'modules' as const,
                  label: 'Muebles',
                  icon: <Box size={14} aria-hidden />,
                },
                {
                  id: 'materials' as const,
                  label: 'Materiales',
                  icon: <Palette size={14} aria-hidden />,
                },
              ]}
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              ariaLabel="Navegación del menú lateral"
              idPrefix="spatial-studio-sidebar"
              testIdPrefix="spatial-studio"
            />
          </div>

          <div
            role="tabpanel"
            id={`spatial-studio-sidebar-panel-${sidebarTab}`}
            aria-labelledby={`spatial-studio-sidebar-tab-${sidebarTab}`}
          >
          {sidebarTab === 'modules' ? (
            <>
              <div className="spatial-studio__sidebar-head">
                <h3 className="spatial-studio__section-title" style={{ margin: 0 }}>
                  Muebles
                </h3>
                <div className="spatial-studio__sidebar-head-actions">
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

              {libraryAvailable ? (
                <div className="spatial-studio__sidebar-nav">
                  <WorkspaceTabs
                    tabs={[
                      { id: 'library' as const, label: 'Biblioteca' },
                      {
                        id: 'items' as const,
                        label: 'De la obra',
                        count: footprints.length,
                      },
                    ]}
                    activeTab={modulesSubTab}
                    onTabChange={setModulesSubTab}
                    ariaLabel="Secciones de muebles"
                    idPrefix="spatial-studio-modules"
                    testIdPrefix="spatial-studio-modules"
                  />
                </div>
              ) : null}
              <div
                role={libraryAvailable ? 'tabpanel' : undefined}
                id={
                  libraryAvailable
                    ? `spatial-studio-modules-panel-${modulesSubTab}`
                    : undefined
                }
                aria-labelledby={
                  libraryAvailable
                    ? `spatial-studio-modules-tab-${modulesSubTab}`
                    : undefined
                }
              >
                {libraryAvailable && modulesSubTab === 'library' ? (
                  <ModuleLibraryPanel
                    modules={modules}
                    categories={categories}
                    canEdit={canEdit}
                    resolveMediaUrl={resolveMediaUrl}
                    collections={libraryCollections}
                    onInsert={handleLibraryInsert}
                    onCardDragStart={handleLibraryCardDragStart}
                    onCardDragEnd={handleLibraryCardDragEnd}
                  />
                ) : (
                  <>
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
                        {footprints.length === 0 ? (
                          <p className="spatial-studio__hint">
                            {libraryAvailable
                              ? 'Arrastrá un mueble desde la Biblioteca al plano para empezar.'
                              : 'Esta cotización todavía no tiene muebles.'}
                          </p>
                        ) : null}
                        {listFilter !== 'placed' && unplaced.length > 0 ? (
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
                        const active = isSelected(selection, key);
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
                                title="Doble click para colocar en el muro activo; arrastrá al viewport para colocar directamente"
                                draggable={canEdit}
                                onDragStart={
                                  canEdit
                                    ? (e) => {
                                        const item = project.items.find(
                                          (it) => it.id === f.itemId,
                                        );
                                        const mod = item
                                          ? modules.find(
                                              (m) => m.id === item.moduleId,
                                            )
                                          : undefined;
                                        const dims = item
                                          ? resolveItemDims(item, mod)
                                          : { width: 600, height: 720, depth: 560 };
                                        const payload = encodeUnplacedDrag({
                                          itemId: f.itemId,
                                          instanceIndex: f.instanceIndex,
                                          widthMm: dims.width,
                                          heightMm: dims.height,
                                          depthMm: dims.depth,
                                        });
                                        e.dataTransfer.setData(UNPLACED_DRAG_MIME, payload);
                                        e.dataTransfer.effectAllowed = 'move';
                                        setGhostDrag({
                                          kind: 'unplaced',
                                          itemId: f.itemId,
                                          instanceIndex: f.instanceIndex,
                                          widthMm: dims.width,
                                          heightMm: dims.height,
                                          depthMm: dims.depth,
                                        });
                                      }
                                    : undefined
                                }
                                onDragEnd={
                                  canEdit
                                    ? () => {
                                        setGhostDrag(null);
                                        setGhostHit(null);
                                      }
                                    : undefined
                                }
                                onClick={(e) => handleListSelect(key, e)}
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
                    <p className="spatial-studio__hint" style={{ marginTop: 'var(--space-2)' }}>
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
                        const active = isSelected(selection, key);
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
                              onClick={(e) => handleListSelect(key, e)}
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
                  </>
                )}
              </div>
            </>
          ) : null}

          {sidebarTab === 'materials' ? (
            <>
              <div className="spatial-studio__sidebar-head">
                <h3 className="spatial-studio__section-title" style={{ margin: 0 }}>
                  Materiales
                </h3>
                <div className="spatial-studio__sidebar-head-actions">
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

              <div className="spatial-studio__sidebar-nav">
                <WorkspaceTabs
                  tabs={[
                    { id: 'ambient' as const, label: 'Ambiente' },
                    { id: 'boards' as const, label: 'Tableros' },
                  ]}
                  activeTab={materialsSubTab}
                  onTabChange={setMaterialsSubTab}
                  ariaLabel="Tipos de material"
                  idPrefix="spatial-studio-materials"
                  testIdPrefix="spatial-studio-materials"
                />
              </div>

              <div
                role="tabpanel"
                id={`spatial-studio-materials-panel-${materialsSubTab}`}
                aria-labelledby={`spatial-studio-materials-tab-${materialsSubTab}`}
              >
              {materialsSubTab === 'boards' ? (
                <BoardMaterialPalette
                  materials={catalog.materials}
                  materialCategories={materialCategories}
                  canEdit={canEdit}
                  resolveMediaUrl={resolveMediaUrl}
                  scope={boardScope}
                  onScopeChange={setBoardScope}
                  hasSelection={selectedKey !== null}
                  status={boardStatus}
                  onApply={(materialId) => applyBoardMaterial(materialId, null)}
                  onCardDragEnd={() => setBoardPaintHoverKey(null)}
                />
              ) : (
              <section className="spatial-studio__section">
                <MaterialPalette
                  materials={availableAmbientMaterials}
                  categories={catalog.ambientCategories ?? []}
                  activeFloorId={layout.floorMaterialId}
                  activeWallId={layout.wallMaterialId}
                  activeCeilingId={layout.ceilingMaterialId}
                  activeCountertopId={layout.countertopMaterialId}
                  testId="spatial-studio-material-palette"
                  onSelectMaterial={(mat, targetSurface) => {
                    if (!canEdit) return;
                    if (targetSurface === 'floor') {
                      commit({ ...layout, floorMaterialId: mat.id });
                    } else if (targetSurface === 'wall') {
                      if (activeWallId) {
                        const updatedWalls = (layout.walls ?? []).map((w) =>
                          w.id === activeWallId ? { ...w, wallMaterialId: mat.id } : w,
                        );
                        commit({ ...layout, walls: updatedWalls });
                      } else {
                        commit({ ...layout, wallMaterialId: mat.id });
                      }
                    } else if (targetSurface === 'ceiling') {
                      commit({ ...layout, ceilingMaterialId: mat.id, showCeiling: true });
                    } else if (targetSurface === 'countertop') {
                      commit({ ...layout, countertopMaterialId: mat.id, showCountertop: true });
                    }
                  }}
                />
              </section>
              )}
              </div>
            </>
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
          </div>
        </aside>

        <main
          className="spatial-studio__viewport"
          data-testid="spatial-studio-viewport"
          role="tabpanel"
          id={`spatial-studio-spaces-panel-${activeSpaceId ?? spaces[0]?.id ?? ''}`}
          aria-labelledby={`spatial-studio-spaces-tab-${activeSpaceId ?? spaces[0]?.id ?? ''}`}
        >
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
                onClick={fitRoom}
                title="Ajustar cámara al ambiente completo (muros + muebles)"
                data-testid="spatial-studio-cam-fit-room"
              >
                Ajustar
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
                title={
                  undoStack.length > 0
                    ? `Deshacer: ${undoLabelOf(undoStack) ?? 'plano'} (Ctrl+Z)`
                    : 'Deshacer plano'
                }
                data-testid="spatial-studio-undo"
              >
                <Undo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className="btn btn--small"
                disabled={!canEdit || redoStack.length === 0}
                onClick={redoPlan}
                title={
                  redoStack.length > 0
                    ? `Rehacer: ${redoLabelOf(redoStack) ?? 'plano'} (Ctrl+Shift+Z)`
                    : 'Rehacer plano'
                }
                data-testid="spatial-studio-redo"
              >
                <Redo2 size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <div className="spatial-studio__toolbar-group" role="group" aria-label="Precisión">
              <button
                type="button"
                className={
                  precisionOpen
                    ? 'btn btn--small spatial-studio__tool--on'
                    : 'btn btn--small'
                }
                aria-pressed={precisionOpen}
                aria-expanded={precisionOpen}
                onClick={() => setPrecisionOpen((v) => !v)}
                title="Precisión: paso de nudge y snap (persiste en este equipo)"
                data-testid="spatial-studio-precision-toggle"
              >
                <Ruler size={14} strokeWidth={1.5} aria-hidden /> Precisión
              </button>
            </div>
            {precisionOpen ? (
              <div
                className="spatial-studio__precision-panel"
                role="dialog"
                aria-label="Ajustes de precisión"
                data-testid="spatial-studio-precision-panel"
              >
                <label className="spatial-studio__field">
                  <span>Paso nudge (mm)</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={precision.settings.nudgeStepMm}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) precision.update({ nudgeStepMm: v });
                    }}
                    data-testid="spatial-studio-precision-nudge"
                  />
                </label>
                <p className="spatial-studio__hint">
                  Shift+flechas = ×{precision.settings.nudgeCoarseMultiplier} (
                  {precision.nudgeStepFor(true)} mm).
                </p>
                <label className="spatial-studio__field spatial-studio__field--check">
                  <input
                    type="checkbox"
                    checked={precision.settings.wallSnap}
                    onChange={(e) => precision.update({ wallSnap: e.target.checked })}
                    data-testid="spatial-studio-precision-wallsnap"
                  />
                  <span>Snap de muro (vecinos/extremos)</span>
                </label>
                <label className="spatial-studio__field">
                  <span>Umbral snap (mm)</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    defaultValue={precision.settings.wallSnapThresholdMm}
                    disabled={!precision.settings.wallSnap}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) precision.update({ wallSnapThresholdMm: v });
                    }}
                    data-testid="spatial-studio-precision-threshold"
                  />
                </label>
                <label className="spatial-studio__field">
                  <span>Gap entre muebles (mm)</span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    defaultValue={precision.settings.wallGapMm}
                    disabled={!precision.settings.wallSnap}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) precision.update({ wallGapMm: v });
                    }}
                    data-testid="spatial-studio-precision-gap"
                  />
                </label>
                <label className="spatial-studio__field">
                  <span>Grilla islas (mm, 0 = libre)</span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    defaultValue={precision.settings.islandSnapMm}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) precision.update({ islandSnapMm: v });
                    }}
                    data-testid="spatial-studio-precision-island"
                  />
                </label>
              </div>
            ) : null}
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
                  hideOccludingWalls
                    ? 'btn btn--small spatial-studio__tool--on'
                    : 'btn btn--small'
                }
                aria-pressed={hideOccludingWalls}
                onClick={() => setHideOccludingWalls((v) => !v)}
                title="Atenuar los muros entre la cámara y el ambiente para que no bloqueen el trabajo"
                data-testid="spatial-studio-toggle-hide-walls"
              >
                Ocultar muros
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
                hideOccludingWalls={hideOccludingWalls}
                testId="spatial-studio-scene"
                colorMode={colorMode}
                materialColors={materialColors}
                materialTextures={materialTextures}
                surfaceMode={surfaceMode}
                lightingMode={lightingMode}
                hardwareCatalog={catalog.hardware}
                showOutlines={showOutlines}
                showWireframe={showWireframe}
                showFloorGrid={showFloorGrid}
                ambientFloor={ambientFloor}
                ambientWall={ambientWall}
                ambientCeiling={ambientCeiling}
                ambientCountertop={ambientCountertop}
                availableAmbientMaterials={availableAmbientMaterials}
                showCeiling={layout.showCeiling}
                selectedModuleKey={selectedKey}
                selectedModuleKeys={selection.keys}
                keyboardNavActive={selection.keys.length === 0}
                onSelectModule={handleSceneSelectModule}
                selectedPartId={detailMode ? detailPartId : null}
                onSelectPart={detailMode ? handleSceneSelectPart : undefined}
                isolateSelected={detailMode}
                selectedHardwareId={detailMode ? detailHardwareId : null}
                onSelectHardware={detailMode ? handleSceneSelectHardware : undefined}
                showDragGuides
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
                selectedWallId={targetWallId}
                onSelectWall={(wallId) => {
                  if (!wallId || wallId === targetWallId) {
                    setTargetWallId(null);
                  } else {
                    setTargetWallId(wallId);
                  }
                }}
                paintHoverSurface={paintHoverSurface}
                draggingInvalid={draggingInvalid}
                onPaintHover={handlePaintHover}
                onPaintDrop={handlePaintDrop}
                ghostModule={ghostDrag}
                ghostDropValid={calcGhostValid(ghostHit, ghostDrag)}
                ghostPosition={
                  ghostDrag && ghostHit
                    ? resolveGhostPosition(ghostHit, ghostDrag)
                    : null
                }
                onUnplacedHover={canEdit ? handleUnplacedHover : undefined}
                onUnplacedDrop={canEdit ? handleUnplacedDrop : undefined}
                onBoardPaintHover={canEdit ? setBoardPaintHoverKey : undefined}
                onBoardPaintDrop={canEdit ? handleBoardPaintDrop : undefined}
                boardPaintHoverModuleKey={boardPaintHoverKey}
              />
            </Suspense>
          ) : (
            <p className="catalog-empty">
              WebGL no disponible. Usá un navegador con aceleración 3D.
            </p>
          )}

          <StudioSelectionBar
            count={selectionCapabilities.count}
            canEdit={canEdit}
            hasClipboard={clipboard.length > 0}
            allOnWall={selectionCapabilities.allPlacedOnWall}
            allIslands={selectionCapabilities.allIslands}
            wallName={selectionCapabilities.wallName}
            primaryPlacedOnWall={selectionCapabilities.primaryPlacedOnWall}
            status={commandStatus}
            onDuplicate={handleDuplicateSelection}
            onCopy={handleCopySelection}
            onPaste={handlePaste}
            onPasteRelative={handlePasteRelative}
            onCompact={handleCompactOnWall}
            onDistribute={handleDistribute}
            onAlignIslands={handleAlignIslands}
            onCenter={handleCenterOnWall}
            onFitSelection={fitSelection}
            onRemoveFromPlan={handleRemoveSelectionFromPlan}
          />

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
                  // F145 — huecos del muro: tramos sólidos + vano punteado.
                  const wall = layout.walls.find((w) => w.id === f.id);
                  const dxMm = f.endXMm - f.originXMm;
                  const dyMm = f.endYMm - f.originYMm;
                  const wallLenMm = Math.max(1, Math.hypot(dxMm, dyMm));
                  const dirX = dxMm / wallLenMm;
                  const dirY = dyMm / wallLenMm;
                  const pxAt = (tMm: number) => ({
                    x: x1 + dirX * tMm * planMini.scale,
                    y: y1 + dirY * tMm * planMini.scale,
                  });
                  const solidSegments = wall
                    ? splitWallSegments(wall, 2400).filter(
                        (s) => s.zBottomMm === 0 && s.zTopMm >= 2400,
                      )
                    : [{ startMm: 0, lengthMm: wallLenMm }];
                  return (
                    <g key={f.id}>
                      {solidSegments.map((s, si) => {
                        const a = pxAt(s.startMm);
                        const b = pxAt(s.startMm + s.lengthMm);
                        return (
                          <line
                            key={si}
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke={
                              active
                                ? 'var(--accent-500, #3b82f6)'
                                : 'var(--text-primary, #e2e8f0)'
                            }
                            strokeWidth={active ? 5 : 3}
                            strokeLinecap="square"
                          />
                        );
                      })}
                      {(wall?.openings ?? []).map((o) => {
                        const a = pxAt(Math.max(0, o.offsetMm));
                        const b = pxAt(
                          Math.min(wallLenMm, o.offsetMm + o.widthMm),
                        );
                        return (
                          <line
                            key={`op-${o.id}`}
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke="var(--accent-400, #60a5fa)"
                            strokeWidth={active ? 4 : 2.5}
                            strokeDasharray="4 3"
                            strokeLinecap="butt"
                          >
                            <title>
                              {`${WALL_OPENING_KIND_LABELS_ES[o.kind]} · ${
                                o.widthMm
                              } mm a ${Math.round(o.offsetMm)} mm`}
                            </title>
                          </line>
                        );
                      })}
                    </g>
                  );
                })}
                {planPlacements2D.map((p) => {
                  const key = `${p.itemId}#${p.instanceIndex}`;
                  const selected = isSelected(selection, key);
                  const rx =
                    planMini.pad + (p.boxMm.minX - planMini.minX) * planMini.scale;
                  const ry =
                    planMini.pad + (p.boxMm.minY - planMini.minY) * planMini.scale;
                  const rw = Math.max(4, (p.boxMm.maxX - p.boxMm.minX) * planMini.scale);
                  const rh = Math.max(4, (p.boxMm.maxY - p.boxMm.minY) * planMini.scale);

                  const fx1 =
                    planMini.pad + (p.frontFaceMm.x1 - planMini.minX) * planMini.scale;
                  const fy1 =
                    planMini.pad + (p.frontFaceMm.y1 - planMini.minY) * planMini.scale;
                  const fx2 =
                    planMini.pad + (p.frontFaceMm.x2 - planMini.minX) * planMini.scale;
                  const fy2 =
                    planMini.pad + (p.frontFaceMm.y2 - planMini.minY) * planMini.scale;

                  const theme = getCategoryTheme(p.category);
                  const fillColor = selected
                    ? 'var(--accent-500, #3b82f6)'
                    : theme.fillColor;
                  const strokeColor = selected
                    ? 'var(--accent-600, #2563eb)'
                    : theme.strokeColor;

                  return (
                    <g
                      key={key}
                      onClick={(e) =>
                        handleSceneSelectModule(
                          key,
                          modifiersFromPointer(e.nativeEvent),
                        )
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <title>{p.label} ({p.widthMm} × {p.depthMm} mm)</title>
                      <rect
                        x={rx}
                        y={ry}
                        width={rw}
                        height={rh}
                        fill={fillColor}
                        opacity={selected ? 1 : 0.88}
                        stroke={strokeColor}
                        strokeWidth={selected ? 1.5 : 1}
                        strokeDasharray={theme.isDashed ? '2 1' : undefined}
                        rx={1}
                      />
                      <path
                        d={`M ${fx1} ${fy1} L ${fx2} ${fy2}`}
                        className="spatial-studio__plan-front-face"
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                    </g>
                  );
                })}
              </svg>
              <div
                className="spatial-studio__plan-legend"
                data-testid="spatial-studio-plan-legend"
              >
                <span className="spatial-studio__plan-legend-item">
                  <span
                    className="spatial-studio__plan-swatch spatial-studio__plan-swatch--floor"
                    aria-hidden
                  />
                  Base
                </span>
                <span className="spatial-studio__plan-legend-item">
                  <span
                    className="spatial-studio__plan-swatch spatial-studio__plan-swatch--wall"
                    aria-hidden
                  />
                  Alacena
                </span>
                <span className="spatial-studio__plan-legend-item">
                  <span
                    className="spatial-studio__plan-swatch spatial-studio__plan-swatch--alto"
                    aria-hidden
                  />
                  Despensa
                </span>
                <span className="spatial-studio__plan-legend-item">
                  <span
                    className="spatial-studio__plan-swatch spatial-studio__plan-swatch--free"
                    aria-hidden
                  />
                  Isla
                </span>
              </div>
            </div>
          ) : null}
        </main>

        <aside
          className="spatial-studio__inspector"
          data-testid="spatial-studio-inspector"
        >
          {selection.keys.length > 1 && selectionCapabilities.count > 1 ? (
            <>
              <h3 className="spatial-studio__section-title">
                Selección · {selection.keys.length} muebles
              </h3>
              <section className="spatial-studio__section" data-testid="spatial-studio-multi-panel">
                <div className="spatial-studio__multi-summary">
                  {selectionCapabilities.allPlacedOnWall ? (
                    <span>
                      Todos en {selectionCapabilities.wallName ?? 'el muro'} · usá
                      Alinear / Distribuir / Centrar en la barra del canvas.
                    </span>
                  ) : selectionCapabilities.allIslands ? (
                    <span>
                      {selection.keys.length} islas · alinealas por bordes o
                      centros desde la barra del canvas.
                    </span>
                  ) : (
                    <span>
                      Selección mixta (muros o islas distintas) · los comandos de
                      alineación funcionan sobre muebles de un mismo muro.
                    </span>
                  )}
                  <span>
                    La primera seleccionada es la referencia para «Pegar a…» y
                    alimenta este inspector al volver a una sola.
                  </span>
                </div>
              </section>
            </>
          ) : !selectedItem || !selectedRef ? (
            <>
              <h3 className="spatial-studio__section-title">
                Ambiente · {activeSpaceName}
              </h3>
              <section className="spatial-studio__section">
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

                <div className="spatial-studio__field spatial-studio__field--block">
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
                    {layout.walls.map((w, i) => {
                      const wallLabel = w.name?.trim() || `Muro ${i + 1}`;
                      const openings = w.openings ?? [];
                      return (
                        <li key={w.id}>
                          <button
                            type="button"
                            className={
                              activeWallId === w.id
                                ? 'spatial-studio__wall-btn spatial-studio__wall-btn--active'
                                : 'spatial-studio__wall-btn'
                            }
                            onClick={() =>
                              setTargetWallId(activeWallId === w.id ? null : w.id)
                            }
                            data-testid={`spatial-studio-wall-${w.id}`}
                            aria-expanded={activeWallId === w.id}
                          >
                            {wallLabel} · {w.lengthMm} mm
                            {openings.length > 0
                              ? ` · ${openings.length} hueco${openings.length === 1 ? '' : 's'}`
                              : ''}
                          </button>
                          {canEdit && activeWallId === w.id ? (
                            <div
                              className="spatial-studio__wall-editor"
                              data-testid={`spatial-studio-wall-editor-${w.id}`}
                            >
                              <label className="spatial-studio__field">
                                <span>Nombre</span>
                                <CommitOnBlurInput
                                  type="text"
                                  value={w.name ?? ''}
                                  onCommit={(raw) =>
                                    handleUpdateWall(w.id, { name: raw })
                                  }
                                  testId="spatial-studio-wall-name"
                                />
                              </label>
                              <div className="spatial-studio__wall-grid">
                                <label className="spatial-studio__field">
                                  <span>Largo (mm)</span>
                                  <CommitOnBlurInput
                                    value={w.lengthMm}
                                    min={MIN_WALL_LENGTH_MM}
                                    step={50}
                                    onCommit={(raw) => {
                                      const v = Number(raw);
                                      if (Number.isFinite(v)) {
                                        handleUpdateWall(w.id, { lengthMm: v });
                                      }
                                    }}
                                    testId="spatial-studio-wall-length"
                                  />
                                </label>
                                <label className="spatial-studio__field">
                                  <span>Ángulo (°)</span>
                                  <CommitOnBlurInput
                                    value={w.angleDeg}
                                    step={15}
                                    onCommit={(raw) => {
                                      const v = Number(raw);
                                      if (Number.isFinite(v)) {
                                        handleUpdateWall(w.id, { angleDeg: v });
                                      }
                                    }}
                                    testId="spatial-studio-wall-angle"
                                  />
                                </label>
                              </div>
                              <div
                                className="spatial-studio__preset-grid"
                                role="group"
                                aria-label="Ángulos rectos"
                              >
                                {[0, 90, 180, 270].map((deg) => (
                                  <button
                                    key={deg}
                                    type="button"
                                    className={
                                      ((w.angleDeg % 360) + 360) % 360 === deg
                                        ? 'spatial-studio__preset spatial-studio__preset--active'
                                        : 'spatial-studio__preset'
                                    }
                                    onClick={() =>
                                      handleUpdateWall(w.id, { angleDeg: deg })
                                    }
                                    data-testid={`spatial-studio-wall-angle-${deg}`}
                                  >
                                    {deg}°
                                  </button>
                                ))}
                              </div>
                              <details className="spatial-studio__wall-advanced">
                                <summary className="spatial-studio__hint">
                                  Origen del muro (avanzado)
                                </summary>
                                <div className="spatial-studio__wall-grid">
                                  <label className="spatial-studio__field">
                                    <span>X (mm)</span>
                                    <CommitOnBlurInput
                                      value={w.originXMm ?? 0}
                                      step={50}
                                      onCommit={(raw) => {
                                        const v = Number(raw);
                                        if (Number.isFinite(v)) {
                                          handleUpdateWall(w.id, { originXMm: v });
                                        }
                                      }}
                                      testId="spatial-studio-wall-origin-x"
                                    />
                                  </label>
                                  <label className="spatial-studio__field">
                                    <span>Y (mm)</span>
                                    <CommitOnBlurInput
                                      value={w.originYMm ?? 0}
                                      step={50}
                                      onCommit={(raw) => {
                                        const v = Number(raw);
                                        if (Number.isFinite(v)) {
                                          handleUpdateWall(w.id, { originYMm: v });
                                        }
                                      }}
                                      testId="spatial-studio-wall-origin-y"
                                    />
                                  </label>
                                </div>
                              </details>

                              <span className="spatial-studio__field-label">
                                Huecos del muro
                              </span>
                              {openings.length === 0 ? (
                                <p className="spatial-studio__hint">
                                  Ventanas, puertas y pasajes se ven en el 3D y en la
                                  planta; no afectan la cotización.
                                </p>
                              ) : (
                                <ul className="spatial-studio__opening-list">
                                  {openings.map((o) => {
                                    const defaults = WALL_OPENING_DEFAULTS_MM[o.kind];
                                    return (
                                      <li
                                        key={o.id}
                                        className="spatial-studio__opening-row"
                                        data-testid="spatial-studio-opening"
                                      >
                                        <span className="spatial-studio__opening-kind">
                                          {WALL_OPENING_KIND_LABELS_ES[o.kind]}
                                        </span>
                                        <label className="spatial-studio__field">
                                          <span>Distancia</span>
                                          <CommitOnBlurInput
                                            value={o.offsetMm}
                                            min={0}
                                            step={50}
                                            onCommit={(raw) => {
                                              const v = Number(raw);
                                              if (Number.isFinite(v)) {
                                                handleUpdateOpening(w.id, o.id, {
                                                  offsetMm: v,
                                                });
                                              }
                                            }}
                                            testId="spatial-studio-opening-offset"
                                          />
                                        </label>
                                        <label className="spatial-studio__field">
                                          <span>Ancho</span>
                                          <CommitOnBlurInput
                                            value={o.widthMm}
                                            min={100}
                                            step={50}
                                            onCommit={(raw) => {
                                              const v = Number(raw);
                                              if (Number.isFinite(v)) {
                                                handleUpdateOpening(w.id, o.id, {
                                                  widthMm: v,
                                                });
                                              }
                                            }}
                                            testId="spatial-studio-opening-width"
                                          />
                                        </label>
                                        <label className="spatial-studio__field">
                                          <span>Alto</span>
                                          <CommitOnBlurInput
                                            value={o.heightMm ?? defaults.heightMm}
                                            min={100}
                                            step={50}
                                            onCommit={(raw) => {
                                              const v = Number(raw);
                                              if (Number.isFinite(v)) {
                                                handleUpdateOpening(w.id, o.id, {
                                                  heightMm: v,
                                                });
                                              }
                                            }}
                                            testId="spatial-studio-opening-height"
                                          />
                                        </label>
                                        <label className="spatial-studio__field">
                                          <span>Antepecho</span>
                                          <CommitOnBlurInput
                                            value={o.sillMm ?? defaults.sillMm}
                                            min={0}
                                            step={50}
                                            onCommit={(raw) => {
                                              const v = Number(raw);
                                              if (Number.isFinite(v)) {
                                                handleUpdateOpening(w.id, o.id, {
                                                  sillMm: v,
                                                });
                                              }
                                            }}
                                            testId="spatial-studio-opening-sill"
                                          />
                                        </label>
                                        <button
                                          type="button"
                                          className="btn btn--small"
                                          onClick={() => handleRemoveOpening(w.id, o.id)}
                                          title={`Quitar ${WALL_OPENING_KIND_LABELS_ES[
                                            o.kind
                                          ].toLowerCase()}`}
                                          data-testid="spatial-studio-opening-remove"
                                        >
                                          <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                              <div
                                className="spatial-studio__preset-grid"
                                role="group"
                                aria-label="Agregar hueco"
                              >
                                {(['window', 'door', 'pass'] as const).map((kind) => (
                                  <button
                                    key={kind}
                                    type="button"
                                    className="spatial-studio__preset"
                                    onClick={() => handleAddOpening(w.id, kind)}
                                    title={`Agregar ${WALL_OPENING_KIND_LABELS_ES[
                                      kind
                                    ].toLowerCase()} en el primer tramo libre`}
                                    data-testid={`spatial-studio-add-opening-${kind}`}
                                  >
                                    + {WALL_OPENING_KIND_LABELS_ES[kind]}
                                  </button>
                                ))}
                              </div>

                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => handleRemoveWall(w.id)}
                                title="Quitar el muro; sus muebles quedan sin colocar"
                                data-testid="spatial-studio-remove-wall"
                              >
                                <Trash2 size={14} strokeWidth={1.5} aria-hidden /> Quitar
                                muro
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {canEdit ? (
                  <div className="spatial-studio__field spatial-studio__wall-add">
                    <label className="spatial-studio__field">
                      <span>Nuevo muro (mm)</span>
                      <input
                        type="number"
                        min={MIN_WALL_LENGTH_MM}
                        step={50}
                        value={newWallLengthMm}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) setNewWallLengthMm(v);
                        }}
                        data-testid="spatial-studio-new-wall-length"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => handleAddWall(newWallLengthMm)}
                      title="Encadena un muro al final del ambiente girando 90°"
                      data-testid="spatial-studio-add-wall"
                    >
                      <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar muro
                    </button>
                  </div>
                ) : null}

                {envMessage ? (
                  <p
                    className="spatial-studio__import-msg"
                    role="status"
                    data-testid="spatial-studio-env-msg"
                  >
                    {envMessage}
                  </p>
                ) : null}

                {canEdit && activeWallId ? (
                  <div
                    className="spatial-studio__field"
                    style={{ marginTop: 'var(--space-2)' }}
                  >
                    <span>Material de este muro</span>
                    <select
                      value={
                        layout.walls.find((w) => w.id === activeWallId)
                          ?.wallMaterialId ?? ''
                      }
                      disabled={!canEdit}
                      onChange={(e) => {
                        const matId = e.target.value || undefined;
                        const updatedWalls = (layout.walls ?? []).map((w) =>
                          w.id === activeWallId
                            ? { ...w, wallMaterialId: matId }
                            : w,
                        );
                        commit({ ...layout, walls: updatedWalls });
                      }}
                      data-testid="spatial-studio-select-wall-material"
                    >
                      <option value="">(Usar material general de muros)</option>
                      {availableAmbientMaterials
                        .filter((m) => m.surfaceType === 'wall')
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.code})
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}

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
                  </div>
                ) : null}
              </section>
              <p className="spatial-studio__hint">
                Seleccioná un mueble en el plano o en «De la obra» para editar
                sus propiedades.
              </p>
            </>
          ) : (
            <>
              <h3 className="spatial-studio__section-title">Propiedades</h3>
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

              <div className="spatial-studio__field spatial-studio__check-row">
                <button
                  type="button"
                  className={
                    detailMode
                      ? 'btn btn--small spatial-studio__tool--on'
                      : 'btn btn--small'
                  }
                  aria-pressed={detailMode}
                  onClick={() => {
                    setDetailMode((v) => !v);
                    setDetailPartId(null);
                    setDetailHardwareId(null);
                  }}
                  title="Modo detalle: hacer clic en una pieza o herraje del mueble para inspeccionarlo"
                  data-testid="spatial-studio-detail-toggle"
                >
                  <Scan size={14} strokeWidth={1.5} aria-hidden /> Ver piezas
                </button>
              </div>

              {detailTarget ? (
                <div
                  className="spatial-studio__detail-card"
                  data-testid="spatial-studio-detail-card"
                >
                  <span className="spatial-studio__detail-card-title">
                    {detailTarget.kind === 'part'
                      ? detailTarget.part.code?.trim() || detailTarget.part.description
                      : detailTarget.hardware?.name?.trim() || 'Herraje'}
                  </span>
                  {detailTarget.kind === 'part' ? (
                    <span className="spatial-studio__detail-card-meta">
                      {detailTarget.part.lengthMm} × {detailTarget.part.widthMm} mm ·{' '}
                      {catalog.materials.find((m) => m.id === detailTarget.part.materialId)
                        ?.name?.trim() || 'material del catálogo'}
                    </span>
                  ) : (
                    <span className="spatial-studio__detail-card-meta">
                      {detailTarget.hardware?.code?.trim() || 'herraje'} · la
                      edición fina vive en el editor del mueble
                    </span>
                  )}
                </div>
              ) : detailMode ? (
                <p className="spatial-studio__hint" data-testid="spatial-studio-detail-hint">
                  Detalle: hacé clic en una pieza o herraje del mueble en el
                  canvas. ESC vuelve a la unidad.
                </p>
              ) : null}

              <div className="spatial-studio__tabs">
                <WorkspaceTabs
                  tabs={[
                    { id: 'props' as const, label: 'Mueble' },
                    { id: 'position' as const, label: 'Posición' },
                  ]}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                  ariaLabel="Inspector"
                  idPrefix="spatial-studio-inspector"
                  testIdPrefix="spatial-studio-inspector"
                />
              </div>

              {inspectorTab === 'props' ? (
                <div
                  className="spatial-studio__tab-panel"
                  data-testid="spatial-studio-panel-props"
                  role="tabpanel"
                  id="spatial-studio-inspector-panel-props"
                  aria-labelledby="spatial-studio-inspector-tab-props"
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
                                updateSelectedItem(
                                  { measurePresetId: pr.id, customDims: undefined },
                                  'Medida comercial',
                                )
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

                  {selectedModule && moduleAcceptsCustomDims(selectedModule) ? (
                    <div className="spatial-studio__field">
                      <span className="spatial-studio__field-label">
                        A medida (mm)
                      </span>
                      <p className="spatial-studio__hint">
                        {selectedItem.customDims
                          ? 'A medida'
                          : 'Preset comercial'}{' '}
                        · afecta a las {selectedItem.quantity}{' '}
                        {selectedItem.quantity === 1 ? 'copia' : 'copias'} ·
                        cambia BOM y precio.
                      </p>
                      <div className="spatial-studio__dims-row">
                        {(
                          [
                            ['widthMm', 'Ancho'],
                            ['heightMm', 'Alto'],
                            ['depthMm', 'Prof.'],
                          ] as const
                        ).map(([dimKey, dimLabel]) => {
                          const current = selectedItem.customDims?.[dimKey];
                          const effective =
                            selectedDims?.[
                              dimKey === 'widthMm'
                                ? 'width'
                                : dimKey === 'heightMm'
                                  ? 'height'
                                  : 'depth'
                            ] ?? 0;
                          const issues = dimDraftIssues;
                          return (
                            <label
                              key={dimKey}
                              className="spatial-studio__dims-cell"
                            >
                              <span>{dimLabel}</span>
                              <input
                                type="number"
                                min={1}
                                step={10}
                                key={`dim-${dimKey}-${current ?? effective}`}
                                defaultValue={current ?? effective}
                                disabled={!canEdit || !onUpdateItem}
                                aria-invalid={issues.some((i) => i.field === dimKey) || undefined}
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (!Number.isFinite(v)) return;
                                  handleCustomDimsBlur(dimKey, v);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                                data-testid={`spatial-studio-dim-${dimKey}`}
                              />
                            </label>
                          );
                        })}
                      </div>
                      {dimDraftIssues.length > 0 ? (
                        <p
                          className="spatial-studio__hint spatial-studio__hint--error"
                          role="alert"
                          data-testid="spatial-studio-dim-error"
                        >
                          {dimDraftIssues[0]!.message}
                        </p>
                      ) : null}
                      {selectedItem.customDims && canEdit && onUpdateItem ? (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() =>
                            updateSelectedItem(
                              { customDims: undefined },
                              'Volver a preset',
                            )
                          }
                          data-testid="spatial-studio-dim-clear"
                        >
                          Volver a preset
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="spatial-studio__hint">
                      Medidas a medida no disponibles para este mueble (no es
                      paramétrico).
                    </p>
                  )}

                  {(() => {
                    const BASE_ROLE_CODES = new Set([
                      ZOCLO_BOARD_ROLE,
                      ZOCLO_STRIP_ROLE,
                      PATAS_ROLE,
                    ]);
                    const nonBaseGroups = optionGroupsForItem.filter(
                      (g) => !BASE_ROLE_CODES.has(g.code),
                    );
                    return nonBaseGroups.length > 0 ? (
                    <div className="spatial-studio__finishes">
                      <span className="spatial-studio__field-label">
                        Acabados y herrajes
                      </span>
                      {nonBaseGroups.map((group) => {
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
                        Sin más acabados para este mueble.
                      </p>
                    );
                  })()}

                  {(() => {
                    // F087 — Zócalo: una sola decisión (tipo + acabado).
                    // La altura vive en la pestaña Posición (plano).
                    const itemBaseMode: ModuleBaseMode =
                      selectedItem.baseMode ??
                      (selectedModule
                        ? resolveModuleBaseMode(selectedModule)
                        : 'none');
                    const finishRole =
                      itemBaseMode === 'plinth_board'
                        ? ZOCLO_BOARD_ROLE
                        : itemBaseMode === 'plinth_strip'
                          ? ZOCLO_STRIP_ROLE
                          : itemBaseMode === 'legs'
                            ? PATAS_ROLE
                            : null;
                    const finishGroup = finishRole
                      ? catalog.optionGroups.find((g) => g.code === finishRole)
                      : undefined;
                    const finishOptions = finishGroup
                      ? optionsForGroup(finishGroup, pickerCatalogs)
                      : [];
                    const finishValue = finishRole
                      ? (selectedItem.optionChoices[finishRole]?.trim() ??
                        project.projectLevelChoices?.[finishRole]?.trim() ??
                        '')
                      : '';
                    const finishInherit =
                      finishRole && finishValue === ''
                        ? (project.projectLevelChoices?.[finishRole]?.trim() ??
                          '')
                        : '';
                    return (
                    <div className="spatial-studio__finishes">
                      <span className="spatial-studio__field-label">
                        Zócalo (base del mueble)
                      </span>
                      <label className="spatial-studio__field">
                        <span>¿Cómo apoya en el piso?</span>
                        <select
                          value={itemBaseMode}
                          disabled={!canEdit || !onUpdateItem}
                          onChange={(e) => {
                            if (!onUpdateItem) return;
                            onUpdateItem({
                              ...selectedItem,
                              baseMode: e.target.value as ModuleBaseMode,
                            });
                          }}
                          data-testid="spatial-studio-base-mode"
                        >
                          <option value="plinth_board">
                            Zócalo de melamina (se corta y canta)
                          </option>
                          <option value="plinth_strip">
                            Perfil comprado (por metro lineal)
                          </option>
                          <option value="legs">Patas / niveladores</option>
                          <option value="none">Sin zócalo</option>
                        </select>
                      </label>
                      {finishGroup && finishOptions.length > 0 ? (
                        <label className="spatial-studio__field">
                          <span>
                            {itemBaseMode === 'plinth_board'
                              ? 'Acabado del zócalo'
                              : itemBaseMode === 'plinth_strip'
                                ? 'Perfil (de tu catálogo)'
                                : 'Patas (de tu catálogo)'}
                          </span>
                          <select
                            value={finishValue}
                            disabled={!canEdit || !onUpdateItem}
                            onChange={(e) => {
                              if (!onUpdateItem || !finishRole) return;
                              onUpdateItem({
                                ...selectedItem,
                                optionChoices: setItemOptionChoice(
                                  selectedItem.optionChoices,
                                  finishRole,
                                  e.target.value,
                                ),
                              });
                            }}
                            data-testid={`spatial-studio-base-finish-${finishRole}`}
                          >
                            {itemBaseMode === 'plinth_board' ? (
                              <option value="">
                                {finishInherit
                                  ? `Igual que el proyecto (${optionLabelForId(finishInherit, finishGroup, pickerCatalogs)})`
                                  : 'Igual que el frente'}
                              </option>
                            ) : (
                              <option value="">
                                {finishInherit
                                  ? `Proyecto (${optionLabelForId(finishInherit, finishGroup, pickerCatalogs)})`
                                  : 'Default del proyecto'}
                              </option>
                            )}
                            {finishOptions.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : finishRole ? (
                        <p className="spatial-studio__hint">
                          {itemBaseMode === 'plinth_board'
                            ? 'Sin material propio: hereda el acabado del frente.'
                            : 'Creá la opción en tu catálogo (Herrajes + Grupos) para elegirla acá.'}
                        </p>
                      ) : null}
                      <p className="spatial-studio__hint">
                        La altura del zócalo se ajusta en la pestaña Posición.
                      </p>
                    </div>
                    );
                  })()}
                </div>
              ) : null}

              {inspectorTab === 'position' ? (
                <div
                  className="spatial-studio__tab-panel"
                  data-testid="spatial-studio-panel-position"
                  role="tabpanel"
                  id="spatial-studio-inspector-panel-position"
                  aria-labelledby="spatial-studio-inspector-tab-position"
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
                        Isla libre — arrastrá en el piso 3D
                        {precision.settings.islandSnapMm > 0
                          ? ` (grilla ${precision.settings.islandSnapMm} mm)`
                          : ' (sin grilla)'}
                        .
                      </p>
                      <label className="spatial-studio__field">
                        <span>X plano (mm)</span>
                        <input
                          type="number"
                          step={precision.settings.islandSnapMm || 10}
                          key={`fx-${Math.round(selectedPlacement.freeXMm ?? 0)}`}
                          defaultValue={Math.round(selectedPlacement.freeXMm ?? 0)}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            applyFreePlanPosition(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              v,
                              selectedPlacement.freeYMm ?? 0,
                              { intent: 'Mover isla' },
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          data-testid="spatial-studio-free-x"
                        />
                      </label>
                      <label className="spatial-studio__field">
                        <span>Y plano (mm)</span>
                        <input
                          type="number"
                          step={precision.settings.islandSnapMm || 10}
                          key={`fy-${Math.round(selectedPlacement.freeYMm ?? 0)}`}
                          defaultValue={Math.round(selectedPlacement.freeYMm ?? 0)}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            applyFreePlanPosition(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              selectedPlacement.freeXMm ?? 0,
                              v,
                              { intent: 'Mover isla' },
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
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
                          step={precision.settings.nudgeStepMm}
                          key={`off-${Math.round(selectedPlacement.offsetMm)}`}
                          defaultValue={Math.round(selectedPlacement.offsetMm)}
                          disabled={!canEdit}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v) || v === Math.round(selectedPlacement.offsetMm)) return;
                            applyOffsetOnWall(
                              selectedPlacement.itemId,
                              selectedPlacement.instanceIndex,
                              v,
                              { history: 'push', snap: false, intent: 'Offset en muro' },
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
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
            </>
          )}

          <p className="spatial-studio__phase-note">
            Medidas: presets del catálogo o a medida por mueble. En el 3D:
            arrastrá para deslizar (flechas = nudge preciso, Shift = grueso).
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
