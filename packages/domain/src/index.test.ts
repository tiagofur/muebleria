import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@granete/domain scaffold', () => {
  it('exports package identity', () => {
    expect(PACKAGE_NAME).toBe('@granete/domain');
  });
});
