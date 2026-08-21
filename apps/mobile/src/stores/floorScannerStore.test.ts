import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFloorScannerStore } from './floorScannerStore';
import { pieceLabelQrPayload } from '@muebles/domain';

// Mock expo-haptics (non-native test env)
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

const postMock = vi.fn();
const patchMock = vi.fn();
vi.mock('../services/apiClient', () => ({
  apiClient: {
    post: (...args: unknown[]) => postMock(...args),
    get: vi.fn(),
    put: vi.fn(),
    patch: (...args: unknown[]) => patchMock(...args),
    delete: vi.fn(),
  },
}));

const qrFor = (moduleCode = 'GAB-01') =>
  pieceLabelQrPayload({
    projectId: 'p1',
    moduleCode,
    description: 'Costado',
    materialCode: 'TAB-1',
    lengthMm: 720,
    widthMm: 560,
  });

const apiResponse = (over: Partial<Record<string, string>> = {}) => ({
  project_id: 'p1',
  project_name: 'Cocina López',
  item_id: 'i1',
  factory_code: 'GAB-01',
  module_code: 'GAB-01',
  module_name: 'Gabinete base',
  status_before: 'pending',
  status_after: 'cut',
  next_status: 'edged',
  ...over,
});

describe('floorScannerStore Mobile (server-backed, F089-RN)', () => {
  beforeEach(() => {
    useFloorScannerStore.setState({
      history: [],
      activeScan: null,
      itemStatuses: {},
      pendingScans: [],
      activeProjectId: null,
      autoAdvance: true,
      syncing: false,
      lastScanTime: 0,
      lastScannedText: null,
    });
    postMock.mockReset();
    patchMock.mockReset();
  });

  it('resuelve el escaneo contra el endpoint floor-scan y auto-avanza', async () => {
    postMock.mockResolvedValueOnce(apiResponse());
    const record = await useFloorScannerStore.getState().processScan(qrFor());

    expect(postMock).toHaveBeenCalledWith('/projects/p1/floor-scan', {
      module: 'GAB-01',
      advance: true,
    });
    expect(record?.resolution).toMatchObject({
      projectId: 'p1',
      projectName: 'Cocina López',
      itemId: 'i1',
      statusAfter: 'cut',
      nextStatus: 'edged',
    });
    expect(record?.currentStatus).toBe('cut');
    expect(useFloorScannerStore.getState().itemStatuses['i1']).toBe('cut');
  });

  it('sin auto-avance hace lookup sin escribir', async () => {
    useFloorScannerStore.setState({ autoAdvance: false });
    postMock.mockResolvedValueOnce(
      apiResponse({ status_after: 'pending', next_status: 'cut' }),
    );
    const record = await useFloorScannerStore.getState().processScan(qrFor());

    expect(postMock).toHaveBeenCalledWith('/projects/p1/floor-scan', {
      module: 'GAB-01',
      advance: false,
    });
    expect(record?.resolution?.statusAfter).toBe('pending');
  });

  it('código plano sin obra activa → error visible y sin llamada', async () => {
    const record = await useFloorScannerStore.getState().processScan('GAB-01');
    expect(postMock).not.toHaveBeenCalled();
    expect(record?.error).toContain('obra');
  });

  it('código plano CON obra activa resuelve contra esa obra', async () => {
    useFloorScannerStore.setState({ activeProjectId: 'p9' });
    postMock.mockResolvedValueOnce(apiResponse());
    await useFloorScannerStore.getState().processScan('GAB-01-L2');
    expect(postMock).toHaveBeenCalledWith('/projects/p9/floor-scan', {
      module: 'GAB-01-L2',
      advance: true,
    });
  });

  it('fallo de red → cola offline con avance optimista', async () => {
    postMock.mockRejectedValueOnce(
      new Error('Error de red al conectar con el servidor: sin cobertura'),
    );
    const record = await useFloorScannerStore.getState().processScan(qrFor());

    expect(record?.error).toContain('Sin conexión');
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(1);
    // Optimistic advance: pending → cut locally
    expect(record?.currentStatus).toBe('cut');
  });

  it('error de dominio (404 módulo) NO se encola', async () => {
    postMock.mockRejectedValueOnce(new Error('módulo no encontrado en esta obra'));
    const record = await useFloorScannerStore.getState().processScan(qrFor());
    expect(record?.error).toContain('módulo no encontrado');
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);
  });

  it('syncPending drena la cola cuando vuelve la conexión', async () => {
    useFloorScannerStore.setState({
      pendingScans: [{ rawText: qrFor(), advance: true, at: new Date().toISOString() }],
    });
    postMock.mockResolvedValueOnce(apiResponse());
    await useFloorScannerStore.getState().syncPending();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);
  });

  it('advanceScan avanza explícitamente y actualiza el registro', async () => {
    postMock.mockResolvedValueOnce(apiResponse());
    const record = await useFloorScannerStore.getState().processScan(qrFor());
    postMock.mockResolvedValueOnce(
      apiResponse({ status_before: 'cut', status_after: 'edged', next_status: 'assembled' }),
    );
    await useFloorScannerStore.getState().advanceScan(record!);

    const updated = useFloorScannerStore.getState().activeScan;
    expect(updated?.resolution?.statusAfter).toBe('edged');
    expect(updated?.currentStatus).toBe('edged');
  });

  it('debounce: ignora lecturas duplicadas idénticas recibidas en menos de 800ms', async () => {
    postMock.mockResolvedValueOnce(apiResponse());
    const qr = qrFor('MOD-DEBOUNCE');
    const first = await useFloorScannerStore.getState().processScan(qr);
    expect(postMock).toHaveBeenCalledTimes(1);

    // Immediate second scan of the same QR (e.g. video frame spam)
    const second = await useFloorScannerStore.getState().processScan(qr);
    // Should return cached activeScan without a second HTTP request
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(second?.id).toBe(first?.id);
  });

  it('patchItemFloorStatus actualiza atómicamente el estado del item por ID', async () => {
    patchMock.mockResolvedValueOnce({
      project_id: 'p1',
      item_id: 'i1',
      floor_status: 'assembled',
      next_status: 'installed',
    });

    const status = await useFloorScannerStore
      .getState()
      .patchItemFloorStatus('p1', 'i1', 'assembled');

    expect(patchMock).toHaveBeenCalledWith('/projects/p1/items/i1/floor-status', {
      status: 'assembled',
    });
    expect(status).toBe('assembled');
    expect(useFloorScannerStore.getState().itemStatuses['i1']).toBe('assembled');
  });
});


