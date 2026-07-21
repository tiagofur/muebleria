/**
 * Zustand stores barrel. Sub-slicing F057-F064 (Perfect App Fase 0):
 *   - workspaceStore: sesión + load workspace + RBAC + workshopSettings (F057)
 *   - catalogStore:   catálogos + módulos + estructuras + ... (F062)
 *   - projectStore:   proyectos + items + templates + breakdown (F063, futuro)
 *   - uiStore:        toasts + exportBusy/errors + createKeys (F064, futuro)
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
