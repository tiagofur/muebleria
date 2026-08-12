/**
 * Pure project/quotation UI helpers — drafts, validation, option pickers (no cost formulas).
 */

import type {
  Agregado,
  Catalog,
  Component,
  Customer,
  EdgeBand,
  FurnitureType,
  Hardware,
  MaterialBoard,
  Module,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectStatus,
  Structure,
  WorkshopSettings,
} from '@muebles/domain';
import {
  calcProjectBreakdown,
  DEFAULT_WORKSHOP_SETTINGS,
  effectiveOptionChoices,
} from '@muebles/domain';
import {
  canShowPricePreview,
  membersForKind,
  requiredGroupCodesForModule,
  type CatalogMember,
  type PricePreviewGateResult,
} from '../optionGroups/optionGroupHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import {
  matchesCodeOrName,
  validateNonNegativeNumber,
  validateRequiredName,
} from '../catalogs/catalogHelpers';

export type ProjectDraft = {
  name: string;
  /**
   * Selected catalog customer id (primary). Empty when creating a new customer
   * via `customerName` on submit.
   */
  customerId: string;
  /**
   * Optional name for the "Nuevo cliente" path only. When set and `customerId`
   * is empty, the shell creates a customer and attaches the new id.
   */
  customerName?: string;
  currency: string;
  marginFactor: string;
  laborFixedCost: string;
  status: ProjectStatus;
  notes: string;
  /** Portfolio owner user id (F034). Empty = shell default (me). */
  ownerUserId: string;
};

export type AddItemDraft = {
  moduleId: string;
  quantity: number;
  /** Option choices for the new line (filled in add-item modal). */
  optionChoices: OptionChoices;
  /** Commercial measure preset from Module.presets (H09). */
  measurePresetId?: string;
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Borrador',
  quoted: 'Cotizado',
  accepted: 'Aceptado',
  produced: 'En producción',
};

/** design.md §5.2 status badge class names (without leading `.`). */
const STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  draft: 'badge-draft',
  quoted: 'badge-quoted',
  accepted: 'badge-accepted',
  produced: 'badge-produced',
};

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'draft',
  'quoted',
  'accepted',
  'produced',
] as const;

/**
 * Status options for role capabilities (F036).
 * @deprecated #257 — status no longer lives in ProjectMetaModal; workflow
 * buttons + confirm drive transitions. Kept for tests / legacy callers.
 */
export function statusOptionsForRole(opts: {
  readonly current: ProjectStatus;
  readonly canMutate: boolean;
  readonly canReopen: boolean;
  readonly canMarkProduced: boolean;
}): readonly ProjectStatus[] {
  const { current, canMutate, canReopen, canMarkProduced } = opts;
  const out = new Set<ProjectStatus>([current]);
  if (canMutate) {
    if (current === 'draft') {
      out.add('quoted');
      out.add('accepted');
    }
    if (current === 'quoted') {
      out.add('accepted');
    }
  }
  if (canMarkProduced && (current === 'accepted' || current === 'produced')) {
    out.add('produced');
  }
  // #257: reopen only from quoted (not accepted/produced).
  if (canReopen && current === 'quoted') {
    out.add('draft');
  }
  return PROJECT_STATUSES.filter((s) => out.has(s));
}

/**
 * Quote content (items, layout, meta comercial) only while draft + role allows.
 * #257 — freeze quoted / accepted / produced for design edits.
 */
export function canEditQuoteContent(
  canMutateRole: boolean,
  status: ProjectStatus,
): boolean {
  return canMutateRole && status === 'draft';
}

export function projectStatusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status];
}

/** CSS class for colored project status badge (design.md §5.2). */
export function projectStatusBadgeClass(status: ProjectStatus): string {
  return STATUS_BADGE_CLASS[status] ?? 'badge-draft';
}

/**
 * Resolve a display name for a project's customerId from the customers catalog.
 * Falls back to the id when the catalog entry is missing (orphan / legacy).
 */
export function resolveCustomerName(
  customerId: string,
  customers: readonly Customer[] = [],
): string {
  if (!customerId) return '';
  const found = customers.find((c) => c.id === customerId);
  return found?.name ?? customerId;
}

