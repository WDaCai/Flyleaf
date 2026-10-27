import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./apps/desktop/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@yan\/ui\/tokens\.css$/, replacement: r('./ui/src/tokens.css') },
      { find: /^@yan\/core\/contracts$/, replacement: r('./core/src/contracts.ts') },
      { find: /^@yan\/core\/client$/, replacement: r('./core/src/client/index.ts') },
      { find: /^@yan\/core$/, replacement: r('./core/src/index.ts') },
      { find: /^@yan\/ui$/, replacement: r('./ui/src/index.ts') },
    ],
  },
  build: {
    outDir: r('./apps/desktop/dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(r('./apps/desktop/renderer'), 'index.html'),
        card: path.resolve(r('./apps/desktop/renderer'), 'card.html'),
      },
    },
  },
});
