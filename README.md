# BAMT 项目目录

当前主项目是 pps/bamt-next，旧版脚本、打包产物和素材已经按用途归档。

## 顶层目录

- pps/bamt-next/：新版主项目，Electron + React + TypeScript 前端，Python Windows 输入后端。
- legacy/early-scripts/：早期单文件 Python 实验版本。
- legacy/versioned-python/：按 2.0、3.0、5.0 保留的历史版本。
- legacy/tkinter-package/：旧 Tkinter 发布目录和可执行文件。
- legacy/published-python/：最终发布阶段留下的 Python 源文件。
- config-samples/：旧版 JSON 配置样例。
- untime-logs/：历史运行日志。
- eleases/archives/：历史压缩包和可分发包。
- eleases/media/：封面、截图、原视频等发布素材。

## 新版源码结构

`	ext
apps/bamt-next
├─ backend/
│  ├─ macro_service.py
│  └─ requirements.txt
├─ electron/
│  ├─ main.ts
│  └─ preload.ts
├─ src/
│  ├─ App.tsx
│  ├─ api.ts
│  ├─ config.ts
│  ├─ hotkeys.ts
│  ├─ main.tsx
│  ├─ styles.css
│  └─ types.ts
├─ package.json
└─ README.md
`

## 维护规则

- 新功能只在 pps/bamt-next 开发。
- 历史 Python 版本只作参考，除非明确需要复刻旧行为。
- 构建产物、依赖、日志、本地配置和大型发布素材默认不进 Git。
- 需要发布时，从 pps/bamt-next 构建，再把产物放入 eleases/archives/。
