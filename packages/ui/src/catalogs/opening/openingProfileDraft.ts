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

/** #1327 slice 3: the door bevel's edge class — front_boundary has no
 * geometry consumer, so the editor never offers it. */
export type OpeningBevelAtDraft = 'top_front' | 'bottom_front';

export type OpeningProfileBOMMembersLike = Record<string, OpeningProfileBOMMember>;

export interface OpeningProfileBodyModifierLike {
  readonly role: string;
  readonly effect?: string;
  readonly depth_reduction_mm?: number | null;
  readonly notch_height_mm?: number | null;
  readonly notch_depth_mm?: number | null;
  readonly notch_at?: string | null;
  readonly bevel_angle_deg?: number | null;
  readonly bevel_size_mm?: number | null;
  readonly bevel_at?: string | null;
}

/** The BOM member kind (#1327): a hardware SKU or a catalog COMPONENT
 * (panel — e.g. the italian gola strip). Exactly one reference per member. */
export type OpeningProfileMemberKind = 'hardware' | 'component';

export interface OpeningProfileMemberDraft {
  /** Member key: profile | supports | endCaps | tira | … (stable identity). */
  readonly key: string;
  readonly kind: OpeningProfileMemberKind;
  readonly hardwareId: string;
  readonly componentId: string;
  readonly rule: string;
  readonly unit: string;
  readonly spacingMm: string;
  /** Declared envelope [along-run, depth, height]; empty strings = undeclared. */
  readonly dims: readonly [string, string, string];
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
  /** #1316 — ONE workshop-facing number; prefilled with the legacy pair sum. */
  readonly doorReductionMm: string;
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
  // #1327 slice 3 — the declared 45° door bevel (italian gola's grip).
  readonly bevelEnabled: boolean;
  readonly bevelSizeMm: string;
  readonly bevelAt: OpeningBevelAtDraft;
  /** Editable BOM members (#1327): hardware SKUs and/or catalog components. */
  readonly members: readonly OpeningProfileMemberDraft[];
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
    doorReductionMm: '',
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
    bevelEnabled: false,
    bevelSizeMm: '',
    bevelAt: 'top_front',
    members: [],
  };
}

export function emptyMemberDraft(): OpeningProfileMemberDraft {
  return { key: '', kind: 'hardware', hardwareId: '', componentId: '', rule: 'interior_width', unit: 'piece', spacingMm: '', dims: ['', '', ''] };
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
  /** #1316 — the workshop-facing door discount; null = legacy pair only. */
  readonly doorReductionMm: number | null;
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
  const bevel = row.bodyModifiers.find((m) => m.effect === 'bevel' || m.bevel_size_mm != null || m.bevel_at != null);
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
    // #1316: the ONE workshop number — the declared discount, or the legacy
    // datasheet pair sum so the edit migrates the profile transparently.
    doorReductionMm:
      row.doorReductionMm != null
        ? String(row.doorReductionMm)
        : row.frontReductionMm != null && row.gripClearanceMm != null
          ? String(row.frontReductionMm + row.gripClearanceMm)
          : '',
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
    bevelEnabled: bevel != null,
    bevelSizeMm: bevel?.bevel_size_mm != null ? String(bevel.bevel_size_mm) : '',
    bevelAt: (bevel?.bevel_at as OpeningBevelAtDraft) ?? 'top_front',
    members: membersOfMap(row.bomMembers),
  };
}

/** Deterministic map → ordered member drafts (sorted by key). */
function membersOfMap(members: OpeningProfileBOMMembersLike | null): readonly OpeningProfileMemberDraft[] {
  const byKey = members ?? {};
  return Object.keys(byKey)
    .sort()
    .map((key) => {
      const member: OpeningProfileBOMMember = byKey[key] ?? { hardware_id: '', rule: '' };
      const kind: OpeningProfileMemberKind = member.component_id ? 'component' : 'hardware';
      return {
        key,
        kind,
        hardwareId: member.hardware_id ?? '',
        componentId: member.component_id ?? '',
        rule: member.rule ?? '',
        unit: member.unit ?? '',
        spacingMm: member.spacing_mm != null ? String(member.spacing_mm) : '',
        dims: (member.dimensions_mm ?? [null, null, null]).map((d) => (d != null ? String(d) : '')) as [string, string, string],
      };
    });
}

/** The editable member drafts → the persisted snake_case map (#1327). */
export function membersMapOfDraft(
  members: readonly OpeningProfileMemberDraft[],
): OpeningProfileBOMMembersLike {
  const map: Record<string, OpeningProfileBOMMember> = {};
  for (const member of members) {
    const dims = member.dims.map((d) => (d.trim() !== '' ? Number(d) : null));
    map[member.key.trim()] = {
      // hardware_id is the required contract key; component members carry it
      // empty and reference through component_id (#1327).
      hardware_id: member.kind === 'component' ? '' : member.hardwareId.trim(),
      ...(member.kind === 'component' ? { component_id: member.componentId.trim() } : {}),
      rule: member.rule,
      ...(member.unit.trim() !== '' ? { unit: member.unit.trim() } : {}),
      ...(member.spacingMm.trim() !== '' ? { spacing_mm: Number(member.spacingMm) } : {}),
      ...(dims.some((d) => d != null) ? { dimensions_mm: dims.map((d) => (d == null ? 0 : d)) } : {}),
    };
  }
  return map;
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
  // #1327 slice 3: the 45° angle is the only consumer-backed value, so the
  // editor declares it as a constant — the data stays explicit for the pin.
  if (draft.bevelEnabled) {
    modifiers.push({
      role: 'door',
      bevel_angle_deg: 45,
      bevel_size_mm: Number(draft.bevelSizeMm),
      bevel_at: draft.bevelAt,
    });
  }
  return modifiers;
}
