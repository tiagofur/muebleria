import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@granete/domain/fixtures': new URL(
        '../domain/src/__fixtures__/plantillaDemo.ts',
        import.meta.url,
      ).pathname,
      '@granete/domain': new URL('../domain/src/index.ts', import.meta.url)
        .pathname,
    },
  },
});
