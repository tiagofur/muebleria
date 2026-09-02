import { createHmac } from 'node:crypto';

/** RFC 6238 TOTP helper for the browser gate (mirrors the backend profile:
 * SHA1, 6 digits, 30s period, ±1 window). Node-side only. */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, offsetIntervals = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offsetIntervals;
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** Extracts the base32 secret from an otpauth:// provisioning URI. */
export function secretFromProvisioningUri(uri: string): string {
  const idx = uri.indexOf('secret=');
  if (idx < 0) throw new Error(`provisioning uri without secret: ${uri}`);
  return decodeURIComponent(uri.slice(idx + 'secret='.length).split('&')[0]!);
}

/**
 * Tracks the accepted-counter high-water mark like the server: a second
 * verification within the same 30s interval uses the future slot of the ±1
 * window; a third waits for the next interval (bounded, gate-only).
 */
export class TotpProvider {
  #last = -1;

  constructor(private readonly secret: string) {}

  next(): string {
    const current = Math.floor(Date.now() / 30_000);
    let candidate = this.#last + 1;
    if (candidate < current) candidate = current;
    if (candidate > current + 1) {
      throw new Error('TOTP window exhausted: wait for the next interval');
    }
    this.#last = candidate;
    return totp(this.secret, candidate - current);
  }
}
