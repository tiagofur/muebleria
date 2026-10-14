/**
 * String-typed draft model for the opening profile form (#1325): the form
 * owns strings; conversion to the #1130 entity contract happens at submit
 * time. Body modifiers mirror the declared vocabulary — the notch (lateral
 * role, the v1 geometry consumer) and the depth reduction (#1317), which may
 * declare NO value: the engine then derives it from the profile's own
 * profile_depth_mm (one source of truth, never a typed constant).
 */

import type { OpeningProfileBOMMember } from '@granete/storage';

export type OpeningGripTypeDraft = 'gola' | 'handle' | 'bottom_reveal' | 'none';
export type OpeningCrossSectionDraft = '' | 'L' | 'C' | 'J' | 'flat';
export type OpeningNotchAtDraft = 'top_front' | 'bottom_front' | 'front_boundary';

export type OpeningProfileBOMMembersLike = Record<string, OpeningProfileBOMMember>;

export interface OpeningProfileBodyModifierLike {
  readonly role: string;
  readonly effect?: string;
  readonly depth_reduction_mm?: number | null;
  readonly notch_height_mm?: number | null;
  readonly notch_depth_mm?: number | null;
  readonly notch_at?: string | null;
}

export interface OpeningProfileDraft {
  /** Client-named profile id (create only) — e.g. profile.gola-l.8006. */
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly gripType: OpeningGripTypeDraft;
  readonly crossSection: OpeningCrossSectionDraft;
  readonly top: boolean;
  readonly between: boolean;
  readonly bottom: boolean;
  readonly datasheetStatus: 'pending' | 'verified';
  readonly frontReductionMm: string;
  readonly gripClearanceMm: string;
  readonly profileHeightMm: string;
  readonly profileDepthMm: string;
  readonly geometryOrigin: string;
  // Body modifiers — declared data the engine consumes (#1287 / #1317).
  readonly notchEnabled: boolean;
  readonly notchHeightMm: string;
  readonly notchDepthMm: string;
  readonly notchAt: OpeningNotchAtDraft;
  readonly depthReductionEnabled: boolean;
  /** true = declare WITHOUT a value: the engine derives profile_depth_mm. */
  readonly depthReductionDerived: boolean;
  readonly depthReductionMm: string;
  /** Preserved untouched on edit (v1 read-only BOM members). */
  readonly bomMembers: OpeningProfileBOMMembersLike | null;
}

export function emptyOpeningProfileDraft(): OpeningProfileDraft {
  return {
    id: '',
    code: '',
    name: '',
    gripType: 'gola',
    crossSection: 'L',
    top: true,
    between: false,
    bottom: false,
    datasheetStatus: 'pending',
    frontReductionMm: '',
    gripClearanceMm: '',
    profileHeightMm: '',
    profileDepthMm: '',
    geometryOrigin: '',
    notchEnabled: false,
    notchHeightMm: '',
    notchDepthMm: '',
    notchAt: 'top_front',
    depthReductionEnabled: false,
    depthReductionDerived: true,
    depthReductionMm: '',
    bomMembers: null,
  };
}

export interface OpeningProfileRowLike {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly gripType: string;
  readonly crossSection: string | null;
  readonly placements: readonly string[];
  readonly datasheetStatus: string;
  readonly frontReductionMm: number | null;
  readonly gripClearanceMm: number | null;
  readonly profileHeightMm: number | null;
  readonly profileDepthMm: number | null;
  readonly geometryOrigin: string | null;
  readonly bodyModifiers: readonly OpeningProfileBodyModifierLike[];
  readonly bomMembers: OpeningProfileBOMMembersLike | null;
}

/** Edit-draft conversion from a listed profile row. */
export function toOpeningProfileDraft(row: OpeningProfileRowLike): OpeningProfileDraft {
  const notch = row.bodyModifiers.find((m) => m.notch_at !== undefined || m.notch_height_mm !== undefined);
  const reduction = row.bodyModifiers.find((m) => m.effect === 'depth_reduction' || m.depth_reduction_mm !== undefined);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    gripType: (row.gripType as OpeningGripTypeDraft) ?? 'gola',
    crossSection: (row.crossSection as OpeningCrossSectionDraft) ?? '',
    top: row.placements.includes('top'),
    between: row.placements.includes('between'),
    bottom: row.placements.includes('bottom'),
    datasheetStatus: row.datasheetStatus === 'verified' ? 'verified' : 'pending',
    frontReductionMm: row.frontReductionMm != null ? String(row.frontReductionMm) : '',
    gripClearanceMm: row.gripClearanceMm != null ? String(row.gripClearanceMm) : '',
    profileHeightMm: row.profileHeightMm != null ? String(row.profileHeightMm) : '',
    profileDepthMm: row.profileDepthMm != null ? String(row.profileDepthMm) : '',
    geometryOrigin: row.geometryOrigin ?? '',
    notchEnabled: notch != null,
    notchHeightMm: notch?.notch_height_mm != null ? String(notch.notch_height_mm) : '',
    notchDepthMm: notch?.notch_depth_mm != null ? String(notch.notch_depth_mm) : '',
    notchAt: (notch?.notch_at as OpeningNotchAtDraft) ?? 'top_front',
    depthReductionEnabled: reduction != null,
    depthReductionDerived: reduction == null || reduction.depth_reduction_mm == null,
    depthReductionMm: reduction?.depth_reduction_mm != null ? String(reduction.depth_reduction_mm) : '',
    bomMembers: row.bomMembers,
  };
}

/** Suggests the client-named id from the code (create flow): GOLA-L-8006 → profile.gola-l-8006. */
export function suggestOpeningProfileId(code: string): string {
  const slug = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `profile.${slug}` : '';
}

/**
 * The declared body modifiers of the draft, in the persisted snake_case
 * contract. Depth reduction without an explicit value carries ONLY the
 * effect name — the derivation source is the profile's own datasheet.
 */
export function bodyModifiersOfDraft(draft: OpeningProfileDraft): OpeningProfileBodyModifierLike[] {
  const modifiers: OpeningProfileBodyModifierLike[] = [];
  if (draft.notchEnabled) {
    modifiers.push({
      role: 'lateral',
      notch_height_mm: Number(draft.notchHeightMm),
      notch_depth_mm: Number(draft.notchDepthMm),
      notch_at: draft.notchAt,
    });
  }
  if (draft.depthReductionEnabled) {
    modifiers.push(
      draft.depthReductionDerived
        ? { role: 'horizontal', effect: 'depth_reduction' }
        : { role: 'horizontal', effect: 'depth_reduction', depth_reduction_mm: Number(draft.depthReductionMm) },
    );
  }
  return modifiers;
}
