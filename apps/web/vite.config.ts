import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },

  resolve: {
    alias: [
      {
        find: '@granete/domain/fixtures',
        replacement: path.resolve(
          rootDir,
          '../../packages/domain/src/__fixtures__/plantillaDemo.ts',
        ),
      },
      {
        find: '@granete/domain',
        replacement: path.resolve(
          rootDir,
          '../../packages/domain/src/index.ts',
        ),
      },
      {
        find: '@granete/storage/seed',
        replacement: path.resolve(
          rootDir,
          '../../packages/storage/src/seed.ts',
        ),
      },
      {
        find: '@granete/ui/design-system',
        replacement: path.resolve(
          rootDir,
          '../../packages/ui/src/design-system',
        ),
      },
      {
        find: /^@muebles\/ui$/,
        replacement: path.resolve(rootDir, '../../packages/ui/src/index.ts'),
      },
    ],
  },
});
