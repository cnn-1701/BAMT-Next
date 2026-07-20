# BAMT 项目目录

当前推荐维护的项目是 `最终宏/发布/BAMT-next`。

## 目录说明

- `最终宏/发布/BAMT-next/`：新版主项目，Electron + React + TypeScript 前端，Python Windows 输入后端。
- `最终宏/发布/BAMTb/BAMT/`：旧版 Tkinter 单文件项目与旧版可执行文件，用作功能对照和兼容配置来源。
- `最终宏/发布/*.zip`、图片、视频、旧 Python 草稿：历史发布包和素材，默认不纳入 Git 初始版本。
- `.gitignore`：忽略构建产物、依赖目录、可执行文件、缓存和本地配置。

## 新版源码结构

```text
最终宏/发布/BAMT-next
├─ backend/
│  ├─ macro_service.py       # Windows 热键监听、鼠标输入、配置读写
│  └─ requirements.txt
├─ electron/
│  ├─ main.ts                # Electron 主进程、后端进程管理、IPC
│  └─ preload.ts             # 安全暴露前端 API
├─ src/
│  ├─ App.tsx                # 主界面与配置编辑
│  ├─ api.ts                 # Electron API / 浏览器预览 fallback
│  ├─ config.ts              # 默认配置、动作类型、校验逻辑
│  ├─ hotkeys.ts             # 键盘/鼠标热键录入与显示
│  ├─ main.tsx
│  ├─ styles.css
│  └─ types.ts
├─ package.json
└─ README.md
```

## Git 策略

初始提交只跟踪新版源码、构建配置、README 和忽略规则。旧版文件、发布包、构建输出、依赖目录继续留在工作区，但保持未跟踪，避免仓库变得过重。
