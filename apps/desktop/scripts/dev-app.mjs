/**
 * Dev helper: wait for Vite (web) then launch Electron host.
 * Usage (from repo root):
 *   pnpm --filter @muebles/web dev   # terminal 1
 *   pnpm --filter @muebles/desktop dev:app
 *
 * Or single command from desktop package after web is up.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const maxAttempts = Number(process.env.ELECTRON_WAIT_ATTEMPTS || 60);
const delayMs = Number(process.env.ELECTRON_WAIT_MS || 500);

async function waitForUrl(target) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(target, { method: 'GET' });
      if (res.ok || res.status === 304) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Vite dev server not reachable at ${target}. Start: pnpm --filter @muebles/web dev`,
  );
}

await waitForUrl(url);

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.'],
  {
    cwd: desktopRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_DEV: '1',
      VITE_DEV_SERVER_URL: url,
    },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
