import { create } from 'zustand';
import * as Haptics from 'expo-haptics';
import {
  parsePieceLabelScan,
  type ParsedPieceLabelScan,
  type ItemFloorStatus,
  normalizeItemFloorStatus,
  nextItemFloorStatus,
} from '@muebles/domain';
import { apiClient } from '../services/apiClient';

/**
 * Server-backed floor scanner (F089-RN parity).
 *
 * The QR payload carries projectId + moduleCode; the Go `/floor-scan`
 * endpoint resolves the line item (factory code −L2/−L3 aware) and advances
 * its status ATOMICALLY — one row, no project rewrite. Network failures are
 * queued and retried so the shop floor keeps working in dead zones.
 */

export interface FloorScanResolution {
  projectId: string;
  projectName: string;
  itemId: string;
  factoryCode: string;
  moduleCode: string;
  moduleName: string;
  statusBefore: ItemFloorStatus;
  statusAfter: ItemFloorStatus;
  nextStatus: ItemFloorStatus | null;
}

export interface ScannedPieceRecord {
  id: string;
  rawText: string;
  parsed: ParsedPieceLabelScan;
  scannedAt: string;
  /** Last known floor status (server truth when online, optimistic offline). */
  currentStatus: ItemFloorStatus;
  /** Server resolution when the scan reached the API. */
  resolution?: FloorScanResolution;
  /** Last error for this scan (offline, unknown module, forbidden…). */
  error?: string;
}

export interface PendingScan {
  rawText: string;
  advance: boolean;
  at: string;
}

export interface FloorScannerState {
  history: ScannedPieceRecord[];
  activeScan: ScannedPieceRecord | null;
  itemStatuses: Record<string, ItemFloorStatus>;
  /** Scans waiting for connectivity (offline queue). */
  pendingScans: PendingScan[];
  /** Auto-advance scanned pieces to the next floor status (web parity). */
  autoAdvance: boolean;
  /** Active obra for plain-code scans (set from the production queue). */
  activeProjectId: string | null;
  syncing: boolean;
  /** Timestamp of the last processed scan for debounce protection. */
  lastScanTime: number;
  lastScannedText: string | null;

  // Actions
  processScan: (rawText: string, force?: boolean) => Promise<ScannedPieceRecord | null>;
  advanceScan: (record: ScannedPieceRecord) => Promise<void>;
  patchItemFloorStatus: (projectId: string, itemId: string, status?: ItemFloorStatus) => Promise<ItemFloorStatus | null>;
  syncPending: () => Promise<void>;
  setAutoAdvance: (on: boolean) => void;
  setActiveProjectId: (projectId: string | null) => void;
  setActiveScan: (scan: ScannedPieceRecord | null) => void;
  clearHistory: () => void;
  getItemStatus: (itemId?: string) => ItemFloorStatus;
}

interface FloorScanApiResponse {
  project_id: string;
  project_name: string;
  item_id: string;
  factory_code: string;
  module_code: string;
  module_name: string;
  status_before: string;
  status_after: string;
  next_status: string;
}

function toResolution(raw: FloorScanApiResponse): FloorScanResolution {
  return {
    projectId: raw.project_id,
    projectName: raw.project_name,
    itemId: raw.item_id,
    factoryCode: raw.factory_code,
    moduleCode: raw.module_code,
    moduleName: raw.module_name,
    statusBefore: normalizeItemFloorStatus(raw.status_before),
    statusAfter: normalizeItemFloorStatus(raw.status_after),
    nextStatus: raw.next_status ? normalizeItemFloorStatus(raw.next_status) : null,
  };
}

async function haptic(kind: 'success' | 'error' | 'warning') {
  try {
    await Haptics.notificationAsync(
      kind === 'success'
        ? Haptics.NotificationFeedbackType.Success
        : kind === 'error'
          ? Haptics.NotificationFeedbackType.Error
          : Haptics.NotificationFeedbackType.Warning,
    );
  } catch {
    /* haptics unavailable (non-native) */
  }
}

function isNetworkError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Error de red');
}

function recordId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

