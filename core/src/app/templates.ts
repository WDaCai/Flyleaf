import type { NoteType } from '../contracts';

export const DEFAULT_DIRS: Record<NoteType, string> = {
  pitfall: '10-pitfalls',
  experiment: '20-experiments',
  knowledge: '30-knowledge',
  weekly: '40-weekly',
  framework: '50-frameworks',
  note: '00-inbox',
};

export const DEFAULT_TEMPLATES: Record<NoteType, string> = {
  pitfall: ['## 症状', '', '## 环境', '', '## 原因', '', '## 解法', '', '## 验证', ''].join('\n'),
  experiment: [
    '| 版本 | 设备 | 帧时间(ms) | DrawCall | 显存(MB) |',
    '| --- | --- | --- | --- | --- |',
    '| before |  |  |  |  |',
    '| after |  |  |  |  |',
    '',
  ].join('\n'),
  knowledge: '',
  weekly: ['## 可复用的产出', '', '## 是否救火', '', '## 层位变化', ''].join('\n'),
  framework: ['## ', ''].join('\n'),
  note: '',
};

export const VAULT_DIRS = [
  '00-inbox',
  '10-pitfalls',
  '20-experiments',
  '30-knowledge',
  '40-weekly',
  '50-frameworks',
  '50-frameworks/nodes',
  'assets',
  '.yan',
  '.yan/templates',
  '.yan/scratch',
  '.yan/ui',
];

export const VAULT_VERSION = '1';
