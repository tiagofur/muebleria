import { sessionScopeKey, type SessionScope } from './sessionScope';

type FilterScalar = string | number | boolean | null;
export type QueryFilters = Readonly<Record<string, FilterScalar | readonly FilterScalar[] | undefined>>;

export function normalizeQueryFilters(
  filters: QueryFilters = {},
  setLikeFields: ReadonlySet<string> = new Set(),
) {
  return Object.fromEntries(
    Object.entries(filters)
      .filter((entry): entry is [string, FilterScalar | readonly FilterScalar[]] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        Array.isArray(value) && setLikeFields.has(key)
          ? [...value].sort((left, right) => String(left).localeCompare(String(right)))
          : value,
      ]),
  );
}

const SET_LIKE_FILTERS = new Set(['roles', 'status']);

const scopedRoot = (area: 'organization' | 'platform', scope: SessionScope) =>
  [area, ...sessionScopeKey(scope)] as const;

export const organizationKeys = {
  all: (scope: SessionScope) => scopedRoot('organization', scope),
  team: (scope: SessionScope, filters: QueryFilters = {}) =>
    [...scopedRoot('organization', scope), 'team', normalizeQueryFilters(filters, SET_LIKE_FILTERS)] as const,
  invitations: (scope: SessionScope, filters: QueryFilters = {}) =>
    [...scopedRoot('organization', scope), 'invitations', normalizeQueryFilters(filters, SET_LIKE_FILTERS)] as const,
  membership: (scope: SessionScope, membershipId: string) =>
    [...scopedRoot('organization', scope), 'memberships', membershipId] as const,
};

export const platformKeys = {
  all: (scope: SessionScope) => scopedRoot('platform', scope),
  organizations: (scope: SessionScope, filters: QueryFilters = {}) =>
    [...scopedRoot('platform', scope), 'organizations', normalizeQueryFilters(filters, SET_LIKE_FILTERS)] as const,
  users: (scope: SessionScope, filters: QueryFilters = {}) =>
    [...scopedRoot('platform', scope), 'users', normalizeQueryFilters(filters, SET_LIKE_FILTERS)] as const,
  audit: (scope: SessionScope, organizationId: string, filters: QueryFilters = {}) =>
    [...scopedRoot('platform', scope), 'audit', organizationId, normalizeQueryFilters(filters, SET_LIKE_FILTERS)] as const,
};
