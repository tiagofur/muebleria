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
  Component,
  Customer,
  EdgeAssignment,
  Module,
  OptionChoices,
  Project,
  QuoteBreakdown,
  Structure,
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
  structureId: 'struct-gab-01',
  // Module-level components: door (front) + shelf (interior), beyond the body.
  components: [
    { componentId: 'comp-gab-puerta', quantity: 1 },
    { componentId: 'comp-gab-entrepano', quantity: 1 },
  ],
  // Excel has no per-module labor; project-level fixed only
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
  structureId: 'struct-caj-01',
  components: [
    { componentId: 'comp-caj-frente', quantity: 4 },
    { componentId: 'comp-caj-lateral', quantity: 8 },
    { componentId: 'comp-caj-frentetras', quantity: 4 },
    { componentId: 'comp-caj-fondo', quantity: 4 },
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

// --- Reusable component seeds (F049 / H07) ---

export const seedComponentPuerta: Component = {
  id: 'seed-comp-puerta',
  code: 'COM-PUE-01',
  name: 'Puerta',
  placement: 'puerta',
  geometry: { kind: 'rectangular_board', lengthMm: 717, widthMm: 296, thicknessMm: 18 },
  defaultEdges: edgesAll(true, true, true, true),
  optionRoles: ['FRENTE'],
  active: true,
};

export const seedComponentEntrepano: Component = {
  id: 'seed-comp-entrepano',
  code: 'COM-ENT-01',
  name: 'Entrepaño Regulable',
  placement: 'interno',
  geometry: { kind: 'rectangular_board', lengthMm: 462, widthMm: 550, thicknessMm: 15 },
  defaultEdges: edgesAll(false, false, false, true),
  optionRoles: ['INTERIOR'],
  active: true,
};

export const seedComponentCostado: Component = {
  id: 'seed-comp-costado',
  code: 'COM-COS-01',
  name: 'Costado Lateral',
  placement: 'lateral_izquierdo',
  geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18 },
  defaultEdges: edgesAll(false, false, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
};

export const seedComponentBase: Component = {
  id: 'seed-comp-base',
  code: 'COM-BAS-01',
  name: 'Base Estructura',
  placement: 'base',
  geometry: { kind: 'rectangular_board', lengthMm: 564, widthMm: 560, thicknessMm: 18 },
  defaultEdges: edgesAll(false, false, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
};

// --- Parametric components for MOD-GAB-01 / MOD-CAJ-01 (Fase 2+3) ---
// Geometry formulas reproduce the exact Excel dimensions at each module's
// preset (W=width, H=height, D=depth in mm), so golden cost numbers are
// preserved while pieces become reusable + parametric.

/** Gabinete body: costado (L=H, W=D), respaldo, piso, manguetes. */
/** Gabinete body: costado (L=H, W=D), respaldo, piso, manguetes. */
const compGabCostado: Component = {
  id: 'comp-gab-costado',
  code: 'COM-GAB-COS',
  name: 'Costado Gabinete',
  placement: 'lateral_izquierdo',
  geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 590, thicknessMm: 18, lengthFormula: 'PH', widthFormula: 'PD' },
  defaultEdges: edgesAll(true, true, true, true),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'i * (PW - T)',
  yFormula: '0',
  zFormula: '0',
  rotateX: 0,
  rotateY: 90,
  rotateZ: 0,
};
const compGabRespaldo: Component = {
  id: 'comp-gab-respaldo',
  code: 'COM-GAB-RES',
  name: 'Respaldo Gabinete',
  placement: 'trasera',
  geometry: { kind: 'rectangular_board', lengthMm: 689, widthMm: 269, thicknessMm: 18, lengthFormula: 'PH - 31', widthFormula: 'PW - 31' },
  defaultEdges: edgesAll(false, false, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: '0',
  zFormula: 'T',
  rotateX: 90,
  rotateY: 0,
  rotateZ: 0,
};
const compGabPiso: Component = {
  id: 'comp-gab-piso',
  code: 'COM-GAB-PIS',
  name: 'Piso Gabinete',
  placement: 'base',
  geometry: { kind: 'rectangular_board', lengthMm: 590, widthMm: 269, thicknessMm: 18, lengthFormula: 'PD', widthFormula: 'PW - 31' },
  defaultEdges: edgesAll(false, false, true, true),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: '0',
  zFormula: '0',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};
const compGabManguete: Component = {
  id: 'comp-gab-manguete',
  code: 'COM-GAB-MAN',
  name: 'Manguete',
  placement: 'frontal',
  geometry: { kind: 'rectangular_board', lengthMm: 269, widthMm: 120, thicknessMm: 18, lengthFormula: 'PW - 31', widthFormula: '120' },
  defaultEdges: edgesAll(true, true, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: 'i * (PD - 120)',
  zFormula: 'PH - T',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};
/** Gabinete module-level components: door + shelf. */
const compGabPuerta: Component = {
  id: 'comp-gab-puerta',
  code: 'COM-GAB-PUE',
  name: 'Puerta Gabinete',
  placement: 'puerta',
  geometry: { kind: 'rectangular_board', lengthMm: 717, widthMm: 296, thicknessMm: 18, lengthFormula: 'PH - 3', widthFormula: 'PW - 4' },
  defaultEdges: edgesAll(true, true, true, true),
  optionRoles: ['FRENTE'],
  active: true,
  xFormula: '2',
  yFormula: 'PD',
  zFormula: '2',
  rotateX: 90,
  rotateY: 0,
  rotateZ: 0,
};
const compGabEntrepano: Component = {
  id: 'comp-gab-entrepano',
  code: 'COM-GAB-ENT',
  name: 'Entrepaño Gabinete',
  placement: 'interno',
  geometry: { kind: 'rectangular_board', lengthMm: 520, widthMm: 269, thicknessMm: 18, lengthFormula: 'PH - 200', widthFormula: 'PW - 31' },
  defaultEdges: edgesAll(false, false, false, true),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: '0',
  zFormula: '150 + i * 200',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};

/** Cajonera body: costados, piso, respaldo. */
const compCajCostado: Component = {
  id: 'comp-caj-costado',
  code: 'COM-CAJ-COS',
  name: 'Costado Cajonera',
  placement: 'lateral_izquierdo',
  geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 590, thicknessMm: 18, lengthFormula: 'PH', widthFormula: 'PD' },
  defaultEdges: edgesAll(true, true, true, true),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'i * (PW - T)',
  yFormula: '0',
  zFormula: '0',
  rotateX: 0,
  rotateY: 90,
  rotateZ: 0,
};
const compCajPiso: Component = {
  id: 'comp-caj-piso',
  code: 'COM-CAJ-PIS',
  name: 'Piso Cajonera',
  placement: 'base',
  geometry: { kind: 'rectangular_board', lengthMm: 590, widthMm: 469, thicknessMm: 18, lengthFormula: 'PD', widthFormula: 'PW - 31' },
  defaultEdges: edgesAll(false, false, true, true),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: '0',
  zFormula: '0',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};
const compCajRespaldo: Component = {
  id: 'comp-caj-respaldo',
  code: 'COM-CAJ-RES',
  name: 'Respaldo Cajonera',
  placement: 'trasera',
  geometry: { kind: 'rectangular_board', lengthMm: 689, widthMm: 469, thicknessMm: 18, lengthFormula: 'PH - 31', widthFormula: 'PW - 31' },
  defaultEdges: edgesAll(false, false, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: '0',
  zFormula: 'T',
  rotateX: 90,
  rotateY: 0,
  rotateZ: 0,
};
/** Cajonera module-level components: drawer parts. */
const compCajFrente: Component = {
  id: 'comp-caj-frente',
  code: 'COM-CAJ-FRE',
  name: 'Frente de Cajón',
  placement: 'frente_cajon',
  geometry: { kind: 'rectangular_board', lengthMm: 175, widthMm: 496, thicknessMm: 18 },
  defaultEdges: edgesAll(true, true, true, true),
  optionRoles: ['FRENTE'],
  active: true,
  xFormula: '2',
  yFormula: 'PD',
  zFormula: 'i * 175',
  rotateX: 90,
  rotateY: 0,
  rotateZ: 0,
};
const compCajLateral: Component = {
  id: 'comp-caj-lateral',
  code: 'COM-CAJ-LAT',
  name: 'Lateral de Cajón',
  placement: 'interno',
  geometry: { kind: 'rectangular_board', lengthMm: 500, widthMm: 120, thicknessMm: 18, lengthFormula: 'PW', widthFormula: '120' },
  defaultEdges: edgesAll(true, false, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'i * (PW - T)',
  yFormula: '0',
  zFormula: '0',
  rotateX: 0,
  rotateY: 90,
  rotateZ: 0,
};
const compCajFrenteTras: Component = {
  id: 'comp-caj-frentetras',
  code: 'COM-CAJ-FTC',
  name: 'Frente/Tras Cajón',
  placement: 'interno',
  geometry: { kind: 'rectangular_board', lengthMm: 412, widthMm: 120, thicknessMm: 18, lengthFormula: 'PW - 88', widthFormula: '120' },
  defaultEdges: edgesAll(true, false, false, false),
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'T',
  yFormula: 'i * (PD - 120)',
  zFormula: '0',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};
const compCajFondo: Component = {
  id: 'comp-caj-fondo',
  code: 'COM-CAJ-FON',
  name: 'Fondo de Cajón',
  placement: 'trasera',
  geometry: { kind: 'rectangular_board', lengthMm: 500, widthMm: 442, thicknessMm: 3, lengthFormula: 'PW', widthFormula: 'PW - 58' },
  defaultEdges: edgesAll(false, false, false, false),
  optionRoles: ['FONDO'],
  active: true,
  xFormula: '29',
  yFormula: '0',
  zFormula: '0',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
};

/** Bodies (structures) for the two seed modules. */
const structGab01: Structure = {
  id: 'struct-gab-01',
  code: 'EST-GAB-01',
  name: 'Cuerpo Gabinete 1 Puerta',
  externalDims: { width: 300, height: 720, depth: 590 },
  components: [
    { componentId: 'comp-gab-costado', quantity: 2 },
    { componentId: 'comp-gab-respaldo', quantity: 1 },
    { componentId: 'comp-gab-piso', quantity: 1 },
    { componentId: 'comp-gab-manguete', quantity: 2 },
  ],
  presets: [{ id: 'preset-gab-300', name: '300×720×590', width: 300, height: 720, depth: 590 }],
  active: true,
};
const structCaj01: Structure = {
  id: 'struct-caj-01',
  code: 'EST-CAJ-01',
  name: 'Cuerpo Cajonera 4 Cajones',
  externalDims: { width: 500, height: 720, depth: 590 },
  components: [
    { componentId: 'comp-caj-costado', quantity: 2 },
    { componentId: 'comp-caj-piso', quantity: 1 },
    { componentId: 'comp-caj-respaldo', quantity: 1 },
  ],
  presets: [{ id: 'preset-caj-500', name: '500×720×590', width: 500, height: 720, depth: 590 }],
  active: true,
};

// --- Composed module seed ---

export const seedComposedModule: Module = {
  id: 'seed-mod-comp-001',
  code: 'MOD-COMP-001',
  name: 'Gabinete Compuesto 600',
  externalDims: { width: 600, height: 720, depth: 560 },
  structureId: 'seed-struct-test',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 1 },
    { componentId: 'seed-comp-entrepano', quantity: 2 },
  ],
  // Commercial multi-size options for quote (#104). Base 600 remains the default size.
  presets: [
    { id: 'mod-preset-300', name: 'Ancho 300', width: 300, height: 720, depth: 560 },
    { id: 'mod-preset-400', name: 'Ancho 400', width: 400, height: 720, depth: 560 },
    { id: 'mod-preset-600', name: 'Ancho 600', width: 600, height: 720, depth: 560 },
  ],
  hardwareLines: [],
  notes: 'Mueble compuesto demo: estructura + puerta + entrepaños + presets 300/400/600',
};

/**
 * Valid structure fixture for seed/testing.
 *
 * Since F053 a Structure composes reusable Component instances instead of
 * carrying its own board parts. This fixture references the costado and base
 * components so the structure contributes those pieces to composed modules.
 */
const SEED_STRUCTURE: Structure = {
  id: 'seed-struct-test',
  code: 'EST-COMP-600',
  name: 'Estructura Compuesta 600',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [
    { componentId: 'seed-comp-costado', quantity: 2 },
    { componentId: 'seed-comp-base', quantity: 1 },
  ],
  presets: [
    { id: 'preset-600', name: 'Ancho 600', width: 600, height: 720, depth: 560 },
  ],
  active: true,
};

export const plantillaCatalogWithModules: Catalog = {
  ...plantillaCatalog,
  modules: [modGab01, modCaj01, seedComposedModule],
  structures: [structGab01, structCaj01, SEED_STRUCTURE],
  components: [
    seedComponentPuerta,
    seedComponentEntrepano,
    seedComponentCostado,
    seedComponentBase,
    compGabCostado,
    compGabRespaldo,
    compGabPiso,
    compGabManguete,
    compGabPuerta,
    compGabEntrepano,
    compCajCostado,
    compCajPiso,
    compCajRespaldo,
    compCajFrente,
    compCajLateral,
    compCajFrenteTras,
    compCajFondo,
  ],
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
