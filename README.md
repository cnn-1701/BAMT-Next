# BAMT Next

BAMT Next 是面向 `国际服` / `日服` 《碧蓝档案》PC 端的本地宏控制台与排轴工具。项目使用 Electron + React + TypeScript 构建桌面界面，宏后端在 2.2.0 重构分支中为尝试解决原有python事件延迟切换为 Rust 原生 Windows 后端；AutoHotkey v2 作为脚本解释器和输入链路测试工具保留

目前本项目实现的功能有

1. 适配于碧蓝档案pc端国际服/日服的统一宏管理，支持宏预设的导入导出合并
2. 导入宏时依据牌位或点位做不同分辨率屏幕之间的位置映射计算
3. 预设有最速出牌宏，点位宏，拖动宏与连点宏的常用宏
4. 支持通过类mumu预设语法低门槛自定宏
5. 可导入ahk脚本以自定宏的形式加入全局宏
6. 支持文字轴的固定格式编排文件管理与导入导出
7. 文字轴编辑过程中实现ba基本出牌逻辑的模拟
8. 排轴编辑器支持转场、送人、锁牌、复制、下p等事件的添加与逻辑的实现
9. 支持置顶窗口预览文字轴
10. 内嵌ahk解释器

> 若要直接使用打包好的执行文件，请使用管理员权限开启并在首次使用前完成基本分辨率的设定与点位映射的校准检查

## 2.3.0 更新说明

- 重构脚本宏 DSL：前端使用严格解析器检查语法，Rust 后端在开始监听前完成解析与预编译，运行期间不再重复拆解脚本文本
- 脚本默认只执行一次；只有显式写出 `loop`、`loop N` 或 `loop until_release` 时才会进入循环
- 兼容 MuMu 宏按键的常用核心语法，包括 `x,y`、`click`、`wait`、`key_press`、`key_release`、`mouse_press`、`mouse_release`、`loop`、`loop_end` 与 `release_actions`
- 保留 BAMT 原有命令别名，并新增 `release_all`，用于异常终止或热键松开时统一释放仍处于按下状态的键盘和鼠标按键
- 脚本编辑器加入语法提示、代码补全、错误行定位、示例模板和 AHK 脚本导入入口
- 全局宏预设的导入、导出和合并现在可携带脚本宏配置
- 应用内使用说明书与本 README 已补全 DSL 命令、参数、循环规则、释放规则及示例

