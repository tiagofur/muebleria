import { describe, expect, it } from 'vitest';

import {
  PACKAGE_NAME,
  SCHEMA_VERSION,
  createSeedWorkspace,
} from './index';

describe('@granete/storage exports', () => {
  it('exports package identity and storage surface', () => {
    expect(PACKAGE_NAME).toBe('@granete/storage');
    expect(SCHEMA_VERSION).toBe(3);
    expect(typeof createSeedWorkspace).toBe('function');
  });
});
