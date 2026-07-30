import { Code2, Play, Square } from "lucide-react";
import { useState } from "react";
import type { MacroApi } from "./types";

const defaultScript = `#Requires AutoHotkey v2.0
#SingleInstance Force

SetMouseDelay(-1)
SetKeyDelay(-1, -1)
SendMode("Input")
CoordMode("Mouse", "Screen")

; BAMT AHK 最速出牌测试脚本。
; 这个脚本只用来验证游戏是否能稳定接收 AHK 输入，不会修改 BAMT 的宏配置。
;
; 按住 Q：循环发送 1，然后点击当前鼠标位置。
; 按住 W：循环发送 2，然后点击当前鼠标位置。
; 按住 E：循环发送 3，然后点击当前鼠标位置。
;
; InnerGapMs：一次循环内，选牌键和鼠标点击之间的间隔。
; LoopGapMs：两轮循环之间的间隔。
; F11：暂停 / 继续脚本。
; F12：退出脚本。

global Running := Map("q", false, "w", false, "e", false)
global CardKey := Map("q", "1", "w", "2", "e", "3")
global InnerGapMs := 8
global LoopGapMs := 15

TrayTip("BAMT AHK Test", "Q/W/E hold-to-loop is ready. F12 exits.", 3)
ToolTip("BAMT AHK Test Ready" Chr(10) "Hold Q/W/E to send 1/2/3 + click" Chr(10) "F11 pause, F12 exit", 20, 20)
SetTimer(() => ToolTip(), -2500)

$q::RunFastClick("q")
$w::RunFastClick("w")
$e::RunFastClick("e")

F11::Pause(-1)
F12::ExitApp()

RunFastClick(triggerKey) {
    global Running, CardKey, InnerGapMs, LoopGapMs

    if Running[triggerKey] {
        return
    }

    Running[triggerKey] := true
    card := CardKey[triggerKey]
    ToolTip("Running " StrUpper(triggerKey) " -> " card " + LeftClick", 20, 20)

    try {
        while GetKeyState(triggerKey, "P") {
            SendInput(card)
            Sleep(InnerGapMs)
            Click("Left")
            Sleep(LoopGapMs)
        }
    } finally {
        Running[triggerKey] := false
        ToolTip()
    }
}
`;

export function AhkConsole({ api, pushLog }: { api: MacroApi; pushLog: (message: string) => void }) {
  const [script, setScript] = useState(defaultScript);
  const [running, setRunning] = useState(false);
  const [lastMessage, setLastMessage] = useState("等待运行 AHK 脚本");

  async function run() {
    const result = await api.runAhkScript(script);
    setRunning(result.status === "listening" || result.status === "ready");
    setLastMessage(result.message);
    pushLog(result.message);
  }

  async function stop() {
    const result = await api.stopAhkScript();
    setRunning(false);
    setLastMessage(result.message);
    pushLog(result.message);
  }

  async function importScript() {
    const file = await api.pickPresetPackage();
    if (!file) {
      pushLog("已取消导入 AHK 脚本");
      return;
    }
    setScript(file.text);
    setLastMessage("已导入脚本：" + file.path);
    pushLog("已导入 AHK 脚本：" + file.path);
  }


  return (
    <section id="section-ahk" className="glass-card ahk-console">
      <div className="section-title">
        <div>
          <p className="eyebrow">AutoHotkey Bridge</p>
          <h2><Code2 size={22} /> AHK 解释器</h2>
        </div>
        <div className="action-row">
          <button className="primary ghost" onClick={importScript}>导入脚本</button>
          <button className="primary ghost" onClick={run}><Play size={17} />运行脚本</button>
          <button className="danger ghost" onClick={stop}><Square size={17} />停止 AHK</button>
        </div>
      </div>
      <p className="hint">这里调用 AutoHotkey v2 执行脚本。默认脚本用于测试 Q/W/E 最速出牌：按住 Q/W/E 会循环发送 1/2/3 并点击当前鼠标位置；F11 暂停，F12 退出。</p>
      <textarea value={script} onChange={(event) => setScript(event.target.value)} spellCheck={false} />
      <div className={running ? "ahk-status running" : "ahk-status"}>{lastMessage}</div>
    </section>
  );
}

