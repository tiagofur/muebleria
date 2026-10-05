import { parseGenerated, type ApiError } from './openapi/generated/types';

export class GraneteApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiError,
  ) {
    super(payload.message);
    this.name = 'GraneteApiError';
  }
  get code(): ApiError['code'] { return this.payload.code; }
  get requestId(): string { return this.payload.requestId; }
  get retryable(): boolean { return this.payload.retryable; }
}

export class GraneteNetworkError extends Error {
  constructor(override readonly cause: TypeError) {
    super('Network request failed', { cause });
    this.name = 'GraneteNetworkError';
  }
}

/**
 * #497: a module save was refused BEFORE the wire because this session has no
 * server version for the module (legacy backend without the version field, or
 * a lost cache entry). Fail-closed — a blind write could clobber a concurrent
 * authoring change. Recovery: reload the catalog.
 */
export class ModuleVersionUnknownError extends Error {
  constructor(readonly moduleId: string) {
    super(
      `No se conoce la versión del mueble ${moduleId} en esta sesión; recargá el catálogo antes de volver a guardar.`,
    );
    this.name = 'ModuleVersionUnknownError';
  }
}

/**
 * #1084 (#443 slice 1): a hardware save was refused BEFORE the wire because
 * this session has no server version for the herraje. Fail-closed — a blind
 * write could clobber a concurrent catalog change. Recovery: reload the
 * catalog.
 */
export class HardwareVersionUnknownError extends Error {
  constructor(readonly hardwareId: string) {
    super(
      `No se conoce la versión del herraje ${hardwareId} en esta sesión; recargá el catálogo antes de volver a guardar.`,
    );
    this.name = 'HardwareVersionUnknownError';
  }
}

export function parseApiError(value: unknown): ApiError {
  return parseGenerated<ApiError>('ApiError', value);
}


/**
 * #1091 (#443 slice 2): a simple-catalog-family save was refused BEFORE the
 * wire because this session has no server version for the entity. Fail-closed
 * — a blind write could clobber a concurrent catalog change. Recovery:
 * reload the catalog.
 */
export class CatalogEntityVersionUnknownError extends Error {
  constructor(readonly family: string, readonly entityId: string) {
    super(
      `No se conoce la versión de ${family} ${entityId} en esta sesión; recargá el catálogo antes de volver a guardar.`,
    );
    this.name = 'CatalogEntityVersionUnknownError';
  }
}