import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDesktopShell } from './main';
import { PACKAGE_NAME } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');

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

describe('Electron host files (F032 / #38)', () => {
  it('ships main + preload entries for BrowserWindow', () => {
    const mainPath = join(desktopRoot, 'electron/main.mjs');
    const preloadPath = join(desktopRoot, 'electron/preload.cjs');
    expect(existsSync(mainPath)).toBe(true);
    expect(existsSync(preloadPath)).toBe(true);
    const main = readFileSync(mainPath, 'utf8');
    expect(main).toContain('BrowserWindow');
    expect(main).toContain('excel:showSaveDialog');
    expect(main).toContain('excel:writeExcelFile');
    expect(main).not.toMatch(/calcProjectBreakdown|resolveBom/);
    const preload = readFileSync(preloadPath, 'utf8');
    expect(preload).toContain('electronAPI');
    expect(preload).toContain('contextBridge');
  });

  it('package.json points main to electron host and exposes dev scripts', () => {
    const pkg = JSON.parse(
      readFileSync(join(desktopRoot, 'package.json'), 'utf8'),
    ) as {
      main?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.main).toBe('./electron/main.mjs');
    expect(pkg.scripts?.dev).toContain('electron');
    expect(pkg.scripts?.['dev:app']).toBeTruthy();
    expect(pkg.devDependencies?.electron).toBeTruthy();
  });
});
