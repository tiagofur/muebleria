import { describe, expect, it } from 'vitest';
import partOperationTypesContract from '../../../contracts/partOperationTypes.json';
import moduleUnitStatusesContract from '../../../contracts/moduleUnitStatuses.json';
import {
  advanceModuleUnitStatus,
  advancePartOperation,
  aggregateAssemblyReadiness,
  canTransitionModuleUnitStatus,
  checkAssemblyReadiness,
  nextModuleUnitStatus,
  recordSupervisorAssemblyOverride,
  partsWaitingForSector,
  unitsWaitingForSector,
  deriveLegacyItemFloorStatus,
  deriveModuleUnitsForProject,
  derivePartInstancesForProject,
  describeMissingPieces,
  physicalStationQueue,
  isModuleUnitStatus,
  isPartOperationStatus,
  isPartOperationType,
  MODULE_UNIT_STATUSES,
  PART_OPERATION_STATUSES,
  PART_OPERATION_TYPES,
  resolvePartRequiredOperations,
  triggerPartRework,
} from './partExecution';
import type { Project, ResolvedBoardPart } from './types';

describe('partExecution — Domain Contract Parity (OC-030..OC-033)', () => {
  it('matches partOperationTypes contract fixture exactly', () => {
    expect([...PART_OPERATION_TYPES]).toEqual(partOperationTypesContract.operationTypes);
    expect([...PART_OPERATION_STATUSES]).toEqual(partOperationTypesContract.operationStatuses);

    for (const valid of partOperationTypesContract.operationTypes) {
      expect(isPartOperationType(valid)).toBe(true);
    }
    for (const invalid of partOperationTypesContract.rejectedOperationTypes) {
      expect(isPartOperationType(invalid)).toBe(false);
    }

    for (const valid of partOperationTypesContract.operationStatuses) {
      expect(isPartOperationStatus(valid)).toBe(true);
    }
    for (const invalid of partOperationTypesContract.rejectedOperationStatuses) {
      expect(isPartOperationStatus(invalid)).toBe(false);
    }
  });

  it('matches moduleUnitStatuses contract fixture exactly', () => {
    expect([...MODULE_UNIT_STATUSES]).toEqual(moduleUnitStatusesContract.unitStatuses);

    for (const valid of moduleUnitStatusesContract.unitStatuses) {
      expect(isModuleUnitStatus(valid)).toBe(true);
    }
    for (const invalid of moduleUnitStatusesContract.rejectedUnitStatuses) {
      expect(isModuleUnitStatus(invalid)).toBe(false);
    }
  });
});

describe('partExecution — Routing & Dynamic Operation Resolution (OC-031)', () => {
  const basePart: ResolvedBoardPart = {
    id: 'part-1',
    code: 'LAT-IZQ',
    description: 'Lateral Izquierdo',
    quantity: 1,
    lengthMm: 700,
    widthMm: 500,
    thicknessMm: 18,
    grain: 1,
    materialId: 'mat-melamina',
    optionRole: 'structural',
    edges: [],
  };

  it('generates only cut operation when part has no machining and no edges', () => {
    const ops = resolvePartRequiredOperations(basePart, false);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('cut');
    expect(ops[0]!.status).toBe('queued');
  });

  it('generates cut -> edge_banding when part has edges but no machining', () => {
    const edgedPart: ResolvedBoardPart = {
      ...basePart,
      edges: [{ side: 'L1', enabled: true }],
    };
    const ops = resolvePartRequiredOperations(edgedPart, false);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.type).toBe('cut');
    expect(ops[1]!.type).toBe('edge_banding');
  });

  it('generates cut -> cnc -> edge_banding when part has both machining and edges', () => {
    const cncAndEdgedPart: ResolvedBoardPart = {
      ...basePart,
      edges: [{ side: 'L1', enabled: true }],
    };
    const ops = resolvePartRequiredOperations(cncAndEdgedPart, true);
    expect(ops).toHaveLength(3);
    expect(ops[0]!.type).toBe('cut');
    expect(ops[1]!.type).toBe('cnc');
    expect(ops[2]!.type).toBe('edge_banding');
  });
});

