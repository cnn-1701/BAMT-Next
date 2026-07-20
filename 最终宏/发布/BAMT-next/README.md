# BAMT Next

BAMT Next 是对原始 `BlueArchiveMacroTool.py` 的重写版本。

- 前端：Electron + React + TypeScript + Vite
- 后端：Python Windows 原生输入服务，通过 stdin/stdout JSON RPC 与 Electron 通信
- 配置：保存到 Electron `userData/blue_archive_config.json`，启动时兼容旧版配置字段

## 功能

- 点位：按住热键时移动到目标坐标并按下鼠标，松开热键后释放并回到原位置
- 拖动：按住热键时循环从技能点向上拖动，再拖到当前鼠标位置释放
- 连点：按住热键时按间隔点击当前鼠标位置
- 点击：按下热键时点击目标坐标一次并回到原位置
- 停止键：全局停止监听并释放鼠标/解除屏蔽
- 捕获坐标、分辨率预设、配置保存/加载、旧版启动入口

## 开发

```powershell
cd "最终宏\发布\BAMT-next"
npm install
pip install -r backend/requirements.txt
npm run dev
```

## 构建

```powershell
npm run typecheck
npm run dist
```
