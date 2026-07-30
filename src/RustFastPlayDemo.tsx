import { Cpu, Play, Square } from "lucide-react";
import type { MacroApi } from "./types";

export function RustFastPlayDemo({ api, pushLog }: { api: MacroApi; pushLog: (message: string) => void }) {
  async function run() {
    const result = await api.runRustFastPlayDemo();
    pushLog(result.message);
  }

  async function stop() {
    const result = await api.stopRustFastPlayDemo();
    pushLog(result.message);
  }

  return (
    <section id="section-rust-demo" className="glass-card rust-demo-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Rust Input Demo</p>
          <h2><Cpu size={22} /> Rust 最速出牌 Demo</h2>
        </div>
        <div className="action-row">
          <button className="primary ghost" onClick={run}><Play size={17} />启动 Demo</button>
          <button className="danger ghost" onClick={stop}><Square size={17} />停止 Demo</button>
        </div>
      </div>
      <div className="demo-note">
        <p><strong>用途：</strong>独立测试 Rust 输入链路，不会替换 Python 后端，也不会改当前宏配置。</p>
        <p><strong>按键：</strong>按住 Q 循环发送 1 + 当前鼠标左键；按住 W 循环发送 2 + 当前鼠标左键；按住 E 循环发送 3 + 当前鼠标左键。</p>
        <p><strong>退出：</strong>F12 可以从 Rust 进程内部退出，也可以点“停止 Demo”。</p>
        <p><strong>实现：</strong>Rust 使用 Windows 低级键盘 Hook 监听热键，并用 SendInput 发送键盘与鼠标点击。</p>
      </div>
    </section>
  );
}
