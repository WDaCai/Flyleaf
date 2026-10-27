// 同时启动 API 服务与 Vite 开发服务器
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';

function run(script) {
  const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', script], {
    stdio: 'inherit',
    shell: isWin,
  });
  child.on('exit', (code) => {
    console.log(`[dev] ${script} 退出：${code}`);
    process.exit(code ?? 0);
  });
  return child;
}

const server = run('dev:server');
setTimeout(() => run('dev:web'), 1200);

process.on('SIGINT', () => {
  server.kill();
  process.exit(0);
});
