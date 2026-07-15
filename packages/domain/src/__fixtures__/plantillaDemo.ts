/**
 * Golden fixture derived from Plantilla_Muebles.xlsx (repo root).
 *
 * Source sheets:
 * - "⚙️ Configuración Costos" — material / edge / hardware unit costs
 * - "📋 Explosión y Despiece" — MOD-GAB-01 + MOD-CAJ-01 BOM rows
 * - "📊 Resumen y Cotización" — marginFactor=1.35 (B16), laborFixedCost=1200 (B17)
 *
 * Cached data_only values were empty; expected totals recomputed with PRD §13 /
 * Excel formulas (area, edge ML, boardCost without waste, edge by material name).
 *
 * Intentional divergences vs Excel workbook presentation:
 * - wastePercent = 0 (Excel has no merma column; F014 UI defaults 0%)
 * - laborModular = 0 (Excel only has project-level fixed labor B17)
 * - IVA none (Excel sale price is pre-tax)
 * - Edge resolution uses MaterialBoard.defaultEdgeBandId (FK), not display-name match
 */

import type {
  Catalog,
  Customer,
  EdgeAssignment,
  Module,
  OptionChoices,
  Project,
  QuoteBreakdown,
} from '../types';

const edgesAll = (
  L1: boolean,
  L2: boolean,
  W1: boolean,
  W2: boolean,
): readonly EdgeAssignment[] =>
  [
    { side: 'L1', enabled: L1 },
    { side: 'L2', enabled: L2 },
    { side: 'W1', enabled: W1 },
    { side: 'W2', enabled: W2 },
  ] as const;

// --- Catalog IDs (stable for tests) ---

export const IDS = {
  matArauco: 'mat-arauco-blanco',
  matMaderado: 'mat-maderado-frente',
  matMdf: 'mat-mdf-3mm',
  edgeArauco: 'edge-arauco-blanco',
  edgeMaderado: 'edge-maderado-frente',
  edgeMdf: 'edge-mdf-3mm',
  hwBisagra: 'hw-bisagra-cierre-lento',
  hwJaladera: 'hw-jaladera-acero',
  hwPata: 'hw-pata-regulable',
  hwTornillo: 'hw-tornillo-4x50',
  hwCorredera: 'hw-corredera-500',
  hwSoporte: 'hw-soporte-entrepano',
  ogInterior: 'og-interior',
  ogFrente: 'og-frente',
  ogFondo: 'og-fondo',
  ogBisagra: 'og-bisagra',
  ogCorredera: 'og-corredera',
  modGab: 'mod-gab-01',
  modCaj: 'mod-caj-01',
  /** Seed customers referenced by plantilla / demo projects. */
  custPlantilla1: 'cust-plantilla-1',
  custPlantilla2: 'cust-plantilla-2',
  project: 'proj-plantilla-demo',
  /** Seed first-open demo project (MOD-GAB-01 × 1 only). */
  projectDemo: 'proj-demo-plantilla',
  itemGab: 'item-gab-01',
  itemCaj: 'item-caj-01',
  itemDemoGab: 'item-demo-gab-01',
} as const;

export const plantillaChoices: OptionChoices = {
  INTERIOR: IDS.matArauco,
  FRENTE: IDS.matMaderado,
  FONDO: IDS.matMdf,
  BISAGRA: IDS.hwBisagra,
  CORREDERA: IDS.hwCorredera,
};

