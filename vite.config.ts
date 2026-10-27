import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./apps/web'),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@flyleaf\/ui\/tokens\.css$/, replacement: r('./ui/src/tokens.css') },
      { find: /^@flyleaf\/core\/contracts$/, replacement: r('./core/src/contracts.ts') },
      { find: /^@flyleaf\/core\/client$/, replacement: r('./core/src/client/index.ts') },
      { find: /^@flyleaf\/core$/, replacement: r('./core/src/index.ts') },
      { find: /^@flyleaf\/ui$/, replacement: r('./ui/src/index.ts') },
      { find: /^@flyleaf\/app$/, replacement: r('./apps/web/src') },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: r('./dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(r('./apps/web'), 'index.html'),
        card: path.resolve(r('./apps/web'), 'card.html'),
      },
    },
  },
});
