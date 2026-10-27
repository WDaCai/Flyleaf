// UI 截图脚本：用本机 Chrome 无头模式验证界面
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.YAN_WEB ?? 'http://localhost:5173/';
const OUT = path.resolve('shots');

await fs.mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(OUT, '01-home.png') });

// 打开知识框架
const opened = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.tree-row.file')].find((el) => el.textContent?.includes('实时渲染'));
  if (!row) return false;
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(OUT, '02-framework-outline.png') });

// 切导图
const mind = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.seg button')].find((el) => el.textContent?.trim() === '导图');
  if (!b) return false;
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
await new Promise((r) => setTimeout(r, 1100));
await page.screenshot({ path: path.join(OUT, '03-mindmap.png') });

// 打开一篇踩坑笔记（预览模式）
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.tree-row.file')].find((el) => el.textContent?.includes('材质实例'));
  row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: path.join(OUT, '04-note-edit.png') });

await page.keyboard.down('Control');
await page.keyboard.press('KeyE');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: path.join(OUT, '05-note-preview.png') });

// 命令面板
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, '06-palette.png') });

console.log(JSON.stringify({ openedFramework: opened, mindmap: mind, errors }, null, 2));
await browser.close();
