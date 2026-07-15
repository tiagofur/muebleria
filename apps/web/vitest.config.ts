import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    css: false,
  },
  resolve: {
    alias: [
      {
        find: '@muebles/domain/fixtures',
        replacement: new URL(
          '../../packages/domain/src/__fixtures__/plantillaDemo.ts',
          import.meta.url,
        ).pathname,
      },
      {
        find: '@muebles/domain',
        replacement: new URL(
          '../../packages/domain/src/index.ts',
          import.meta.url,
        ).pathname,
      },
      {
        find: '@muebles/storage/seed',
        replacement: new URL(
          '../../packages/storage/src/seed.ts',
          import.meta.url,
        ).pathname,
      },
      {
        find: '@muebles/storage',
        replacement: new URL(
          '../../packages/storage/src/index.ts',
          import.meta.url,
        ).pathname,
      },
      {
        find: '@muebles/ui/design-system',
        replacement: new URL(
          '../../packages/ui/src/design-system',
          import.meta.url,
        ).pathname,
      },
      {
        find: /^@muebles\/ui$/,
        replacement: new URL(
          '../../packages/ui/src/index.ts',
          import.meta.url,
        ).pathname,
      },
      {
        // Full-id match: id.replace(find, replacement) must yield the mock path.
        find: /.+\.css$/,
        replacement: new URL('./src/__test__/styleMock.ts', import.meta.url)
          .pathname,
      },
    ],
  },
});
