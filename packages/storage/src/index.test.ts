import { describe, expect, it } from 'vitest';

import {
  PACKAGE_NAME,
  SCHEMA_VERSION,
  createSeedWorkspace,
} from './index';

describe('@muebles/storage exports', () => {
  it('exports package identity and storage surface', () => {
    expect(PACKAGE_NAME).toBe('@muebles/storage');
    expect(SCHEMA_VERSION).toBe(2);
    expect(typeof createSeedWorkspace).toBe('function');
  });
});
