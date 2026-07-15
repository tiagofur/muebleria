import { describe, expect, it } from 'vitest';
import { createDesktopShell } from './main';
import { PACKAGE_NAME } from './index';

describe('@muebles/desktop scaffold', () => {
  it('exports package identity', () => {
    expect(PACKAGE_NAME).toBe('@muebles/desktop');
  });

  it('wires domain and storage package names', () => {
    const shell = createDesktopShell();
    expect(shell.name).toBe('@muebles/desktop');
    expect(shell.domain).toBe('@muebles/domain');
    expect(shell.storage).toBe('@muebles/storage');
  });
});
