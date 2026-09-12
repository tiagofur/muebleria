import { describe, expect, it, vi } from 'vitest';
import { GraneteApiClient } from './apiClient';
import { createApiHardwareAssetService } from './hardwareAssetService';

describe('createApiHardwareAssetService', () => {
  it('delegates calls to GraneteApiClient with token', async () => {
    const client = new GraneteApiClient('http://localhost:8080/api');
    const token = 'test-token';

    const listSpy = vi.spyOn(client, 'listHardwareAssets').mockResolvedValueOnce([]);
    const getSpy = vi.spyOn(client, 'getHardwareAsset').mockResolvedValueOnce({
      id: 'asset-1',
      display_name: 'Asset 1',
      status: 'active',
      revisions: [],
      created_at: '2026-09-12T00:00:00Z',
      updated_at: '2026-09-12T00:00:00Z',
    });

    const service = createApiHardwareAssetService(client, token);

    const assets = await service.listAssets();
    expect(assets).toEqual([]);
    expect(listSpy).toHaveBeenCalledWith(token, undefined);

    const asset = await service.getAsset('asset-1');
    expect(asset.id).toBe('asset-1');
    expect(getSpy).toHaveBeenCalledWith(token, 'asset-1', undefined);
  });
});
