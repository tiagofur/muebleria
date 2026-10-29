import { describe, expect, it, vi } from 'vitest';

import { uploadHardwareAssetBinding } from './hardwareAssetUpload';
import type { HardwareAssetService } from './hardwareAssetService';
import type {
  HardwareAsset,
  HardwareAssetUploadSession,
} from './openapi/generated/types';

function skpFile(name = 'riel-fijo-izq.skp'): File {
  return new File(['fake-skp-bytes'], name, { type: 'application/octet-stream' });
}

interface ServiceScript {
  readonly startUpload: HardwareAssetService['startUpload'];
  readonly uploadBytes?: HardwareAssetService['uploadBytes'];
  readonly finalizeUpload?: HardwareAssetService['finalizeUpload'];
  readonly getSession: HardwareAssetService['getSession'];
  readonly getAsset: HardwareAssetService['getAsset'];
}

function scriptedService(script: ServiceScript): HardwareAssetService {
  return {
    listAssets: vi.fn(async () => []),
    getAsset: script.getAsset,
    startUpload: script.startUpload,
    getSession: script.getSession,
    uploadBytes: script.uploadBytes ?? vi.fn(async () => ({}) as never),
    finalizeUpload: script.finalizeUpload ?? vi.fn(async () => ({}) as never),
    cancelUpload: vi.fn(async () => ({}) as never),
    retireAsset: vi.fn(async () => ({}) as never),
  } as unknown as HardwareAssetService;
}

const finalizedSession = (id: string): HardwareAssetUploadSession =>
  ({
    id,
    status: 'finalized',
    finalized_asset_id: 'asset-1',
    finalized_revision_id: 'rev-9',
  }) as unknown as HardwareAssetUploadSession;

const assetWithRevision: HardwareAsset =
  ({
    id: 'asset-1',
    revisions: [
      {
        id: 'rev-8',
        representation: 'skp',
        sha256: 'old'.padEnd(64, '0'),
        validation_state: 'validated',
      },
      {
        id: 'rev-9',
        representation: 'skp',
        sha256: 'new'.padEnd(64, '0'),
        validation_state: 'validated',
      },
    ],
  }) as unknown as HardwareAsset;

describe('uploadHardwareAssetBinding (#1416)', () => {
  it('happy path: start → bytes → finalize → readback exacto de la revisión', async () => {
    const calls: string[] = [];
    const keys: string[] = [];
    const service = scriptedService({
      startUpload: vi.fn(async (req, key) => {
        calls.push('start');
        keys.push(key ?? '');
        expect(req.representation).toBe('skp');
        expect(req.display_name).toBe('Riel fijo izq');
        return { id: 'ses-1', status: 'prepared' } as unknown as HardwareAssetUploadSession;
      }),
      uploadBytes: vi.fn(async (sessionId) => {
        calls.push(`bytes:${sessionId}`);
        return {} as never;
      }),
      finalizeUpload: vi.fn(async (_sessionId, key) => {
        calls.push('finalize');
        keys.push(key ?? '');
        return {} as never;
      }),
      getSession: vi.fn(async () => {
        calls.push('get-session');
        return finalizedSession('ses-1');
      }),
      getAsset: vi.fn(async (assetId) => {
        calls.push(`get-asset:${assetId}`);
        return assetWithRevision;
      }),
    });

    const binding = await uploadHardwareAssetBinding(service, {
      file: skpFile(),
      displayName: 'Riel fijo izq',
    });

    expect(calls).toEqual(['start', 'bytes:ses-1', 'finalize', 'get-session', 'get-asset:asset-1']);
    expect(binding).toEqual({
      assetId: 'asset-1',
      assetRevisionId: 'rev-9',
      representation: 'skp',
      sha256: 'new'.padEnd(64, '0'),
      validationState: 'validated',
    });
    // Two distinct idempotency keys (start and finalize are separate intents).
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('rechaza extensiones no soportadas antes de tocar el servicio', async () => {
    const service = scriptedService({
      startUpload: vi.fn(async () => ({}) as never),
      getSession: vi.fn(async () => ({}) as never),
      getAsset: vi.fn(async () => ({}) as never),
    });
    await expect(
      uploadHardwareAssetBinding(service, {
        file: skpFile('diseño.stl'),
        displayName: 'X',
      }),
    ).rejects.toThrow('solo se admiten archivos .skp y .glb');
    expect(service.startUpload).not.toHaveBeenCalled();
  });

  it('envuelve el fallo de subida con el nombre del archivo y el paso', async () => {
    const service = scriptedService({
      startUpload: vi.fn(async () => ({ id: 'ses-2', status: 'prepared' } as never)),
      uploadBytes: vi.fn(async () => {
        throw new Error('network down');
      }),
      getSession: vi.fn(async () => ({}) as never),
      getAsset: vi.fn(async () => ({}) as never),
    });
    await expect(
      uploadHardwareAssetBinding(service, { file: skpFile('riel.skp'), displayName: 'X' }),
    ).rejects.toThrow('Falló la carga de «riel.skp»: network down');
  });

  it('falla cerrado si la sesión no queda finalized o falta la identidad', async () => {
    const notFinalized = scriptedService({
      startUpload: vi.fn(async () => ({ id: 's', status: 'prepared' } as never)),
      getSession: vi.fn(async () => ({ id: 's', status: 'prepared' } as never)),
      getAsset: vi.fn(async () => ({}) as never),
    });
    await expect(
      uploadHardwareAssetBinding(notFinalized, { file: skpFile(), displayName: 'X' }),
    ).rejects.toThrow('terminó en estado «prepared»');

    const missingIdentity = scriptedService({
      startUpload: vi.fn(async () => ({ id: 's', status: 'prepared' } as never)),
      getSession: vi.fn(
        async () => ({ id: 's', status: 'finalized' }) as unknown as HardwareAssetUploadSession,
      ),
      getAsset: vi.fn(async () => ({}) as never),
    });
    await expect(
      uploadHardwareAssetBinding(missingIdentity, { file: skpFile(), displayName: 'X' }),
    ).rejects.toThrow('sin las identidades definitivas');
  });

  it('falla cerrado si la revisión finalizada no aparece en el recurso', async () => {
    const service = scriptedService({
      startUpload: vi.fn(async () => ({ id: 's', status: 'prepared' } as never)),
      getSession: vi.fn(async () => finalizedSession('s')),
      getAsset: vi.fn(
        async () => ({ id: 'asset-1', revisions: [] }) as unknown as HardwareAsset,
      ),
    });
    await expect(
      uploadHardwareAssetBinding(service, { file: skpFile(), displayName: 'X' }),
    ).rejects.toThrow('No se encontró la revisión creada');
  });
});
