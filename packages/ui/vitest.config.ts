import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test.ts,test.tsx}'],
    css: false,
  },
  resolve: {
    alias: {
      '@muebles/domain': new URL('../domain/src/index.ts', import.meta.url)
        .pathname,
      // CSS imports from catalog screens are no-ops in unit tests
      '\\.css$': new URL('./src/__test__/styleMock.ts', import.meta.url)
        .pathname,
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
});
