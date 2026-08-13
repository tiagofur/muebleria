/**
 * Seed fixture for F076 (Onboarding + Demo Comercial).
 * Contains the "Cocina López" (full L-shaped kitchen with 4 base + 4 wall cabinets + island + plinth)
 * and an expanded catalog of 15+ Latin American workshop modules.
 */

import type {
  AmbientMaterial,
  Catalog,
  Module,
  Project,
  Structure,
} from '../types';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
} from './plantillaDemo';

// --- Ambient Materials Seed ---

export const seedAmbientMaterials: readonly AmbientMaterial[] = [
  {
    id: 'amb-floor-porcelanato',
    code: 'AMB-PIS-POR',
    name: 'Porcelanato Claro (Piso)',
    surfaceType: 'floor',
    previewColor: '#e5e0d8',
    active: true,
  },
  {
    id: 'amb-wall-yeso-blanco',
    code: 'AMB-MUR-BLA',
    name: 'Muro Blanco Marfil (Pared)',
    surfaceType: 'wall',
    previewColor: '#f8f6f0',
    active: true,
  },
];

// --- Additional LatAm Modules ---

export const modBajo800: Module = {
  id: 'mod-bajo-800',
  code: 'MOD-BAJO-800',
  name: 'Gabinete Bajo 2 Puertas 800 x 720 x 590 mm',
  externalDims: { width: 800, height: 720, depth: 590 },
  furnitureType: 'inferior',
  structureId: 'struct-gab-800',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 2 },
    { componentId: 'seed-comp-entrepano', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'b800-h01', quantity: 4, optionRole: 'BISAGRA' },
    { id: 'b800-h02', quantity: 2, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
    { id: 'b800-h03', quantity: 4, optionRole: 'FIXED', hardwareId: IDS.hwPata },
  ],
  presets: [
    { id: 'b800-p1', name: '800×720×590', width: 800, height: 720, depth: 590 },
  ],
};

export const modFregadero900: Module = {
  id: 'mod-freg-900',
  code: 'MOD-FREG-900',
  name: 'Gabinete Bajo Fregadero 900 x 720 x 590 mm',
  externalDims: { width: 900, height: 720, depth: 590 },
  furnitureType: 'inferior',
  structureId: 'struct-gab-900',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 2 },
  ],
  hardwareLines: [
    { id: 'freg-h01', quantity: 4, optionRole: 'BISAGRA' },
    { id: 'freg-h02', quantity: 2, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
    { id: 'freg-h03', quantity: 4, optionRole: 'FIXED', hardwareId: IDS.hwPata },
  ],
  presets: [
    { id: 'freg-p1', name: '900×720×590', width: 900, height: 720, depth: 590 },
  ],
};

export const modHorno600: Module = {
  id: 'mod-horno-600',
  code: 'MOD-HORNO-600',
  name: 'Gabinete Bajo para Horno 600 x 720 x 590 mm',
  externalDims: { width: 600, height: 720, depth: 590 },
  furnitureType: 'inferior',
  structureId: 'struct-gab-600',
  components: [
    { componentId: 'comp-caj-frente', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'horno-h01', quantity: 1, optionRole: 'CORREDERA' },
    { id: 'horno-h02', quantity: 1, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
    { id: 'horno-h03', quantity: 4, optionRole: 'FIXED', hardwareId: IDS.hwPata },
  ],
  presets: [
    { id: 'horno-p1', name: '600×720×590', width: 600, height: 720, depth: 590 },
  ],
};

export const modEsquineroL900: Module = {
  id: 'mod-esq-900',
  code: 'MOD-ESQ-900',
  name: 'Gabinete Bajo Esquinero L 900 x 720 x 900 mm',
  externalDims: { width: 900, height: 720, depth: 900 },
  furnitureType: 'inferior',
  structureId: 'struct-esq-900',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 2 },
    { componentId: 'seed-comp-entrepano', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'esq-h01', quantity: 4, optionRole: 'BISAGRA' },
    { id: 'esq-h02', quantity: 2, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
    { id: 'esq-h03', quantity: 5, optionRole: 'FIXED', hardwareId: IDS.hwPata },
  ],
  presets: [
    { id: 'esq-p1', name: '900×720×900', width: 900, height: 720, depth: 900 },
  ],
};