export const useFloorScannerStore = create<FloorScannerState>((set, get) => ({
  history: [],
  activeScan: null,
  itemStatuses: {},
  pendingScans: [],
  autoAdvance: true,
  activeProjectId: null,
  syncing: false,
  lastScanTime: 0,
  lastScannedText: null,

  getItemStatus: (itemId?: string) => {
    if (!itemId) return 'pending';
    return normalizeItemFloorStatus(get().itemStatuses[itemId]);
  },

  setAutoAdvance: (on) => set({ autoAdvance: on }),
  setActiveProjectId: (projectId) => set({ activeProjectId: projectId }),
  setActiveScan: (scan) => set({ activeScan: scan }),
  clearHistory: () =>
    set({
      history: [],
      activeScan: null,
      pendingScans: [],
      lastScanTime: 0,
      lastScannedText: null,
    }),

  processScan: async (rawText, force = false) => {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    const now = Date.now();
    // Debounce protection: ignore exact duplicate scan received within 800ms (barcode gun / camera spam)
    if (!force && trimmed === get().lastScannedText && now - get().lastScanTime < 800) {
      return get().activeScan;
    }
    set({ lastScanTime: now, lastScannedText: trimmed });

    const parsed = parsePieceLabelScan(trimmed);
    if (!parsed) return null;

    const advance = get().autoAdvance;
    const projectId =
      parsed.kind === 'payload' ? parsed.fields.projectId : get().activeProjectId;
    const moduleCode =
      parsed.kind === 'payload' ? parsed.fields.moduleCode : parsed.code;

    const record: ScannedPieceRecord = {
      id: recordId(),
      rawText: trimmed,
      parsed,
      scannedAt: new Date().toISOString(),
      currentStatus: 'pending',
    };
    set((s) => ({
      history: [record, ...s.history].slice(0, 50),
      activeScan: record,
    }));

    if (!projectId) {
      record.error =
        'Código sin obra: escaneá la etiqueta QR de una pieza (o fijá una obra activa desde la cola).';
      set((s) => ({
        history: s.history.map((r) => (r.id === record.id ? record : r)),
        activeScan: record,
      }));
      await haptic('warning');
      return record;
    }

    const apply = (resolution: FloorScanResolution) => {
      record.resolution = resolution;
      record.currentStatus = resolution.statusAfter;
      set((s) => ({
        itemStatuses: { ...s.itemStatuses, [resolution.itemId]: resolution.statusAfter },
        history: s.history.map((r) => (r.id === record.id ? { ...record } : r)),
        activeScan: { ...record },
      }));
    };

    try {
      const raw = await apiClient.post<FloorScanApiResponse>(
        `/projects/${encodeURIComponent(projectId)}/floor-scan`,
        { module: moduleCode, advance },
      );
      apply(toResolution(raw));
      await haptic(advance && raw.status_after !== raw.status_before ? 'success' : 'success');
      return record;
    } catch (err) {
      if (isNetworkError(err)) {
        // Optimistic local advance; queue for sync.
        record.error = 'Sin conexión — guardado para sincronizar.';
        const next = nextItemFloorStatus(record.currentStatus);
        if (advance && next) record.currentStatus = next;
        set((s) => ({
          itemStatuses: {
            ...s.itemStatuses,
            [moduleCode]: record.currentStatus,
          },
          pendingScans: [...s.pendingScans, { rawText: trimmed, advance, at: new Date().toISOString() }],
          history: s.history.map((r) => (r.id === record.id ? { ...record } : r)),
          activeScan: { ...record },
        }));
        await haptic('warning');
      } else {
        record.error =
          err instanceof Error ? err.message : 'No se pudo resolver el escaneo.';
        set((s) => ({
          history: s.history.map((r) => (r.id === record.id ? { ...record } : r)),
          activeScan: { ...record },
        }));
        await haptic('error');
      }
      return record;
    }
  },

  advanceScan: async (record) => {
    const resolution = record.resolution;
    if (!resolution) return;
    try {
      const raw = await apiClient.post<FloorScanApiResponse>(
        `/projects/${encodeURIComponent(resolution.projectId)}/floor-scan`,
        { module: resolution.factoryCode, factory_code: resolution.factoryCode, advance: true },
      );
      const next = toResolution(raw);
      set((s) => ({
        itemStatuses: { ...s.itemStatuses, [next.itemId]: next.statusAfter },
        history: s.history.map((r) =>
          r.id === record.id ? { ...r, resolution: next, currentStatus: next.statusAfter, error: undefined } : r,
        ),
        activeScan:
          s.activeScan?.id === record.id
            ? { ...s.activeScan, resolution: next, currentStatus: next.statusAfter, error: undefined }
            : s.activeScan,
      }));
      await haptic('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error';
      set((s) => ({
        history: s.history.map((r) => (r.id === record.id ? { ...r, error: message } : r)),
        activeScan: s.activeScan?.id === record.id ? { ...s.activeScan, error: message } : s.activeScan,
      }));
      await haptic('error');
    }
  },

  patchItemFloorStatus: async (projectId, itemId, status) => {
    try {
      const res = await apiClient.patch<{
        project_id: string;
        item_id: string;
        floor_status: string;
        next_status: string;
      }>(
        `/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/floor-status`,
        status ? { status } : {}
      );
      const normalized = normalizeItemFloorStatus(res.floor_status);
      set((s) => ({
        itemStatuses: { ...s.itemStatuses, [itemId]: normalized },
      }));
      await haptic('success');
      return normalized;
    } catch (err) {
      await haptic('error');
      return null;
    }
  },

  syncPending: async () => {
    const { pendingScans, syncing } = get();
    if (syncing || pendingScans.length === 0) return;
    set({ syncing: true });
    const remaining: PendingScan[] = [];
    for (const pending of pendingScans) {
      const parsed = parsePieceLabelScan(pending.rawText);
      const projectId =
        parsed?.kind === 'payload' ? parsed.fields.projectId : get().activeProjectId;
      const moduleCode =
        parsed?.kind === 'payload' ? parsed.fields.moduleCode : parsed?.kind === 'plainCode' ? parsed.code : '';
      if (!projectId || !moduleCode) {
        continue; // unresolvable offline scan — drop silently
      }
      try {
        await apiClient.post(`/projects/${encodeURIComponent(projectId)}/floor-scan`, {
          module: moduleCode,
          advance: pending.advance,
        });
      } catch (err) {
        if (isNetworkError(err)) remaining.push(pending);
      }
    }
    set({ pendingScans: remaining, syncing: false });
  },
}));