/**
 * Empty draft for a new quotation.
 * Uses workshop settings when provided (F031); does not mutate existing projects.
 */
export function emptyProjectDraft(
  settings?: WorkshopSettings | null,
): ProjectDraft {
  const s = settings ?? DEFAULT_WORKSHOP_SETTINGS;
  return {
    name: '',
    customerId: '',
    customerName: '',
    currency: s.defaultCurrency || 'MXN',
    marginFactor: String(s.defaultMarginFactor),
    laborFixedCost: String(s.defaultLaborFixedCost),
    status: 'draft',
    notes: '',
    ownerUserId: '',
  };
}

export function projectToDraft(
  project: Project,
  _customers: readonly Customer[] = [],
): ProjectDraft {
  return {
    name: project.name,
    customerId: project.customerId,
    // Picker uses customerId; customerName only for "Nuevo cliente" create path.
    customerName: '',
    currency: project.currency,
    marginFactor: String(project.marginFactor),
    laborFixedCost: String(project.laborFixedCost),
    status: project.status,
    notes: project.notes ?? '',
    ownerUserId: project.ownerUserId ?? '',
  };
}

/**
 * Customers available in the project meta picker: active by default.
 * When editing, always include the currently selected customer even if inactive
 * (or orphan / missing from catalog) so the select remains valid.
 */
export function customersForProjectPicker(
  customers: readonly Customer[],
  selectedCustomerId = '',
): Customer[] {
  const selectedId = selectedCustomerId.trim();
  const active = customers.filter((c) => c.active);
  if (!selectedId) return active;
  if (active.some((c) => c.id === selectedId)) return active;
  const selected = customers.find((c) => c.id === selectedId);
  if (selected) return [...active, selected];
  // Orphan id: placeholder option so the controlled select keeps a valid value.
  return [
    ...active,
    { id: selectedId, name: selectedId, active: false },
  ];
}

export function validateProjectDraft(draft: ProjectDraft): string | null {
  const nameErr = validateRequiredName(draft.name);
  if (nameErr) return 'El nombre de la cotización es obligatorio.';

  const customerId = draft.customerId.trim();
  const newCustomerName = (draft.customerName ?? '').trim();
  if (!customerId && !newCustomerName) {
    return 'Seleccioná un cliente.';
  }

  const currency = draft.currency.trim();
  if (!currency) {
    return 'La moneda es obligatoria.';
  }

  const margin = Number(draft.marginFactor);
  if (!Number.isFinite(margin) || margin <= 0) {
    return 'El factor de margen debe ser un número mayor a 0.';
  }

  const labor = Number(draft.laborFixedCost);
  const laborErr = validateNonNegativeNumber(labor, 'Mano de obra fija');
  if (laborErr) return laborErr;

  if (!PROJECT_STATUSES.includes(draft.status)) {
    return 'Estado de cotización inválido.';
  }

  return null;
}

export function validateItemQuantity(quantity: number): string | null {
  if (!Number.isFinite(quantity)) {
    return 'La cantidad debe ser un número.';
  }
  if (!Number.isInteger(quantity)) {
    return 'La cantidad debe ser un entero.';
  }
  if (quantity < 1) {
    return 'La cantidad debe ser ≥ 1.';
  }
  return null;
}

export function emptyAddItemDraft(
  modules: readonly Module[],
  optionGroups: readonly OptionGroup[] = [],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): AddItemDraft {
  const moduleId = modules[0]?.id ?? '';
  const mod = modules.find((m) => m.id === moduleId);
  return {
    moduleId,
    quantity: 1,
    optionChoices: mod
      ? defaultChoicesForNewItem(
          mod,
          optionGroups,
          catalogComponents,
          catalogStructures,
          catalogAgregados,
        )
      : {},
    measurePresetId: mod?.presets?.[0]?.id,
  };
}

/**
 * Filter projects by name or customer display name (case-insensitive). Empty query → all.
 * Pure — no domain cost logic.
 */
export function filterProjectsByQuery(
  projects: readonly Project[],
  query: string,
  customers: readonly Customer[] = [],
): Project[] {
  const q = query.trim().toLocaleLowerCase('es-UY');
  if (!q) return [...projects];
  return projects.filter((p) => {
    const clientName = resolveCustomerName(p.customerId, customers);
    return matchesCodeOrName({ code: clientName, name: p.name }, q);
  });
}

