/**
 * consumeRequestCreateKey — sticky create key consume (JD R4-W).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeRequestCreateKey,
  resetRequestCreateKeyConsumers,
} from './consumeRequestCreateKey';

afterEach(() => {
  resetRequestCreateKeyConsumers();
});

describe('consumeRequestCreateKey', () => {
  it('returns false for 0 / undefined', () => {
    expect(consumeRequestCreateKey('modules', 0)).toBe(false);
    expect(consumeRequestCreateKey('modules', undefined)).toBe(false);
  });

  it('consumes a new key once', () => {
    expect(consumeRequestCreateKey('modules', 1)).toBe(true);
    expect(consumeRequestCreateKey('modules', 1)).toBe(false);
  });

  it('allows a bumped key after consume', () => {
    expect(consumeRequestCreateKey('modules', 1)).toBe(true);
    expect(consumeRequestCreateKey('modules', 2)).toBe(true);
    expect(consumeRequestCreateKey('modules', 2)).toBe(false);
  });

  it('scopes keys per screen', () => {
    expect(consumeRequestCreateKey('modules', 1)).toBe(true);
    expect(consumeRequestCreateKey('materials', 1)).toBe(true);
    expect(consumeRequestCreateKey('modules', 1)).toBe(false);
  });
});
