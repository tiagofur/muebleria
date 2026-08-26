import { create } from 'zustand';
import {
  type Module,
  type Project,
  type MaterialBoard,
  seedCatalogExpandedLatAm,
  resolveBom,
} from '@granete/domain';
import { useCrmStore } from './crmStore';

export interface SignatureData {
  customerName: string;
  documentNumber: string;
  signatureSvgPaths: string[];
  notes?: string;
  signedAt: string;
  projectId: string;
}

export interface BenchPieceItem {
  id: string;
  name: string;
  material: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  edges: { L1: boolean; L2: boolean; W1: boolean; W2: boolean };
  assembled: boolean;
}

export interface PresentationState {
  selectedModuleId: string;
  explodedViewProgress: number; // 0 (cerrado) to 1 (despiece total)
  selectedMaterialId: string;
  cameraPreset: 'perspective' | 'front' | 'top' | 'isometric';
  benchActivePieces: BenchPieceItem[];
  deliveryReceipts: SignatureData[];

  // Actions
  setSelectedModuleId: (id: string) => void;
  setExplodedViewProgress: (val: number) => void;
  setSelectedMaterialId: (id: string) => void;
  setCameraPreset: (preset: 'perspective' | 'front' | 'top' | 'isometric') => void;
  toggleBenchPieceAssembled: (pieceId: string) => void;
  resetBenchAssembly: () => void;
  saveDigitalSignature: (data: Omit<SignatureData, 'signedAt'>) => void;
  getSelectedModule: () => Module | undefined;
  getSelectedMaterial: () => MaterialBoard | undefined;
  initBenchForModule: (moduleId: string) => void;
}

export const usePresentationStore = create<PresentationState>((set, get) => ({
  selectedModuleId: seedCatalogExpandedLatAm.modules[0]?.id ?? 'mod-bajo-1',
  explodedViewProgress: 0,
  selectedMaterialId: seedCatalogExpandedLatAm.materials[0]?.id ?? 'mat-1',
  cameraPreset: 'perspective',
  benchActivePieces: [],
  deliveryReceipts: [],

  setSelectedModuleId: (id) => {
    set({ selectedModuleId: id });
    get().initBenchForModule(id);
  },

  setExplodedViewProgress: (val) =>
    set({ explodedViewProgress: Math.max(0, Math.min(1, val)) }),

  setSelectedMaterialId: (id) => set({ selectedMaterialId: id }),

  setCameraPreset: (preset) => set({ cameraPreset: preset }),

  toggleBenchPieceAssembled: (pieceId) => {
    set((state) => ({
      benchActivePieces: state.benchActivePieces.map((p) =>
        p.id === pieceId ? { ...p, assembled: !p.assembled } : p
      ),
    }));
  },

  resetBenchAssembly: () => {
    set((state) => ({
      benchActivePieces: state.benchActivePieces.map((p) => ({
        ...p,
        assembled: false,
      })),
    }));
  },

  saveDigitalSignature: (data) => {
    const receipt: SignatureData = {
      ...data,
      signedAt: new Date().toISOString(),
    };

    set((state) => ({
      deliveryReceipts: [receipt, ...state.deliveryReceipts],
    }));

    // Register into CRM store as delivery_receipt photo document
    useCrmStore
      .getState()
      .addPhoto(
        data.projectId,
        'delivery_receipt',
        'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&auto=format&fit=crop&q=80',
        `Acta de Entrega firmada por ${data.customerName} (DNI/CUIT: ${data.documentNumber})`
      );
  },

  getSelectedModule: () => {
    return seedCatalogExpandedLatAm.modules.find(
      (m) => m.id === get().selectedModuleId
    );
  },

  getSelectedMaterial: () => {
    return seedCatalogExpandedLatAm.materials.find(
      (m) => m.id === get().selectedMaterialId
    );
  },

  initBenchForModule: (moduleId) => {
    const mod = seedCatalogExpandedLatAm.modules.find((m) => m.id === moduleId);
    if (!mod) return;

    try {
      const bom = resolveBom(mod, {}, seedCatalogExpandedLatAm);
      const pieces: BenchPieceItem[] = bom.boardParts.map((p, idx) => {
        const mat = seedCatalogExpandedLatAm.materials.find((m) => m.id === p.materialId);
        return {
          id: `bench-piece-${idx}-${p.id}`,
          name: p.description || `Pieza #${idx + 1}`,
          material: mat?.name || 'Melamina 18mm',
          lengthMm: p.lengthMm,
          widthMm: p.widthMm,
          thicknessMm: p.thicknessMm || 18,
          edges: {
            L1: p.edges.some((e) => e.side === 'L1'),
            L2: p.edges.some((e) => e.side === 'L2'),
            W1: p.edges.some((e) => e.side === 'W1'),
            W2: p.edges.some((e) => e.side === 'W2'),
          },
          assembled: false,
        };
      });
      set({ benchActivePieces: pieces });
    } catch {
      // Fallback standard pieces if resolver formula not available
      const fallbackPieces: BenchPieceItem[] = [
        {
          id: 'bench-fallback-1',
          name: 'Lateral Izquierdo',
          material: 'Melamina 18mm',
          lengthMm: 720,
          widthMm: 580,
          thicknessMm: 18,
          edges: { L1: true, L2: false, W1: true, W2: false },
          assembled: false,
        },
        {
          id: 'bench-fallback-2',
          name: 'Lateral Derecho',
          material: 'Melamina 18mm',
          lengthMm: 720,
          widthMm: 580,
          thicknessMm: 18,
          edges: { L1: true, L2: false, W1: true, W2: false },
          assembled: false,
        },
        {
          id: 'bench-fallback-3',
          name: 'Piso Inferior',
          material: 'Melamina 18mm',
          lengthMm: 764,
          widthMm: 580,
          thicknessMm: 18,
          edges: { L1: true, L2: false, W1: false, W2: false },
          assembled: false,
        },
        {
          id: 'bench-fallback-4',
          name: 'Fondo Ranurado',
          material: 'Fibroplus 3mm',
          lengthMm: 790,
          widthMm: 710,
          thicknessMm: 3,
          edges: { L1: false, L2: false, W1: false, W2: false },
          assembled: false,
        },
      ];
      set({ benchActivePieces: fallbackPieces });
    }
  },
}));
