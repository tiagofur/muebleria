import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFloorScannerStore } from './floorScannerStore';
import { pieceLabelQrPayload } from '@muebles/domain';

// Mock expo-haptics
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

describe('floorScannerStore Mobile (Fase 1)', () => {
  beforeEach(() => {
    useFloorScannerStore.getState().clearHistory();
    useFloorScannerStore.setState({
      history: [],
      activeScan: null,
      itemStatuses: {},
    });
    vi.clearAllMocks();
  });

  it('procesa payload QR v2 oficial de @muebles/domain', async () => {
    const rawQr = pieceLabelQrPayload({
      projectId: 'proj-123',
      moduleCode: 'GAB-01',
      partCode: 'COST-IZQ',
      description: 'Costado Izquierdo 18mm',
      materialCode: 'BLANCO-18',
      lengthMm: 720,
      widthMm: 564,
      quantity: 1,
      edgeSides: 'L1+W2',
      edgeCode: 'CANTO-BL-2',
      revision: '1',
    });

    const parsed = await useFloorScannerStore.getState().processScan(rawQr);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('payload');
    if (parsed?.kind === 'payload') {
      expect(parsed.fields.moduleCode).toBe('GAB-01');
      expect(parsed.fields.partCode).toBe('COST-IZQ');
      expect(parsed.fields.lengthMm).toBe(720);
      expect(parsed.fields.widthMm).toBe(564);
      expect(parsed.fields.edgeSides).toBe('L1+W2');
    }

    const state = useFloorScannerStore.getState();
    expect(state.history.length).toBe(1);
    expect(state.activeScan).not.toBeNull();
  });

  it('procesa códigos simples o de texto plano', async () => {
    const plainText = 'GAB-01-COSTADO';
    const parsed = await useFloorScannerStore.getState().processScan(plainText);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('plainCode');
    if (parsed?.kind === 'plainCode') {
      expect(parsed.code).toBe('GAB-01-COSTADO');
    }
  });

  it('avanza el estado de piso de fabricación secuencialmente', async () => {
    const itemId = 'PIEZA-01';
    const store = useFloorScannerStore.getState();

    // Default is pending
    expect(store.getItemStatus(itemId)).toBe('pending');

    // Advance: pending -> cut
    store.advanceItemStatus('proj-1', itemId);
    expect(useFloorScannerStore.getState().getItemStatus(itemId)).toBe('cut');

    // Advance: cut -> edged
    useFloorScannerStore.getState().advanceItemStatus('proj-1', itemId);
    expect(useFloorScannerStore.getState().getItemStatus(itemId)).toBe('edged');

    // Advance: edged -> assembled
    useFloorScannerStore.getState().advanceItemStatus('proj-1', itemId);
    expect(useFloorScannerStore.getState().getItemStatus(itemId)).toBe('assembled');

    // Advance: assembled -> installed
    useFloorScannerStore.getState().advanceItemStatus('proj-1', itemId);
    expect(useFloorScannerStore.getState().getItemStatus(itemId)).toBe('installed');

    // Advance when already installed remains installed
    useFloorScannerStore.getState().advanceItemStatus('proj-1', itemId);
    expect(useFloorScannerStore.getState().getItemStatus(itemId)).toBe('installed');
  });

  it('actualiza el estado de las piezas en el historial', async () => {
    const rawQr = pieceLabelQrPayload({
      projectId: 'proj-123',
      moduleCode: 'GAB-01',
      partCode: 'COST-IZQ',
      description: 'Costado Izquierdo',
      materialCode: 'BLANCO-18',
      lengthMm: 720,
      widthMm: 564,
    });

    await useFloorScannerStore.getState().processScan(rawQr);
    useFloorScannerStore.getState().updateItemStatus('proj-123', 'COST-IZQ', 'cut');

    const state = useFloorScannerStore.getState();
    expect(state.history[0].currentStatus).toBe('cut');
    expect(state.activeScan?.currentStatus).toBe('cut');
  });
});
