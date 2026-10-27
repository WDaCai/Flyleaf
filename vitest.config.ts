import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@yan/core': r('./core/src/index.ts'),
      '@yan/core/contracts': r('./core/src/contracts.ts'),
      '@yan/core/client': r('./core/src/client/index.ts'),
      '@yan/ui': r('./ui/src/index.ts'),
    },
  },
  test: {
    include: ['core/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
