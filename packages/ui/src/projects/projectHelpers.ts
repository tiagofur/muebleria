/**
 * Pure project/quotation UI helpers — drafts, validation, option pickers (no cost formulas).
 */

import type {
  Customer,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectStatus,
  WorkshopSettings,
} from '@muebles/domain';
import {
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

/** Status options for the meta form, filtered by role capabilities (F036). */
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
  if (
    canReopen &&
    (current === 'quoted' || current === 'accepted' || current === 'produced')
  ) {
    out.add('draft');
  }
  return PROJECT_STATUSES.filter((s) => out.has(s));
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
): AddItemDraft {
  const moduleId = modules[0]?.id ?? '';
  const mod = modules.find((m) => m.id === moduleId);
  return {
    moduleId,
    quantity: 1,
    optionChoices: mod ? defaultChoicesForNewItem(mod, optionGroups) : {},
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
): OptionGroup[] {
  if (!module) return [];
  const codes = requiredGroupCodesForModule(module, optionGroups);
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
): PricePreviewGateResult {
  const missing = new Set<string>();
  const byId = new Map(modules.map((m) => [m.id, m]));

  for (const item of project.items) {
    const mod = byId.get(item.moduleId);
    if (!mod) {
      missing.add(`módulo:${item.moduleId}`);
      continue;
    }
    const required = requiredGroupCodesForModule(mod, optionGroups);
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
): OptionChoices {
  const required = requiredGroupCodesForModule(module, optionGroups);
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
