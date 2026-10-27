import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@flyleaf/core': r('./core/src/index.ts'),
      '@flyleaf/core/contracts': r('./core/src/contracts.ts'),
      '@flyleaf/core/client': r('./core/src/client/index.ts'),
      '@flyleaf/ui': r('./ui/src/index.ts'),
    },
  },
  test: {
    include: ['core/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
