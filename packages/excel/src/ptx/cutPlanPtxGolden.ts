/**
 * GOLDEN candidate fixture (#650 PR 5) — FROZEN OUTPUT, DO NOT EDIT BY HAND.
 *
 * Generated from a real optimizeCutPlan result (deterministic input below:
 * same rows, catalog, config and options always compile to these bytes).
 * LAB_FIXTURE / NOT_MACHINE_VALIDATED: this is NOT a machine-validated
 * program, NOT a CADmatic acceptance and NOT one of the five kitchens.
 * Regenerate only via the generator spec when the compiler contract
 * deliberately changes (and say so in the commit).
 */

import type { CutPlanConfig, MaterialBoard, ProductionCutRow } from '@granete/domain';
import type { PtxDocument } from './records';
import type { CompileCutPlanToPtxOptions } from './compileCutPlan';

export const GOLDEN_PROJECT_ID = 'lab-650-golden';

export const GOLDEN_MATERIALS: MaterialBoard[] = [{"id":"mat-lab","code":"LAB18","name":"Lab Board 18","costPerM2":10,"wastePercent":10,"lengthMm":1200,"widthMm":700,"thicknessMm":18,"grainDefault":true,"boardPrice":8,"active":true}];

export const GOLDEN_CONFIG: CutPlanConfig = {"sawKerfMm":4,"trim":{"topMm":0,"bottomMm":0,"leftMm":0,"rightMm":0},"deductEdgeBand":true,"allowRotationNoGrain":true,"minRemnantWidthMm":300,"minRemnantLengthMm":400,"preferLongitudinalRips":true};

export const GOLDEN_ROWS: ProductionCutRow[] = [{"quantity":1,"lengthMm":450,"widthMm":320,"description":"A lab","materialName":"Lab Board 18","materialCode":"LAB18","grain":1,"L1":0,"L2":0,"W1":0,"W2":0,"partCode":"A","partName":"A","moduleCode":"M01","thicknessMm":18},{"quantity":1,"lengthMm":280,"widthMm":210,"description":"B lab","materialName":"Lab Board 18","materialCode":"LAB18","grain":1,"L1":0,"L2":0,"W1":0,"W2":0,"partCode":"B","partName":"B","moduleCode":"M01","thicknessMm":18}];

export const GOLDEN_OPTIONS: CompileCutPlanToPtxOptions = {"headerVersion":1,"headerOrigin":0,"trimType":1,"title":"LAB_FIXTURE NOT_MACHINE_VALIDATED","decimalPlaces":2};

export const GOLDEN_DOCUMENT: PtxDocument = {
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
      "name": "lab-650-golden",
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
      "kerfCrosscut": 4
    },
    {
      "type": "PARTS_REQ",
      "jobIndex": 1,
      "partIndex": 1,
      "code": "A",
      "materialIndex": 1,
      "length": 450,
      "width": 320,
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
      "length": 280,
      "width": 210,
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
      "length": 1200,
      "width": 700,
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
      "dimension": 450,
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
      "dimension": 320,
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
      "sequence": 3,
      "functionCode": 2,
      "dimension": 280,
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
      "cutIndex": 4,
      "sequence": 4,
      "functionCode": 3,
      "dimension": 210,
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
      "cutIndex": 5,
      "sequence": 0,
      "functionCode": 2,
      "dimension": 746,
      "repeatQuantity": 0,
      "partReference": {
        "kind": "offcut",
        "offcutIndex": 1
      },
      "producedQuantity": 1,
      "comment": "place-1-1:rest"
    },
    {
      "type": "OFFCUTS",
      "jobIndex": 1,
      "offcutIndex": 1,
      "code": "place-1-1:rest",
      "materialIndex": 1,
      "length": 746,
      "width": 700
    }
  ]
};

/** ReadonlyMap-free projection of PtxCompilationMapping (rebuilt by the test). */
export const GOLDEN_MAPPING = {
  "jobIndex": 1,
  "materialIndexByCode": {
    "LAB18": 1
  },
  "partIndexByPieceRef": {
    "A-1-s0": 1,
    "B-2-s0": 2
  },
  "pieceRefByPartIndex": [
    "A-1-s0",
    "B-2-s0"
  ],
  "offcutRegionIdByOffcutIndex": [
    "place-1-1:rest"
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
        "place-2-1": 3,
        "place-2-2": 4
      },
      "cutIdByCutIndex": [
        "place-1-1",
        "place-1-2",
        "place-2-1",
        "place-2-2"
      ],
      "releaseCutIndexByRegionId": {
        "place-1-1:rest": 5
      },
      "offcutIndexByRegionId": {
        "place-1-1:rest": 1
      }
    }
  ]
} as const;

/** Exact candidate bytes (ASCII, CRLF) — reviewable against the dossier fragments. */
export const GOLDEN_TEXT = "HEADER,1,LAB_FIXTURE NOT_MACHINE_VALIDATED,0,0,1\r\nJOBS,1,lab-650-golden,GRANETE NON-PRODUCTION PTX CANDIDATE,,,,,,,,\r\nMATERIALS,1,1,LAB18,Lab Board 18,18,1,4,4,,,,,,,,,,,\r\nPARTS_REQ,1,1,A,1,450,320,1,0,0,1,1\r\nPARTS_REQ,1,2,B,1,280,210,1,0,0,1,1\r\nBOARDS,1,1,S1,1,1200,700,1,1\r\nPATTERNS,1,1,1,4,1,1,1\r\nCUTS,1,1,1,1,2,450,1,0,0,place-1-1\r\nCUTS,1,1,2,2,1,320,1,1,1,place-1-2\r\nCUTS,1,1,3,3,2,280,1,0,0,place-2-1\r\nCUTS,1,1,4,4,3,210,1,2,1,place-2-2\r\nCUTS,1,1,5,0,2,746,0,X1,1,place-1-1:rest\r\nOFFCUTS,1,1,place-1-1:rest,1,746,700\r\n";
