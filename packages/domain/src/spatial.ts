/**
 * Spatial assembly helpers (S1) — faces, slots, defaults.
 * Workshop frame: X = width (0 left), Y = height (0 floor), Z = depth (0 front).
 */

import type { BoardFace, PlacementSlot } from './types';

export const BOARD_FACES: readonly BoardFace[] = ['xy', 'xz', 'yz'] as const;

export const PLACEMENT_SLOTS: readonly PlacementSlot[] = [
  'base',
  'top',
  'left',
  'right',
  'back',
  'front',
  'shelf',
  'door',
  'drawer_front',
  'divider',
  'custom',
] as const;

export function isBoardFace(value: string): value is BoardFace {
  return (BOARD_FACES as readonly string[]).includes(value);
}

export function isPlacementSlot(value: string): value is PlacementSlot {
  return (PLACEMENT_SLOTS as readonly string[]).includes(value);
}

export function boardFaceLabelEs(face: BoardFace): string {
  const map: Record<BoardFace, string> = {
    xy: 'Frontal (XY)',
    xz: 'Horizontal (XZ)',
    yz: 'Lateral (YZ)',
  };
  return map[face];
}

export function placementSlotLabelEs(slot: PlacementSlot): string {
  const map: Record<PlacementSlot, string> = {
    base: 'Base',
    top: 'Tapa',
    left: 'Lateral izquierdo',
    right: 'Lateral derecho',
    back: 'Trasera',
    front: 'Frente',
    shelf: 'Entrepaño',
    door: 'Puerta',
    drawer_front: 'Frente de cajón',
    divider: 'Divisor',
    custom: 'Personalizado',
  };
  return map[slot];
}

/** Default design thickness when material / designThicknessMm are absent. */
export const DEFAULT_DESIGN_THICKNESS_MM = 18;

/**
 * Default face + origin formulas for a placement slot.
 * Origins use W,H,D,T (and i,n for multi-instance slots).
 */
export function defaultPoseForSlot(
  slot: PlacementSlot,
): {
  face: BoardFace;
  originXFormula: string;
  originYFormula: string;
  originZFormula: string;
} {
  switch (slot) {
    case 'base':
      return {
        face: 'xz',
        originXFormula: '0',
        originYFormula: '0',
        originZFormula: '0',
      };
    case 'top':
      return {
        face: 'xz',
        originXFormula: '0',
        originYFormula: 'H-T',
        originZFormula: '0',
      };
    case 'left':
      return {
        face: 'yz',
        originXFormula: '0',
        originYFormula: '0',
        originZFormula: '0',
      };
    case 'right':
      return {
        face: 'yz',
        originXFormula: 'W-T',
        originYFormula: '0',
        originZFormula: '0',
      };
    case 'back':
      return {
        face: 'xy',
        originXFormula: '0',
        originYFormula: '0',
        originZFormula: 'D-T',
      };
    case 'front':
      return {
        face: 'xy',
        originXFormula: '0',
        originYFormula: '0',
        originZFormula: '0',
      };
    case 'shelf':
      // Even spacing between floor clearance T and top clearance H-T
      return {
        face: 'xz',
        originXFormula: 'T',
        originYFormula: 'T+(i+1)*(H-2*T)/(n+1)',
        originZFormula: '0',
      };
    case 'door':
    case 'drawer_front':
      return {
        face: 'xy',
        originXFormula: 'i*(W/n)',
        originYFormula: '0',
        originZFormula: '0',
      };
    case 'divider':
      return {
        face: 'yz',
        originXFormula: '(i+1)*W/(n+1)',
        originYFormula: '0',
        originZFormula: '0',
      };
    case 'custom':
    default:
      return {
        face: 'xy',
        originXFormula: '0',
        originYFormula: '0',
        originZFormula: '0',
      };
  }
}
