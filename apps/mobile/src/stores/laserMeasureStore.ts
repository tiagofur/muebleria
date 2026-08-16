import { create } from 'zustand';
import * as Haptics from 'expo-haptics';
import {
  bleLaserService,
  type BleLaserDevice,
  type LaserMeasurementEvent,
} from '../services/bleLaserService';

export type MeasurementTarget =
  | 'wall_width'
  | 'wall_height'
  | 'wall_depth'
  | 'obstacle_width'
  | 'water_supply_offset'
  | 'gas_supply_offset'
  | 'electrical_socket_offset'
  | 'custom';

export interface RoomWallMeasurements {
  wallWidthMm?: number;
  wallHeightMm?: number;
  wallDepthMm?: number;
  waterSupplyOffsetMm?: number;
  gasSupplyOffsetMm?: number;
  electricalSocketOffsetMm?: number;
  customMeasures: { id: string; label: string; valueMm: number }[];
}

export interface LaserMeasureState {
  isScanning: boolean;
  discoveredDevices: BleLaserDevice[];
  connectedDevice: BleLaserDevice | null;
  activeTarget: MeasurementTarget;
  lastMeasurement: LaserMeasurementEvent | null;
  history: LaserMeasurementEvent[];
  wallMeasurements: RoomWallMeasurements;
  activeWall: 'north' | 'south' | 'east' | 'west';

  // Actions
  startScanning: () => Promise<void>;
  stopScanning: () => void;
  connectDevice: (device: BleLaserDevice) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  setActiveTarget: (target: MeasurementTarget) => void;
  setActiveWall: (wall: 'north' | 'south' | 'east' | 'west') => void;
  recordMeasurement: (distanceMm: number, angleDeg?: number) => void;
  setWallMeasure: (target: MeasurementTarget, valueMm: number) => void;
  addCustomMeasure: (label: string, valueMm: number) => void;
  clearHistory: () => void;
  resetWallMeasures: () => void;
}

const INITIAL_WALL_MEASURES: RoomWallMeasurements = {
  wallWidthMm: undefined,
  wallHeightMm: undefined,
  wallDepthMm: undefined,
  waterSupplyOffsetMm: undefined,
  gasSupplyOffsetMm: undefined,
  electricalSocketOffsetMm: undefined,
  customMeasures: [],
};

export const useLaserMeasureStore = create<LaserMeasureState>((set, get) => {
  // Subscribe to raw BLE measurements
  bleLaserService.subscribe((event) => {
    get().recordMeasurement(event.distanceMm, event.angleDeg);
  });

  return {
    isScanning: false,
    discoveredDevices: [],
    connectedDevice: null,
    activeTarget: 'wall_width',
    lastMeasurement: null,
    history: [],
    wallMeasurements: INITIAL_WALL_MEASURES,
    activeWall: 'north',

    startScanning: async () => {
      set({ isScanning: true, discoveredDevices: [] });
      await bleLaserService.startScan((device) => {
        set((state) => {
          if (state.discoveredDevices.some((d) => d.id === device.id)) return state;
          return { discoveredDevices: [...state.discoveredDevices, device] };
        });
      });
    },

    stopScanning: () => {
      bleLaserService.stopScan();
      set({ isScanning: false });
    },

    connectDevice: async (device) => {
      const ok = await bleLaserService.connect(device);
      if (ok) {
        set({
          connectedDevice: { ...device, connected: true },
          isScanning: false,
        });
        bleLaserService.stopScan();
        try {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      }
    },

    disconnectDevice: async () => {
      await bleLaserService.disconnect();
      set({ connectedDevice: null });
    },

    setActiveTarget: (target) => set({ activeTarget: target }),
    setActiveWall: (wall) => set({ activeWall: wall }),

    recordMeasurement: (distanceMm, angleDeg) => {
      const { activeTarget } = get();
      const rounded = Math.round(distanceMm);

      const event: LaserMeasurementEvent = {
        deviceId: get().connectedDevice?.id ?? 'manual',
        distanceMm: rounded,
        unit: 'mm',
        timestamp: new Date().toISOString(),
        angleDeg,
      };

      // Assign to current wall target
      get().setWallMeasure(activeTarget, rounded);

      set((state) => ({
        lastMeasurement: event,
        history: [event, ...state.history].slice(0, 50),
      }));

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    },

    setWallMeasure: (target, valueMm) => {
      set((state) => {
        const updated = { ...state.wallMeasurements };
        switch (target) {
          case 'wall_width':
            updated.wallWidthMm = valueMm;
            break;
          case 'wall_height':
            updated.wallHeightMm = valueMm;
            break;
          case 'wall_depth':
            updated.wallDepthMm = valueMm;
            break;
          case 'water_supply_offset':
            updated.waterSupplyOffsetMm = valueMm;
            break;
          case 'gas_supply_offset':
            updated.gasSupplyOffsetMm = valueMm;
            break;
          case 'electrical_socket_offset':
            updated.electricalSocketOffsetMm = valueMm;
            break;
          default:
            break;
        }
        return { wallMeasurements: updated };
      });
    },

    addCustomMeasure: (label, valueMm) => {
      set((state) => ({
        wallMeasurements: {
          ...state.wallMeasurements,
          customMeasures: [
            ...state.wallMeasurements.customMeasures,
            { id: `custom-${Date.now()}`, label, valueMm },
          ],
        },
      }));
    },

    clearHistory: () => set({ history: [], lastMeasurement: null }),
    resetWallMeasures: () => set({ wallMeasurements: INITIAL_WALL_MEASURES }),
  };
});
