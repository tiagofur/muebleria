/**
 * Component catalog draft helpers and shared placement labels.
 */

import type { Component } from '@muebles/domain';

/** Shared placement options for components and structure/module instances. */
export const COMPONENT_PLACEMENTS: {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: 'base', label: 'Base' },
  { value: 'superior', label: 'Superior' },
  { value: 'lateral_izquierdo', label: 'Lateral Izquierdo' },
  { value: 'lateral_derecho', label: 'Lateral Derecho' },
  { value: 'frontal', label: 'Frontal' },
  { value: 'trasera', label: 'Trasera' },
  { value: 'interno', label: 'Interno' },
  { value: 'puerta', label: 'Puerta' },
  { value: 'frente_cajon', label: 'Frente de Cajón' },
  { value: 'custom', label: 'Personalizado' },
];

export const PLACEMENT_LABEL: Record<string, string> = Object.fromEntries(
  COMPONENT_PLACEMENTS.map((p) => [p.value, p.label]),
);

export type ComponentEditorTab =
  | 'general'
  | 'geometry'
  | 'edges'
  | 'options'
  | 'preview3d';

export const COMPONENT_EDITOR_TABS: readonly {
  readonly id: ComponentEditorTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'Datos Generales' },
  { id: 'geometry', label: 'Geometría' },
  { id: 'edges', label: 'Cantos' },
  { id: 'options', label: 'Opciones' },
  { id: 'preview3d', label: 'Vista 3D' },
];

export interface ComponentDraft {
  code: string;
  name: string;
  placement: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  lengthFormula: string;
  widthFormula: string;
  xFormula: string;
  yFormula: string;
  zFormula: string;
  /** null = use placement default; 0 is a valid explicit rotation */
  rotateX: number | null;
  rotateY: number | null;
  rotateZ: number | null;
  edgeL1: boolean;
  edgeL2: boolean;
  edgeW1: boolean;
  edgeW2: boolean;
  optionRoles: string;
  notes: string;
  active: boolean;
}

export function emptyComponentDraft(): ComponentDraft {
  return {
    code: '',
    name: '',
    placement: 'interno',
    lengthMm: 0,
    widthMm: 0,
    thicknessMm: 0,
    lengthFormula: '',
    widthFormula: '',
    xFormula: '',
    yFormula: '',
    zFormula: '',
    rotateX: null,
    rotateY: null,
    rotateZ: null,
    edgeL1: false,
    edgeL2: false,
    edgeW1: false,
    edgeW2: false,
    optionRoles: '',
    notes: '',
    active: true,
  };
}

export function componentToDraft(item: Component): ComponentDraft {
  const edges = new Map(item.defaultEdges.map((e) => [e.side, e.enabled]));
  return {
    code: item.code,
    name: item.name,
    placement: item.placement,
    lengthMm:
      item.geometry.kind === 'rectangular_board' ? item.geometry.lengthMm : 0,
    widthMm:
      item.geometry.kind === 'rectangular_board' ? item.geometry.widthMm : 0,
    thicknessMm:
      item.geometry.kind === 'rectangular_board'
        ? item.geometry.thicknessMm
        : 0,
    lengthFormula:
      item.geometry.kind === 'rectangular_board' && item.geometry.lengthFormula
        ? item.geometry.lengthFormula
        : '',
    widthFormula:
      item.geometry.kind === 'rectangular_board' && item.geometry.widthFormula
        ? item.geometry.widthFormula
        : '',
    xFormula: item.xFormula ?? '',
    yFormula: item.yFormula ?? '',
    zFormula: item.zFormula ?? '',
    rotateX: item.rotateX ?? null,
    rotateY: item.rotateY ?? null,
    rotateZ: item.rotateZ ?? null,
    edgeL1: edges.get('L1') ?? false,
    edgeL2: edges.get('L2') ?? false,
    edgeW1: edges.get('W1') ?? false,
    edgeW2: edges.get('W2') ?? false,
    optionRoles: item.optionRoles.join(', '),
    notes: item.notes ?? '',
    active: item.active,
  };
}

export function geometrySummary(item: Component): string {
  if (item.geometry.kind === 'rectangular_board') {
    return `${item.geometry.lengthMm}×${item.geometry.widthMm}×${item.geometry.thicknessMm} mm`;
  }
  return '—';
}

export function placementLabel(placement: string): string {
  return PLACEMENT_LABEL[placement] ?? placement;
}
