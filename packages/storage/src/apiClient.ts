import { GraneteApiError, GraneteNetworkError, parseApiError } from './apiErrors';
import {
  type AuthoringResolveRequestV1,
  type AuthoringResolveResponseV1,
  parseAuthoringResolveResponse,
  FURNITURE_AUTHORING_PREVIEW_PATH,
  buildFurnitureAuthoringPreviewRequest,
  parseFurnitureAuthoringPreviewResponse,
  type FurnitureAuthoringPreviewRequest,
  type FurnitureAuthoringPreviewResponse,
  type FactoryConstructionPolicy,
  policyToOverlayOverrides,
} from '@granete/domain';
import {
  parseGenerated,
  parseGeneratedArray,
  type HardwareAssetRepresentation,
  type HardwareAssetUploadStaged,
  type LibraryOverlayDetail,
} from './openapi/generated/types';
import { GeneratedGraneteApiClient, type GeneratedRequestOptions } from './openapi/generated/client';

type SchemaName = Parameters<typeof parseGenerated>[0];
export type RequestOptions = Omit<GeneratedRequestOptions, 'schema' | 'arrayOf'> & {
  readonly schema?: SchemaName;
  readonly arrayOf?: SchemaName;
};

function requestId(): string {
  const value = globalThis.crypto?.randomUUID?.().replaceAll('-', '');
  return value && value.length >= 8 ? value : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function newIdempotencyKey(): string {
  return `web:${requestId()}`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

/**
 * Mirrors JSON.stringify semantics for request-body validation: keys whose
 * value is undefined never reach the wire, so the schema validator must not
 * see them either. Without this, any mapper emitting an optional field as an
 * explicit undefined (e.g. componentInstanceToApi's placementOverride) fails
 * validation for a payload the wire would accept (#497 T8 browser-gate find).
 */
function pruneUndefinedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneUndefinedKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = pruneUndefinedKeys(entry);
    }
    return out;
  }
  return value;
}

async function readResponseJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

export class GraneteApiClient extends GeneratedGraneteApiClient {
  constructor(
    readonly baseUrl: string,
    readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) { super(); }

