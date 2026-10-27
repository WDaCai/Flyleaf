// 打一个可分发的精简桌面包：electron dist + 我们的 app，剔除多语言包等冗余
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const srcDist = path.join(root, 'node_modules', 'electron', 'dist');
const outDir = path.join(root, 'release', 'Yan');
const appDir = path.join(outDir, 'resources', 'app');

const KEEP_LOCALES = new Set(['zh-CN.pak', 'en-US.pak']);
const DROP = [/^LICENSES\.chromium\.html$/i, /^LICENSES\.chromium\.html\.sha256$/i, /^version$/];

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function copyDir(from, to, filter) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (filter && !filter(entry.name, from)) continue;
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, filter);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  await rmrf(outDir);
  await copyDir(srcDist, outDir, (name, dir) => {
    if (path.basename(dir) === 'locales') return KEEP_LOCALES.has(name);
    if (DROP.some((re) => re.test(name))) return false;
    return true;
  });

  // 主程序改名，双击即可启动
  const exe = path.join(outDir, 'electron.exe');
  if (await fs.stat(exe).then(() => true).catch(() => false)) {
    await fs.rename(exe, path.join(outDir, 'Yan.exe'));
  }

  await fs.mkdir(appDir, { recursive: true });

  const pkg = {
    name: 'yan-desktop',
    productName: 'Yan',
    version: '0.2.0',
    main: 'main.cjs',
  };
  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  for (const f of ['main.cjs', 'preload.cjs']) {
    await fs.copyFile(path.join(root, 'apps', 'desktop', 'dist', f), path.join(appDir, f));
  }
  await copyDir(path.join(root, 'apps', 'desktop', 'dist', 'renderer'), path.join(appDir, 'renderer'));

  let total = 0;
  let files = 0;
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const st = await fs.stat(p);
        total += st.size;
        files += 1;
      }
    }
  };
  await walk(outDir);

  console.log(`打包完成：${outDir}`);
  console.log(`体积：${(total / 1024 / 1024).toFixed(1)} MB · ${files} 个文件`);
  console.log(`启动：${path.join(outDir, 'Yan.exe')}`);
}

await main();
