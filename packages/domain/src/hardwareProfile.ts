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

export interface HardwareProfile {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly revision: string;
  readonly items: readonly HardwareProfileItem[];
  readonly recipeRef?: ProfileRecipeRef;
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
