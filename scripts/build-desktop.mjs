// 构建桌面壳：主进程 + preload（esbuild）+ 两个渲染入口（vite）
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'apps', 'desktop', 'dist');

async function bundle(entry, outfile) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(out, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    sourcemap: false,
    logLevel: 'info',
  });
}

await bundle('apps/desktop/src/app-main.ts', 'main.cjs');
await bundle('apps/desktop/src/preload.ts', 'preload.cjs');

const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const res = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.config.desktop.ts'], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