export const plantillaCatalog: Catalog = {
  materials: [
    {
      id: IDS.matArauco,
      code: 'TAB-ARA-BLA',
      name: 'ARAUCO BLANCO',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 15,
      grainDefault: false,
      boardPrice: 714.43,
      wastePercent: 0,
      costPerM2: 160,
      defaultEdgeBandId: IDS.edgeArauco,
      active: true,
    },
    {
      id: IDS.matMaderado,
      code: 'TAB-MAD-FRE',
      name: 'MADERADO FRENTE',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 1294.91,
      wastePercent: 0,
      costPerM2: 290,
      defaultEdgeBandId: IDS.edgeMaderado,
      active: true,
    },
    {
      id: IDS.matMdf,
      code: 'TAB-MDF-3',
      name: 'MDF 3MM',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 3,
      grainDefault: false,
      boardPrice: 334.89,
      wastePercent: 0,
      costPerM2: 75,
      defaultEdgeBandId: IDS.edgeMdf,
      active: true,
    },
  ],
  edges: [
    {
      id: IDS.edgeArauco,
      code: 'CAN-ARA-BLA',
      name: 'ARAUCO BLANCO',
      thicknessMm: 0.5,
      costPerMl: 12,
      active: true,
    },
    {
      id: IDS.edgeMaderado,
      code: 'CAN-MAD-FRE',
      name: 'MADERADO FRENTE',
      thicknessMm: 2,
      costPerMl: 25,
      active: true,
    },
    {
      id: IDS.edgeMdf,
      code: 'CAN-MDF-3',
      name: 'MDF 3MM',
      thicknessMm: 0,
      costPerMl: 0,
      active: true,
    },
  ],
  hardware: [
    {
      id: IDS.hwBisagra,
      code: 'HER-BIS-CL',
      name: 'Bisagra Cierre Lento',
      unit: 'piece',
      costPerUnit: 35,
      active: true,
    },
    {
      id: IDS.hwJaladera,
      code: 'HER-JAL-INOX',
      name: 'Jaladera Acero Inox',
      unit: 'piece',
      costPerUnit: 45,
      active: true,
    },
    {
      id: IDS.hwPata,
      code: 'HER-PATA-REG',
      name: 'Pata Regulable Plastica',
      unit: 'piece',
      costPerUnit: 15,
      active: true,
    },
    {
      id: IDS.hwTornillo,
      code: 'HER-TOR-4X50',
      name: 'Tornillo 4x50 mm',
      unit: 'piece',
      costPerUnit: 0.5,
      active: true,
    },
    {
      id: IDS.hwCorredera,
      code: 'HER-CORR-500',
      name: 'Corredera Telescópica 500mm',
      unit: 'set',
      costPerUnit: 120,
      active: true,
    },
    {
      id: IDS.hwSoporte,
      code: 'HER-SOP-ENT',
      name: 'Soporte de Entrepaño',
      unit: 'piece',
      costPerUnit: 2,
      active: true,
    },
  ],
  optionGroups: [
    {
      id: IDS.ogInterior,
      code: 'INTERIOR',
      name: 'Melamina de Interiores',
      kind: 'board',
      required: true,
      optionIds: [IDS.matArauco],
    },
    {
      id: IDS.ogFrente,
      code: 'FRENTE',
      name: 'Melamina de Frentes',
      kind: 'board',
      required: true,
      optionIds: [IDS.matMaderado],
    },
    {
      id: IDS.ogFondo,
      code: 'FONDO',
      name: 'Fondos delgados',
      kind: 'board',
      required: true,
      optionIds: [IDS.matMdf],
    },
    {
      id: IDS.ogBisagra,
      code: 'BISAGRA',
      name: 'Bisagras',
      kind: 'hardware',
      required: true,
      optionIds: [IDS.hwBisagra],
    },
    {
      id: IDS.ogCorredera,
      code: 'CORREDERA',
      name: 'Correderas',
      kind: 'hardware',
      required: true,
      optionIds: [IDS.hwCorredera],
    },
  ],
  customers: [
    {
      id: IDS.custPlantilla1,
      name: 'Cliente Plantilla',
      active: true,
    },
    {
      id: IDS.custPlantilla2,
      name: 'Cliente Demo',
      active: true,
    },
  ] satisfies readonly Customer[],
  modules: [], // filled below after module defs
};

