// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hardware, HardwareVisualAssetBinding } from '@granete/domain';
import type {
  HardwareAsset,
  HardwareAssetRevision,
  HardwareAssetService,
  HardwareAssetUploadSession,
  HardwareAssetUploadStaged,
} from '@granete/storage';
import { HardwareCatalog } from './HardwareCatalog';

afterEach(cleanup);

const mockRevision1: HardwareAssetRevision = {
  id: 'rev-uuid-1',
  asset_id: 'asset-uuid-1',
  revision_number: 1,
  representation: 'skp',
  content_type: 'application/vnd.sketchup.skp',
  size_bytes: 10240,
  sha256: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
  validation_state: 'pending',
  integrity_verified_at: '2026-09-12T10:00:00Z',
  created_at: '2026-09-12T10:00:00Z',
};

const mockRevision2: HardwareAssetRevision = {
  id: 'rev-uuid-2',
  asset_id: 'asset-uuid-1',
  revision_number: 2,
  representation: 'skp',
  content_type: 'application/vnd.sketchup.skp',
  size_bytes: 12288,
  sha256: 'sha256-2222222222222222222222222222222222222222222222222222222222222222',
  validation_state: 'pending',
  integrity_verified_at: '2026-09-12T11:00:00Z',
  created_at: '2026-09-12T11:00:00Z',
};

const mockThumbnailRevision: HardwareAssetRevision = {
  id: 'rev-uuid-thumb',
  asset_id: 'asset-uuid-1',
  revision_number: 3,
  representation: 'thumbnail',
  content_type: 'image/png',
  size_bytes: 4096,
  sha256: 'sha256-3333333333333333333333333333333333333333333333333333333333333333',
  validation_state: 'pending',
  integrity_verified_at: '2026-09-12T11:05:00Z',
  created_at: '2026-09-12T11:05:00Z',
};

const mockAssetActive: HardwareAsset = {
  id: 'asset-uuid-1',
  display_name: 'Manija Tubular Inox',
  provenance: 'Hafele Catálogo 2026',
  license: 'Propietaria',
  status: 'active',
  revisions: [mockRevision1, mockRevision2, mockThumbnailRevision],
  created_at: '2026-09-12T10:00:00Z',
  updated_at: '2026-09-12T11:00:00Z',
};

