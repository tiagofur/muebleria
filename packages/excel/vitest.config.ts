import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@muebles/domain/fixtures': new URL(
        '../domain/src/__fixtures__/plantillaDemo.ts',
        import.meta.url,
      ).pathname,
      '@muebles/domain': new URL('../domain/src/index.ts', import.meta.url)
        .pathname,
    },
  },
});
