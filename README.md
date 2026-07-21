# BAMT — Blue Archive Macro Tool

蔚蓝档案 PC 端总力战宏工具。把键盘热键映射到鼠标操作（拖技能卡、点击目标等），支持跨分辨率预设共享、排轴编辑和 AHK 脚本。

## 项目结构

```
BAMT/
├── apps/bamt-next/          ← 当前主项目（唯一活跃开发）
├── legacy/                  # 历史版本归档（只读）
│   ├── early-scripts/       #   早期单文件实验
│   ├── versioned-python/    #   v2.0 / v3.0 / v5.0
│   ├── tkinter-package/     #   Tkinter GUI 发布版
│   └── published-python/    #   最终 Python 源码
├── config-samples/          # 旧版 JSON 配置样例
├── releases/                # 发布素材 & 历史打包产物
└── runtime-logs/            # 历史运行日志
```

- **新功能只在 `apps/bamt-next` 开发**，其余目录为归档。
- 构建产物、依赖、日志、本地配置不进 Git。
- 发布时从 `apps/bamt-next` 构建，产物放入 `releases/archives/`。

## 快速开始

需要 Windows 10/11 x64 + Python 3（推荐 [python.org](https://www.python.org/) 安装，关掉 Microsoft Store 的 python 别名）。

```bash
cd apps/bamt-next
npm install
npm run dev      
npm run dist     
```

详细文档 → [`apps/bamt-next/README.md`](apps/bamt-next/README.md)。

## 相关路径

| 路径 | 说明 |
|------|------|
| `%APPDATA%\BAMT Next\blue_archive_config.json` | 用户宏配置 |
| `%APPDATA%\BAMT Next\bamt-inline.ahk` | AHK 临时脚本 |