export const modCajonera3C: Module = {
  id: 'mod-caj-3c',
  code: 'MOD-CAJ-3C',
  name: 'Cajonera 3 Cajones (2+1 Cacerolero) 600 x 720 x 590 mm',
  externalDims: { width: 600, height: 720, depth: 590 },
  furnitureType: 'inferior',
  structureId: 'struct-caj-600',
  components: [
    { componentId: 'comp-caj-frente', quantity: 3 },
    { componentId: 'comp-caj-lateral', quantity: 6 },
    { componentId: 'comp-caj-frentetras', quantity: 3 },
    { componentId: 'comp-caj-fondo', quantity: 3 },
  ],
  hardwareLines: [
    { id: 'c3c-h01', quantity: 3, optionRole: 'CORREDERA' },
    { id: 'c3c-h02', quantity: 3, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
    { id: 'c3c-h03', quantity: 4, optionRole: 'FIXED', hardwareId: IDS.hwPata },
  ],
  presets: [
    { id: 'c3c-p1', name: '600×720×590', width: 600, height: 720, depth: 590 },
  ],
};

export const modAlacena800: Module = {
  id: 'mod-ala-800',
  code: 'MOD-ALA-800',
  name: 'Alacena Superior 2 Puertas 800 x 720 x 320 mm',
  externalDims: { width: 800, height: 720, depth: 320 },
  furnitureType: 'superior',
  structureId: 'struct-alacena-800',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 2 },
    { componentId: 'seed-comp-entrepano', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'a800-h01', quantity: 4, optionRole: 'BISAGRA' },
    { id: 'a800-h02', quantity: 2, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
  ],
  presets: [
    { id: 'a800-p1', name: '800×720×320', width: 800, height: 720, depth: 320 },
  ],
};

export const modAlacenaCampana: Module = {
  id: 'mod-ala-camp',
  code: 'MOD-ALA-CAMP',
  name: 'Alacena Sobrecampana 600 x 400 x 320 mm',
  externalDims: { width: 600, height: 400, depth: 320 },
  furnitureType: 'superior',
  structureId: 'struct-alacena-400',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'acamp-h01', quantity: 2, optionRole: 'BISAGRA' },
    { id: 'acamp-h02', quantity: 1, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
  ],
  presets: [
    { id: 'acamp-p1', name: '600×400×320', width: 600, height: 400, depth: 320 },
  ],
};

export const modAlacenaEsquinera: Module = {
  id: 'mod-ala-esq',
  code: 'MOD-ALA-ESQ',
  name: 'Alacena Esquinera 600 x 720 x 600 mm',
  externalDims: { width: 600, height: 720, depth: 600 },
  furnitureType: 'superior',
  structureId: 'struct-alacena-esq',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 1 },
    { componentId: 'seed-comp-entrepano', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'aesq-h01', quantity: 2, optionRole: 'BISAGRA' },
    { id: 'aesq-h02', quantity: 1, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
  ],
  presets: [
    { id: 'aesq-p1', name: '600×720×600', width: 600, height: 720, depth: 600 },
  ],
};

