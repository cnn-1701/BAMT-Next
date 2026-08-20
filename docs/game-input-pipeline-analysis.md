# 《蔚蓝档案》Windows 客户端输入采样与技能出牌链路分析

> 分析日期：2026-08-20
> 分析对象：Blue Archive 日服 PC 客户端
> 分析方式：只读检查游戏目录、Unity 配置、运行日志和 IL2CPP 元数据。分析过程中未修改任何游戏文件。

## 1. 分析目的

本文用于解释 BAMT 在执行“最速出牌”时偶发出现的卡牌回弹、回槽位或未释放问题，并判断游戏究竟在什么时机接收和确认键盘、鼠标输入。

核心结论是：游戏的输入并不是以一个单独、固定的频率直接生效，而是经过至少两级处理：

```text
Windows 键鼠事件
  -> Unity Input System 收取事件
  -> 游戏保存当前帧和上一帧输入状态
  -> 技能输入收集与排队
  -> 战斗逻辑验证并确认
  -> 表现层播放出牌结果
```

因此，“操作系统成功注入了输入”不等于“游戏已经在技能状态机中接受了这次输入”。

## 2. 已确认的客户端技术信息

### 2.1 Unity 与 IL2CPP

客户端包含以下典型文件：

```text
BlueArchive.exe
GameAssembly.dll
UnityPlayer.dll
BlueArchive_Data/il2cpp_data/Metadata/global-metadata.dat
```

由此确认游戏使用 Unity IL2CPP 构建。当前客户端使用的 Unity 版本为：

```text
Unity 2021.3.56f2
```

游戏版本清单显示：

```text
1.71.1
```

### 2.2 渲染线程

运行日志显示游戏使用 D3D11，并启用了多线程渲染：

```text
GfxDevice: creating device client; threaded=1
Rendering threading mode: MultiThreaded
```

这意味着渲染、主线程逻辑和输入状态推进不必严格处于同一个线程或完全相同的时间点。

### 2.3 Unity 输入系统

运行日志明确包含：

```text
New input system (experimental) initialized
Using XInput
Initialized touch support
```

程序集清单同时包含：

```text
UnityEngine.InputModule.dll
UnityEngine.InputLegacyModule.dll
Unity.InputSystem.dll
Unity.InputSystem.ForUI.dll
```

解析 `globalgamemanagers` 中的 PlayerSettings 得到：

```text
activeInputHandler = 2
runInBackground = true
```

`activeInputHandler = 2` 表示客户端允许 Unity 旧输入系统和新 Input System 同时工作，而不是只依赖其中一套。

新 Input System 的包版本可识别为：

```text
com.unity.inputsystem@1.7
```

## 3. Unity 层的输入采样

Unity Input System 的默认更新方式是 `ProcessEventsInDynamicUpdate`。在这种模式下，操作系统积累的输入事件会在每次动态 `Update` 开始之前被处理。

官方说明：

