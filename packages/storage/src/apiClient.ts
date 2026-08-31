import { GraneteApiError, GraneteNetworkError, parseApiError } from './apiErrors';
import {
  parseGenerated,
  parseGeneratedArray,
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
      ? parseGenerated(options.bodySchema as SchemaName, options.body)
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
}
