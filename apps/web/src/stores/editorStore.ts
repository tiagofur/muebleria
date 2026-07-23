/**
 * editorStore — estado del editor de mueble board-first (Fase 1).
 *
 * 5º store Zustand (siguiendo workspaceStore/catalogStore/projectStore/uiStore).
 * Mantiene ResolvedBoardPart[] como scratch space en memoria. Al guardar,
 * el caller deriva los cambios de pose de vuelta a ModuleComponentInstance.overrides.
 *
 * Patrón scratch space (decisión F067): el canvas trabaja con el tipo rico
 * (ResolvedBoardPart, que tiene thicknessMm/materialId) y solo toca el Module
 * al guardar. No rompe el modelo de dominio (resolveBom sigue siendo la fuente).
 */

import { create } from 'zustand';

import type { ResolvedBoardPart } from '@muebles/domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditorTool = 'select' | 'move' | 'rotate' | 'duplicate';
export type EditorViewMode = '2d-iso' | '3d';

export interface PartPose {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rotateX?: number;
  readonly rotateY?: number;
  readonly rotateZ?: number;
}

export interface PartDimensions {
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly thicknessMm?: number;
}

export interface EditorState {
  // --- Entidad activa ---
  readonly moduleId: string | null;
  readonly resolvedParts: readonly ResolvedBoardPart[];

  // --- Selección ---
  readonly selectedPartId: string | null;

  // --- Herramienta ---
  readonly tool: EditorTool;

  // --- View mode ---
  readonly viewMode: EditorViewMode;

  // --- Snapping ---
  readonly snapEnabled: boolean;
  readonly snapGridMm: number;
  readonly snapToPeer: boolean;

  // --- Actions ---
  readonly loadModule: (
    moduleId: string,
    resolvedParts: readonly ResolvedBoardPart[],
  ) => void;
  readonly clearEditor: () => void;
  readonly selectPart: (partId: string | null) => void;
  readonly setTool: (tool: EditorTool) => void;
  readonly setViewMode: (mode: EditorViewMode) => void;
  readonly setSnapEnabled: (enabled: boolean) => void;
  readonly setSnapGridMm: (mm: number) => void;
  readonly updatePartPose: (partId: string, pose: PartPose) => void;
  readonly updatePartDimensions: (
    partId: string,
    dims: PartDimensions,
  ) => void;
  readonly duplicatePart: (partId: string) => void;
  readonly removePart: (partId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_GRID_MM = 50;
const DUPLICATE_OFFSET_MM = 20;

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `part-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorState>()((set, get) => ({
  moduleId: null,
  resolvedParts: [],
  selectedPartId: null,
  tool: 'select',
  viewMode: '3d',
  snapEnabled: true,
  snapGridMm: DEFAULT_GRID_MM,
  snapToPeer: true,

  loadModule: (moduleId, resolvedParts) =>
    set({
      moduleId,
      resolvedParts,
      selectedPartId: null,
      tool: 'select',
    }),

  clearEditor: () =>
    set({
      moduleId: null,
      resolvedParts: [],
      selectedPartId: null,
      tool: 'select',
      viewMode: '3d',
      snapEnabled: true,
      snapGridMm: DEFAULT_GRID_MM,
      snapToPeer: true,
    }),

  selectPart: (partId) => set({ selectedPartId: partId }),

  setTool: (tool) => set({ tool }),

  setViewMode: (viewMode) => set({ viewMode }),

  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),

  setSnapGridMm: (snapGridMm) => set({ snapGridMm }),

  updatePartPose: (partId, pose) =>
    set((state) => ({
      resolvedParts: state.resolvedParts.map((p) =>
        p.id === partId
          ? {
              ...p,
              ...(pose.x !== undefined ? { x: pose.x } : {}),
              ...(pose.y !== undefined ? { y: pose.y } : {}),
              ...(pose.z !== undefined ? { z: pose.z } : {}),
              ...(pose.rotateX !== undefined ? { rotateX: pose.rotateX } : {}),
              ...(pose.rotateY !== undefined ? { rotateY: pose.rotateY } : {}),
              ...(pose.rotateZ !== undefined ? { rotateZ: pose.rotateZ } : {}),
            }
          : p,
      ),
    })),

  updatePartDimensions: (partId, dims) =>
    set((state) => ({
      resolvedParts: state.resolvedParts.map((p) =>
        p.id === partId
          ? {
              ...p,
              ...(dims.lengthMm !== undefined ? { lengthMm: dims.lengthMm } : {}),
              ...(dims.widthMm !== undefined ? { widthMm: dims.widthMm } : {}),
              ...(dims.thicknessMm !== undefined
                ? { thicknessMm: dims.thicknessMm }
                : {}),
            }
          : p,
      ),
    })),

  duplicatePart: (partId) =>
    set((state) => {
      const source = state.resolvedParts.find((p) => p.id === partId);
      if (!source) return state;
      const newId = defaultNewId();
      const copy: ResolvedBoardPart = {
        ...source,
        id: newId,
        x: (source.x ?? 0) + DUPLICATE_OFFSET_MM,
        description: `${source.description} (copia)`,
      };
      return {
        resolvedParts: [...state.resolvedParts, copy],
        selectedPartId: newId,
      };
    }),

  removePart: (partId) =>
    set((state) => ({
      resolvedParts: state.resolvedParts.filter((p) => p.id !== partId),
      selectedPartId:
        state.selectedPartId === partId ? null : state.selectedPartId,
    })),
}));

// ---------------------------------------------------------------------------
// Non-React accessor
// ---------------------------------------------------------------------------

export function getEditorStoreState(): EditorState {
  return useEditorStore.getState();
}