- [Unity InputSettings](https://docs.unity3d.com/ja/Packages/com.unity.inputsystem%401.4/api/UnityEngine.InputSystem.InputSettings.html)
- [Unity InputSettings.UpdateMode](https://docs.unity3d.com/ja/Packages/com.unity.inputsystem%401.4/api/UnityEngine.InputSystem.InputSettings.UpdateMode.html)
- [Unity InputSystemUIInputModule](https://docs.unity3d.com/ja/Packages/com.unity.inputsystem%401.4/api/UnityEngine.InputSystem.UI.InputSystemUIInputModule.html)

当前没有在序列化设置中找到明确覆盖默认更新模式的 `InputSettings` 实例，也没有发现证明客户端固定在 `FixedUpdate` 中处理输入的配置。因此，现有证据最支持以下判断：

> Windows 输入事件大概率在每个动态渲染更新开始前进入 Unity。

如果实际渲染速率为 160 FPS，则相邻动态更新的理论间隔约为：

```text
1000 / 160 = 6.25 ms
```

这并不代表战斗技能每 6.25 ms 就能完成一次状态变化，只代表 Unity 大约每 6.25 ms 有一次机会收取和整理新的键鼠事件。

## 4. 游戏自身的战斗输入链路

在 IL2CPP 元数据中发现了以下与战斗输入直接相关的字段和方法名：

```text
prevFrameInputState
currFrameInputState

AdvanceInput
AdvanceLogicTo
AdvanceLogic
AdvancePresentation
ProcessPresentation

pendingInputs
TryCollectCurrentInput
TryCollectAndAdvanceOrFire
ConfirmWithCurrentInputs
RewindToInputIndex
ValidatePendingInputs

LastSkillUserFrame
useSkill
UISkillCardBundledInputController
```

还发现了与时间推进相关的结构：

```text
BattleGameTime.TicksPerLogicFrame
BattleGameTime.LogicSecondPerFrame
BattleGameTime.forcedFrame
BattleGameTime.elapsedFromLastTick
InBattleSubScene.UpdateFrame
InBattleSubScene.HasPresentationUpdate
```

这些命名足以确认，客户端至少将以下过程分开处理：

1. 收集当前输入。
2. 保存当前帧和上一帧输入快照。
3. 将技能输入放入待处理队列。
4. 验证当前费用、卡牌状态和目标状态。
5. 推进战斗逻辑。
6. 更新界面和动画表现。

所以鼠标点击落在卡牌上，并不意味着技能会立刻释放。技能仍然可能因为状态尚未推进、输入顺序不符合预期或当前逻辑帧未接受该操作而失败。

## 5. 30 Hz、60 FPS 与 160 Hz 的关系

实测中，战斗界面计时会出现类似以下变化：

```text
466 -> 433
```

差值约为 33.33 ms，与 30 Hz 的周期相符：

```text
1000 / 30 = 33.333... ms
```

但 NVIDIA 监控显示客户端可按约 160 FPS 或 160 Hz 呈现。这两组数据并不冲突，更合理的解释是：

```text
Windows/Unity 输入收取：跟随动态更新，当前可能约 160 Hz
战斗逻辑或计时显示：可能约 30 Hz
画面渲染和显示呈现：可达到约 160 FPS/Hz
```

因此，游戏不是简单的“30 Hz 输入采样”，也不是“160 Hz 收到输入后立即出牌”。输入先以较高频率进入 Unity，再等待游戏自己的战斗逻辑状态机确认。

游戏本地 `DeviceOption` 中记录了 `FPS` 和 `VSync` 字段，但它们是枚举值。没有获得完整的枚举映射前，不能仅凭数值 `0` 判断功能处于开启或关闭状态。

## 6. 卡牌回弹的主要原因推断

一次最速出牌通常包含四个阶段：

```text
选牌键按下
选牌键释放
鼠标左键按下
鼠标左键释放
```

如果这些事件过于接近，它们可能在同一次 Unity Input System 更新中被统一处理。此时可能出现：

1. 游戏读取到选牌键，但技能选择状态尚未推进。
2. 鼠标按下已经到达。
3. 点击按照旧的 `currFrameInputState` 或旧 UI 状态执行。
4. `ValidatePendingInputs` 判定这次操作无效。
5. 界面表现为卡牌弹起后回槽、卡牌没有打出或目标确认失败。

这类问题不一定意味着 Rust 定时器不准。宏执行得过快，反而可能超过游戏状态机可以接受的推进速度。

## 7. 为什么 7/7/7/7 ms 明显改善

BAMT 当前稳定性较好的默认阶段延迟为：

```text
7 ms / 7 ms / 7 ms / 7 ms
```

在 160 FPS 下，每个动态输入更新的理论间隔约为 6.25 ms。7 ms 略高于该周期，因此相邻操作更有机会被拆分到不同的 Unity 输入更新中：

```text
第 N 次输入更新：选牌键按下
第 N+1 次输入更新：选牌键释放
第 N+2 次输入更新：鼠标按下
第 N+3 次输入更新：鼠标释放
```

这样游戏就有机会在阶段之间推进卡牌选择和目标确认状态。`7 ms` 并不是游戏公开定义的常量，而是当前 160 FPS 环境下与动态输入周期吻合的经验值。

当渲染速率降低或出现明显帧时间波动时，7 ms 仍可能落入同一个输入更新周期。例如：

```text
160 FPS -> 6.25 ms/帧
120 FPS -> 8.33 ms/帧
60 FPS  -> 16.67 ms/帧
30 FPS  -> 33.33 ms/帧
```

因此固定延迟不能保证适配所有机器、所有画质设置和所有瞬时负载。

## 8. 目前能够确认与不能确认的边界

### 已确认

- 游戏是 Unity 2021.3.56f2 IL2CPP 客户端。
- 新旧 Unity 输入系统同时启用。
- Unity UI 使用 Input System 相关模块。
- 游戏维护当前帧和上一帧输入状态。
- 技能输入经过收集、排队、验证、逻辑推进和表现更新。
- 游戏逻辑更新与渲染呈现并不是一个简单的同步步骤。
- 7 ms 阶段延迟与 160 FPS 下约 6.25 ms 的输入更新周期高度吻合。

### 合理推断

- Unity 输入事件大概率按默认动态更新模式处理。
- 战斗计时或主要逻辑存在约 30 Hz 的推进特征。
- 卡牌回弹主要来自输入阶段落入同一更新周期，或技能状态机尚未完成前一阶段。

### 尚未完全确认

- 游戏是否在运行时通过代码修改了 Input System 的 `updateMode`。
- `AdvanceInput` 在每个渲染帧、每个战斗逻辑帧还是其他节点调用。
- 技能输入确认是否要求跨越固定数量的逻辑帧。
- 不同场景、暂停状态和 Bullet Time 状态是否采用不同的输入推进规则。

要证明这些剩余问题，需要进一步进行运行时外部观测，例如记录 Present 帧时间、Windows 输入注入时间和 BAMT 各阶段时间，再与游戏画面中的选牌状态变化逐帧对应。该方法仍可保持不修改游戏文件。

## 9. 对 BAMT 的设计建议

1. 保留 `7/7/7/7 ms` 作为当前 160 Hz 环境的稳定默认值。
2. 不要只追求更短延迟；应优先保证四个输入阶段跨过游戏可识别的状态边界。
3. 诊断日志应分别记录选牌按下、选牌释放、鼠标按下、鼠标释放的计划时间和实际时间。
4. 同时记录线程调度迟滞、阶段是否乱序、实际循环周期和输入发送失败。
5. 后续可以按实际帧时间动态选择阶段延迟，而不是假设所有玩家都是 160 FPS。
6. 不建议接管或修改游戏内部输入接口。通过正常 Windows 输入路径并适配游戏节奏，兼容性和风险都更可控。

## 10. 最终结论

《蔚蓝档案》Windows 客户端采用的是“Unity 动态输入收取 + 游戏战斗状态机确认”的多阶段输入链路。

当前最符合文件证据和实际测试结果的模型是：Unity 可能按约 160 Hz 的动态更新收取 Windows 输入，而技能最终是否生效，还要经过可能具有约 30 Hz 特征的战斗逻辑和技能输入验证流程。

最速出牌中的卡牌回弹，本质上更像是宏事件序列跑在游戏状态机前面，而不是单纯的定时器精度不足。让各输入阶段跨越 Unity 输入更新边界，是目前 `7/7/7/7 ms` 能够明显提高稳定性的主要原因。
