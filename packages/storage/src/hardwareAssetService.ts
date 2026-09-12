/**
 * Hardware asset service contract and GraneteApiClient adapter (#667 M2).
 * UI components receive capabilities through this interface without reading
 * auth tokens or constructing HTTP endpoints directly.
 */

import type { GraneteApiClient } from './apiClient';
import type {
  HardwareAsset,
  HardwareAssetRepresentation,
  HardwareAssetRevisionGrant,
  HardwareAssetUploadSession,
  HardwareAssetUploadStaged,
  StartHardwareAssetUploadRequest,
} from './openapi/generated/types';

export interface HardwareAssetService {
  listAssets(signal?: AbortSignal): Promise<readonly HardwareAsset[]>;
  getAsset(assetId: string, signal?: AbortSignal): Promise<HardwareAsset>;
  startUpload(
    request: StartHardwareAssetUploadRequest,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<HardwareAssetUploadSession>;
  getSession(sessionId: string, signal?: AbortSignal): Promise<HardwareAssetUploadSession>;
  uploadBytes(
    sessionId: string,
    representation: HardwareAssetRepresentation,
    file: File | Blob,
    filename?: string,
    signal?: AbortSignal,
  ): Promise<HardwareAssetUploadStaged>;
  finalizeUpload(
    sessionId: string,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<HardwareAsset>;
  cancelUpload(sessionId: string, signal?: AbortSignal): Promise<HardwareAssetUploadSession>;
  retireAsset(
    assetId: string,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<HardwareAsset>;
  authorizeRevision?(
    assetId: string,
    revisionId: string,
    signal?: AbortSignal,
  ): Promise<HardwareAssetRevisionGrant>;
}

export function createApiHardwareAssetService(
  client: GraneteApiClient,
  token: string,
): HardwareAssetService {
  return {
    listAssets: (signal) => client.listHardwareAssets(token, signal),
    getAsset: (assetId, signal) => client.getHardwareAsset(token, assetId, signal),
    startUpload: (request, key, signal) =>
      client.startHardwareAssetUpload(token, request, key, signal),
    getSession: (sessionId, signal) =>
      client.getHardwareAssetUploadSession(token, sessionId, signal),
    uploadBytes: (sessionId, representation, file, filename, signal) =>
      client.uploadHardwareAssetBytes(token, sessionId, representation, file, filename, signal),
    finalizeUpload: (sessionId, key, signal) =>
      client.finalizeHardwareAssetUpload(token, sessionId, key, signal),
    cancelUpload: (sessionId, signal) =>
      client.cancelHardwareAssetUpload(token, sessionId, signal),
    retireAsset: (assetId, key, signal) =>
      client.retireHardwareAsset(token, assetId, key, signal),
    authorizeRevision: (assetId, revisionId, signal) =>
      client.authorizeHardwareAssetRevision(token, assetId, revisionId, signal),
  };
}
