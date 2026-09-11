/**
 * GOLDEN r3 candidate fixture (#661) — FROZEN OUTPUT, DO NOT EDIT BY HAND.
 *
 * Generated from a real optimizeCutPlan result with POSITIVE perimeter trims
 * (deterministic input below: same rows, catalog, config and options always
 * compile to these bytes). LAB_FIXTURE / NOT_MACHINE_VALIDATED: this is NOT a
 * machine-validated program, NOT a CADmatic acceptance and NOT one of the
 * five kitchens. The external client PTX samples are field evidence, never a
 * golden of Granete output. Regenerate only via the generator spec when the
 * r3 compiler contract deliberately changes (and say so in the commit).
 *
 * The frozen case demonstrates the full r3 subset of
 * docs/machines/ptx-cadmatic4/04_contrato_r3_refilados.md on one sheet
 * (1220x800, trims 10/10/10/10, kerf 4):
 * - MATERIALS.TRIM_FRIP/VRIP/FXCT/VXCT = 10 (totals including kerf) with
 *   TRIM_HEAD/TRIM_FRCT/TRIM_VRCT absent (G3);
 * - no perimeter trim CUTS rows: the productive tree starts at the usable
 *   root (1200x780) and staging resets there (G4);
 * - one FUNCTION 92 + X1 release for the rest-side remnant of the phase-2
 *   crosscut place-3-1 (QTY_RPT=1, QTY_PARTS absent), scheduled after its
 *   producer and before the dependent phase-3 recut place-3-2 (G5);
 * - CUT_INDEX (structural preorder) diverges from SEQUENCE (event schedule);
 * - readback verifier === [] over serialize -> parse bytes.
 */

import type { CutPlanConfig, MaterialBoard, ProductionCutRow } from '@granete/domain';
import type { PtxDocument } from './records';
import type { CompileCutPlanToPtxOptions } from './compileCutPlan';

export const GOLDEN_R3_PROJECT_ID = 'lab-661-golden-r3';

export const GOLDEN_R3_MATERIALS: MaterialBoard[] = [
  {
    "id": "mat-lab",
    "code": "LAB18",
    "name": "Lab Board 18",
    "costPerM2": 10,
    "wastePercent": 10,
    "lengthMm": 1220,
    "widthMm": 800,
    "thicknessMm": 18,
    "grainDefault": true,
    "boardPrice": 8,
    "active": true
  }
];

export const GOLDEN_R3_CONFIG: CutPlanConfig = {
  "sawKerfMm": 4,
  "trim": {
    "topMm": 10,
    "bottomMm": 10,
    "leftMm": 10,
    "rightMm": 10
  },
  "deductEdgeBand": true,
  "allowRotationNoGrain": true,
  "minRemnantWidthMm": 300,
  "minRemnantLengthMm": 400,
  "preferLongitudinalRips": true,
  "heuristic": "guillotine-hybrid"
};

export const GOLDEN_R3_ROWS: ProductionCutRow[] = [
  {
    "quantity": 1,
    "lengthMm": 800,
    "widthMm": 350,
    "description": "A",
    "materialName": "Lab Board 18",
    "materialCode": "LAB18",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "A",
    "partName": "A",
    "moduleCode": "M01",
    "thicknessMm": 18
  },
  {
    "quantity": 1,
    "lengthMm": 350,
    "widthMm": 500,
    "description": "B",
    "materialName": "Lab Board 18",
    "materialCode": "LAB18",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "B",
    "partName": "B",
    "moduleCode": "M01",
    "thicknessMm": 18
  },
  {
    "quantity": 1,
    "lengthMm": 232,
    "widthMm": 300,
    "description": "C",
    "materialName": "Lab Board 18",
    "materialCode": "LAB18",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "C",
    "partName": "C",
    "moduleCode": "M01",
    "thicknessMm": 18
  }
];

export const GOLDEN_R3_OPTIONS: CompileCutPlanToPtxOptions = {
  "headerVersion": 1,
  "headerOrigin": 0,
  "trimType": 1,
  "title": "LAB_FIXTURE NOT_MACHINE_VALIDATED",
  "decimalPlaces": 2,
  "supportsPositiveTrim": true
};

