// 分层边界检查：把「只能向下依赖」这条规则变成可执行的门禁
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const RULES = [
  {
    dir: 'core/src/domain',
    forbid: [/^node:/, /^fastify/, /^chokidar/, /^electron/, /^react/, /^\.\.\/infra/, /^\.\.\/app/, /^\.\.\/api/],
    why: 'domain 必须是零依赖纯函数',
  },
  {
    dir: 'core/src/app',
    forbid: [/^node:fs/, /^node:path$/, /^chokidar/, /^electron/, /^react/, /^fastify/, /^\.\.\/infra/],
    why: 'app 只依赖 domain + ports，IO 必须通过端口注入',
  },
  {
    dir: 'core/src/ports',
    forbid: [/^node:/, /^fastify/, /^chokidar/, /^electron/, /^react/],
    why: 'ports 只放接口定义',
  },
];

const APP_FORBID = [
  { pattern: /from\s+['"]@yan\/core\/(domain|app|infra|api|ports)/, why: '壳层只能通过 client / contracts 访问核心' },
  { pattern: /from\s+['"].*core\/src\/(domain|app|infra|api|ports)/, why: '壳层只能通过 client / contracts 访问核心' },
];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
let violations = 0;

for (const rule of RULES) {
  const files = await walk(path.join(root, rule.dir));
  for (const file of files) {
    if (file.includes('.test.')) continue;
    const src = await fs.readFile(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (rule.forbid.some((re) => re.test(spec))) {
        violations++;
        console.error(`✗ ${path.relative(root, file)} 不能 import "${spec}" —— ${rule.why}`);
      }
    }
  }
}

const appFiles = [...(await walk(path.join(root, 'apps'))), ...(await walk(path.join(root, 'ui')))];
for (const file of appFiles) {
  if (file.includes('node_modules') || file.includes(`${path.sep}dist${path.sep}`)) continue;
  const src = await fs.readFile(file, 'utf8');
  for (const rule of APP_FORBID) {
    if (rule.pattern.test(src)) {
      violations++;
      console.error(`✗ ${path.relative(root, file)} —— ${rule.why}`);
    }
  }
}

if (violations === 0) {
  console.log('✓ 分层边界检查通过');
} else {
  console.error(`\n共 ${violations} 处越界`);
  process.exit(1);
}