describe('partExecution — Derivation from Project & Items Expansion (OC-030, OC-033)', () => {
  const sampleProject: Project = {
    id: 'proj-123',
    name: 'Cocina Moderna',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    createdAt: '2026-08-21T10:00:00Z',
    status: 'produced',
    items: [
      {
        id: 'item-1',
        moduleId: 'mod-bajo',
        quantity: 2, // 2 physical units
        optionChoices: {},
      },
    ],
    updatedAt: '2026-08-21T10:00:00Z',
  };

  const sampleParts: readonly ResolvedBoardPart[] = [
    {
      id: 'p-lat',
      code: 'LAT',
      description: 'Lateral',
      quantity: 2, // 2 laterals per unit
      lengthMm: 700,
      widthMm: 500,
      thicknessMm: 18,
      grain: 0,
      materialId: 'mat-1',
      optionRole: 'structural',
      edges: [{ side: 'L1', enabled: true }],
    },
    {
      id: 'p-piso',
      code: 'PISO',
      description: 'Piso',
      quantity: 1, // 1 floor per unit
      lengthMm: 600,
      widthMm: 500,
      thicknessMm: 18,
      grain: 0,
      materialId: 'mat-1',
      optionRole: 'structural',
      edges: [],
    },
  ];

  it('derives correct number of ModuleUnits for quantity > 1', () => {
    const units = deriveModuleUnitsForProject(sampleProject);
    expect(units).toHaveLength(2);
    expect(units[0]!.unitIndex).toBe(1);
    expect(units[1]!.unitIndex).toBe(2);
    expect(units[0]!.status).toBe('awaiting_parts');
  });

  it('derives all discrete PartInstances with unique IDs and routes', () => {
    const parts = derivePartInstancesForProject(sampleProject, {
      'item-1': sampleParts,
    });
    // 2 units * (2 laterals + 1 floor) = 6 physical parts
    expect(parts).toHaveLength(6);

    const u1Parts = parts.filter((p) => p.unitIndex === 1);
    const u2Parts = parts.filter((p) => p.unitIndex === 2);
    expect(u1Parts).toHaveLength(3);
    expect(u2Parts).toHaveLength(3);

    // Each part has unique ID
    const ids = new Set(parts.map((p) => p.id));
    expect(ids.size).toBe(6);
  });
});