// --- F091 item 2: persistent offline queue ------------------------------------

import {
  loadPendingScans,
  savePendingScans,
  setOfflineQueueStorage,
} from '../services/offlineQueueStorage';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => Promise.resolve(map.get(k) ?? null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      map.delete(k);
      return Promise.resolve();
    },
    __dump: () => map,
  };
}

describe('floorScannerStore offline persistence (F091 item 2)', () => {
  beforeEach(() => {
    useFloorScannerStore.setState({
      pendingScans: [],
      itemStatuses: {},
      activeProjectId: null,
      syncing: false,
      lastScanTime: 0,
      lastScannedText: null,
    });
    postMock.mockReset();
  });

  it('queues offline scans and survives a restart via hydrateFromStorage', async () => {
    const storage = memoryStorage();
    setOfflineQueueStorage(storage);
    postMock.mockRejectedValueOnce(
      new Error('Error de red al conectar con el servidor: sótano sin señal'),
    );
    await useFloorScannerStore.getState().processScan(qrFor());

    // "App restart": fresh store state, same persisted queue.
    useFloorScannerStore.setState({ pendingScans: [], itemStatuses: {} });
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);

    await useFloorScannerStore.getState().hydrateFromStorage();
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(1);
    expect(useFloorScannerStore.getState().pendingScans[0]?.rawText).toBe(qrFor());

    // Connectivity returns → sync drains and persists the empty queue.
    postMock.mockResolvedValueOnce(apiResponse());
    await useFloorScannerStore.getState().syncPending();
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);
    const persisted = await loadPendingScans();
    expect(persisted).toHaveLength(0);

    setOfflineQueueStorage(null);
  });

  it('dedupes the same QR scanned twice offline', async () => {
    const storage = memoryStorage();
    setOfflineQueueStorage(storage);
    postMock.mockRejectedValue(
      new Error('Error de red al conectar con el servidor: sin señal'),
    );
    await useFloorScannerStore.getState().processScan(qrFor(), true);
    await useFloorScannerStore.getState().processScan(qrFor(), true);
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(1);

    savePendingScans(useFloorScannerStore.getState().pendingScans);
    setOfflineQueueStorage(null);
  });

  it('hydrate without storage configured is a safe no-op', async () => {
    setOfflineQueueStorage(null);
    await useFloorScannerStore.getState().hydrateFromStorage();
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);
  });
});

// --- #301: physical routing (pieza → part endpoint, unidad/bulto → unit endpoint) ---

import { moduleLabelQrPayload } from '@muebles/domain';

