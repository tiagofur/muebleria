/**
 * Module editor tab ids and routing for validation errors.
 */

export type ModuleEditorTab =
  | 'general'
  | 'structure'
  | 'components'
  | 'measures'
  | 'hardware'
  | 'cost';

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

export function tabForModuleValidationError(
  message: string,
): ModuleEditorTab {
  const m = message.toLocaleLowerCase('es-UY');
  if (m.includes('herraje')) return 'hardware';
  if (m.includes('estructura') || m.includes('medida base')) return 'structure';
  if (m.includes('componente') || m.includes('composición')) return 'components';
  if (m.includes('preset') || m.includes('opción de medida')) return 'measures';
  return 'general';
}
