import { Code2, Play, Square } from "lucide-react";
import { useState } from "react";
import type { MacroApi } from "./types";

const defaultScript = `#Requires AutoHotkey v2
CoordMode "Mouse", "Screen"
; 示例：按 F8 弹出提示
F8::MsgBox "BAMT AHK bridge is running."
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

  return (
    <section id="section-ahk" className="glass-card ahk-console">
      <div className="section-title">
        <div>
          <p className="eyebrow">AutoHotkey Bridge</p>
          <h2><Code2 size={22} /> AHK 解释器</h2>
        </div>
        <div className="action-row">
          <button className="primary ghost" onClick={run}><Play size={17} />运行脚本</button>
          <button className="danger ghost" onClick={stop}><Square size={17} />停止 AHK</button>
        </div>
      </div>
      <p className="hint">这里调用本机 AutoHotkey v2 执行脚本。未安装时会提示路径；可用环境变量 BAMT_AHK 指向 AutoHotkey64.exe。</p>
      <textarea value={script} onChange={(event) => setScript(event.target.value)} spellCheck={false} />
      <div className={running ? "ahk-status running" : "ahk-status"}>{lastMessage}</div>
    </section>
  );
}
