/**
 * Reusable furniture component kinds and labels (H06 / #101).
 * Validation and BOM expansion live in engine.ts (avoids circular imports).
 */

import type { FurnitureComponentKind } from './types';

export const FURNITURE_COMPONENT_KINDS: readonly FurnitureComponentKind[] = [
  'puerta',
  'entrepaño',
  'frente_cajon',
  'lateral',
  'otro',
] as const;

export function isFurnitureComponentKind(
  value: string,
): value is FurnitureComponentKind {
  return (FURNITURE_COMPONENT_KINDS as readonly string[]).includes(value);
}

export function furnitureComponentKindLabelEs(
  kind: FurnitureComponentKind,
): string {
  const map: Record<FurnitureComponentKind, string> = {
    puerta: 'Puerta',
    entrepaño: 'Entrepaño',
    frente_cajon: 'Frente de cajón',
    lateral: 'Lateral',
    otro: 'Otro',
  };
  return map[kind];
}
