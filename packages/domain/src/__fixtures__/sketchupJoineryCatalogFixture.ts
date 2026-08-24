/**
 * Joinery catalog fixture for the relationship→machining resolver (#356):
 * geometry for the F161 cabinet definitions, minifix+dowel and dowel-only
 * systems, and the manual hinge machining rule.
 */

import { DEFAULT_SHELF_SUPPORT_RULE, type SketchUpJoineryCatalog } from '../sketchupJoineryCatalog';
import type { Hardware } from '../types';

const hardware: readonly Hardware[] = [
  {
    id: 'hw-minifix-15',
    code: 'HER-MIN-15',
    name: 'Minifix 15',
    unit: 'piece',
    costPerUnit: 0.4,
    active: true,
  },
  {
    id: 'hw-dowel-8x30',
    code: 'HER-TAQ-8X30',
    name: 'Tarugo 8x30',
    unit: 'piece',
    costPerUnit: 0.05,
    active: true,
  },
];

export const cabinetJoineryCatalog: SketchUpJoineryCatalog = {
  componentGeometry: {
    'definition-side-panel': {
      componentDefinitionId: 'definition-side-panel',
      boardLocal: 'lateral',
      lengthMm: 720,
      widthMm: 570,
      thicknessMm: 18,
    },
    'definition-shelf': {
      componentDefinitionId: 'definition-shelf',
      boardLocal: 'horizontal',
      lengthMm: 564,
      widthMm: 570,
      thicknessMm: 18,
    },
  },
  joinerySystems: {
    'minifix-dowel': DEFAULT_SHELF_SUPPORT_RULE,
    'dowel-only': {
      ...DEFAULT_SHELF_SUPPORT_RULE,
      joinerySystemId: 'dowel-only',
      minifixCode: undefined,
    },
  },
  relationshipKinds: {
    'shelf-support': 'minifix-dowel',
  },
  manualHardware: {
    'hinge-softclose-110': {
      pilotDiameterMm: 35,
      pilotDepthMm: 12.5,
      holeType: 'hinge',
      boardFace: 'front',
    },
  },
  hardware,
};