export const modGab01: Module = {
  id: IDS.modGab,
  code: 'MOD-GAB-01',
  name: 'Gabinete 1 Puerta 300 x 720 x 590 mm',
  externalDims: { width: 300, height: 720, depth: 590 },
  // Excel has no per-module labor; project-level fixed only
  boardParts: [
    {
      id: 'gab-p01',
      code: 'MOD-GAB-01-P01',
      description: 'Costado Derecho',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      grain: 0,
      edges: edgesAll(true, true, true, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p02',
      code: 'MOD-GAB-01-P02',
      description: 'Costado Izquierdo',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      grain: 0,
      edges: edgesAll(true, true, true, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p03',
      code: 'MOD-GAB-01-P03',
      description: 'Respaldo Gabinete',
      quantity: 1,
      lengthMm: 689,
      widthMm: 269,
      grain: 0,
      edges: edgesAll(false, false, false, false),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p04',
      code: 'MOD-GAB-01-P04',
      description: 'Piso Gabinete',
      quantity: 1,
      lengthMm: 590,
      widthMm: 269,
      grain: 0,
      edges: edgesAll(false, false, true, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p05',
      code: 'MOD-GAB-01-P05',
      description: 'Entrepano Gabinete',
      quantity: 1,
      lengthMm: 520,
      widthMm: 269,
      grain: 0,
      edges: edgesAll(false, false, false, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p06',
      code: 'MOD-GAB-01-P06',
      description: 'Manguete Frontal',
      quantity: 1,
      lengthMm: 269,
      widthMm: 120,
      grain: 0,
      edges: edgesAll(true, true, false, false),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p07',
      code: 'MOD-GAB-01-P07',
      description: 'Manguete Posterior',
      quantity: 1,
      lengthMm: 269,
      widthMm: 120,
      grain: 0,
      edges: edgesAll(true, true, false, false),
      optionRole: 'INTERIOR',
    },
    {
      id: 'gab-p08',
      code: 'MOD-GAB-01-P08',
      description: 'Puerta Gabinete',
      quantity: 1,
      lengthMm: 717,
      widthMm: 296,
      grain: 1,
      edges: edgesAll(true, true, true, true),
      optionRole: 'FRENTE',
    },
  ],
  hardwareLines: [
    {
      id: 'gab-h01',
      quantity: 2,
      optionRole: 'BISAGRA',
    },
    {
      id: 'gab-h02',
      quantity: 1,
      optionRole: 'FIXED',
      hardwareId: IDS.hwJaladera,
    },
    {
      id: 'gab-h03',
      quantity: 4,
      optionRole: 'FIXED',
      hardwareId: IDS.hwPata,
    },
    {
      id: 'gab-h04',
      quantity: 40,
      optionRole: 'FIXED',
      hardwareId: IDS.hwTornillo,
    },
    {
      id: 'gab-h05',
      quantity: 4,
      optionRole: 'FIXED',
      hardwareId: IDS.hwSoporte,
    },
  ],
};

export const modCaj01: Module = {
  id: IDS.modCaj,
  code: 'MOD-CAJ-01',
  name: 'Cajonera 4 Cajones 500 x 720 x 590 mm',
  externalDims: { width: 500, height: 720, depth: 590 },
  boardParts: [
    {
      id: 'caj-p01',
      code: 'MOD-CAJ-01-P01',
      description: 'Costado Derecho',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      grain: 0,
      edges: edgesAll(true, true, true, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'caj-p02',
      code: 'MOD-CAJ-01-P02',
      description: 'Costado Izquierdo',
      quantity: 1,
      lengthMm: 720,
      widthMm: 590,
      grain: 0,
      edges: edgesAll(true, true, true, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'caj-p03',
      code: 'MOD-CAJ-01-P03',
      description: 'Piso Gabinete',
      quantity: 1,
      lengthMm: 590,
      widthMm: 469,
      grain: 0,
      edges: edgesAll(false, false, true, true),
      optionRole: 'INTERIOR',
    },
    {
      id: 'caj-p04',
      code: 'MOD-CAJ-01-P04',
      description: 'Respaldo Gabinete',
      quantity: 1,
      lengthMm: 689,
      widthMm: 469,
      grain: 0,
      edges: edgesAll(false, false, false, false),
      optionRole: 'INTERIOR',
    },
    {
      id: 'caj-p05',
      code: 'MOD-CAJ-01-P05',
      description: 'Frente de Cajón',
      quantity: 4,
      lengthMm: 175,
      widthMm: 496,
      grain: 1,
      edges: edgesAll(true, true, true, true),
      optionRole: 'FRENTE',
    },
    {
      id: 'caj-p06',
      code: 'MOD-CAJ-01-P06',
      description: 'Lateral de Cajón',
      quantity: 8,
      lengthMm: 500,
      widthMm: 120,
      grain: 0,
      edges: edgesAll(true, false, false, false),
      optionRole: 'INTERIOR',
    },
    {
      id: 'caj-p07',
      code: 'MOD-CAJ-01-P07',
      description: 'Frente/Tras Cajón',
      quantity: 4,
      lengthMm: 412,
      widthMm: 120,
      grain: 0,
      edges: edgesAll(true, false, false, false),
      optionRole: 'INTERIOR',
    },
    {
      id: 'caj-p08',
      code: 'MOD-CAJ-01-P08',
      description: 'Fondo de Cajón (MDF)',
      quantity: 4,
      lengthMm: 500,
      widthMm: 442,
      grain: 0,
      edges: edgesAll(false, false, false, false),
      optionRole: 'FONDO',
    },
  ],
  hardwareLines: [
    {
      id: 'caj-h01',
      quantity: 4,
      optionRole: 'CORREDERA',
    },
    {
      id: 'caj-h02',
      quantity: 4,
      optionRole: 'FIXED',
      hardwareId: IDS.hwJaladera,
    },
    {
      id: 'caj-h03',
      quantity: 4,
      optionRole: 'FIXED',
      hardwareId: IDS.hwPata,
    },
    {
      id: 'caj-h04',
      quantity: 60,
      optionRole: 'FIXED',
      hardwareId: IDS.hwTornillo,
    },
  ],
};

export const plantillaCatalogWithModules: Catalog = {
  ...plantillaCatalog,
  modules: [modGab01, modCaj01],
};

export const plantillaProject: Project = {
  id: IDS.project,
  name: 'Mobiliario Residencial Estándar',
  customerId: IDS.custPlantilla1,
  currency: 'MXN',
  marginFactor: 1.35,
  laborFixedCost: 1200,
  status: 'draft',
  items: [
    {
      id: IDS.itemGab,
      moduleId: IDS.modGab,
      quantity: 1,
      optionChoices: plantillaChoices,
    },
    {
      id: IDS.itemCaj,
      moduleId: IDS.modCaj,
      quantity: 1,
      optionChoices: plantillaChoices,
    },
  ],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

/**
 * Seed / acceptance project: MOD-GAB-01 × 1 only with plantilla option choices.
 * Same margin + laborFixed as plantilla workbook (B16/B17); BOM is GAB-only.
 */
export const plantillaGabOnlyProject: Project = {
  id: IDS.projectDemo,
  name: 'Demo plantilla',
  customerId: IDS.custPlantilla2,
  currency: 'MXN',
  marginFactor: 1.35,
  laborFixedCost: 1200,
  status: 'draft',
  items: [
    {
      id: IDS.itemDemoGab,
      moduleId: IDS.modGab,
      quantity: 1,
      optionChoices: plantillaChoices,
    },
  ],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

/** Fresh copy for seed workspace (avoids accidental mutation of fixture). */
export function createPlantillaDemoProject(): Project {
  return {
    ...plantillaGabOnlyProject,
    items: plantillaGabOnlyProject.items.map((item) => ({
      ...item,
      optionChoices: { ...item.optionChoices },
    })),
  };
}

/**
 * Expected totals recomputed from Plantilla_Muebles.xlsx input rows.
 * Resumen B15 = directCost; B18 = (B15 * B16) + B17 with B16=1.35, B17=1200.
 */
export const plantillaExpected: Pick<
  QuoteBreakdown,
  | 'materialsCost'
  | 'edgeTotal'
  | 'hardwareTotal'
  | 'directCost'
  | 'laborModular'
  | 'laborFixedCost'
  | 'marginFactor'
  | 'salePrice'
> = {
  materialsCost: 792.5836,
  edgeTotal: 412.238,
  hardwareTotal: 953,
  directCost: 2157.8216,
  laborModular: 0,
  laborFixedCost: 1200,
  marginFactor: 1.35,
  salePrice: 4113.05916,
};

/**
 * GAB-only expected totals (MOD-GAB-01 × 1, plantillaChoices, waste 0).
 * Same formula as dual golden; laborFixedCost still project-level 1200.
 * Not the dual-module Resumen sheet total (that includes CAJ).
 */
export const plantillaGabOnlyExpected: Pick<
  QuoteBreakdown,
  | 'materialsCost'
  | 'edgeTotal'
  | 'hardwareTotal'
  | 'directCost'
  | 'laborModular'
  | 'laborFixedCost'
  | 'marginFactor'
  | 'salePrice'
> = {
  materialsCost: 285.24184,
  edgeTotal: 136.126,
  hardwareTotal: 203,
  directCost: 624.36784,
  laborModular: 0,
  laborFixedCost: 1200,
  marginFactor: 1.35,
  salePrice: 2042.896584,
};

export const GOLDEN_FIXTURE = {
  catalog: plantillaCatalogWithModules,
  project: plantillaProject,
  expected: plantillaExpected,
  source: {
    workbook: 'Plantilla_Muebles.xlsx',
    materials: 'Configuración Costos!A5:B7',
    edges: 'Configuración Costos!E5:F7',
    hardware: 'Configuración Costos!A13:B18',
    bom: 'Explosión y Despiece!A5:J30',
    margin: 'Resumen y Cotización!B16',
    laborFixed: 'Resumen y Cotización!B17',
  },
} as const;

/** F011 GAB-only golden (seed demo quotation path). */
export const GAB_ONLY_GOLDEN = {
  catalog: plantillaCatalogWithModules,
  project: plantillaGabOnlyProject,
  expected: plantillaGabOnlyExpected,
  source: {
    workbook: 'Plantilla_Muebles.xlsx',
    module: 'MOD-GAB-01',
    bom: 'Explosión y Despiece (GAB rows only)',
    margin: 'Resumen y Cotización!B16',
    laborFixed: 'Resumen y Cotización!B17',
  },
} as const;
