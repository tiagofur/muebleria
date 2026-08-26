/**
 * Pure project/quotation list filtering, searching and formatting helpers.
 */

import type {
  Customer,
  FurnitureType,
  Project,
  ProjectStatus,
} from '@granete/domain';
import { formatMoneyDisplay } from '../../common/formatMoneyDisplay';
import { matchesCodeOrName } from '../../catalogs/catalogHelpers';

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

export function formatIsoDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Humano es-MX «18 ago 2026» (design.md §7.2) — nunca dd/MM/yyyy crudo.
  return d.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
