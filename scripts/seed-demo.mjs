import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.local-vault');
const w = async (rel, content) => {
  const abs = path.join(root, ...rel.split('/'));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
};

// 只在演示目录上清空，避免误删真实 vault
if (path.basename(root) === '.local-vault') {
  await fs.rm(root, { recursive: true, force: true });
}
await fs.mkdir(root, { recursive: true });

await w(
  '50-frameworks/实时渲染.md',
  `---
type: framework
title: 实时渲染
updated: 2026-10-27T20:00:00+08:00
---

## 光栅化
- [x] 三角形光栅化
- [x] 深度测试与 Z-Fighting [[深度测试]]
- [~] Early-Z 为什么失效
  - [ ] 半透明与深度写入
- [ ] 背面剔除与绕序
## PBR
- [ ] 微表面模型
- [ ] 能量守恒
- [*] 金属度/粗糙度工作流
## 性能
- [~] DrawCall 与合批
- [ ] LOD 与 Nanite
- [ ] 遮挡剔除
`,
);

await w(
  '30-knowledge/深度测试.md',
  `---
type: knowledge
title: 深度测试
tags: [渲染, 深度]
created: 2026-10-20T10:00:00+08:00
updated: 2026-10-26T11:00:00+08:00
---

# 深度测试

深度测试决定片元能否写入颜色缓冲。Z-Fighting 通常来自近裁面过近或精度不足。

相关：[[材质实例打包丢失参数]]
`,
);

await w(
  '10-pitfalls/材质实例打包丢失参数.md',
  `---
type: pitfall
title: 材质实例打包后丢失参数
project: 项目A
engine: UE 5.4.2
platform: Android / Vulkan
tags: [材质, 打包]
nodes: [深度测试]
status: solved
created: 2026-10-24T14:30:00+08:00
updated: 2026-10-24T15:02:00+08:00
---

## 症状

编辑器里正常，Android Development 包内材质变默认灰。

## 环境

UE 5.4.2 · Android Vulkan · Development 打包

## 原因

父材质增删过参数，实例的序列化错位。

## 解法

父材质改参数后，对所有实例跑一次 Fixup Material Instances，并重新保存。

## 验证

重新打包 → 进关卡三处材质正常 → log 无 warning。
`,
);

await w(
  '20-experiments/LOD 策略对比.md',
  `---
type: experiment
title: LOD 策略调整对比
project: 项目A
engine: UE 5.4.2
platform: Android
metrics: [frametime, drawcall, vram]
created: 2026-10-25T12:30:00+08:00
updated: 2026-10-25T13:00:00+08:00
---

| 版本   | 设备    | 帧时间(ms) | DrawCall | 显存(MB) |
| ------ | ------- | ---------- | -------- | -------- |
| before | Pixel 7 | 18.2       | 1420     | 812      |
| after  | Pixel 7 | 14.1       | 1180     | 806      |
`,
);

await w(
  '40-weekly/2026-W43.md',
  `---
type: weekly
title: 2026 W43
created: 2026-10-24T18:00:00+08:00
updated: 2026-10-24T18:00:00+08:00
---

## 可复用的产出

- 材质实例修复脚本
- LOD 策略对比数据

## 是否救火

周二救火一次，其余按计划。

## 层位变化

这周开始拥有资产检查脚本。
`,
);

await w('00-inbox/2026-10-27.md', `# 2026-10-27\n\n- 09:12 美术说 UI 贴图要 1024 起步\n`);

console.log(`demo vault ready: ${root}`);