/** List filter: all statuses or a single ProjectStatus (Fase 2 UI chips). */
export type ProjectStatusFilter = 'all' | ProjectStatus;

export const PROJECT_STATUS_FILTER_OPTIONS: readonly {
  readonly value: ProjectStatusFilter;
  readonly label: string;
}[] = [
  { value: 'all', label: 'Todos' },
  { value: 'draft', label: 'Borrador' },
  { value: 'quoted', label: 'Cotizado' },
  { value: 'accepted', label: 'Aceptado' },
  { value: 'produced', label: 'En producción' },
];

/**
 * Filter projects by text query and optional workflow status.
 * Pure — no domain cost logic.
 */
export function filterProjectsList(
  projects: readonly Project[],
  query: string,
  status: ProjectStatusFilter,
  customers: readonly Customer[] = [],
): Project[] {
  const byQuery = filterProjectsByQuery(projects, query, customers);
  if (status === 'all') return byQuery;
  return byQuery.filter((p) => p.status === status);
}

/**
 * Format project money for display — shared formatMoneyDisplay (#51).
 * Optional currency defaults to MXN (product default).
 */
export function formatProjectMoney(
  n: number | undefined | null,
  currency?: string,
): string {
  return formatMoneyDisplay(n, { currency });
}

/**
 * OPT-04 / PRJ-03: option picker values for a group — only group members (by kind + optionIds).
 * Empty optionIds → no catalog-wide dump (strict group membership).
 */
export function optionsForGroup(
  group: OptionGroup,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
): CatalogMember[] {
  const members = membersForKind(group.kind, catalogs);
  if (group.optionIds.length === 0) {
    return [];
  }
  const allowed = new Set(group.optionIds);
  return members.filter((m) => allowed.has(m.id));
}

/**
 * PRJ-03: option groups required by this module (roles used + group.required).
 */
export function groupsForModuleItem(
  module: Module | undefined,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): OptionGroup[] {
  if (!module) return [];
  const codes = requiredGroupCodesForModule(
    module,
    optionGroups,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );
  const byCode = new Map(optionGroups.map((g) => [g.code, g]));
  return codes
    .map((code) => byCode.get(code))
    .filter((g): g is OptionGroup => g !== undefined);
}

/**
 * Gate for whole-project price preview: every item must satisfy required choices.
 * Uses effective resolution (project defaults + line overrides) — F029 / #35.
 */
export function canShowProjectPricePreview(
  project: Project,
  modules: readonly Module[],
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): PricePreviewGateResult {
  const missing = new Set<string>();
  const byId = new Map(modules.map((m) => [m.id, m]));

  for (const item of project.items) {
    const mod = byId.get(item.moduleId);
    if (!mod) {
      missing.add(`módulo:${item.moduleId}`);
      continue;
    }
    const required = requiredGroupCodesForModule(
      mod,
      optionGroups,
      catalogComponents,
      catalogStructures,
      catalogAgregados,
    );
    const effective = effectiveOptionChoices(
      item.optionChoices,
      project.projectLevelChoices,
    );
    const gate = canShowPricePreview(required, effective);
    if (!gate.ok) {
      for (const code of gate.missingGroups) {
        missing.add(code);
      }
    }
  }

  if (missing.size === 0) {
    return { ok: true, missingGroups: [] };
  }
  return { ok: false, missingGroups: [...missing] };
}

/**
 * Label for a catalog option id within a group (UI display).
 */
export function optionLabelForId(
  optionId: string,
  group: OptionGroup,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
): string {
  const opt = optionsForGroup(group, catalogs).find((o) => o.id === optionId);
  return opt ? `${opt.name} — ${opt.code}` : optionId;
}

/** Visual chip swatch for presentation options (board finishes). */
export type OptionSwatch =
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'edge' }
  | { readonly kind: 'hardware' }
  | null;

/**
 * Resolve a presentation swatch for a chosen option id.
 * Boards: previewColor or imageUrl; edges/hardware: typed marker.
 */
