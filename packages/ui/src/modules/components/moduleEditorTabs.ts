/**
 * Module editor tab ids and routing for validation errors.
 * Fase 4 UI: 3 primary groups (General / Composición / Costo); composition
 * keeps structure · components · measures · hardware as secondary tabs.
 */

export type ModuleEditorTab =
  | 'general'
  | 'structure'
  | 'components'
  | 'measures'
  | 'hardware'
  | 'cost';

/** Top-level groups shown in the primary tablist. */
export type ModuleEditorPrimaryTab = 'general' | 'composition' | 'cost';

export const MODULE_EDITOR_PRIMARY_TABS: readonly {
  readonly id: ModuleEditorPrimaryTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'General' },
  { id: 'composition', label: 'Composición' },
  { id: 'cost', label: 'Costo' },
] as const;

/** Secondary tabs inside Composición. */
export const MODULE_EDITOR_COMPOSITION_TABS: readonly {
  readonly id: Extract<
    ModuleEditorTab,
    'structure' | 'components' | 'measures' | 'hardware'
  >;
  readonly label: string;
}[] = [
  { id: 'structure', label: 'Estructura' },
  { id: 'components', label: 'Componentes' },
  { id: 'measures', label: 'Medidas' },
  { id: 'hardware', label: 'Herrajes' },
] as const;

/** @deprecated Use MODULE_EDITOR_PRIMARY_TABS + COMPOSITION; kept for search. */
export const MODULE_EDITOR_TABS: readonly {
  readonly id: ModuleEditorTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'General' },
  { id: 'structure', label: 'Estructura' },
  { id: 'components', label: 'Componentes' },
  { id: 'measures', label: 'Medidas' },
  { id: 'hardware', label: 'Herrajes' },
  { id: 'cost', label: 'Costo' },
] as const;

export function primaryTabFor(
  tab: ModuleEditorTab,
): ModuleEditorPrimaryTab {
  if (tab === 'general') return 'general';
  if (tab === 'cost') return 'cost';
  return 'composition';
}

export function isCompositionTab(tab: ModuleEditorTab): boolean {
  return primaryTabFor(tab) === 'composition';
}

/** Default panel when entering the Composición group. */
export const DEFAULT_COMPOSITION_TAB: ModuleEditorTab = 'structure';

export function tabForModuleValidationError(
  message: string,
): ModuleEditorTab {
  const m = message.toLocaleLowerCase('es-UY');
  if (m.includes('herraje')) return 'hardware';
  if (m.includes('estructura') || m.includes('medida base')) return 'structure';
  if (m.includes('componente') || m.includes('composición')) return 'components';
  if (m.includes('preset') || m.includes('opción de medida')) return 'measures';
  if (m.includes('costo') || m.includes('precio') || m.includes('margen')) {
    return 'cost';
  }
  return 'general';
}
