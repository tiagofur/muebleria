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

