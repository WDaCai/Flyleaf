// 轻量壳：Vite 网页 + esbuild 打包的 Node 核心 + 系统 WebView2 宿主
// 白话：lite 主窗 + 随记卡是当前分发形态，不做网站/同步；产物默认 release/Flyleaf，可用 FLYLEAF_INSTALL 刷到安装目录。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseDir = path.join(root, 'release', 'Flyleaf');
const sdkRoot = path.join(root, 'shell', 'lite', '.sdk');
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`${path.basename(cmd)} 退出码 ${res.status ?? 'null'}`);
  }
}

async function buildWeb() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  run(process.execPath, [vite, 'build', '--config', 'vite.config.ts']);
}

async function buildServer() {
  const outfile = path.join(root, 'dist', 'lite', 'server.cjs');
  await build({
    entryPoints: [path.join(root, 'core', 'src', 'dev', 'server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: false,
    logLevel: 'info',
  });
  return outfile;
}

function sdkPaths(dest) {
  return {
    core: path.join(dest, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'),
    winforms: path.join(dest, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll'),
    loader: path.join(dest, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'),
  };
}

function cachedSdk() {
  if (!fs.existsSync(sdkRoot)) return null;
  const versions = fs
    .readdirSync(sdkRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const version = versions[i];
    const files = sdkPaths(path.join(sdkRoot, version));
    if (fs.existsSync(files.core) && fs.existsSync(files.winforms) && fs.existsSync(files.loader)) {
      return { version, ...files };
    }
  }
  return null;
}

async function ensureSdk() {
  const cached = cachedSdk();
  if (cached) return cached;
  const indexRes = await fetch('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json');
  if (!indexRes.ok) throw new Error(`NuGet index ${indexRes.status}`);
  const index = await indexRes.json();
  const version = index.versions.at(-1);
  if (!version) throw new Error('WebView2 SDK 没有版本');
  const dest = path.join(sdkRoot, version);
  const files = sdkPaths(dest);
  if (fs.existsSync(files.core) && fs.existsSync(files.winforms) && fs.existsSync(files.loader)) {
    return { version, ...files };
  }
  fs.mkdirSync(dest, { recursive: true });
  const nupkg = path.join(sdkRoot, `microsoft.web.webview2.${version}.nupkg`);
  if (!fs.existsSync(nupkg)) {
    const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${version}/microsoft.web.webview2.${version}.nupkg`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载 WebView2 SDK 失败 ${res.status}`);
    fs.writeFileSync(nupkg, Buffer.from(await res.arrayBuffer()));
  }
  run('tar', ['-xf', nupkg, '-C', dest]);
  if (!fs.existsSync(files.core) || !fs.existsSync(files.loader)) {
    throw new Error(`SDK 解压后缺少 DLL：${dest}`);
  }
  return { version, ...files };
}

function compile(sdk) {
  if (!fs.existsSync(csc)) throw new Error(`找不到 csc.exe：${csc}`);
  const src = fs.readFileSync(path.join(root, 'shell', 'lite', 'Host.cs'));
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const tmpDir = path.join(root, 'dist', 'lite');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpSrc = path.join(tmpDir, 'Host.cs');
  fs.writeFileSync(tmpSrc, Buffer.concat([bom, src]));
  const exe = path.join(tmpDir, 'Flyleaf.exe');
  run(csc, [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:x64',
    '/warn:4',
    `/out:${exe}`,
    `/win32manifest:${path.join(root, 'shell', 'lite', 'app.manifest')}`,
    `/win32icon:${path.join(root, 'shell', 'lite', 'flyleaf.ico')}`,
    '/reference:System.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    `/reference:${sdk.core}`,
    `/reference:${sdk.winforms}`,
    tmpSrc,
  ]);
  return exe;
}

function assemble(serverFile, exe, sdk) {
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.copyFileSync(exe, path.join(releaseDir, 'Flyleaf.exe'));
  fs.copyFileSync(sdk.core, path.join(releaseDir, 'Microsoft.Web.WebView2.Core.dll'));
  fs.copyFileSync(sdk.winforms, path.join(releaseDir, 'Microsoft.Web.WebView2.WinForms.dll'));
  fs.copyFileSync(sdk.loader, path.join(releaseDir, 'WebView2Loader.dll'));
  fs.copyFileSync(serverFile, path.join(releaseDir, 'server.cjs'));
  fs.copyFileSync(path.join(root, 'shell', 'lite', 'launch.vbs'), path.join(releaseDir, 'launch.vbs'));
  fs.cpSync(path.join(root, 'dist', 'web'), path.join(releaseDir, 'renderer'), { recursive: true });
}


function syncInstall(from) {
  const dest = process.env.FLYLEAF_INSTALL || 'E:\\Flyleaf';
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch {
    /* ignore */
  }
  // robocopy：被占用文件（运行中的 Flyleaf.exe / WebView2 dll）会失败，其余照刷
  const res = spawnSync(
    'robocopy',
    [from, dest, '/E', '/IS', '/IT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS'],
    { encoding: 'utf8' },
  );
  // robocopy 位标志：0–7 全成；8–15 = 有失败但仍有复制（常见于 exe 占用）
  const code = res.status ?? 16;
  if (code >= 16) {
    console.warn('[flyleaf] 刷安装目录严重失败（robocopy ' + code + '）：' + dest);
    if (res.stderr) console.warn(res.stderr);
    return;
  }
  const running = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Flyleaf.exe', '/NH'], { encoding: 'utf8' });
  const busy = (running.stdout || '').toLowerCase().includes('flyleaf.exe');
  if (code >= 8 || busy) {
    console.warn('[flyleaf] 已刷到 ' + dest + '（部分文件占用未更新，多为 Flyleaf.exe；关进程后重跑即可）');
  } else {
    console.log('[flyleaf] 已刷到安装目录 ' + dest);
  }
}

function report() {
  let bytes = 0;
  let files = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs);
      else {
        files += 1;
        bytes += st.size;
      }
    }
  };
  walk(releaseDir);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`\n[flyleaf] ${releaseDir}`);
  console.log(`[flyleaf] ${mb} MB · ${files} 个文件（不含 Node 运行时）`);
}

const serverFile = await buildServer();
await buildWeb();
const sdk = await ensureSdk();
console.log(`[flyleaf] WebView2 SDK ${sdk.version}`);
const exe = compile(sdk);
assemble(serverFile, exe, sdk);
report();
syncInstall(releaseDir);
