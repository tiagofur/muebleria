/**
 * Hardware Profile domain contract (#912) — TS twin of
 * backend-go/internal/domain/hardware_profile.go. A profile references
 * catalog hardware by ID (never copies codes, prices or units) and pins the
 * versioned ContactOperationRecipe that machines it. One machining engine:
 * recipes stay the technical authority; the profile is the commercial
 * application recipes anchor to (technicalProfileId == profile id).
 */

export interface HardwareProfileItem {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly applicationRole?: string;
}

export interface ProfileRecipeRef {
  readonly recipeId: string;
  readonly recipeRevision: string;
}

export interface ProfileRuleSpec {
  readonly ruleId: string;
  readonly ruleRevision: string;
  readonly participantRole: 'A' | 'B';
  readonly operationRole: string;
  readonly entryFace: string;
  readonly offsetMm: readonly [number, number, number];
  readonly axis: readonly [number, number, number];
  readonly diameterMm: number;
  readonly depthMm: number;
}

export interface ProfileRecipeVariant {
  readonly targetFace: string;
  readonly rules: readonly ProfileRuleSpec[];
}

/** Profile-embedded recipe definition (#916): one variant per target-face orientation. */
export interface ProfileRecipeBody {
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly variants: readonly ProfileRecipeVariant[];
}

export interface HardwareProfile {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly revision: string;
  readonly items: readonly HardwareProfileItem[];
  readonly recipeRef?: ProfileRecipeRef;
  readonly recipe?: ProfileRecipeBody;
  readonly active: boolean;
}

export interface ComponentSideAssignment {
  readonly componentId: string;
  readonly side: string;
  readonly profileId: string;
}

/** The six canonical board faces — the existing joinery/anchor vocabulary. */
export const BOARD_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;

export type BoardFace = (typeof BOARD_FACES)[number];

export function isBoardFace(value: string): value is BoardFace {
  return (BOARD_FACES as readonly string[]).includes(value);
}

export const HARDWARE_PROFILE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface HardwareProfileIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: 'error';
  readonly entityId: string;
  readonly path: string;
}

const PROFILE_INVALID = 'PROFILE_INVALID';
const ASSIGNMENT_INVALID = 'ASSIGNMENT_INVALID';

const positiveFinite = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

/** Structural, fail-closed validation — twin of HardwareProfile.Validate. */
export function validateHardwareProfile(profile: HardwareProfile): readonly HardwareProfileIssue[] {
  const issues: HardwareProfileIssue[] = [];
  const add = (message: string, path: string) =>
    issues.push({ code: PROFILE_INVALID, message, severity: 'error', entityId: profile.id, path });
  const path = (suffix: string) => (suffix === '' ? 'hardwareProfile' : `hardwareProfile.${suffix}`);

  if (profile.id === '') add('hardware profile needs a non-blank id', path('id'));
  if (profile.code === '' || !HARDWARE_PROFILE_CODE_PATTERN.test(profile.code)) {
    add('hardware profile code must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', path('code'));
  }
  if (profile.name === '') add('hardware profile needs a non-blank name', path('name'));
  if (profile.revision === '') {
    add('hardware profile needs a non-blank revision: releases pin exact revisions, never latest', path('revision'));
  }
  if (profile.items.length === 0) {
    add('hardware profile needs at least one hardware item', path('items'));
  }
  const seenHardware = new Set<string>();
  profile.items.forEach((item, index) => {
    const itemPath = path(`items[${index}]`);
    if (item.hardwareId === '') {
      add('profile item needs a non-blank hardwareId', `${itemPath}.hardwareId`);
    } else if (seenHardware.has(item.hardwareId)) {
      add(`hardware ${item.hardwareId} appears more than once: split quantities are ambiguous`, `${itemPath}.hardwareId`);
    }
    seenHardware.add(item.hardwareId);
    if (!positiveFinite(item.quantity)) {
      add('profile item quantity must be a positive finite number', `${itemPath}.quantity`);
    }
  });
  if (profile.recipeRef && (profile.recipeRef.recipeId === '' || profile.recipeRef.recipeRevision === '')) {
    add('recipeRef needs a non-blank recipeId and recipeRevision together', path('recipeRef'));
  }
  issues.push(...validateProfileRecipeBody(profile.recipeRef, profile.recipe));
  return issues;
}