const partQr = pieceLabelQrPayload({
  projectId: 'p1',
  moduleCode: 'GAB-01',
  partCode: 'LAT-IZQ',
  description: 'Lateral',
  materialCode: 'TAB-1',
  lengthMm: 720,
  widthMm: 560,
  partInstanceId: 'p1_i1_u1_LAT_1',
  unitIndex: 1,
});

const unitQr = moduleLabelQrPayload({
  projectId: 'p1',
  itemId: 'i1',
  factoryCode: 'GAB-01',
  moduleCode: 'GAB-01',
  moduleName: 'Gabinete base',
  moduleUnitId: 'p1_i1_u1',
});

const bultoQr = moduleLabelQrPayload({
  projectId: 'p1',
  itemId: 'i1',
  factoryCode: 'GAB-01',
  moduleCode: 'GAB-01',
  moduleName: 'Gabinete base',
  moduleUnitId: 'p1_i1_u1',
  packageIndex: 2,
  totalPackages: 3,
});

describe('floorScannerStore physical routing (#301)', () => {
  beforeEach(() => {
    useFloorScannerStore.setState({
      history: [],
      activeScan: null,
      itemStatuses: {},
      pendingScans: [],
      activeProjectId: null,
      autoAdvance: true,
      syncing: false,
      lastScanTime: 0,
      lastScannedText: null,
    });
    postMock.mockReset();
  });

  it('QR de pieza (pId) avanza la operación actual por el endpoint físico', async () => {
    postMock.mockResolvedValueOnce({
      part: { id: 'p1_i1_u1_LAT_1', part_code: 'LAT-IZQ', unit_index: 1, status: 'ready_for_assembly' },
    });
    const record = await useFloorScannerStore.getState().processScan(partQr);

    expect(postMock).toHaveBeenCalledWith(
      '/projects/p1/parts/p1_i1_u1_LAT_1/advance',
      { advance: true, source: 'scan' },
    );
    expect(record?.physical).toMatchObject({
      kind: 'part',
      id: 'p1_i1_u1_LAT_1',
      partCode: 'LAT-IZQ',
      status: 'ready_for_assembly',
    });
  });

  it('QR de unidad (uId) avanza la unidad por el endpoint físico', async () => {
    postMock.mockResolvedValueOnce({
      unit: { id: 'p1_i1_u1', unit_index: 1, status: 'assembly' },
      next_status: 'module_qc',
    });
    const record = await useFloorScannerStore.getState().processScan(unitQr);

    expect(postMock).toHaveBeenCalledWith(
      '/projects/p1/units/p1_i1_u1/advance',
      { advance: true, source: 'scan' },
    );
    expect(record?.physical).toMatchObject({ kind: 'unit', status: 'assembly' });
  });

  it('QR de bulto avanza su unidad enviando package_count', async () => {
    postMock.mockResolvedValueOnce({
      unit: { id: 'p1_i1_u1', unit_index: 1, status: 'packaged' },
    });
    await useFloorScannerStore.getState().processScan(bultoQr);

    expect(postMock).toHaveBeenCalledWith(
      '/projects/p1/units/p1_i1_u1/advance',
      { advance: true, source: 'scan', package_count: 3 },
    );
  });

  it('gate de armado bloqueado (409) muestra el error del servidor sin encolar', async () => {
    postMock.mockRejectedValueOnce(
      new Error('Part execution failed: 409 {"error":"el gate de armado bloquea el avance","assembly_readiness":{"ready_pieces":2,"total_pieces":3}}'),
    );
    const record = await useFloorScannerStore.getState().processScan(unitQr);

    expect(record?.error).toContain('gate de armado');
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);
  });

  it('scan físico offline se encola y sincroniza por el endpoint físico', async () => {
    postMock.mockRejectedValueOnce(new Error('Error de red al conectar con el servidor: sin señal'));
    await useFloorScannerStore.getState().processScan(partQr);
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(1);

    postMock.mockResolvedValueOnce({
      part: { id: 'p1_i1_u1_LAT_1', status: 'in_progress' },
    });
    await useFloorScannerStore.getState().syncPending();
    expect(postMock).toHaveBeenCalledWith(
      '/projects/p1/parts/p1_i1_u1_LAT_1/advance',
      { advance: true, source: 'scan' },
    );
    expect(useFloorScannerStore.getState().pendingScans).toHaveLength(0);
  });

  it('etiqueta legacy sin pId/uId sigue yendo al floor-scan', async () => {
    postMock.mockResolvedValueOnce(apiResponse());
    const legacyQr = qrFor(); // pieza QR v2 sin partInstanceId
    await useFloorScannerStore.getState().processScan(legacyQr);
    expect(postMock).toHaveBeenCalledWith('/projects/p1/floor-scan', {
      module: 'GAB-01',
      advance: true,
    });
  });
});
