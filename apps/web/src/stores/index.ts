/**
 * Zustand stores barrel. Sub-slicing F057-F064 (Perfect App Fase 0):
 *   - workspaceStore: sesión + load workspace + RBAC + workshopSettings (F057)
 *   - catalogStore:   catálogos + módulos + estructuras + ... (F062)
 *   - projectStore:   proyectos + items + templates + breakdown (F063)
 *   - uiStore:        toasts + exportBusy/errors + createKeys (F064)
 */

export {
  useWorkspaceStore,
  createWorkspaceStore,
  type WorkspaceState,
  type WorkspaceStoreDeps,
  type AssignableOwner,
  type AuthGate,
} from './workspaceStore';

export {
  useCatalogStore,
  createCatalogStore,
  ensureCatalogStore,
  getCatalogStoreState,
  type CatalogState,
  type CatalogStoreDeps,
  type ToastFn,
} from './catalogStore';

export {
  useProjectStore,
  createProjectStore,
  ensureProjectStore,
  getProjectStoreState,
  useBackendBreakdownEffect,
  type ProjectState,
  type ProjectStoreDeps,
  type ProjectActor,
} from './projectStore';

export {
  useUiStore,
  getUiStoreState,
  type UiState,
  type ToastType,
  type ToastInput,
  type ToastItem,
  type InternalToast,
  type ToastPhase,
  TOAST_DURATION_MS,
  TOAST_EXIT_MS,
  TOAST_MAX,
} from './uiStore';

export {
  useEditorStore,
  getEditorStoreState,
  type EditorState,
  type EditorTool,
  type EditorViewMode,
  type PartPose,
  type PartDimensions,
} from './editorStore';