  protected createIdempotencyKey(): string { return newIdempotencyKey(); }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const body = options.bodySchema
      ? parseGenerated(options.bodySchema as SchemaName, pruneUndefinedKeys(options.body))
      : options.body;
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Request-ID': requestId() });
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
    if (options.ifMatch !== undefined) headers.set('If-Match', `"v${options.ifMatch}"`);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        signal: options.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof TypeError) throw new GraneteNetworkError(error);
      throw error;
    }
    const value = response.status === 204 ? undefined : await readResponseJSON(response);
    if (!response.ok) {
      let payload;
      try { payload = parseApiError(value); }
      catch {
        payload = {
          code: 'INTERNAL_ERROR' as const,
          message: `Invalid API error response (${response.status})`,
          fieldErrors: {},
          requestId: response.headers.get('X-Request-ID') ?? '',
          retryable: response.status >= 500,
          details: { invalidEnvelope: true },
        };
      }
      throw new GraneteApiError(response.status, payload);
    }
    if (options.arrayOf) return parseGeneratedArray<T>(options.arrayOf, value) as T;
    if (options.schema) return parseGenerated<T>(options.schema, value);
    return value as T;
  }

  async uploadHardwareAssetBytes(
    token: string,
    sessionId: string,
    representation: HardwareAssetRepresentation,
    file: Blob | File,
    filenameOrSignal?: string | AbortSignal,
    signal?: AbortSignal,
  ): Promise<HardwareAssetUploadStaged> {
    const filename = typeof filenameOrSignal === 'string' ? filenameOrSignal : undefined;
    const resolvedSignal = typeof filenameOrSignal === 'string' ? signal : filenameOrSignal;
    const formData = new FormData();
    if (filename) {
      formData.append('file', file, filename);
    } else {
      formData.append('file', file);
    }
    const headers = new Headers({ 'X-Request-ID': requestId() });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const path = `/hardware-assets/uploads/${encodeURIComponent(sessionId)}/bytes/${encodeURIComponent(representation)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers,
        body: formData,
        signal: resolvedSignal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof TypeError) throw new GraneteNetworkError(error);
      throw error;
    }
    const value = response.status === 204 ? undefined : await readResponseJSON(response);
    if (!response.ok) {
      let payload;
      try { payload = parseApiError(value); }
      catch {
        payload = {
          code: 'INTERNAL_ERROR' as const,
          message: `Invalid API error response (${response.status})`,
          fieldErrors: {},
          requestId: response.headers.get('X-Request-ID') ?? '',
          retryable: response.status >= 500,
          details: { invalidEnvelope: true },
        };
      }
      throw new GraneteApiError(response.status, payload);
    }
    return parseGenerated<HardwareAssetUploadStaged>('HardwareAssetUploadStaged', value);
  }

  /**
   * #875: content-addressed workshop catalog revision (the resolve request's
   * catalogRevision pin). Reads GET /api/furniture/definitions' revisionId.
   */
  async getFurnitureCatalogRevision(token: string, signal?: AbortSignal): Promise<string> {
    const value = await this.request<{ revisionId?: string }>('GET', '/furniture/definitions', {
      token,
      signal,
    });
    if (typeof value?.revisionId !== 'string' || value.revisionId.length === 0) {
      throw new GraneteApiError(502, {
        code: 'INTERNAL_ERROR' as const,
        message: 'Workshop catalog response carries no revisionId',
        fieldErrors: {},
        requestId: '',
        retryable: true,
        details: {},
      });
    }
    return value.revisionId;
  }

  /**
   * #497: POST the web editor's authoring preview (a DRAFT definition set +
   * sample values through the resolve engine, stateless). Like the resolve
   * below it is deliberately not OpenAPI-modeled — the resolved section is
   * golden-pinned by the domain contract, which parses the response
   * fail-closed before any screen sees it.
   */
  async previewFurnitureAuthoring(
    token: string,
    request: FurnitureAuthoringPreviewRequest,
    signal?: AbortSignal,
  ): Promise<FurnitureAuthoringPreviewResponse> {
    const value = await this.request<unknown>('POST', FURNITURE_AUTHORING_PREVIEW_PATH, {
      token,
      body: buildFurnitureAuthoringPreviewRequest(request),
      signal,
    });
    return parseFurnitureAuthoringPreviewResponse(value);
  }

  /**
   * #875: POST the canonical authoring resolve (the same endpoint the
   * SketchUp extension consumes; deliberately not OpenAPI-modeled — the
   * response is golden-pinned). The envelope is validated fail-closed via
   * the domain contract before it reaches any screen.
   */
  async resolveFurnitureAuthoring(
    token: string,
    request: AuthoringResolveRequestV1,
    signal?: AbortSignal,
  ): Promise<AuthoringResolveResponseV1> {
    const value = await this.request<unknown>('POST', '/furniture/authoring/resolve', {
      token,
      body: request,
      signal,
    });
    return parseAuthoringResolveResponse(value, request);
  }

  /**
   * #875: Fetch the organization's active overlay for Granete Standard,
   * falling back to null if no overlay exists yet (HTTP 404).
   */
  async getActiveStandardLibraryOverlay(
    token: string,
    signal?: AbortSignal,
  ): Promise<LibraryOverlayDetail | null> {
    try {
      return await this.getActiveLibraryOverlay(token, signal);
    } catch (error) {
      if (error instanceof GraneteApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * #875: Save factory construction policy into the organization's overlay overrides.
   * If an active overlay already exists, updates its overrides.
   * If not, fetches the current Standard release and creates a new active overlay.
   */
  async saveConstructionPolicy(
    token: string,
    policy: FactoryConstructionPolicy,
    activeOverlay: LibraryOverlayDetail | null,
    signal?: AbortSignal,
  ): Promise<LibraryOverlayDetail> {
    const policyOverrides = policyToOverlayOverrides(policy);
    if (activeOverlay) {
      const existingOverrides = (activeOverlay.overrides ?? {}) as Record<string, unknown>;
      const nextOverrides: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(existingOverrides)) {
        if (!k.startsWith('joint.')) {
          nextOverrides[k] = v;
        }
      }
      Object.assign(nextOverrides, policyOverrides);
      return await this.updateLibraryOverlay(token, activeOverlay.id, {
        overrides: nextOverrides,
      }, signal);
    }

    const currentRel = await this.getStandardCurrentRelease(token, signal);
    return await this.createLibraryOverlay(token, {
      baseReleaseId: currentRel.id,
      overrides: policyOverrides,
    }, signal);
  }
}

