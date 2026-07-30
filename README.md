# BAMT Next

BAMT Next 是面向《碧蓝档案》PC 端的本地宏控制台与排轴工具。项目使用 Electron + React + TypeScript 构建桌面界面，宏后端在 2.2.0 重构分支中切换为 Rust 原生 Windows 后端；AutoHotkey v2 作为脚本解释器和输入链路测试工具保留。

> 这是本机输入辅助工具。不同服务器、不同游戏窗口状态、不同权限层级对 Windows 输入的接收情况会不同。第一次使用务必在安全环境中校准和测试。

## 2.2.0 重构说明

- 宏运行后端已改为 Rust，不再启动或打包 Python 宏服务。
- 原 `backend/macro_service.py` 已从重构分支移除。
- Rust 后端支持当前主线宏类型：点位、拖动、点击/连点、最速出牌、脚本宏。
- AHK 解释器仍保留，用于运行用户脚本、导入 AHK 脚本宏、验证游戏对 AHK 输入链路的接收情况。
- 固定紧急停止键为 `X`。

## 快速开始

1. 启动 BAMT Next。
2. 在「宏控制台」确认游戏分辨率，点击「应用并重算」。
3. 第一次使用先校准 Q/W/E 手牌位置和常用点位。
4. 默认输入路线建议使用「系统光标模式」。兼容性最高，但会移动真实鼠标。
5. 点「开始」进入监听。
6. 如果宏异常，按固定紧急停止键 `X`。

## 数据目录

源码开发模式下，数据写入项目内：

```text
data/
```

发布版 exe 下，数据写入：

```text
%APPDATA%/BAMT Next/data/
```

常用目录：

| 路径 | 内容 |
| --- | --- |
| `data/config/blue_archive_config.json` | 当前宏配置 |
| `data/presets/preset-library.json` | 全局宏预设库 |
| `data/imports/` | 建议放外部导入文件 |
| `data/exports/` | 宏预设导出目录 |
| `data/timelines/` | 排轴编辑器自动保存的轴 JSON |
| `data/ahk/bamt-inline.ahk` | AHK 面板生成的临时脚本 |

发布版对应路径都位于 `%APPDATA%/BAMT Next/data/` 下。

## 功能模块

| 模块 | 说明 |
| --- | --- |
| 宏控制台 | 编辑、测试、保存和运行点位、拖动、点击、连点、最速出牌、脚本宏 |
| 点位转换器 | 按不同分辨率换算坐标 |
| 排轴编辑器 | 管理 P 队伍、练度、牌序、动作、备注和文本导出 |
| AHK 解释器 | 运行 AutoHotkey v2 脚本，测试输入链路 |
| 使用说明书 | 应用内说明，列出目录、宏逻辑和常见问题 |

## 宏类型

| 类型 | 行为 |
| --- | --- |
| 点位 | 热键触发后移动到目标坐标点击，并回到原鼠标位置 |
| 拖动 | 按住热键期间循环执行手牌拖动 |
| 点击 | 点击目标点，或配合选牌键做快速点击 |
| 连点 | 按设定间隔连续点击 |
| 最速出牌 | 按住热键循环执行 `1/2/3 选牌键 + 当前鼠标位置点击` |
| 脚本 | 执行 BAMT 固定 DSL 脚本 |

## 坐标映射

BAMT 把坐标分成两类：

1. 战场地图点位：点位、点击、连点使用中轴线缩放规则，适合技能释放点、地图位置和敌人位置。
2. 底部 UI 手牌：拖动宏使用底部 UI 锚定算法，适合 Q/W/E 这类底部手牌位置。

Q/W/E 三个基础手牌宏有独立算法，不和普通点位混算。导入他人配置后，先点击「应用并重算」或「重算技能位」，再手动校准一次。

## 拖动宏逻辑

一轮拖动宏的设计目标是：在牌位按下，在触发时鼠标原始位置释放。

执行顺序：

1. 热键触发时记录当前鼠标位置，作为本轮释放点。
2. 光标移动到计算出的手牌位置。
3. 按下左键。
4. 竖直向上移动设定距离。
5. 移动回本轮记录的鼠标原始位置。
6. 在原始位置释放左键。
7. 如果热键仍按住，等待循环间隔后进入下一轮。

