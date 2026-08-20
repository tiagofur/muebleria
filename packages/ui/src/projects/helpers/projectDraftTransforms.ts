/**
 * Project draft types and conversion helpers (pure UI/domain mappings).
 */

import type {
  Agregado,
  Component,
  Customer,
  Module,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectStatus,
  ProjectTechnicalStatus,
  Structure,
  WorkshopSettings,
} from '@muebles/domain';
import { DEFAULT_WORKSHOP_SETTINGS } from '@muebles/domain';
import { defaultChoicesForNewItem } from './projectOptionHelpers';

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
  /** Technical / Production engineer in charge (CRM Phase 2). */
  assignedEngineerId?: string;
  /** Technical workflow status (CRM Phase 2). */
  technicalStatus?: ProjectTechnicalStatus;
  /** Date/time when survey was completed. */
  surveyCompletedAt?: string;
  /** Planned installation date in Obra (YYYY-MM-DD). */
  installationScheduledDate?: string;
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
  draft: 'status-badge--draft',
  quoted: 'status-badge--quoted',
  accepted: 'status-badge--accepted',
  produced: 'status-badge--produced',
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
  return STATUS_BADGE_CLASS[status] ?? 'status-badge--draft';
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
    assignedEngineerId: '',
    technicalStatus: 'pending_assignment',
    surveyCompletedAt: '',
    installationScheduledDate: '',
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
    assignedEngineerId: project.assignedEngineerId ?? '',
    technicalStatus: project.technicalStatus ?? 'pending_assignment',
    surveyCompletedAt: project.surveyCompletedAt ?? '',
    installationScheduledDate: project.installationScheduledDate ?? '',
  };
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
