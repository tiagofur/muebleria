import { describe, it, expect, beforeEach } from 'vitest';
import { usePresentationStore } from './presentationStore';
import { seedCatalogExpandedLatAm } from '@muebles/domain';

describe('usePresentationStore (Fase 5 - 3D Presentation, Signatures & Paperless Bench)', () => {
  beforeEach(() => {
    usePresentationStore.setState({
      selectedModuleId: seedCatalogExpandedLatAm.modules[0]?.id ?? 'mod-1',
      explodedViewProgress: 0,
      selectedMaterialId: seedCatalogExpandedLatAm.materials[0]?.id ?? 'mat-1',
      cameraPreset: 'perspective',
      benchActivePieces: [],
      deliveryReceipts: [],
    });
  });

  it('permite cambiar módulo, progreso de despiece y preset de cámara', () => {
    const store = usePresentationStore.getState();
    const secondMod = seedCatalogExpandedLatAm.modules[1] || seedCatalogExpandedLatAm.modules[0];

    store.setSelectedModuleId(secondMod.id);
    expect(usePresentationStore.getState().selectedModuleId).toBe(secondMod.id);

    store.setExplodedViewProgress(0.75);
    expect(usePresentationStore.getState().explodedViewProgress).toBe(0.75);

    store.setCameraPreset('isometric');
    expect(usePresentationStore.getState().cameraPreset).toBe('isometric');
  });

  it('inicializa piezas para el banco de armado paperless y alterna checkbox', () => {
    const store = usePresentationStore.getState();
    const mod = seedCatalogExpandedLatAm.modules[0];
    store.initBenchForModule(mod.id);

    const pieces = usePresentationStore.getState().benchActivePieces;
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces[0].assembled).toBe(false);

    // Toggle assembly
    store.toggleBenchPieceAssembled(pieces[0].id);
    expect(usePresentationStore.getState().benchActivePieces[0].assembled).toBe(true);

    // Reset assembly
    store.resetBenchAssembly();
    expect(usePresentationStore.getState().benchActivePieces[0].assembled).toBe(false);
  });

  it('guarda firma digital de acta de entrega', () => {
    const store = usePresentationStore.getState();
    store.saveDigitalSignature({
      projectId: 'proj-1',
      customerName: 'Roberto Pérez',
      documentNumber: '28.450.123',
      signatureSvgPaths: ['M10,20 L50,80 L120,40'],
      notes: 'Muebles recibidos en perfecto estado.',
    });

    const state = usePresentationStore.getState();
    expect(state.deliveryReceipts.length).toBe(1);
    expect(state.deliveryReceipts[0].customerName).toBe('Roberto Pérez');
    expect(state.deliveryReceipts[0].signedAt).toBeDefined();
  });
});