describe('partExecution — Advance, Gate de Armado & Rework (OC-032, OC-061)', () => {
  const sampleProject: Project = {
    id: 'proj-123',
    name: 'Obra 1',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    createdAt: '2026-08-21T10:00:00Z',
    status: 'produced',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    updatedAt: '2026-08-21T10:00:00Z',
  };

  const sampleParts: readonly ResolvedBoardPart[] = [
    {
      id: 'p-lat',
      code: 'LAT',
      description: 'Lateral',
      quantity: 1,
      lengthMm: 700,
      widthMm: 500,
      thicknessMm: 18,
      grain: 0,
      materialId: 'mat-1',
      optionRole: 'structural',
      edges: [{ side: 'L1', enabled: true }],
    },
    {
      id: 'p-tras',
      code: 'TRAS',
      description: 'Trasera',
      quantity: 1,
      lengthMm: 700,
      widthMm: 600,
      thicknessMm: 6,
      grain: 0,
      materialId: 'mat-fondo',
      optionRole: 'back',
      edges: [],
    },
  ];

  it('advances operations until part is ready_for_assembly', () => {
    const [latPart] = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts }, {
      hasMachiningForPart: () => true,
    });
    expect(latPart!.status).toBe('pending');
    expect(latPart!.requiredOperations).toHaveLength(3); // cut, cnc, edge_banding

    // Step 1: Cut
    const afterCut = advancePartOperation(latPart!, 'cut', { operatorName: 'Juan' });
    expect(afterCut.status).toBe('in_progress');
    expect(afterCut.requiredOperations[0]!.status).toBe('completed');
    expect(afterCut.requiredOperations[0]!.operatorName).toBe('Juan');

    // Step 2: CNC
    const afterCnc = advancePartOperation(afterCut, 'cnc');
    expect(afterCnc.status).toBe('in_progress');
    expect(afterCnc.requiredOperations[1]!.status).toBe('completed');

    // Step 3: Edge Banding
    const afterEdge = advancePartOperation(afterCnc, 'edge_banding');
    expect(afterEdge.status).toBe('ready_for_assembly');
    expect(afterEdge.requiredOperations[2]!.status).toBe('completed');
  });

  it('checks assembly readiness and prevents assembly when parts are missing', () => {
    const units = deriveModuleUnitsForProject(sampleProject);
    const parts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts });
    const unit1 = units[0]!;

    // Initial: 0 parts ready
    const initialCheck = checkAssemblyReadiness(unit1, parts);
    expect(initialCheck.isReady).toBe(false);
    expect(initialCheck.readyPieces).toBe(0);
    expect(initialCheck.totalPieces).toBe(2);
    expect(initialCheck.missingPieces).toHaveLength(2);

    // 1 part cut & ready (trasera has only cut)
    const tras = parts.find((p) => p.partCode === 'TRAS')!;
    const trasDone = advancePartOperation(tras, 'cut');

    const updatedParts = parts.map((p) => (p.id === tras.id ? trasDone : p));
    const partialCheck = checkAssemblyReadiness(unit1, updatedParts);
    expect(partialCheck.isReady).toBe(false);
    expect(partialCheck.readyPieces).toBe(1);
    expect(partialCheck.missingPieces).toHaveLength(1);
    expect(partialCheck.missingPieces[0]!.partCode).toBe('LAT');

    // All parts ready
    const lat = parts.find((p) => p.partCode === 'LAT')!;
    const latCut = advancePartOperation(lat, 'cut');
    const latEdge = advancePartOperation(latCut, 'edge_banding');

    const allDoneParts = updatedParts.map((p) => (p.id === lat.id ? latEdge : p));
    const finalCheck = checkAssemblyReadiness(unit1, allDoneParts);
    expect(finalCheck.isReady).toBe(true);
    expect(finalCheck.readyPieces).toBe(2);
    expect(finalCheck.missingPieces).toHaveLength(0);
  });

  it('advances unit status through physical assembly stages', () => {
    const [unit] = deriveModuleUnitsForProject(sampleProject);
    expect(unit!.status).toBe('awaiting_parts');

    const inAssembly = advanceModuleUnitStatus(unit!, 'assembly');
    expect(inAssembly.status).toBe('assembly');
    expect(inAssembly.assembledAt).toBeDefined();

    const inQc = advanceModuleUnitStatus(inAssembly, 'module_qc');
    expect(inQc.status).toBe('module_qc');
    expect(inQc.qcPassedAt).toBeDefined();

    const packaged = advanceModuleUnitStatus(inQc, 'packaged');
    expect(packaged.status).toBe('packaged');
    expect(packaged.packagedAt).toBeDefined();
  });

  it('triggers piece rework and refabrication properly', () => {
    const parts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts });
    const lat = parts.find((p) => p.partCode === 'LAT')!;
    const latCut = advancePartOperation(lat, 'cut');
    const latEdge = advancePartOperation(latCut, 'edge_banding');
    expect(latEdge.status).toBe('ready_for_assembly');

    // Rework edge banding
    const reworked = triggerPartRework(latEdge, 'rework', 'Canto despegado', 'edge_banding');
    expect(reworked.status).toBe('in_progress');
    const edgeOp = reworked.requiredOperations.find((op) => op.type === 'edge_banding')!;
    expect(edgeOp.status).toBe('rework');

    // Full refabrication
    const refab = triggerPartRework(latEdge, 'refabricate', 'Pieza partida en armado');
    expect(refab.status).toBe('pending');
    expect(refab.requiredOperations[0]!.status).toBe('queued');
  });

  it('derives legacy ItemFloorStatus backward-compatibly', () => {
    const units = deriveModuleUnitsForProject(sampleProject);
    const parts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts });

    expect(deriveLegacyItemFloorStatus(units, parts)).toBe('pending');

    // All parts cut
    const partsCut = parts.map((p) => advancePartOperation(p, 'cut'));
    expect(deriveLegacyItemFloorStatus(units, partsCut)).toBe('cut');

    // All parts ready for assembly
    const partsEdged = partsCut.map((p) =>
      p.requiredOperations.some((op) => op.type === 'edge_banding')
        ? advancePartOperation(p, 'edge_banding')
        : p,
    );
    expect(deriveLegacyItemFloorStatus(units, partsEdged)).toBe('edged');

    // Unit in assembly
    const unitAssembled = advanceModuleUnitStatus(units[0]!, 'assembly');
    expect(deriveLegacyItemFloorStatus([unitAssembled], partsEdged)).toBe('assembled');

    // Unit passes QC, then packaged
    const unitQc = advanceModuleUnitStatus(unitAssembled, 'module_qc');
    const unitPackaged = advanceModuleUnitStatus(unitQc, 'packaged');
    expect(deriveLegacyItemFloorStatus([unitPackaged], partsEdged)).toBe('packaged');

    // Unit loaded
    const unitLoaded = advanceModuleUnitStatus(unitPackaged, 'loaded');
    expect(deriveLegacyItemFloorStatus([unitLoaded], partsEdged)).toBe('loaded');

    // Unit installed
    const unitInstalled = advanceModuleUnitStatus(unitLoaded, 'installed');
    expect(deriveLegacyItemFloorStatus([unitInstalled], partsEdged)).toBe('installed');
  });

  it('supports supervisor assembly override when parts are missing', () => {
    const units = deriveModuleUnitsForProject(sampleProject);
    const parts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts });
    const unit1 = units[0]!;

    const checkBefore = checkAssemblyReadiness(unit1, parts);
    expect(checkBefore.isReady).toBe(false);
    expect(checkBefore.canStartWithOverride).toBe(true);

    const overridden = recordSupervisorAssemblyOverride(
      unit1,
      'Frente llega mañana, armar estructura hoy',
      'user-supervisor',
      checkBefore.missingPieces.length,
    );

    const checkAfter = checkAssemblyReadiness(overridden, parts);
    expect(checkAfter.isReady).toBe(true);
    expect(checkAfter.hasOverride).toBe(true);
    expect(overridden.supervisorOverride?.reason).toBe('Frente llega mañana, armar estructura hoy');
    expect(overridden.supervisorOverride?.overriddenBy).toBe('user-supervisor');
  });

  it('filters station queues honestly between pieces (Cut/CNC/Edge) and units (Assembly+)', () => {
    const units = deriveModuleUnitsForProject(sampleProject);
    const parts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts }, {
      hasMachiningForPart: (p) => p.code === 'LAT',
    });

    // Cutting queue: both LAT and TRAS start queued for cutting
    const cuttingParts = partsWaitingForSector(parts, 'cutting');
    expect(cuttingParts).toHaveLength(2);

    const cncPartsInitial = partsWaitingForSector(parts, 'cnc');
    expect(cncPartsInitial).toHaveLength(0); // None cut yet

    // Advance LAT cut -> now in CNC queue
    const lat = parts.find((p) => p.partCode === 'LAT')!;
    const latCut = advancePartOperation(lat, 'cut');
    const partsAfterLatCut = parts.map((p) => (p.id === lat.id ? latCut : p));

    const cncParts = partsWaitingForSector(partsAfterLatCut, 'cnc');
    expect(cncParts).toHaveLength(1);
    expect(cncParts[0]!.partCode).toBe('LAT');

    // Assembly queue
    const assemblyUnits = unitsWaitingForSector(units, 'assembly');
    expect(assemblyUnits).toHaveLength(1);
  });
});

