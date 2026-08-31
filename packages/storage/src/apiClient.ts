import { GraneteApiError, parseApiError } from './apiErrors';
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
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      signal: options.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
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