export const GOLDEN_R3_DOCUMENT: PtxDocument = {
  "header": {
    "type": "HEADER",
    "version": 1,
    "title": "LAB_FIXTURE NOT_MACHINE_VALIDATED",
    "units": 0,
    "origin": 0,
    "trimType": 1
  },
  "records": [
    {
      "type": "JOBS",
      "jobIndex": 1,
      "name": "lab-661-golden-r3",
      "description": "GRANETE NON-PRODUCTION PTX CANDIDATE"
    },
    {
      "type": "MATERIALS",
      "jobIndex": 1,
      "materialIndex": 1,
      "code": "LAB18",
      "description": "Lab Board 18",
      "thickness": 18,
      "bookQuantity": 1,
      "kerfRip": 4,
      "kerfCrosscut": 4,
      "trimFRip": 10,
      "trimVRip": 10,
      "trimFXct": 10,
      "trimVXct": 10
    },
    {
      "type": "PARTS_REQ",
      "jobIndex": 1,
      "partIndex": 1,
      "code": "A",
      "materialIndex": 1,
      "length": 800,
      "width": 350,
      "requiredQuantity": 1,
      "overQuantity": 0,
      "underQuantity": 0,
      "grain": 1,
      "producedQuantity": 1
    },
    {
      "type": "PARTS_REQ",
      "jobIndex": 1,
      "partIndex": 2,
      "code": "B",
      "materialIndex": 1,
      "length": 350,
      "width": 500,
      "requiredQuantity": 1,
      "overQuantity": 0,
      "underQuantity": 0,
      "grain": 1,
      "producedQuantity": 1
    },
    {
      "type": "PARTS_REQ",
      "jobIndex": 1,
      "partIndex": 3,
      "code": "C",
      "materialIndex": 1,
      "length": 232,
      "width": 300,
      "requiredQuantity": 1,
      "overQuantity": 0,
      "underQuantity": 0,
      "grain": 1,
      "producedQuantity": 1
    },
    {
      "type": "BOARDS",
      "jobIndex": 1,
      "boardIndex": 1,
      "code": "S1",
      "materialIndex": 1,
      "length": 1220,
      "width": 800,
      "stockQuantity": 1,
      "usedQuantity": 1
    },
    {
      "type": "PATTERNS",
      "jobIndex": 1,
      "patternIndex": 1,
      "boardIndex": 1,
      "patternType": 4,
      "runQuantity": 1,
      "cyclesQuantity": 1,
      "maxBook": 1
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 1,
      "sequence": 1,
      "functionCode": 2,
      "dimension": 800,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "none"
      },
      "producedQuantity": 0,
      "comment": "place-1-1"
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 2,
      "sequence": 2,
      "functionCode": 1,
      "dimension": 350,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "part",
        "partIndex": 1
      },
      "producedQuantity": 1,
      "comment": "place-1-2"
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 3,
      "sequence": 5,
      "functionCode": 2,
      "dimension": 232,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "none"
      },
      "producedQuantity": 0,
      "comment": "place-3-1"
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 4,
      "sequence": 7,
      "functionCode": 3,
      "dimension": 300,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "part",
        "partIndex": 3
      },
      "producedQuantity": 1,
      "comment": "place-3-2"
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 5,
      "sequence": 3,
      "functionCode": 2,
      "dimension": 350,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "none"
      },
      "producedQuantity": 0,
      "comment": "place-2-1"
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 6,
      "sequence": 4,
      "functionCode": 1,
      "dimension": 500,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "part",
        "partIndex": 2
      },
      "producedQuantity": 1,
      "comment": "place-2-2"
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 1,
      "cutIndex": 7,
      "sequence": 6,
      "functionCode": 92,
      "dimension": 564,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "offcut",
        "offcutIndex": 1
      },
      "comment": "place-3-1:rest"
    },
    {
      "type": "OFFCUTS",
      "jobIndex": 1,
      "offcutIndex": 1,
      "code": "place-3-1:rest",
      "materialIndex": 1,
      "length": 564,
      "width": 426
    }
  ]
};

/** ReadonlyMap-free projection of PtxCompilationMapping (rebuilt by the test). */
export const GOLDEN_R3_MAPPING = {
  "jobIndex": 1,
  "materialIndexByCode": {
    "LAB18": 1
  },
  "partIndexByPieceRef": {
    "A-1-s0": 1,
    "B-2-s0": 2,
    "C-3-s0": 3
  },
  "pieceRefByPartIndex": [
    "A-1-s0",
    "B-2-s0",
    "C-3-s0"
  ],
  "offcutRegionIdByOffcutIndex": [
    "place-3-1:rest"
  ],
  "sheetIndexByPatternIndex": [
    0
  ],
  "sheets": [
    {
      "sheetIndex": 0,
      "boardIndex": 1,
      "patternIndex": 1,
      "patternType": 4,
      "cutIndexByCutId": {
        "place-1-1": 1,
        "place-1-2": 2,
        "place-3-1": 3,
        "place-3-2": 4,
        "place-2-1": 5,
        "place-2-2": 6
      },
      "cutIdByCutIndex": [
        "place-1-1",
        "place-1-2",
        "place-3-1",
        "place-3-2",
        "place-2-1",
        "place-2-2"
      ],
      "releaseCutIndexByRegionId": {
        "place-3-1:rest": 7
      },
      "offcutIndexByRegionId": {
        "place-3-1:rest": 1
      }
    }
  ]
} as const;

/** Exact candidate bytes (ASCII, CRLF) - reviewable against the r3 contract. */
export const GOLDEN_R3_TEXT = "HEADER,1,LAB_FIXTURE NOT_MACHINE_VALIDATED,0,0,1\r\nJOBS,1,lab-661-golden-r3,GRANETE NON-PRODUCTION PTX CANDIDATE,,,,,,,,\r\nMATERIALS,1,1,LAB18,Lab Board 18,18,1,4,4,10,10,10,10,,,,,,,\r\nPARTS_REQ,1,1,A,1,800,350,1,0,0,1,1\r\nPARTS_REQ,1,2,B,1,350,500,1,0,0,1,1\r\nPARTS_REQ,1,3,C,1,232,300,1,0,0,1,1\r\nBOARDS,1,1,S1,1,1220,800,1,1\r\nPATTERNS,1,1,1,4,1,1,1\r\nCUTS,1,1,1,1,2,800,1,0,0,place-1-1\r\nCUTS,1,1,2,2,1,350,1,1,1,place-1-2\r\nCUTS,1,1,3,5,2,232,1,0,0,place-3-1\r\nCUTS,1,1,4,7,3,300,1,3,1,place-3-2\r\nCUTS,1,1,5,3,2,350,1,0,0,place-2-1\r\nCUTS,1,1,6,4,1,500,1,2,1,place-2-2\r\nCUTS,1,1,7,6,92,564,1,X1,,place-3-1:rest\r\nOFFCUTS,1,1,place-3-1:rest,1,564,426\r\n";
