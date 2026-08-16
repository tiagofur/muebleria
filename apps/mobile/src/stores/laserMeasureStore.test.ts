import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLaserMeasureStore } from './laserMeasureStore';
import { bleLaserService } from '../services/bleLaserService';

// Mock expo-haptics
vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(async () => {}),
  impactAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

describe('useLaserMeasureStore (Fase 4 - BLE Laser Measure)', () => {
  beforeEach(() => {
    useLaserMeasureStore.setState({
      isScanning: false,
      discoveredDevices: [],
      connectedDevice: null,
      activeTarget: 'wall_width',
      lastMeasurement: null,
      history: [],
      wallMeasurements: {
        wallWidthMm: undefined,
        wallHeightMm: undefined,
        wallDepthMm: undefined,
        waterSupplyOffsetMm: undefined,
        gasSupplyOffsetMm: undefined,
        electricalSocketOffsetMm: undefined,
        customMeasures: [],
      },
      activeWall: 'north',
    });
  });

  it('inicia y detiene el escaneo de distanciómetros BLE', async () => {
    const store = useLaserMeasureStore.getState();
    await store.startScanning();
    expect(useLaserMeasureStore.getState().isScanning).toBe(true);

    store.stopScanning();
    expect(useLaserMeasureStore.getState().isScanning).toBe(false);
  });

  it('conecta y desconecta un dispositivo láser', async () => {
    const store = useLaserMeasureStore.getState();
    const mockDev = {
      id: 'bosch-glm-50c',
      name: 'Bosch GLM 50 C',
      rssi: -60,
      manufacturer: 'bosch' as const,
      connected: false,
    };

    await store.connectDevice(mockDev);
    const state = useLaserMeasureStore.getState();
    expect(state.connectedDevice?.id).toBe('bosch-glm-50c');
    expect(state.connectedDevice?.connected).toBe(true);

    await store.disconnectDevice();
    expect(useLaserMeasureStore.getState().connectedDevice).toBeNull();
  });

  it('registra mediciones y las asigna a la cota activa de pared', () => {
    const store = useLaserMeasureStore.getState();

    // 1. Cota ancho de pared
    store.setActiveTarget('wall_width');
    bleLaserService.emitMeasurement(2850.4);

    let state = useLaserMeasureStore.getState();
    expect(state.lastMeasurement?.distanceMm).toBe(2850);
    expect(state.wallMeasurements.wallWidthMm).toBe(2850);
    expect(state.history.length).toBe(1);

    // 2. Cota altura de pared
    store.setActiveTarget('wall_height');
    bleLaserService.emitMeasurement(2600);

    state = useLaserMeasureStore.getState();
    expect(state.lastMeasurement?.distanceMm).toBe(2600);
    expect(state.wallMeasurements.wallHeightMm).toBe(2600);
    expect(state.history.length).toBe(2);
  });

  it('agrega cotas personalizadas y resetea medidas', () => {
    const store = useLaserMeasureStore.getState();
    store.addCustomMeasure('Desfase campana', 950);

    let state = useLaserMeasureStore.getState();
    expect(state.wallMeasurements.customMeasures.length).toBe(1);
    expect(state.wallMeasurements.customMeasures[0].label).toBe('Desfase campana');
    expect(state.wallMeasurements.customMeasures[0].valueMm).toBe(950);

    store.resetWallMeasures();
    state = useLaserMeasureStore.getState();
    expect(state.wallMeasurements.wallWidthMm).toBeUndefined();
    expect(state.wallMeasurements.customMeasures.length).toBe(0);
  });
});