describe('partExecution — reglas físicas duras (secuencia, revisión, transiciones)', () => {
  const sampleProject: Project = {
    id: 'proj-123',
    name: 'Obra 1',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    createdAt: '2026-08-21T10:00:00Z',
    status: 'produced',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    updatedAt: '2026-08-21T10:00:00Z',
  };

  const sampleParts: readonly ResolvedBoardPart[] = [
    {
      id: 'p-lat',
      code: 'LAT',
      description: 'Lateral',
      quantity: 1,
      lengthMm: 700,
      widthMm: 500,
      thicknessMm: 18,
      grain: 0,
      materialId: 'mat-1',
      optionRole: 'structural',
      edges: [{ side: 'L1', enabled: true }],
    },
  ];

  it('rechaza completar una operación fuera de secuencia (edge antes de cut)', () => {
    const [lat] = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts }, {
      hasMachiningForPart: () => true,
    });
    expect(lat!.requiredOperations.map((op) => op.type)).toEqual(['cut', 'cnc', 'edge_banding']);

    // Intentar edge_banding con cut/cnc aún queued → sin cambios
    const skipped = advancePartOperation(lat!, 'edge_banding');
    expect(skipped).toBe(lat!);
    expect(skipped.requiredOperations[2]!.status).toBe('queued');

    // Intentar cnc antes de cut → sin cambios
    const cncEarly = advancePartOperation(lat!, 'cnc');
    expect(cncEarly).toBe(lat!);
  });

  it('bloquea el armado contra una revisión liberada distinta (stale revision)', () => {
    const units = deriveModuleUnitsForProject(sampleProject, { productionRevision: 'rev-1' });
    const parts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts }, {
      productionRevision: 'rev-1',
    });

    // Todo terminado, pero la revisión liberada cambió a rev-2
    const partsDone = parts.map((p) => {
      let current = advancePartOperation(p, 'cut');
      current = advancePartOperation(current, 'cnc');
      return advancePartOperation(current, 'edge_banding');
    });

    const stale = checkAssemblyReadiness(units[0]!, partsDone, { currentProductionRevision: 'rev-2' });
    expect(stale.isReady).toBe(false);
    expect(stale.canStartWithOverride).toBe(true);
    expect(stale.blockers[0]).toContain('rev-2');

    // Con la revisión correcta, la misma unidad está lista
    const fresh = checkAssemblyReadiness(units[0]!, partsDone, { currentProductionRevision: 'rev-1' });
    expect(fresh.isReady).toBe(true);

    // El override supervisor auditado desbloquea la revisión stale
    const overridden = recordSupervisorAssemblyOverride(units[0]!, 'Cambio menor no afecta estructuras', 'sup-1', 0);
    const afterOverride = checkAssemblyReadiness(overridden, partsDone, { currentProductionRevision: 'rev-2' });
    expect(afterOverride.isReady).toBe(true);
    expect(afterOverride.hasOverride).toBe(true);
  });

  it('cuenta piezas de una revisión anterior como faltantes', () => {
    const units = deriveModuleUnitsForProject(sampleProject, { productionRevision: 'rev-2' });
    const staleParts = derivePartInstancesForProject(sampleProject, { 'item-1': sampleParts }, {
      productionRevision: 'rev-1',
    });

    const check = checkAssemblyReadiness(units[0]!, staleParts, { currentProductionRevision: 'rev-2' });
    expect(check.isReady).toBe(false);
    expect(check.readyPieces).toBe(0);
    expect(check.missingPieces).toHaveLength(1);
    expect(check.blockers.join(' ')).toContain('revisión anterior');
  });

  it('valida la cadena de transiciones de unidades y rechaza saltos y retrocesos', () => {
    expect(canTransitionModuleUnitStatus('awaiting_parts', 'assembly')).toBe(true);
    expect(canTransitionModuleUnitStatus('module_qc', 'packaged')).toBe(true);
    // Saltos
    expect(canTransitionModuleUnitStatus('awaiting_parts', 'installed')).toBe(false);
    expect(canTransitionModuleUnitStatus('assembly', 'packaged')).toBe(false);
    // Retrocesos
    expect(canTransitionModuleUnitStatus('packaged', 'assembly')).toBe(false);
    expect(canTransitionModuleUnitStatus('installed', 'loaded')).toBe(false);

    expect(nextModuleUnitStatus('awaiting_parts')).toBe('assembly');
    expect(nextModuleUnitStatus('installed')).toBeNull();

    const [unit] = deriveModuleUnitsForProject(sampleProject);
    const jumped = advanceModuleUnitStatus(unit!, 'installed');
    expect(jumped.status).toBe('awaiting_parts');
    expect(jumped.installedAt).toBeUndefined();
  });

  it('agrega readiness de múltiples unidades: la línea sólo está lista cuando todas lo están', () => {
    const multiProject: Project = {
      ...sampleProject,
      items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 2, optionChoices: {} }],
    };
    const units = deriveModuleUnitsForProject(multiProject);
    const parts = derivePartInstancesForProject(multiProject, { 'item-1': sampleParts });

    // Unidad 1 completa, unidad 2 sin terminar
    const u1Parts = parts.map((p) => advancePartOperation(p, 'cut'));
    const withU1Done = u1Parts.map((p) =>
      p.unitIndex === 1 ? advancePartOperation(p, 'edge_banding') : p,
    );

    const aggregate = aggregateAssemblyReadiness(units, withU1Done);
    expect(aggregate.isReady).toBe(false);
    expect(aggregate.readyPieces).toBe(1);
    expect(aggregate.totalPieces).toBe(2);
    expect(aggregate.missingPieces).toHaveLength(1);

    const allDone = withU1Done.map((p) => advancePartOperation(p, 'edge_banding'));
    const aggregateDone = aggregateAssemblyReadiness(units, allDone);
    expect(aggregateDone.isReady).toBe(true);
    expect(aggregateDone.readyPieces).toBe(2);
  });
});

