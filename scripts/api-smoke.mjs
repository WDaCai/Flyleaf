// API 冒烟测试：用 Node 原生 fetch，确保 UTF-8 正确
const BASE = process.env.YAN_API ?? 'http://127.0.0.1:5174/api/v1';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const FW = '50-frameworks/实时渲染.md';
const enc = encodeURIComponent;

console.log('· vault');
const info = await call('GET', '/vault');
check('vault info', info.status === 200 && info.json.noteCount >= 5, JSON.stringify(info.json));

const tree = await call('GET', '/vault/tree');
check('tree has dirs', tree.status === 200 && tree.json.some((n) => n.name === '50-frameworks'));

console.log('· framework');
const fw = await call('GET', `/framework?path=${enc(FW)}`);
check('framework 解析', fw.status === 200 && fw.json.root.children.length === 3, JSON.stringify(fw.json?.stats));
check('中文节点正确', fw.json?.root.children[0]?.text === '光栅化', fw.json?.root.children[0]?.text);
check('统计合计', fw.json?.stats.total === fw.json?.stats.todo + fw.json.stats.learning + fw.json.stats.known + fw.json.stats.used);

const line10 = fw.json.root.children[0].children[2];
check('第 10 行是 Early-Z', line10.line === 10, String(line10.line));

const setRes = await call('POST', '/framework/state', { path: FW, line: 10, state: 'known' });
check(
  'setState 成功',
  setRes.status === 200 && setRes.json.stats.known === fw.json.stats.known + 1,
  JSON.stringify(setRes.json?.stats ?? setRes.json),
);

const expandRes = await call('POST', '/framework/expand', { path: FW, line: 8 });
check(
  'expand 建文件',
  expandRes.status === 200 && expandRes.json?.doc?.path?.startsWith('50-frameworks/nodes/'),
  JSON.stringify(expandRes.json?.doc?.path ?? expandRes.json),
);
check(
  'expand 后有链接',
  expandRes.json?.tree?.root?.children?.[0]?.children?.[0]?.target?.kind === 'file',
  JSON.stringify(expandRes.json?.tree?.root?.children?.[0]?.children?.[0]?.target),
);

console.log('· capture');
await call('PUT', '/capture/draft', { text: '临时草稿内容' });
const draft = await call('GET', '/capture/draft');
check('草稿回读', draft.json.text === '临时草稿内容', draft.json.text);

const arc = await call('POST', '/capture/archive', { text: '来自冒烟测试的一条' });
check('归档返回位置', arc.status === 200 && arc.json.file.startsWith('00-inbox/'), JSON.stringify(arc.json));

const afterArc = await call('GET', `/note?path=${enc(arc.json.file)}`);
check('归档写入中文', afterArc.json.body.includes('来自冒烟测试的一条'), afterArc.json.body);
check('归档后草稿清空', (await call('GET', '/capture/draft')).json.text === '');

console.log('· 写回');
const notePath = '10-pitfalls/材质实例打包丢失参数.md';
const doc = await call('GET', `/note?path=${enc(notePath)}`);
check('读取笔记', doc.status === 200 && doc.json.frontmatter.title.includes('材质'), JSON.stringify(doc.json?.frontmatter));

const same = await call('PUT', '/note', { path: notePath, body: doc.json.body, mtimeMs: doc.json.mtimeMs });
check('原样写回', same.status === 200 && same.json.mtimeMs === doc.json.mtimeMs, `${same.json?.mtimeMs} vs ${doc.json.mtimeMs}`);

const conflict = await call('PUT', '/note', { path: notePath, body: doc.json.body + '\n', mtimeMs: 1 });
check('冲突检测 409', conflict.status === 409, String(conflict.status));

console.log('· 搜索');
const hits = await call('GET', `/search?q=${enc('材质')}`);
check('中文搜索有结果', hits.status === 200 && hits.json.length > 0, JSON.stringify(hits.json?.length));
check('搜索结果含标题', hits.json.some((h) => h.title.includes('材质')), JSON.stringify(hits.json.map((h) => h.title)));
const none = await call('GET', `/search?q=${enc('骨骼动画蒙皮')}`);
check('无关词无结果', none.status === 200 && none.json.length === 0, String(none.json?.length));

console.log('· 资源');
const png1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const asset = await call('POST', '/assets/image', { dataUrl: png1x1 });
check('图片落盘', asset.status === 200 && asset.json.relPath.startsWith('assets/'), JSON.stringify(asset.json));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