系统光标模式本质上会移动真实鼠标。循环间隔过短时，手动移动鼠标会感觉被抢。需要降低抢鼠标感时，优先提高循环间隔。

## 最速出牌与 AHK 实测结论

实测发现，同样执行「按 1/2/3 选牌，再点击当前鼠标位置」时，AutoHotkey v2 的 `SendInput` / `Click` 链路比早期 Python 后端更不容易卡牌。

当前处理方式：

- 主线宏后端改为 Rust，减少 Python `ctypes + SendInput` 手写事件链路带来的不稳定。
- AHK 解释器保留，用于对照测试游戏是否接收 AHK 输入。
- 最速出牌宏仍建议先在目标服和目标窗口状态下测试。

AHK 测试脚本建议使用：

```ahk
#Requires AutoHotkey v2.0
#SingleInstance Force
SetMouseDelay(-1)
SetKeyDelay(-1, -1)
SendMode("Input")
CoordMode("Mouse", "Screen")

; 按住 Q/W/E：循环发送 1/2/3，然后点击当前鼠标位置。
; F11 暂停/继续，F12 退出。
```

## 脚本宏 DSL

脚本宏不是 Python，也不是完整 AHK。它是 BAMT Rust 后端解析的固定语法。

规则：

- 一行一条命令。
- 空行忽略。
- `#`、`//`、`;` 开头是注释。
- 坐标使用当前分辨率下的屏幕坐标。
- 时间单位为毫秒。
- `mouse` 表示触发热键瞬间的鼠标位置。

示例：

```text
loop until_release
  press 2688 1853
  move 2688 1553 20
  release mouse
  sleep 50
end
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `sleep 50` | 等待 50 ms |
| `move x y 10` | 移动到坐标，可选等待时间 |
| `click x y 35` | 移动到坐标并点击 |
| `press x y` | 移动到坐标并按下左键 |
| `release x y` | 可选移动到坐标后释放左键 |
| `drag sx sy ex ey 80` | 从起点拖到终点 |
| `loop until_release ... end` | 按住热键期间循环执行 |

## 排轴编辑器

排轴编辑器按 P 完全独立管理。P1、P2、P3 可以有不同队伍、练度、牌序和动作记录。

- 新建轴前先填写文件名。
- 新建后会在 `data/timelines/` 初始化 JSON 文件。
- 初始角色使用 `角色1` 到 `角色6`，不会写死具体学生名。
- 编辑时自动保存。
- TXT / MD / JSON 导出默认文件名使用轴名称。

文本预览开头会汇总各 P 的出场角色、牌序、参考练度和视频参考。

## 从源码运行

需要 Node.js 依赖和 Rust 工具链/Windows MSVC Build Tools。

```powershell
npm install
cd rust-backend
cargo build --release
cd ..
npm run dev
```

如果要指定 Rust 后端 exe：

```powershell
$env:BAMT_RUST_BACKEND = "C:\Path\To\bamt-rust-backend.exe"
npm run dev
```

## 构建发布包

```powershell
cd rust-backend
cargo build --release
cd ..
npm run dist
```

构建结果在：

```text
release/
```

发布包应包含：

- Electron 前端资源。
- `rust-backend/bamt-rust-backend.exe`。
- `AutoHotkey/AutoHotkey64.exe`。

不再包含 Python 后端或 Python runtime。

## 技术栈

- Electron
- React
- TypeScript
- Vite
- Rust Windows native backend
- AutoHotkey v2 bridge
- electron-builder portable

## 目录结构

```text
BAMT/
  electron/                 Electron 主进程与 IPC
  src/                      React 前端
  rust-backend/             Rust 宏后端
  tools/AutoHotkey/         内置 AHK v2 解释器
  data/                     开发模式数据目录
  release/                  打包输出目录
  README.md                 项目说明
```

## GitHub 发布建议

1. 确认构建通过：`npm run build`。
2. 确认 Rust 后端已构建：`rust-backend/target/release/bamt-rust-backend.exe`。
3. 提交源码，不提交 `node_modules/`、`dist/`、`dist-electron/` 和本地用户数据。
4. 发布 exe 时，把 `release/BAMT-Next-版本号-portable.exe` 上传到 GitHub Release。
