import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../source/', import.meta.url));
export default { root, cacheDir: fileURLToPath(new URL('./.drilling-context-vite/', import.meta.url)), test: { environment: 'node', include: [fileURLToPath(new URL('./drilling-context.test.ts', import.meta.url))], maxWorkers: 1, minWorkers: 1 }, resolve: { alias: { vitest: root + 'node_modules/vitest/dist/index.js' } } };
