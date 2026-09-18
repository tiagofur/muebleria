/**
 * GOLDEN r4 candidate fixture (#781) — FROZEN OUTPUT, DO NOT EDIT BY HAND.
 *
 * Generated from a real optimizeCutPlan result (deterministic input below)
 * under the r4 field-dialect candidate policy: same rows, catalog, config
 * and options always compile to these bytes. LAB_FIXTURE /
 * NOT_MACHINE_VALIDATED: this is NOT a machine-validated program, NOT a
 * CADmatic acceptance and NOT one of the five kitchens. Regenerate only via
 * the generator spec when the r4 compiler contract deliberately changes.
 *
 * The frozen case demonstrates the r4 subset over the r3 trim scenario
 * (1220x800 boards, trims 10/10/10/10, kerf 4, two materials):
 * - MATERIALS.TRIM_FRIP/VRIP/FXCT/VXCT = 10 (totals including kerf);
 * - PARTS_REQ.CODE = workshop manufacturing codes (clean labelRef, one per
 *   physical piece; the qty-2 row shows the -C2 copy suffix);
 * - OFFCUTS records carry OFC_QTY=1 (evidenced column, R2201/R7301);
 * - OFFCUTS declared BEFORE the PATTERNS/CUTS blocks (no forward Xn refs);
 * - FUNCTION 92 + Xn only where the r3 subset proved it; other remnants are
 *   OFFCUTS-only rows (no pseudo-physical markers);
 * - CUT_INDEX (structural preorder) diverges from SEQUENCE (event schedule);
 * - readback verifier === [] over serialize -> parse bytes.
 */

import type { CutPlanConfig, MaterialBoard, ProductionCutRow } from '@granete/domain';
import type { PtxDocument } from './records';
import type { CompileCutPlanToPtxOptions } from './compileCutPlan';

export const GOLDEN_R4_PROJECT_ID = "lab-781-golden-r4";

