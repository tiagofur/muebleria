/**
 * Raw ZPL print handler builder (Etiquetas tab — plant thermal printing).
 *
 * Platform strategy:
 * - darwin/linux: CUPS `lp -d <printer> -o raw -` with the payload on stdin.
 * - win32: temp file + `copy /b` to the printer share/port name.
 * Deps are injected so tests never spawn real processes.
 */

import type { ElectronPrintRawResult } from './electronApi';

export interface PrintRawDeps {
  readonly platform: NodeJS.Platform;
  /** execFile(file, args, opts, callback)-style with stdin support. */
  readonly execFile: (
    file: string,
    args: readonly string[],
    options: { readonly input?: string },
  ) => Promise<{ readonly stdout: string; readonly stderr: string }>;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly writeFile: (path: string, data: string) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
}

export function createPrintRawHandler(deps: PrintRawDeps) {
  return async (
    printerName: string,
    payload: string,
  ): Promise<ElectronPrintRawResult> => {
    const printer = printerName.trim();
    if (!printer) {
      return { ok: false, error: 'Falta el nombre de la impresora' };
    }
    if (!payload.trim()) {
      return { ok: false, error: 'No hay etiquetas para imprimir' };
    }
    try {
      if (deps.platform === 'win32') {
        const dir = await deps.mkdtemp('muebles-zpl-');
        const file = `${dir}/labels.zpl`;
        await deps.writeFile(file, payload);
        try {
          await deps.execFile('cmd', ['/c', 'copy', '/b', file, printer], {});
        } finally {
          await deps.unlink(file).catch(() => undefined);
        }
        return { ok: true };
      }
      // darwin / linux (CUPS).
      const { stderr } = await deps.execFile(
        'lp',
        ['-d', printer, '-o', 'raw', '-'],
        { input: payload },
      );
      if (stderr && /error|unable/i.test(stderr)) {
        return { ok: false, error: stderr.trim() };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Error al imprimir',
      };
    }
  };
}