const mockAssetRetired: HardwareAsset = {
  id: 'asset-uuid-retired',
  display_name: 'Tirador Descatalogado',
  status: 'retired',
  revisions: [
    {
      id: 'rev-uuid-retired',
      asset_id: 'asset-uuid-retired',
      revision_number: 1,
      representation: 'skp',
      content_type: 'application/vnd.sketchup.skp',
      size_bytes: 8192,
      sha256: 'sha256-4444444444444444444444444444444444444444444444444444444444444444',
      validation_state: 'pending',
      integrity_verified_at: '2026-09-01T10:00:00Z',
      created_at: '2026-09-01T10:00:00Z',
    },
  ],
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

const sampleHardwareWithBinding: Hardware = {
  id: 'hw-bound-1',
  code: 'HER-3D-01',
  name: 'Tirador 3D Vinculado',
  unit: 'piece',
  costPerUnit: 55,
  active: true,
  visualAsset: {
    assetId: 'asset-uuid-1',
    assetRevisionId: 'rev-uuid-1',
    representation: 'skp',
    sha256: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    validationState: 'pending',
  },
};

function makeMockService(overrides?: Partial<HardwareAssetService>): HardwareAssetService {
  return {
    listAssets: vi.fn().mockResolvedValue([mockAssetActive, mockAssetRetired]),
    getAsset: vi.fn().mockImplementation(async (id: string) => {
      if (id === mockAssetRetired.id) return mockAssetRetired;
      return mockAssetActive;
    }),
    startUpload: vi.fn().mockImplementation(async () => ({
      id: 'session-123',
      representation: 'skp',
      display_name: 'Nuevo modelo',
      status: 'prepared',
      created_at: '2026-09-12T10:00:00Z',
      expires_at: new Date(Date.now() + 1800000).toISOString(),
    })),
    getSession: vi.fn().mockImplementation(async (id: string) => ({
      id,
      representation: 'skp',
      display_name: 'Nuevo modelo',
      status: 'finalized',
      created_at: '2026-09-12T10:00:00Z',
      expires_at: new Date(Date.now() + 1800000).toISOString(),
      finalized_asset_id: 'asset-uuid-1',
      finalized_revision_id: 'rev-uuid-2',
    })),
    uploadBytes: vi.fn().mockResolvedValue({
      content_type: 'application/vnd.sketchup.skp',
      size_bytes: 12288,
      sha256: 'sha256-2222222222222222222222222222222222222222222222222222222222222222',
    }),
    finalizeUpload: vi.fn().mockResolvedValue(mockAssetActive),
    cancelUpload: vi.fn().mockImplementation(async (id: string) => ({
      id,
      representation: 'skp',
      display_name: 'Cancelado',
      status: 'cancelled',
      created_at: '2026-09-12T10:00:00Z',
      expires_at: new Date(Date.now() + 1800000).toISOString(),
    })),
    retireAsset: vi.fn().mockImplementation(async (id: string) => ({
      ...mockAssetActive,
      status: 'retired',
    })),
    ...overrides,
  };
}

describe('Hardware 3D Catalog UI (#667 M2)', () => {
  it('1. Editar sólo el nombre de un herraje vinculado conserva exactamente el binding previo', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[sampleHardwareWithBinding]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByText(sampleHardwareWithBinding.code));
    await user.click(screen.getByRole('button', { name: `Editar ${sampleHardwareWithBinding.code}` }));

    const nameInput = screen.getByLabelText('Nombre');
    await user.clear(nameInput);
    await user.type(nameInput, 'Nombre Cambiado');

    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const draft = onUpdate.mock.calls[0]![1] as { visualAsset?: HardwareVisualAssetBinding };
    expect(draft.visualAsset).toEqual(sampleHardwareWithBinding.visualAsset);
  });

  it('2. Elegir modelo existente selecciona la revisión exacta y la incluye en el submit', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.type(screen.getByLabelText('Código'), 'HER-NEW-3D');
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo con 3D');

    // Open 3D section and open selector modal
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-selector-btn'));

    // Selector modal should list assets
    await waitFor(() => {
      expect(screen.getByTestId('hardware-asset-selector-modal')).toBeTruthy();
    });

    // Select asset-uuid-1
    await user.click(screen.getByTestId('hardware-asset-item-asset-uuid-1'));

    // Select revision 2 exactly
    await user.click(screen.getByTestId('hardware-asset-select-rev-2'));

    // Save hardware form
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![0] as { visualAsset?: HardwareVisualAssetBinding };
    expect(draft.visualAsset).toEqual({
      assetId: 'asset-uuid-1',
      assetRevisionId: 'rev-uuid-2',
      representation: 'skp',
      sha256: mockRevision2.sha256,
      validationState: 'pending',
    });
  });

  it('3. Subir archivo ejecuta start -> uploadBytes -> finalize -> getSession -> getAsset con claves estables', async () => {
    const user = userEvent.setup();
    const service = makeMockService();
    const onCreate = vi.fn();

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.type(screen.getByLabelText('Código'), 'HER-UP');
    await user.type(screen.getByLabelText('Nombre'), 'Herraje con subida');

    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-upload-btn'));

    expect(screen.getByTestId('hardware-asset-upload-modal')).toBeTruthy();

    const file = new File(['fake-skp-content'], 'manija.skp', {
      type: 'application/octet-stream',
    });
    const fileInput = screen.getByTestId('hardware-asset-file-input');
    await user.upload(fileInput, file);

    fireEvent.submit(screen.getByTestId('hardware-asset-upload-modal').querySelector('form')!);

    await waitFor(() => {
      expect(service.startUpload).toHaveBeenCalledTimes(1);
      expect(service.uploadBytes).toHaveBeenCalledTimes(1);
      expect(service.finalizeUpload).toHaveBeenCalledTimes(1);
      expect(service.getSession).toHaveBeenCalledTimes(1);
      expect(service.getAsset).toHaveBeenCalledWith('asset-uuid-1', expect.anything());
    });
  });

  it('4. Thumbnail no se ofrece como modelo seleccionable y recurso retirado no permite nuevas asociaciones', async () => {
    const user = userEvent.setup();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-selector-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-asset-item-asset-uuid-1')).toBeTruthy();
    });

    // Asset 1 has 3 revisions: rev 1 (skp), rev 2 (skp), rev 3 (thumbnail)
    expect(screen.getByTestId('hardware-asset-revision-1')).toBeTruthy();
    expect(screen.getByTestId('hardware-asset-revision-2')).toBeTruthy();
    // Thumbnail MUST NOT be rendered as a selectable revision
    expect(screen.queryByTestId('hardware-asset-revision-3')).toBeNull();

    // Now click the retired asset
    await user.click(screen.getByTestId('hardware-asset-item-asset-uuid-retired'));
    const retiredSelectBtn = screen.getByTestId('hardware-asset-select-rev-1');
    expect(retiredSelectBtn).toBeDisabled();
  });

  it('5. Quitar asociación desvincula visualAsset del draft sin eliminar recursos', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[sampleHardwareWithBinding]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByText(sampleHardwareWithBinding.code));
    await user.click(screen.getByRole('button', { name: `Editar ${sampleHardwareWithBinding.code}` }));

    // Unbind button in 3D card
    await user.click(screen.getByTestId('hardware-unbind-asset-btn'));

    // Should now show unbound card
    expect(screen.getByTestId('hardware-unbound-card')).toBeTruthy();

    // Submit
    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const draft = onUpdate.mock.calls[0]![1] as { visualAsset?: unknown };
    expect(draft.visualAsset).toBeNull();
  });

  it('6. Error de guardado mantiene el modal abierto y conserva el draft y el binding intactos', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockRejectedValue(new Error('Network failure'));
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[sampleHardwareWithBinding]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByText(sampleHardwareWithBinding.code));
    await user.click(screen.getByRole('button', { name: `Editar ${sampleHardwareWithBinding.code}` }));

    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByText('Network failure')).toBeTruthy();
    });

    // Modal stays open with the form
    expect(screen.getByTestId('hardware-form-modal')).toBeTruthy();
    expect(screen.getByTestId('hardware-bound-card')).toBeTruthy();
  });

  it('7. Retiro de recurso exige confirmación y llama a retireAsset', async () => {
    const user = userEvent.setup();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-selector-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('hardware-asset-retire-btn')).toBeTruthy();
    });

    // Click retire opens confirmation
    await user.click(screen.getByTestId('hardware-asset-retire-btn'));
    expect(screen.getByTestId('hardware-asset-retire-confirm-btn')).toBeTruthy();

    // Confirm retire
    await user.click(screen.getByTestId('hardware-asset-retire-confirm-btn'));

    await waitFor(() => {
      expect(service.retireAsset).toHaveBeenCalledWith('asset-uuid-1');
    });
  });

  it('8. Sin permiso canMutate se desactivan botones de mutación 3D', async () => {
    const user = userEvent.setup();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[sampleHardwareWithBinding]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate={false}
        assetService={service}
      />,
    );

    await user.click(screen.getByText(sampleHardwareWithBinding.code));
    await user.click(screen.getByRole('button', { name: `Editar ${sampleHardwareWithBinding.code}` }));

    expect(screen.getByTestId('hardware-change-asset-btn')).toBeDisabled();
    expect(screen.getByTestId('hardware-add-revision-btn')).toBeDisabled();
    expect(screen.getByTestId('hardware-unbind-asset-btn')).toBeDisabled();
  });

  it('9. C2 - Reintento tras pérdida de respuesta de finalize recupera la revisión exacta sin re-subir bytes ni duplicar', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    let finalizeAttempts = 0;
    const service = makeMockService({
      startUpload: vi.fn().mockResolvedValue({
        id: 'session-c2',
        representation: 'skp',
        display_name: 'Manija C2',
        status: 'prepared',
        created_at: '2026-09-12T10:00:00Z',
        expires_at: new Date(Date.now() + 1800000).toISOString(),
      }),
      finalizeUpload: vi.fn().mockImplementation(async () => {
        finalizeAttempts += 1;
        if (finalizeAttempts === 1) {
          // Simulate network drop after server committed
          throw new Error('Conexión perdida con el servidor tras confirmación');
        }
        return mockAssetActive;
      }),
      getSession: vi.fn().mockImplementation(async (id: string) => {
        // After finalize was attempted once, server shows finalized!
        if (finalizeAttempts >= 1) {
          return {
            id,
            representation: 'skp',
            display_name: 'Manija C2',
            status: 'finalized',
            created_at: '2026-09-12T10:00:00Z',
            expires_at: new Date(Date.now() + 1800000).toISOString(),
            finalized_asset_id: 'asset-uuid-1',
            finalized_revision_id: 'rev-uuid-2',
          };
        }
        return {
          id,
          representation: 'skp',
          display_name: 'Manija C2',
          status: 'prepared',
          created_at: '2026-09-12T10:00:00Z',
          expires_at: new Date(Date.now() + 1800000).toISOString(),
        };
      }),
    });

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.type(screen.getByLabelText('Código'), 'HER-C2');
    await user.type(screen.getByLabelText('Nombre'), 'Herraje C2');

    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-upload-btn'));

    const file = new File(['fake-skp'], 'c2.skp', { type: 'application/octet-stream' });
    await user.upload(screen.getByTestId('hardware-asset-file-input'), file);

    // Initial submit: finalize will fail with network drop
    fireEvent.submit(screen.getByTestId('hardware-asset-upload-modal').querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('hardware-upload-error')).toBeTruthy();
      expect(screen.getByTestId('hardware-asset-upload-retry-btn')).toBeTruthy();
    });

    expect(service.uploadBytes).toHaveBeenCalledTimes(1);
    expect(service.finalizeUpload).toHaveBeenCalledTimes(1);

    // User clicks "Reintentar"
    await user.click(screen.getByTestId('hardware-asset-upload-retry-btn'));

    // Should detect finalized session, skip uploadBytes and finalizeUpload, and read asset
    await waitFor(() => {
      // Must NOT repeat uploadBytes against a finalized session
      expect(service.uploadBytes).toHaveBeenCalledTimes(1);
      // Must NOT repeat finalizeUpload
      expect(service.finalizeUpload).toHaveBeenCalledTimes(1);
      // Must read asset and revision
      expect(service.getAsset).toHaveBeenCalledWith('asset-uuid-1', expect.anything());
    });

    // Form should now have visualAsset bound to rev-uuid-2
    await waitFor(
      () => {
        expect(screen.getByTestId('hardware-bound-card')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    fireEvent.submit(screen.getByTestId('hardware-form-modal').querySelector('form')!);
    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![0] as { visualAsset?: HardwareVisualAssetBinding };
    expect(draft.visualAsset?.assetRevisionId).toBe('rev-uuid-2');
  });

  it('10. C2 - Fallo de consulta de asset posterior a finalize muestra error y permite reintentar sin re-subir', async () => {
    const user = userEvent.setup();
    let getAssetAttempts = 0;
    const service = makeMockService({
      getAsset: vi.fn().mockImplementation(async (id: string) => {
        getAssetAttempts += 1;
        if (getAssetAttempts === 1) {
          throw new Error('Fallo al leer recurso tras finalizar');
        }
        return mockAssetActive;
      }),
    });

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-upload-btn'));

    const file = new File(['fake-skp'], 'c2-read.skp', { type: 'application/octet-stream' });
    await user.upload(screen.getByTestId('hardware-asset-file-input'), file);

    fireEvent.submit(screen.getByTestId('hardware-asset-upload-modal').querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('hardware-upload-error')).toBeTruthy();
      expect(screen.getByText(/Fallo al leer recurso tras finalizar/)).toBeTruthy();
    });

    // Reintentar
    await user.click(screen.getByTestId('hardware-asset-upload-retry-btn'));

    await waitFor(
      () => {
        expect(screen.getByTestId('hardware-bound-card')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    // Upload bytes and finalize were only called in the initial attempt
    expect(service.uploadBytes).toHaveBeenCalledTimes(1);
    expect(service.finalizeUpload).toHaveBeenCalledTimes(1);
  });

  it('11. C3 - Cerrar el uploader mientras startUpload está pendiente no aplica binding al resolver y cancela la sesión', async () => {
    const user = userEvent.setup();
    let resolveStart!: (s: HardwareAssetUploadSession) => void;
    const startPromise = new Promise<HardwareAssetUploadSession>((res) => {
      resolveStart = res;
    });

    const service = makeMockService({
      startUpload: vi.fn().mockImplementation(() => startPromise),
    });

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-upload-btn'));

    const file = new File(['fake-skp'], 'c3.skp', { type: 'application/octet-stream' });
    await user.upload(screen.getByTestId('hardware-asset-file-input'), file);

    // Submit upload form (startUpload will remain pending)
    fireEvent.submit(screen.getByTestId('hardware-asset-upload-modal').querySelector('form')!);

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Modal is in 'starting' stage; user closes it via the upload modal's close button
    const closeBtn = within(screen.getByTestId('hardware-asset-upload-modal')).getByRole('button', {
      name: 'Cerrar',
    });
    await user.click(closeBtn);

    // Now resolve the startUpload promise
    resolveStart({
      id: 'session-c3-abandoned',
      representation: 'skp',
      display_name: 'C3 Abandonada',
      status: 'prepared',
      created_at: '2026-09-12T10:00:00Z',
      expires_at: new Date(Date.now() + 1800000).toISOString(),
    });

    await waitFor(() => {
      // Remote session must be explicitly cancelled
      expect(service.cancelUpload).toHaveBeenCalledWith('session-c3-abandoned');
    });

    // Binding must NOT have been applied
    expect(screen.queryByTestId('hardware-bound-card')).toBeNull();
    expect(screen.getByTestId('hardware-unbound-card')).toBeTruthy();
  });

  it('12. C3 - Cerrar A y abrir B; resolver resultados tardíos de A no modifica B', async () => {
    const user = userEvent.setup();
    let resolveGetAssetA!: (a: HardwareAsset) => void;
    const getAssetAPromise = new Promise<HardwareAsset>((res) => {
      resolveGetAssetA = res;
    });

    const assetA: HardwareAsset = {
      ...mockAssetActive,
      id: 'asset-a',
      display_name: 'Asset A',
    };

    const service = makeMockService({
      getAsset: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'asset-a') return getAssetAPromise;
        return mockAssetActive;
      }),
    });

    const hwA: Hardware = {
      ...sampleHardwareWithBinding,
      id: 'hw-a',
      code: 'HER-A',
      name: 'Herraje A',
      visualAsset: {
        assetId: 'asset-a',
        assetRevisionId: 'rev-uuid-1',
        representation: 'skp',
        sha256: 'sha256-a',
        validationState: 'pending',
      },
    };

    const hwB: Hardware = {
      ...sampleHardwareWithBinding,
      id: 'hw-b',
      code: 'HER-B',
      name: 'Herraje B',
      visualAsset: undefined,
    };

    render(
      <HardwareCatalog
        hardware={[hwA, hwB]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    // Open A
    await user.click(screen.getByText('HER-A'));
    await user.click(screen.getByRole('button', { name: 'Editar HER-A' }));

    // Close A modal
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    // Open B
    await user.click(screen.getByText('HER-B'));
    await user.click(screen.getByRole('button', { name: 'Editar HER-B' }));

    // Resolve A's pending getAsset
    resolveGetAssetA(assetA);

    // B must remain unbound and not inherit A's asset
    expect(screen.queryByText('Asset A')).toBeNull();
    expect(screen.getByTestId('hardware-unbound-card')).toBeTruthy();
  });

  it('13. C4 - Configurar origin, colapsar el panel y enviar conserva exactamente origin en el payload', async () => {
    const user = userEvent.setup();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-upload-btn'));

    const file = new File(['fake-skp'], 'origin.skp', { type: 'application/octet-stream' });
    await user.upload(screen.getByTestId('hardware-asset-file-input'), file);

    // Open advanced disclosure
    await user.click(screen.getByTestId('hardware-upload-advanced-toggle'));

    // Check configure origin
    await user.click(screen.getByTestId('hardware-upload-configure-origin-checkbox'));

    // Select units cm and up-axis y
    await user.selectOptions(screen.getByTestId('hardware-upload-source-units'), 'cm');
    await user.selectOptions(screen.getByTestId('hardware-upload-up-axis'), 'y');

    // Enable anchor offset and set coordinates
    await user.click(screen.getByTestId('hardware-upload-has-anchor-offset'));
    await user.type(screen.getByTestId('hardware-upload-anchor-x'), '12.5');
    await user.type(screen.getByTestId('hardware-upload-anchor-y'), '24.0');
    await user.type(screen.getByTestId('hardware-upload-anchor-z'), '-8.2');

    // COLLAPSE disclosure panel (C4 requirement: collapsing must not lose configured data!)
    await user.click(screen.getByTestId('hardware-upload-advanced-toggle'));
    expect(screen.queryByTestId('hardware-upload-source-units')).toBeNull();

    // Submit form
    fireEvent.submit(screen.getByTestId('hardware-asset-upload-modal').querySelector('form')!);

    await waitFor(() => {
      expect(service.startUpload).toHaveBeenCalledTimes(1);
    });

    const startPayload = (service.startUpload as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(startPayload.origin).toEqual({
      source_units: 'cm',
      up_axis: 'y',
      anchor_offset_mm: {
        x_mm: 12.5,
        y_mm: 24.0,
        z_mm: -8.2,
      },
    });
  });

  it('14. C4 - Coordenadas inválidas o incompletas de anclaje muestran error y no envían el formulario', async () => {
    const user = userEvent.setup();
    const service = makeMockService();

    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        assetService={service}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Nuevo herraje/i }));
    await user.click(screen.getByTestId('hardware-3d-section-toggle'));
    await user.click(screen.getByTestId('hardware-3d-tab-file'));
    await user.click(screen.getByTestId('hardware-open-upload-btn'));

    const file = new File(['fake-skp'], 'invalid-origin.skp', { type: 'application/octet-stream' });
    await user.upload(screen.getByTestId('hardware-asset-file-input'), file);

    // Open disclosure, enable origin and anchor offset
    await user.click(screen.getByTestId('hardware-upload-advanced-toggle'));
    await user.click(screen.getByTestId('hardware-upload-configure-origin-checkbox'));
    await user.click(screen.getByTestId('hardware-upload-has-anchor-offset'));

    // Set X, but leave Y and Z empty
    await user.type(screen.getByTestId('hardware-upload-anchor-x'), '10');

    // Submit form
    fireEvent.submit(screen.getByTestId('hardware-asset-upload-modal').querySelector('form')!);

    // Form should reject with validation error
    expect(
      screen.getByText(/Las coordenadas de desplazamiento de anclaje/i),
    ).toBeTruthy();
    expect(service.startUpload).not.toHaveBeenCalled();
  });
});
