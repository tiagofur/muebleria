/**
 * Runtime-agnostic SHA-256 hex helper for artifact/profile digests.
 *
 * Uses the platform WebCrypto subtle digest (Node >= 20 and browsers), so the
 * same code path runs in vitest and in the web app. Digests here identify
 * deterministic outputs for evidence — they are not a security boundary.
 */

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const data = bytes as Parameters<typeof crypto.subtle.digest>[1];
  const digest = await crypto.subtle.digest('SHA-256', data);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Deterministic JSON: sorted object keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortValue(record[key])]),
    );
  }
  return value;
}
