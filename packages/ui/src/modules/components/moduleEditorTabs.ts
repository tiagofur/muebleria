/**
 * Module editor tab ids and routing for validation errors.
 * Single flat tablist (no nesting): General / Estructura / Componentes /
 * Agregados / Medidas / Herrajes / Costo.
 */

export type ModuleEditorTab =
  | 'general'
  | 'structure'
  | 'components'
  | 'agregados'
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
  { id: 'agregados', label: 'Agregados' },
  { id: 'measures', label: 'Medidas' },
  { id: 'hardware', label: 'Herrajes' },
  { id: 'cost', label: 'Costo' },
] as const;

export function tabForModuleValidationError(
  message: string,
): ModuleEditorTab {
  const m = message.toLocaleLowerCase('es-UY');
  if (m.includes('herraje')) return 'hardware';
  if (m.includes('agregado') || m.includes('sub-conjunto') || m.includes('agregados')) return 'agregados';
  if (m.includes('estructura') || m.includes('medida base')) return 'structure';
  if (m.includes('componente') || m.includes('composición')) return 'components';
  if (m.includes('preset') || m.includes('opción de medida')) return 'measures';
  if (m.includes('costo') || m.includes('precio') || m.includes('margen')) {
    return 'cost';
  }
  return 'general';
}