export function optionSwatchForId(
  optionId: string,
  group: OptionGroup,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
  resolveMediaUrl?: (url: string | undefined) => string | undefined,
): OptionSwatch {
  if (group.kind === 'board') {
    const mat = catalogs.materials.find((m) => m.id === optionId);
    if (!mat) return null;
    const color = mat.previewColor?.trim();
    if (color) return { kind: 'color', color };
    const img = resolveMediaUrl
      ? resolveMediaUrl(mat.imageUrl)
      : mat.imageUrl?.trim() || undefined;
    if (img) return { kind: 'image', src: img };
    return null;
  }
  if (group.kind === 'edge') {
    return catalogs.edges.some((e) => e.id === optionId) ? { kind: 'edge' } : null;
  }
  if (group.kind === 'hardware') {
    return catalogs.hardware.some((h) => h.id === optionId)
      ? { kind: 'hardware' }
      : null;
  }
  return null;
}

/**
 * Approximate sale price for a single quote line (item × qty).
 * Uses domain calc with laborFixedCost=0 so the line is comparable in the
 * spatial studio inspector — not a formal invoice split of MO fija.
 */
export function estimateLineSalePrice(
  project: Project,
  itemId: string,
  catalog: Catalog,
): number | null {
  const item = project.items.find((i) => i.id === itemId);
  if (!item) return null;
  try {
    const lineProject: Project = {
      ...project,
      items: [item],
      laborFixedCost: 0,
      priceSnapshot: undefined,
    };
    return calcProjectBreakdown(lineProject, catalog).salePrice;
  } catch {
    return null;
  }
}

/**
 * Empty string key means inherit project default (F029).
 * Returns a new OptionChoices without empty keys.
 */
export function setItemOptionChoice(
  current: OptionChoices,
  groupCode: string,
  optionId: string,
): OptionChoices {
  const next: Record<string, string> = { ...current };
  if (!optionId.trim()) {
    delete next[groupCode];
  } else {
    next[groupCode] = optionId;
  }
  return next;
}

/**
 * Patch project-level defaults; empty optionId removes the key.
 */
export function setProjectLevelChoice(
  current: OptionChoices | undefined,
  groupCode: string,
  optionId: string,
): OptionChoices {
  const next: Record<string, string> = { ...(current ?? {}) };
  if (!optionId.trim()) {
    delete next[groupCode];
  } else {
    next[groupCode] = optionId;
  }
  return next;
}

/** Find module by id (UI label helper). */
export function findModuleById(
  modules: readonly Module[],
  moduleId: string,
): Module | undefined {
  return modules.find((m) => m.id === moduleId);
}

export function formatIsoDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-UY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Build default choices for a new line item from module required groups (first option each).
 * Pure selection — does not compute prices. Does not mutate Module (PRJ-09).
 */
export function defaultChoicesForNewItem(
  module: Module,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): OptionChoices {
  const required = requiredGroupCodesForModule(
    module,
    optionGroups,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );
  const byCode = new Map(optionGroups.map((g) => [g.code, g]));
  const choices: Record<string, string> = {};
  for (const code of required) {
    const group = byCode.get(code);
    const first = group?.optionIds[0];
    if (first) {
      choices[code] = first;
    }
  }
  return choices;
}

/** PRJ-10: two ProjectItems may share the same moduleId with different optionChoices. */
export function countItemsWithModule(
  items: readonly ProjectItem[],
  moduleId: string,
): number {
  return items.filter((i) => i.moduleId === moduleId).length;
}

/**
 * Short display label for a FurnitureType (#109). Used by the measure-defaults
 * section and the per-line type badge. `undefined` defaults to 'inferior'.
 */
export function furnitureTypeLabel(type: FurnitureType | undefined): string {
  switch (type ?? 'inferior') {
    case 'inferior':
      return 'Inferior';
    case 'superior':
      return 'Superior';
    case 'alto':
      return 'Alto';
  }
}

/**
 * Share URL for client presentation (`?present=projectId`).
 * Preserves pathname (incl. Vite base path) and other query params; sets/replaces `present`.
 */
export function buildPresentationShareUrl(
  projectId: string,
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'> = window.location,
): string {
  const id = projectId.trim();
  const params = new URLSearchParams(location.search);
  params.set('present', id);
  const qs = params.toString();
  const hash = location.hash ?? '';
  return `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}${hash}`;
}
