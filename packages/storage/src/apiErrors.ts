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

export function parseApiError(value: unknown): ApiError {
  return parseGenerated<ApiError>('ApiError', value);
}