MuMu 宏按键说明可参考：[MuMu 模拟器宏按键设置指南](https://mumu.163.com/help/20240111/35047_1131289.html)。BAMT 兼容的是其中适用于 PC 键盘与鼠标自动化的核心写法；多点触控、摇杆、划线与模拟器专属坐标接口暂不伪装支持。

## 2.2.0 重构说明

- 宏运行后端已改为 Rust，不再启动或打包 Python 宏服务
- 原 `backend/macro_service.py` 已从重构分支移除
- Rust 后端支持当前主线宏类型：点位、拖动、点击/连点、最速出牌、脚本宏
- AHK 解释器仍保留，用于运行用户脚本、导入 AHK 脚本宏、验证游戏对 AHK 输入链路的接收情况

## 快速开始

1. 启动 BAMT Next
2. 在「宏控制台」确认游戏分辨率，点击「应用并重算」
3. 第一次使用先校准 Q/W/E 手牌位置和常用点位
4. 默认输入路线建议使用「系统光标模式」。兼容性最高，但会移动真实鼠标
5. 点「开始」进入监听
6. 如果宏异常，按固定紧急停止键 `X`

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
| `data/logs/` | 最速出牌宏的低干扰诊断日志（JSONL） |

发布版对应路径都位于 `%APPDATA%/BAMT Next/data/` 下

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

1. 战场地图点位：点位、点击、连点使用中轴线缩放规则，适合技能释放点、地图位置和敌人位置
2. 底部 UI 手牌：拖动宏使用底部 UI 锚定算法，适合 Q/W/E 这类底部手牌位置

Q/W/E 三个基础手牌宏有独立算法，不和普通点位混算。导入他人配置后，先点击「应用并重算」或「重算技能位」，再手动校准一次

## 拖动宏逻辑

一轮拖动宏的设计目标是：在牌位按下，在触发时鼠标原始位置释放

执行顺序：

1. 热键触发时记录当前鼠标位置，作为本轮释放点
2. 光标移动到计算出的手牌位置
3. 按下左键
4. 竖直向上移动设定距离
5. 移动回本轮记录的鼠标原始位置
6. 在原始位置释放左键
7. 如果热键仍按住，等待循环间隔后进入下一轮

系统光标模式本质上会移动真实鼠标。循环间隔过短时，手动移动鼠标会感觉被抢。需要降低抢鼠标感时，优先提高循环间隔

## 宏的性能处理

实测发现，同样执行`按 1/2/3 选牌，再点击当前鼠标位置`逻辑时，AutoHotkey v2 的 `SendInput` / `Click` 链路比原先 Python 后端更不容易卡牌

当前处理方式：

- 主线宏后端改为 Rust，减少 Python `ctypes + SendInput` 手写事件链路带来的不稳定
- AHK 解释器保留，用于对照测试游戏是否接收 AHK 输入
- 最速出牌宏仍建议先在目标服和目标窗口状态下测试

### 最速出牌诊断日志

按住最速出牌热键时，Rust 后端只在内存中采集微秒时间戳；松开热键后才一次性写入 `data/logs/fast-play-*.jsonl`，避免实时磁盘写入和 UI 刷新干扰宏线程。首页和状态记录中的「宏诊断日志」按钮可以直接打开该目录。

每份日志包含：

- 工作线程排队时间
- 每轮选牌键按下、选牌键释放、鼠标按下、鼠标释放和循环结束时间
- 实际选牌按住时长、选牌到点击间隔、鼠标按住时长和循环间隔
- `SendInput` 是否成功、事件顺序是否异常
- P95、最大延迟、比目标慢 1 ms 以上的次数

若游戏出现卡牌回弹，先完成一次短测试并松开热键，再查看日志末尾的 `summary`。`inputFailures > 0` 表示 Windows 没有接受某次注入；`orderViolations > 0` 表示后端事件顺序异常；两者均为 0 但仍回弹时，更可能是游戏帧窗口或游戏自身没有消费输入，需要结合各阶段实际延迟继续判断。

AHK 测试脚本可以使用：

```ahk
#Requires AutoHotkey v2.0
#SingleInstance Force
SetMouseDelay(-1)
SetKeyDelay(-1, -1)
SendMode("Input")
CoordMode("Mouse", "Screen")

; 按住 Q/W/E：循环发送 1/2/3，然后点击当前鼠标位置
; F11 暂停/继续，F12 退出
```

## 脚本宏 DSL

脚本宏不是 Python 或 AHK，而是由 BAMT Rust 后端执行的严格 DSL。前端编辑器会即时显示语法错误；开始监听时 Rust 会再次校验并预编译一次，热键触发阶段直接执行已编译命令，不会在循环中反复解析文本。

规则：

- 一行一条命令
- 空行忽略
- `#`、`//`、`;` 之后的内容是注释
- 未写 `loop` 时，按下热键后从上到下完整执行一次，不会默认循环
- 时间支持 `us`、`ms`、`s`，例如 `500us`、`7ms`、`0.02s`；省略单位时按毫秒处理
- 绝对坐标可写作 MuMu 风格的 `x,y` 或 BAMT 风格的 `x y`，使用当前逻辑分辨率并自动映射到实际屏幕
- `target` 表示该宏编辑区的 X/Y 预设点
- `origin`（兼容写法 `mouse`）表示触发热键瞬间的鼠标位置
- `here`（兼容写法 `current`）表示执行到该命令时的实时鼠标位置
- 点位关键字后可追加 `offset x y`，例如 `target offset 0 -300`
- `loop`、`loop N`、`loop until_release` 均以 `loop_end` 结束；旧版 `repeat N ... end` 仍兼容
- 循环体必须包含等待或有持续时间的动作，避免无等待死循环占满 CPU
- `release_actions` 之后的命令会等到触发热键松开后再执行
- 停止或取消时会统一释放脚本按下的鼠标/键盘，并把光标恢复到触发位置

示例：

```text
# 未写 loop：每次按下热键只执行一遍
click 1280,720 7ms
sleep 20
click target offset 0 -200 7ms
restore
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `wait 7ms` | 使用高精度等待；`sleep` 是兼容别名 |
| `move x y 1ms` | 移动到绝对坐标，并可在移动后等待 |
| `click target 7ms` | 移动到宏预设点，按下左键 7 ms 后释放 |
| `click origin` | 点击触发热键时的鼠标位置 |
| `press target` / `release here` | 分开控制左键按下与释放 |
| `drag target to target offset 0 -300 20ms` | 从预设点拖到其上方 300 像素 |
| `key tap 1 7ms` | 按下并释放键盘 `1`；也支持 `key down` / `key up` |
| `key_press 1` / `key_release 1` | MuMu 兼容的键盘按下与释放 |
| `mouse_press left` / `mouse_release left` | MuMu 兼容的鼠标左键按下与释放 |
| `loop 3 ... loop_end` | 固定重复 3 次，最大 100000 次 |
| `loop ... loop_end` | 按住触发热键期间重复；也可写 `loop until_release` |
| `release_actions` | 后续命令在触发热键松开时执行，仅可位于顶层一次 |
| `release_all` | 立即释放本脚本保持的鼠标和键盘输入 |
| `restore 1ms` | 释放左键并回到触发瞬间的鼠标位置 |

完整示例：

```text
# 先按 1 选牌，再点击触发时的鼠标位置
loop
  key tap 1 7ms
  wait 7ms
  click origin 7ms
  wait 7ms
loop_end
```

```text
# 有限执行三次
loop 3
  click target 7ms
  wait 16.667ms
loop_end
restore
```

MuMu 文档中的多指同时触控、摇杆、准星和触控曲线命令依赖模拟器内部接口，Windows 原生单光标后端不会伪装支持。BAMT 直接支持适用于 PC 输入的核心语法，并额外提供 `target`、`origin`、`here`、`offset`、`drag`、`restore` 和微秒时间单位。

DSL 文件可通过编辑区的“导入 DSL 文件”载入。AHK 与 DSL 不是同一种语法，`.ahk` 文件请在左侧 AHK 解释器中运行，不应直接粘贴到 DSL 编辑器。

## 排轴编辑器

排轴编辑器按 P 完全独立管理。P1、P2、P3 可以有不同队伍、练度、牌序和动作记录

- 新建轴前先填写文件名
- 新建后会在 `data/timelines/` 初始化 JSON 文件
- 初始角色使用 `角色1` 到 `角色6`，不会写死具体学生名
- 编辑时自动保存
- TXT / MD / JSON 导出默认文件名使用轴名称

文本预览开头会汇总各 P 的出场角色、牌序、参考练度和视频参考

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