export const modTorreHorno: Module = {
  id: 'mod-torre-horno',
  code: 'MOD-TORRE-HORNO',
  name: 'Torre Horno y Microondas 600 x 2100 x 600 mm',
  externalDims: { width: 600, height: 2100, depth: 600 },
  furnitureType: 'alto',
  structureId: 'struct-despensa-600',
  components: [
    { componentId: 'seed-comp-puerta', quantity: 2 },
    { componentId: 'comp-caj-frente', quantity: 1 },
  ],
  hardwareLines: [
    { id: 'thorno-h01', quantity: 4, optionRole: 'BISAGRA' },
    { id: 'thorno-h02', quantity: 1, optionRole: 'CORREDERA' },
    { id: 'thorno-h03', quantity: 3, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
  ],
  presets: [
    { id: 'thorno-p1', name: '600×2100×600', width: 600, height: 2100, depth: 600 },
  ],
};

export const modIslaCentral: Module = {
  id: 'mod-isla-1200',
  code: 'MOD-ISLA-1200',
  name: 'Módulo Isla Central 1200 x 860 x 700 mm',
  externalDims: { width: 1200, height: 860, depth: 700 },
  furnitureType: 'inferior',
  structureId: 'struct-isla-1200',
  components: [
    { componentId: 'comp-caj-frente', quantity: 4 },
    { componentId: 'seed-comp-puerta', quantity: 2 },
  ],
  hardwareLines: [
    { id: 'isla-h01', quantity: 4, optionRole: 'CORREDERA' },
    { id: 'isla-h02', quantity: 4, optionRole: 'BISAGRA' },
    { id: 'isla-h03', quantity: 6, optionRole: 'FIXED', hardwareId: IDS.hwJaladera },
  ],
  presets: [
    { id: 'isla-p1', name: '1200×860×700', width: 1200, height: 860, depth: 700 },
  ],
};

// Additional Structures for modules above
const structGab800: Structure = {
  id: 'struct-gab-800',
  code: 'EST-GAB-800',
  name: 'Cuerpo Gabinete 800',
  externalDims: { width: 800, height: 720, depth: 590 },
  components: [
    { componentId: 'comp-gab-costado', quantity: 2 },
    { componentId: 'comp-gab-respaldo', quantity: 1 },
    { componentId: 'comp-gab-piso', quantity: 1 },
  ],
  presets: [{ id: 'pr-g800', name: '800×720×590', width: 800, height: 720, depth: 590 }],
  active: true,
};

const structGab900: Structure = {
  id: 'struct-gab-900',
  code: 'EST-GAB-900',
  name: 'Cuerpo Gabinete 900',
  externalDims: { width: 900, height: 720, depth: 590 },
  components: [
    { componentId: 'comp-gab-costado', quantity: 2 },
    { componentId: 'comp-gab-respaldo', quantity: 1 },
    { componentId: 'comp-gab-piso', quantity: 1 },
  ],
  presets: [{ id: 'pr-g900', name: '900×720×590', width: 900, height: 720, depth: 590 }],
  active: true,
};

const structGab600: Structure = {
  id: 'struct-gab-600',
  code: 'EST-GAB-600',
  name: 'Cuerpo Gabinete 600',
  externalDims: { width: 600, height: 720, depth: 590 },
  components: [
    { componentId: 'comp-gab-costado', quantity: 2 },
    { componentId: 'comp-gab-respaldo', quantity: 1 },
    { componentId: 'comp-gab-piso', quantity: 1 },
  ],
  presets: [{ id: 'pr-g600', name: '600×720×590', width: 600, height: 720, depth: 590 }],
  active: true,
};

const structEsq900: Structure = {
  id: 'struct-esq-900',
  code: 'EST-ESQ-900',
  name: 'Cuerpo Esquinero 900',
  externalDims: { width: 900, height: 720, depth: 900 },
  components: [
    { componentId: 'comp-gab-costado', quantity: 2 },
    { componentId: 'comp-gab-piso', quantity: 1 },
  ],
  presets: [{ id: 'pr-esq900', name: '900×720×900', width: 900, height: 720, depth: 900 }],
  active: true,
};

const structCaj600: Structure = {
  id: 'struct-caj-600',
  code: 'EST-CAJ-600',
  name: 'Cuerpo Cajonera 600',
  externalDims: { width: 600, height: 720, depth: 590 },
  components: [
    { componentId: 'comp-caj-costado', quantity: 2 },
    { componentId: 'comp-caj-piso', quantity: 1 },
  ],
  presets: [{ id: 'pr-caj600', name: '600×720×590', width: 600, height: 720, depth: 590 }],
  active: true,
};

const structAlacena800: Structure = {
  id: 'struct-alacena-800',
  code: 'EST-ALA-800',
  name: 'Cuerpo Alacena 800',
  externalDims: { width: 800, height: 720, depth: 320 },
  components: [
    { componentId: 'comp-alacena-costado', quantity: 2 },
    { componentId: 'comp-alacena-base', quantity: 1 },
  ],
  presets: [{ id: 'pr-ala800', name: '800×720×320', width: 800, height: 720, depth: 320 }],
  active: true,
};

const structAlacena400: Structure = {
  id: 'struct-alacena-400',
  code: 'EST-ALA-400',
  name: 'Cuerpo Alacena 400',
  externalDims: { width: 600, height: 400, depth: 320 },
  components: [
    { componentId: 'comp-alacena-costado', quantity: 2 },
    { componentId: 'comp-alacena-base', quantity: 1 },
  ],
  presets: [{ id: 'pr-ala400', name: '600×400×320', width: 600, height: 400, depth: 320 }],
  active: true,
};

const structAlacenaEsq: Structure = {
  id: 'struct-alacena-esq',
  code: 'EST-ALA-ESQ',
  name: 'Cuerpo Alacena Esquinera',
  externalDims: { width: 600, height: 720, depth: 600 },
  components: [
    { componentId: 'comp-alacena-costado', quantity: 2 },
    { componentId: 'comp-alacena-base', quantity: 1 },
  ],
  presets: [{ id: 'pr-alaesq', name: '600×720×600', width: 600, height: 720, depth: 600 }],
  active: true,
};

const structIsla1200: Structure = {
  id: 'struct-isla-1200',
  code: 'EST-ISLA-1200',
  name: 'Cuerpo Isla 1200',
  externalDims: { width: 1200, height: 860, depth: 700 },
  components: [
    { componentId: 'comp-gab-costado', quantity: 2 },
    { componentId: 'comp-gab-piso', quantity: 1 },
  ],
  presets: [{ id: 'pr-isla1200', name: '1200×860×700', width: 1200, height: 860, depth: 700 }],
  active: true,
};

/** Expanded Catalog containing 17 Latin American workshop modules */
export const seedCatalogExpandedLatAm: Catalog = {
  ...plantillaCatalogWithModules,
  ambientMaterials: seedAmbientMaterials,
  modules: [
    ...plantillaCatalogWithModules.modules,
    modBajo800,
    modFregadero900,
    modHorno600,
    modEsquineroL900,
    modCajonera3C,
    modAlacena800,
    modAlacenaCampana,
    modAlacenaEsquinera,
    modTorreHorno,
    modIslaCentral,
  ],
  structures: [
    ...(plantillaCatalogWithModules.structures ?? []),
    structGab800,
    structGab900,
    structGab600,
    structEsq900,
    structCaj600,
    structAlacena800,
    structAlacena400,
    structAlacenaEsq,
    structIsla1200,
  ],
};

/**
 * Creates the "Cocina López" demo project:
 * A full L-shaped kitchen layout (4 base cabinets, 4 wall cabinets, island, plinths)
 * pre-placed in 3D space with ambient materials (tile floor, ivory wall).
 */
export function createCocinaLopezDemoProject(): Project {
  const itemBajo800Id = 'item-lopez-bajo-800';
  const itemCajoneraId = 'item-lopez-cajonera-3c';
  const itemEsquineroId = 'item-lopez-esquinero-900';
  const itemFregaderoId = 'item-lopez-fregadero-900';

  const itemAlacena800Id = 'item-lopez-alacena-800';
  const itemAlacena600Id = 'item-lopez-alacena-600';
  const itemAlacenaCampanaId = 'item-lopez-alacena-campana';
  const itemAlacenaEsqId = 'item-lopez-alacena-esq';

  const itemIslaId = 'item-lopez-isla';
  const itemDespensaId = 'item-lopez-despensa';

  return {
    id: 'proj-cocina-lopez-demo',
    name: 'Cocina López (Proyecto Demo L-Shaped 3D)',
    customerId: IDS.custPlantilla2,
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 1500,
    status: 'accepted',
    items: [
      {
        id: itemBajo800Id,
        moduleId: 'mod-bajo-800',
        measurePresetId: 'b800-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemCajoneraId,
        moduleId: 'mod-caj-3c',
        measurePresetId: 'c3c-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemEsquineroId,
        moduleId: 'mod-esq-900',
        measurePresetId: 'esq-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemFregaderoId,
        moduleId: 'mod-freg-900',
        measurePresetId: 'freg-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemAlacena800Id,
        moduleId: 'mod-ala-800',
        measurePresetId: 'a800-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemAlacena600Id,
        moduleId: 'seed-mod-alacena-001',
        measurePresetId: 'ala-preset-600',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemAlacenaCampanaId,
        moduleId: 'mod-ala-camp',
        measurePresetId: 'acamp-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemAlacenaEsqId,
        moduleId: 'mod-ala-esq',
        measurePresetId: 'aesq-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemIslaId,
        moduleId: 'mod-isla-1200',
        measurePresetId: 'isla-p1',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
      {
        id: itemDespensaId,
        moduleId: 'seed-mod-despensa-001',
        measurePresetId: 'des-preset-2100',
        quantity: 1,
        optionChoices: plantillaChoices,
      },
    ],
    kitchenLayout: {
      baseClearanceMm: 100,
      wallCabinetZMm: 1400,
      showCountertop: true,
      floorMaterialId: 'amb-floor-porcelanato',
      wallMaterialId: 'amb-wall-yeso-blanco',
      walls: [
        {
          id: 'wall-main',
          name: 'Muro Principal',
          lengthMm: 3600,
          angleDeg: 0,
          originXMm: 0,
          originYMm: 0,
        },
        {
          id: 'wall-return',
          name: 'Muro Retorno',
          lengthMm: 2400,
          angleDeg: 90,
          originXMm: 3600,
          originYMm: 0,
        },
      ],
      placements: [
        // Base line on Wall Main
        {
          itemId: itemBajo800Id,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 100,
          elevation: 'floor',
        },
        {
          itemId: itemCajoneraId,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 900,
          elevation: 'floor',
        },
        {
          itemId: itemEsquineroId,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 1500,
          elevation: 'floor',
        },
        // Return line on Wall Return
        {
          itemId: itemFregaderoId,
          instanceIndex: 0,
          wallId: 'wall-return',
          offsetMm: 1000,
          elevation: 'floor',
        },
        // Wall cabinets on Wall Main
        {
          itemId: itemAlacena800Id,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 100,
          elevation: 'wall',
        },
        {
          itemId: itemAlacena600Id,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 900,
          elevation: 'wall',
        },
        {
          itemId: itemAlacenaCampanaId,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 1500,
          elevation: 'wall',
        },
        {
          itemId: itemAlacenaEsqId,
          instanceIndex: 0,
          wallId: 'wall-main',
          offsetMm: 2100,
          elevation: 'wall',
        },
        // Tall pantry at the start of Wall Return
        {
          itemId: itemDespensaId,
          instanceIndex: 0,
          wallId: 'wall-return',
          offsetMm: 200,
          elevation: 'floor',
        },
        // Central Island (Free Placement in room)
        {
          itemId: itemIslaId,
          instanceIndex: 0,
          wallId: '',
          mode: 'free',
          freeXMm: 1600,
          freeYMm: 1400,
          freeYawDeg: 0,
          offsetMm: 0,
          elevation: 'floor',
        },
      ],
    },
    notes:
      'Proyecto Semilla Demo Comercial — Cocina en L completa con Isla Central, ambientación de piso porcelanato y muros blanco marfil.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