describe('partExecution — colas físicas por estación y piezas faltantes (#301)', () => {
  const multiProject: Project = {
    id: 'proj-phys',
    name: 'Obra Física',
    customerId: 'cust-1',
    currency: 'MXN',
    marginFactor: 1.2,
    laborFixedCost: 0,
    createdAt: '2026-08-21T10:00:00Z',
    status: 'produced',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 2, optionChoices: {} }],
    updatedAt: '2026-08-21T10:00:00Z',
  };

  const boardParts: readonly ResolvedBoardPart[] = [
    {
      id: 'p-lat', code: 'LAT', description: 'Lateral', quantity: 1,
      lengthMm: 700, widthMm: 500, thicknessMm: 18, grain: 0,
      materialId: 'mat-1', optionRole: 'structural',
      edges: [{ side: 'L1', enabled: true }],
    },
    {
      id: 'p-tras', code: 'TRAS', description: 'Trasera', quantity: 1,
      lengthMm: 700, widthMm: 600, thicknessMm: 6, grain: 0,
      materialId: 'mat-2', optionRole: 'back', edges: [],
    },
  ];

  it('physicalStationQueue devuelve piezas en corte/cnc/edge y unidades en armado+', () => {
    const parts = derivePartInstancesForProject(multiProject, { 'item-1': boardParts }, {
      hasMachiningForPart: (p) => p.code === 'LAT',
    });
    const units = deriveModuleUnitsForProject(multiProject);
    const project = { ...multiProject, partInstances: parts, moduleUnits: units };

    // Nada cortado aún: 4 piezas (2 unidades × LAT+TRAS) en corte
    const cutting = physicalStationQueue(project, 'cutting');
    expect(cutting).toHaveLength(4);
    expect(cutting.every((r) => r.kind === 'part')).toBe(true);

    // CNC vacío (nadie cortó aún)
    expect(physicalStationQueue(project, 'cnc')).toHaveLength(0);

    // Armado: 2 unidades awaiting, con readiness por unidad
    const assembly = physicalStationQueue(project, 'assembly');
    expect(assembly).toHaveLength(2);
    expect(assembly.every((r) => r.kind === 'unit')).toBe(true);

    // Sin instancias generadas → colas físicas vacías (flujo legacy)
    expect(physicalStationQueue(multiProject, 'cutting')).toHaveLength(0);
  });

  it('describeMissingPieces indica en qué estación está cada pieza faltante', () => {
    const parts = derivePartInstancesForProject(multiProject, { 'item-1': boardParts }, {
      hasMachiningForPart: (p) => p.code === 'LAT',
    });
    const units = deriveModuleUnitsForProject(multiProject);
    const project = { ...multiProject, partInstances: parts, moduleUnits: units };

    const assembly = physicalStationQueue(project, 'assembly');
    const unitRow = assembly.find((r) => r.kind === 'unit');
    expect(unitRow?.kind).toBe('unit');
    if (unitRow?.kind !== 'unit') return;

    const missing = describeMissingPieces(unitRow.readiness);
    expect(missing).toHaveLength(2);
    const lat = missing.find((m) => m.partCode === 'LAT');
    const tras = missing.find((m) => m.partCode === 'TRAS');
    expect(lat?.sector).toBe('cutting');
    expect(tras?.sector).toBe('cutting');
  });
});
