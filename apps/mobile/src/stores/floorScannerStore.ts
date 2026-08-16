import { create } from 'zustand';
import * as Haptics from 'expo-haptics';
import {
  parsePieceLabelScan,
  type ParsedPieceLabelScan,
  type PieceLabelQrFields,
  type ItemFloorStatus,
  normalizeItemFloorStatus,
  nextItemFloorStatus,
} from '@muebles/domain';

export interface ScannedPieceRecord {
  id: string;
  rawText: string;
  parsed: ParsedPieceLabelScan;
  scannedAt: string;
  currentStatus: ItemFloorStatus;
}

export interface FloorScannerState {
  history: ScannedPieceRecord[];
  activeScan: ScannedPieceRecord | null;
  itemStatuses: Record<string, ItemFloorStatus>; // Key: itemId or moduleCode

  // Actions
  processScan: (rawText: string) => Promise<ParsedPieceLabelScan | null>;
  updateItemStatus: (
    projectId: string,
    itemId: string,
    status: ItemFloorStatus
  ) => void;
  advanceItemStatus: (projectId: string, itemId: string) => void;
  getItemStatus: (itemId?: string) => ItemFloorStatus;
  setActiveScan: (scan: ScannedPieceRecord | null) => void;
  clearHistory: () => void;
}

export const useFloorScannerStore = create<FloorScannerState>((set, get) => ({
  history: [],
  activeScan: null,
  itemStatuses: {},

  getItemStatus: (itemId?: string) => {
    if (!itemId) return 'pending';
    const status = get().itemStatuses[itemId];
    return normalizeItemFloorStatus(status);
  },

  processScan: async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    const parsed = parsePieceLabelScan(trimmed);
    if (!parsed) return null;

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // ignore
    }

    const itemId =
      parsed.kind === 'payload'
        ? parsed.fields.partCode || parsed.fields.moduleCode
        : parsed.code;

    const currentStatus = get().getItemStatus(itemId);

    const record: ScannedPieceRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      rawText: trimmed,
      parsed,
      scannedAt: new Date().toISOString(),
      currentStatus,
    };

    set((state) => ({
      history: [record, ...state.history.slice(0, 49)], // Keep last 50
      activeScan: record,
    }));

    return parsed;
  },

  updateItemStatus: (
    projectId: string,
    itemId: string,
    status: ItemFloorStatus
  ) => {
    set((state) => {
      const updatedStatuses = {
        ...state.itemStatuses,
        [itemId]: status,
      };

      // Also update history item if it matches
      const updatedHistory = state.history.map((rec) => {
        const recItemId =
          rec.parsed.kind === 'payload'
            ? rec.parsed.fields.partCode || rec.parsed.fields.moduleCode
            : rec.parsed.code;

        if (recItemId === itemId) {
          return { ...rec, currentStatus: status };
        }
        return rec;
      });

      const updatedActive =
        state.activeScan &&
        (state.activeScan.parsed.kind === 'payload'
          ? state.activeScan.parsed.fields.partCode ||
            state.activeScan.parsed.fields.moduleCode
          : state.activeScan.parsed.code) === itemId
          ? { ...state.activeScan, currentStatus: status }
          : state.activeScan;

      return {
        itemStatuses: updatedStatuses,
        history: updatedHistory,
        activeScan: updatedActive,
      };
    });
  },

  advanceItemStatus: (projectId: string, itemId: string) => {
    const current = get().getItemStatus(itemId);
    const next = nextItemFloorStatus(current);
    if (next) {
      get().updateItemStatus(projectId, itemId, next);
    }
  },

  setActiveScan: (scan: ScannedPieceRecord | null) => {
    set({ activeScan: scan });
  },

  clearHistory: () => {
    set({ history: [], activeScan: null });
  },
}));