export const GOLDEN_R4_MATERIALS: MaterialBoard[] = [
  {
    "id": "mat-lab-15",
    "code": "LAB15",
    "name": "Lab Board 15",
    "costPerM2": 10,
    "wastePercent": 10,
    "lengthMm": 1220,
    "widthMm": 800,
    "thicknessMm": 15,
    "grainDefault": true,
    "boardPrice": 8,
    "active": true
  },
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

export const GOLDEN_R4_CONFIG: CutPlanConfig = {
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

export const GOLDEN_R4_ROWS: ProductionCutRow[] = [
  {
    "quantity": 1,
    "lengthMm": 800,
    "widthMm": 350,
    "description": "A",
    "materialName": "Lab Board 15",
    "materialCode": "LAB15",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "A",
    "partName": "A",
    "moduleCode": "MOD-CAJ-01",
    "labelRef": "MOD-CAJ-01-P01",
    "thicknessMm": 18
  },
  {
    "quantity": 1,
    "lengthMm": 350,
    "widthMm": 500,
    "description": "B",
    "materialName": "Lab Board 15",
    "materialCode": "LAB15",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "B",
    "partName": "B",
    "moduleCode": "MOD-CAJ-01",
    "labelRef": "MOD-CAJ-01-P02",
    "thicknessMm": 18
  },
  {
    "quantity": 1,
    "lengthMm": 232,
    "widthMm": 300,
    "description": "C",
    "materialName": "Lab Board 15",
    "materialCode": "LAB15",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "C",
    "partName": "C",
    "moduleCode": "MOD-CAJ-01",
    "labelRef": "MOD-CAJ-01-P03",
    "thicknessMm": 18
  },
  {
    "quantity": 2,
    "lengthMm": 700,
    "widthMm": 700,
    "description": "D",
    "materialName": "Lab Board 18",
    "materialCode": "LAB18",
    "grain": 1,
    "L1": 0,
    "L2": 0,
    "W1": 0,
    "W2": 0,
    "partCode": "D",
    "partName": "D",
    "moduleCode": "MOD-CAJ-01",
    "labelRef": "MOD-CAJ-01-P04",
    "thicknessMm": 18
  }
];

export const GOLDEN_R4_OPTIONS: CompileCutPlanToPtxOptions = {
  "headerVersion": 1,
  "headerOrigin": 0,
  "trimType": 1,
  "title": "LAB_FIXTURE NOT_MACHINE_VALIDATED",
  "decimalPlaces": 2,
  "supportsPositiveTrim": true,
  "offcutsWithQuantity": true,
  "offcutsBeforePatterns": true,
  "offcutCutMarkers": "function92-only",
  "partCodeAuthority": "workshop-labelref",
  "partCodeMaxLength": 50
};

export const GOLDEN_R4_DOCUMENT: PtxDocument = {
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
      "name": "lab-781-golden-r4",
      "description": "GRANETE NON-PRODUCTION PTX CANDIDATE"
    },
    {
      "type": "MATERIALS",
      "jobIndex": 1,
      "materialIndex": 1,
      "code": "LAB15",
      "description": "Lab Board 15",
      "thickness": 15,
      "bookQuantity": 1,
      "kerfRip": 4,
      "kerfCrosscut": 4,
      "trimFRip": 10,
      "trimVRip": 10,
      "trimFXct": 10,
      "trimVXct": 10
    },
    {
      "type": "MATERIALS",
      "jobIndex": 1,
      "materialIndex": 2,
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
      "code": "MOD-CAJ-01-P01",
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
      "code": "MOD-CAJ-01-P02",
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
      "code": "MOD-CAJ-01-P03",
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
      "type": "PARTS_REQ",
      "jobIndex": 1,
      "partIndex": 4,
      "code": "MOD-CAJ-01-P04",
      "materialIndex": 2,
      "length": 700,
      "width": 700,
      "requiredQuantity": 1,
      "overQuantity": 0,
      "underQuantity": 0,
      "grain": 1,
      "producedQuantity": 1
    },
    {
      "type": "PARTS_REQ",
      "jobIndex": 1,
      "partIndex": 5,
      "code": "MOD-CAJ-01-P04-C2",
      "materialIndex": 2,
      "length": 700,
      "width": 700,
      "requiredQuantity": 1,
      "overQuantity": 0,
      "underQuantity": 0,
      "grain": 1,
      "producedQuantity": 1
    },
    {
      "type": "OFFCUTS",
      "jobIndex": 1,
      "offcutIndex": 1,
      "code": "place-3-1:rest",
      "materialIndex": 1,
      "length": 564,
      "width": 426,
      "producedQuantity": 1
    },
    {
      "type": "OFFCUTS",
      "jobIndex": 1,
      "offcutIndex": 2,
      "code": "place-1-1:rest",
      "materialIndex": 2,
      "length": 496,
      "width": 780,
      "producedQuantity": 1
    },
    {
      "type": "OFFCUTS",
      "jobIndex": 1,
      "offcutIndex": 3,
      "code": "place-1-1:rest",
      "materialIndex": 2,
      "length": 496,
      "width": 780,
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
      "type": "BOARDS",
      "jobIndex": 1,
      "boardIndex": 2,
      "code": "S2",
      "materialIndex": 2,
      "length": 1220,
      "width": 800,
      "stockQuantity": 1,
      "usedQuantity": 1
    },
    {
      "type": "PATTERNS",
      "jobIndex": 1,
      "patternIndex": 2,
      "boardIndex": 2,
      "patternType": 4,
      "runQuantity": 1,
      "cyclesQuantity": 1,
      "maxBook": 1
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 2,
      "cutIndex": 1,
      "sequence": 1,
      "functionCode": 2,
      "dimension": 700,
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
      "patternIndex": 2,
      "cutIndex": 2,
      "sequence": 2,
      "functionCode": 1,
      "dimension": 700,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "part",
        "partIndex": 4
      },
      "producedQuantity": 1,
      "comment": "place-1-2"
    },
    {
      "type": "BOARDS",
      "jobIndex": 1,
      "boardIndex": 3,
      "code": "S3",
      "materialIndex": 2,
      "length": 1220,
      "width": 800,
      "stockQuantity": 1,
      "usedQuantity": 1
    },
    {
      "type": "PATTERNS",
      "jobIndex": 1,
      "patternIndex": 3,
      "boardIndex": 3,
      "patternType": 4,
      "runQuantity": 1,
      "cyclesQuantity": 1,
      "maxBook": 1
    },
    {
      "type": "CUTS",
      "jobIndex": 1,
      "patternIndex": 3,
      "cutIndex": 1,
      "sequence": 1,
      "functionCode": 2,
      "dimension": 700,
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
      "patternIndex": 3,
      "cutIndex": 2,
      "sequence": 2,
      "functionCode": 1,
      "dimension": 700,
      "repeatQuantity": 1,
      "partReference": {
        "kind": "part",
        "partIndex": 5
      },
      "producedQuantity": 1,
      "comment": "place-1-2"
    }
  ]
};

