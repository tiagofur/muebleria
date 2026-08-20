/**
 * Helpers for keyboard navigation in modular grids and DOM ID generation.
 */

export const MODULE_PART_GRID_FIELDS = ['qty', 'length', 'width'] as const;
export type ModulePartGridField = (typeof MODULE_PART_GRID_FIELDS)[number];

export function nextGridEnterTarget(input: {
  readonly rowIds: readonly string[];
  readonly currentRowId: string;
  readonly field: string;
}):
  | { readonly kind: 'focus'; readonly rowId: string; readonly field: string }
  | { readonly kind: 'addRow'; readonly field: string }
  | null {
  const { rowIds, currentRowId, field } = input;
  if (rowIds.length === 0 || !field) return null;
  const index = rowIds.indexOf(currentRowId);
  if (index < 0) return null;
  if (index < rowIds.length - 1) {
    return { kind: 'focus', rowId: rowIds[index + 1]!, field };
  }
  return { kind: 'addRow', field };
}

export function modulePartGridInputId(
  partId: string,
  field: ModulePartGridField | 'code' | 'desc' | 'role',
): string {
  switch (field) {
    case 'code':
      return `part-code-${partId}`;
    case 'desc':
      return `part-desc-${partId}`;
    case 'qty':
      return `part-qty-${partId}`;
    case 'length':
      return `part-l-${partId}`;
    case 'width':
      return `part-w-${partId}`;
    case 'role':
      return `part-role-${partId}`;
    default:
      return `part-${field}-${partId}`;
  }
}

export function moduleHardwareGridInputId(
  lineId: string,
  field: 'qty' | 'mode' | 'role' | 'desc',
): string {
  switch (field) {
    case 'qty':
      return `hw-qty-${lineId}`;
    case 'mode':
      return `hw-mode-${lineId}`;
    case 'role':
      return `hw-role-${lineId}`;
    case 'desc':
      return `hw-desc-${lineId}`;
    default:
      return `hw-${field}-${lineId}`;
  }
}
