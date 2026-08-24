/**
 * Catalog surface the relationship→machining resolver needs. Geometry and
 * joinery rules are Granete-side manufacturing truth resolved from the
 * catalog — never authoring input from the SketchUp envelope.
 */

import type { Hardware } from './types';
import type { HoleType } from './partDrilling';

/**
 * Board-local conventions (same as jointDrillingRules):
 * - lateral: length = height, width = depth, big faces front/back;
 * - horizontal (shelf/floor/top): length = width, width = depth;
 * - door: length = height, width = door width.
 */
export type BoardLocalKind = 'lateral' | 'horizontal' | 'door' | 'back';

export interface SketchUpComponentGeometry {
  readonly componentDefinitionId: string;
  readonly boardLocal: BoardLocalKind;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
}

/** Shelf-support style joinery, mirroring the existing JointDrillingRules knobs. */
export interface ShelfSupportRule {
  readonly joinerySystemId: string;
  readonly minifixCode?: string;
  readonly dowelCode?: string;
  readonly endMarginMm: number;
  readonly maxSpacingMm: number;
  readonly gridMm: number;
  readonly withDowels: boolean;
  readonly camDiameterMm: number;
  readonly camDepthMm: number;
  readonly dowelDiameterMm: number;
  readonly dowelDepthMm: number;
}

/** Pilot machining for a manually placed hardware item. */
export interface ManualHardwareRule {
  readonly pilotDiameterMm: number;
  readonly pilotDepthMm: number;
  readonly holeType: HoleType;
  /** Face (board-local) the anchor maps to. */
  readonly boardFace: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
}

export interface SketchUpJoineryCatalog {
  readonly componentGeometry: Readonly<Record<string, SketchUpComponentGeometry>>;
  readonly joinerySystems: Readonly<Record<string, ShelfSupportRule>>;
  /** relationship kind → default joinery system id. */
  readonly relationshipKinds: Readonly<Record<string, string>>;
  readonly manualHardware: Readonly<Record<string, ManualHardwareRule>>;
  readonly hardware: readonly Hardware[];
}

export const DEFAULT_SHELF_SUPPORT_RULE: ShelfSupportRule = {
  joinerySystemId: 'minifix-dowel',
  minifixCode: 'HER-MIN-15',
  dowelCode: 'HER-TAQ-8X30',
  endMarginMm: 50,
  maxSpacingMm: 512,
  gridMm: 32,
  withDowels: true,
  camDiameterMm: 15,
  camDepthMm: 12.5,
  dowelDiameterMm: 8,
  dowelDepthMm: 30,
};
