// 便携包：在 build:lite 产物上再打一份可拷贝目录 + zip（不推 GitHub）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseDir = path.join(root, 'release', 'Flyleaf');
const portableDir = path.join(root, 'release', 'Flyleaf-portable');
const zipPath = path.join(root, 'release', 'Flyleaf-portable.zip');

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) throw new Error(`${cmd} 退出码 ${res.status ?? 'null'}`);
}

// 1) 确保 lite 已构建
if (!fs.existsSync(path.join(releaseDir, 'Flyleaf.exe'))) {
  console.log('[portable] 先跑 build:lite …');
  run('npm', ['run', 'build:lite']);
}

fs.rmSync(portableDir, { recursive: true, force: true });
fs.mkdirSync(portableDir, { recursive: true });
fs.cpSync(releaseDir, portableDir, { recursive: true });

// vault.path 示例（注释行，用户取消注释或改成自己的库路径）
const vaultExample = `# 把下一行改成你的笔记库绝对路径（或相对本目录），去掉开头的 # 后保存。
# 也可用环境变量 FLYLEAF_VAULT。都不设时默认 Documents\\flyleaf-vault。
# D:\\Notes
`;
fs.writeFileSync(path.join(portableDir, 'vault.path.example'), vaultExample, 'utf8');

const readmeSrc = path.join(root, 'docs', 'README-PORTABLE.md');
const readmeBody = fs.existsSync(readmeSrc)
  ? fs.readFileSync(readmeSrc, 'utf8')
  : '见仓库 docs/README-PORTABLE.md\n';
fs.writeFileSync(path.join(portableDir, 'README-PORTABLE.md'), readmeBody, 'utf8');

// zip（优先 PowerShell Compress-Archive）
fs.rmSync(zipPath, { force: true });
const ps = `Compress-Archive -Path '${portableDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
const z = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
if (z.status !== 0) {
  console.warn('[portable] zip 失败，目录包仍可用：' + portableDir);
} else {
  console.log('[portable] zip → ' + zipPath);
}
console.log('[portable] dir → ' + portableDir);