export const GOLDEN_R4_MAPPING = {
  "jobIndex": 1,
  "materialIndexByCode": {
    "LAB15": 1,
    "LAB18": 2
  },
  "partIndexByPieceRef": {
    "A-1-s0": 1,
    "B-2-s0": 2,
    "C-3-s0": 3,
    "D-1-s0": 4,
    "D-2-s1": 5
  },
  "pieceRefByPartIndex": [
    "A-1-s0",
    "B-2-s0",
    "C-3-s0",
    "D-1-s0",
    "D-2-s1"
  ],
  "offcutRegionRefByOffcutIndex": [
    {
      "sheetIndex": 0,
      "regionId": "place-3-1:rest"
    },
    {
      "sheetIndex": 1,
      "regionId": "place-1-1:rest"
    },
    {
      "sheetIndex": 2,
      "regionId": "place-1-1:rest"
    }
  ],
  "sheetIndexByPatternIndex": [
    0,
    1,
    2
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
    },
    {
      "sheetIndex": 1,
      "boardIndex": 2,
      "patternIndex": 2,
      "patternType": 4,
      "cutIndexByCutId": {
        "place-1-1": 1,
        "place-1-2": 2
      },
      "cutIdByCutIndex": [
        "place-1-1",
        "place-1-2"
      ],
      "releaseCutIndexByRegionId": {},
      "offcutIndexByRegionId": {
        "place-1-1:rest": 2
      }
    },
    {
      "sheetIndex": 2,
      "boardIndex": 3,
      "patternIndex": 3,
      "patternType": 4,
      "cutIndexByCutId": {
        "place-1-1": 1,
        "place-1-2": 2
      },
      "cutIdByCutIndex": [
        "place-1-1",
        "place-1-2"
      ],
      "releaseCutIndexByRegionId": {},
      "offcutIndexByRegionId": {
        "place-1-1:rest": 3
      }
    }
  ]
};

export const GOLDEN_R4_TEXT = "HEADER,1,LAB_FIXTURE NOT_MACHINE_VALIDATED,0,0,1\r\nJOBS,1,lab-781-golden-r4,GRANETE NON-PRODUCTION PTX CANDIDATE,,,,,,,,\r\nMATERIALS,1,1,LAB15,Lab Board 15,15,1,4,4,10,10,10,10,,,,,,,\r\nMATERIALS,1,2,LAB18,Lab Board 18,18,1,4,4,10,10,10,10,,,,,,,\r\nPARTS_REQ,1,1,MOD-CAJ-01-P01,1,800,350,1,0,0,1,1\r\nPARTS_REQ,1,2,MOD-CAJ-01-P02,1,350,500,1,0,0,1,1\r\nPARTS_REQ,1,3,MOD-CAJ-01-P03,1,232,300,1,0,0,1,1\r\nPARTS_REQ,1,4,MOD-CAJ-01-P04,2,700,700,1,0,0,1,1\r\nPARTS_REQ,1,5,MOD-CAJ-01-P04-C2,2,700,700,1,0,0,1,1\r\nOFFCUTS,1,1,place-3-1:rest,1,564,426,1\r\nOFFCUTS,1,2,place-1-1:rest,2,496,780,1\r\nOFFCUTS,1,3,place-1-1:rest,2,496,780,1\r\nBOARDS,1,1,S1,1,1220,800,1,1\r\nPATTERNS,1,1,1,4,1,1,1\r\nCUTS,1,1,1,1,2,800,1,0,0,place-1-1\r\nCUTS,1,1,2,2,1,350,1,1,1,place-1-2\r\nCUTS,1,1,3,5,2,232,1,0,0,place-3-1\r\nCUTS,1,1,4,7,3,300,1,3,1,place-3-2\r\nCUTS,1,1,5,3,2,350,1,0,0,place-2-1\r\nCUTS,1,1,6,4,1,500,1,2,1,place-2-2\r\nCUTS,1,1,7,6,92,564,1,X1,,place-3-1:rest\r\nBOARDS,1,2,S2,2,1220,800,1,1\r\nPATTERNS,1,2,2,4,1,1,1\r\nCUTS,1,2,1,1,2,700,1,0,0,place-1-1\r\nCUTS,1,2,2,2,1,700,1,4,1,place-1-2\r\nBOARDS,1,3,S3,2,1220,800,1,1\r\nPATTERNS,1,3,3,4,1,1,1\r\nCUTS,1,3,1,1,2,700,1,0,0,place-1-1\r\nCUTS,1,3,2,2,1,700,1,5,1,place-1-2\r\n";