const isFiniteVec3 = (v: readonly number[]): boolean => v.every((value) => Number.isFinite(value));

const dotVec3 = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);

/** Twin of Go ValidateProfileRecipeBody — same codes, paths and rules. */
export function validateProfileRecipeBody(
  ref: ProfileRecipeRef | undefined,
  body: ProfileRecipeBody | undefined,
): readonly HardwareProfileIssue[] {
  const issues: HardwareProfileIssue[] = [];
  if (!body) return issues;
  const add = (message: string, p: string) =>
    issues.push({ code: PROFILE_INVALID, message, severity: 'error', entityId: '', path: p });
  const recipePath = (suffix: string) => `hardwareProfile.recipe.${suffix}`;

  if (body.recipeId === '' || body.recipeRevision === '') {
    add('recipe body needs a non-blank recipeId and recipeRevision', recipePath('recipeId'));
  }
  if (ref && ref.recipeId !== '' && ref.recipeRevision !== '' &&
    (ref.recipeId !== body.recipeId || ref.recipeRevision !== body.recipeRevision)) {
    add('recipe body identity must agree with the profile recipeRef', recipePath('recipeId'));
  }
  if (body.variants.length === 0) {
    add('recipe body needs at least one target-face variant', recipePath('variants'));
  }
  const seenFaces = new Set<string>();
  body.variants.forEach((variant, index) => {
    const variantPath = recipePath(`variants[${index}]`);
    if (!isBoardFace(variant.targetFace)) {
      add(`variant targetFace ${JSON.stringify(variant.targetFace)} is not one of the six canonical board faces`, `${variantPath}.targetFace`);
      return;
    }
    if (seenFaces.has(variant.targetFace)) {
      add(`targetFace ${variant.targetFace} declares more than one variant`, `${variantPath}.targetFace`);
    }
    seenFaces.add(variant.targetFace);
    const roleA = variant.rules.some((rule) => rule.participantRole === 'A');
    const roleB = variant.rules.some((rule) => rule.participantRole === 'B');
    const ruleIds = new Set<string>();
    variant.rules.forEach((rule, ruleIndex) => {
      const rulePath = `${variantPath}.rules[${ruleIndex}]`;
      if (rule.ruleId === '' || rule.ruleRevision === '' || rule.operationRole === '' || ruleIds.has(rule.ruleId) ||
        (rule.participantRole !== 'A' && rule.participantRole !== 'B') ||
        !isBoardFace(rule.entryFace) || !isFiniteVec3(rule.offsetMm) || !isFiniteVec3(rule.axis) ||
        !(rule.diameterMm > 0) || !(rule.depthMm > 0) ||
        Math.abs(dotVec3(rule.axis, rule.axis) - 1) > 1e-6) {
        add('rule needs unique ruleId, revision, operationRole, participantRole, one of the six entry faces, finite offset, unit axis, positive finite diameter and depth', rulePath);
      }
      ruleIds.add(rule.ruleId);
    });
    if (!roleA || !roleB) {
      add(`variant ${variant.targetFace} needs at least one rule per participant role (source and target)`, `${variantPath}.rules`);
    }
  });
  return issues;
}

/** Structural, fail-closed validation — twin of ComponentSideAssignment.Validate. */
export function validateComponentSideAssignment(
  assignment: ComponentSideAssignment,
): readonly HardwareProfileIssue[] {
  const issues: HardwareProfileIssue[] = [];
  const add = (message: string, path: string) =>
    issues.push({ code: ASSIGNMENT_INVALID, message, severity: 'error', entityId: assignment.componentId, path });

  if (assignment.componentId === '') {
    add('component side assignment needs a non-blank componentId', 'componentId');
  }
  if (!isBoardFace(assignment.side)) {
    add(`side ${JSON.stringify(assignment.side)} is not one of the six canonical board faces`, 'side');
  }
  if (assignment.profileId === '') {
    add('component side assignment needs a non-blank profileId', 'profileId');
  }
  return issues;
}
