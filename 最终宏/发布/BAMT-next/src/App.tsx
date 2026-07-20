import { useEffect, useMemo, useState } from "react";
import { Activity, Crosshair, FileDown, FileUp, Hand, Keyboard, LetterText, MousePointerClick, Play, Plus, Save, Square, Trash2, Zap } from "lucide-react";
import { createAction, DEFAULT_CONFIG, MACRO_DESCRIPTIONS, MACRO_LABELS, PRESET_RESOLUTIONS, validateConfig } from "./config";
import { getMacroApi } from "./api";
import { hotkeyLabel, keyEventToHotkey, mouseEventToHotkey } from "./hotkeys";
import type { BackendEvent, BackendStatus, MacroAction, MacroConfig, MacroType } from "./types";

const typeIcons: Record<MacroType, typeof Crosshair> = { point: Crosshair, drag: Hand, autoClick: Zap, click: MousePointerClick };

export function App() {
  const api = useMemo(() => getMacroApi(), []);
  const [config, setConfig] = useState<MacroConfig>(DEFAULT_CONFIG);
  const [selectedId, setSelectedId] = useState(DEFAULT_CONFIG.actions[0]?.id ?? "");
  const [status, setStatus] = useState<BackendStatus>("booting");
  const [statusText, setStatusText] = useState("正在连接宏服务");
  const [logs, setLogs] = useState<string[]>([]);
  const [letterOpen, setLetterOpen] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const [recordingField, setRecordingField] = useState<"action" | "exit" | null>(null);

  const selected = config.actions.find((action) => action.id === selectedId) ?? config.actions[0];
  const errors = validateConfig(config);
  const canRun = errors.length === 0 && config.actions.some((action) => action.enabled);

  useEffect(() => {
    void api.getInitialConfig().then((loaded) => {
      setConfig(loaded);
      setSelectedId(loaded.actions[0]?.id ?? "");
      setStatus("ready");
      setStatusText("就绪");
    }).catch((error) => {
      setStatus("unavailable");
      setStatusText(String(error.message ?? error));
    });
    return api.onEvent(handleEvent);
  }, [api]);

  useEffect(() => {
    if (!recordingField) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const hotkey = keyEventToHotkey(event);
      if (!hotkey) return;
      event.preventDefault();
      if (recordingField === "action") patchSelected({ hotkey });
      else patchConfig({ exitKey: hotkey });
      pushLog(`已录入热键：${hotkeyLabel(hotkey)}`);
      setRecordingField(null);
    };
    const onMouseDown = (event: MouseEvent) => {
      const hotkey = mouseEventToHotkey(event);
      if (!hotkey) return;
      event.preventDefault();
      if (recordingField === "action") patchSelected({ hotkey });
      else patchConfig({ exitKey: hotkey });
      pushLog(`已录入热键：${hotkeyLabel(hotkey)}`);
      setRecordingField(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [recordingField, selectedId]);

  function handleEvent(event: BackendEvent) {
    if (event.type === "status") {
      setStatus(event.payload.status);
      setStatusText(event.payload.message);
      pushLog(event.payload.message);
    } else if (event.type === "log") {
      pushLog(event.payload.message);
    } else if (event.type === "execution") {
      pushLog(`${event.payload.phase === "start" ? "执行" : "结束"}：${event.payload.actionName}`);
    } else if (event.type === "error") {
      setStatus("error");
      setStatusText(event.payload.message);
      pushLog(event.payload.message);
    }
  }

  function pushLog(message: string) {
    setLogs((current) => [message, ...current].slice(0, 10));
  }

  function patchConfig(patch: Partial<MacroConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function patchSelected(patch: Partial<MacroAction>) {
    if (!selected) return;
    setConfig((current) => ({ ...current, actions: current.actions.map((action) => action.id === selected.id ? { ...action, ...patch } : action) }));
  }

  async function saveConfig() {
    const saved = await api.saveConfig(config);
    setConfig(saved);
    pushLog("配置已保存");
  }

  async function loadConfig() {
    const loaded = await api.loadConfig();
    setConfig(loaded);
    setSelectedId(loaded.actions[0]?.id ?? "");
    pushLog("配置已载入");
  }

  async function start() {
    if (!canRun) return;
    const result = await api.startListening(config);
    setStatus(result.status);
    setStatusText(result.message);
  }

  async function stop() {
    const result = await api.stopListening();
    setStatus(result.status);
    setStatusText(result.message);
  }

  async function testSelected() {
    if (!selected || errors.length > 0) return;
    const result = await api.testMacro(selected, config);
    setStatusText(result.message);
    pushLog(result.message);
  }

  async function capture() {
    setCaptureText("2 秒后捕获鼠标位置");
    const point = await api.capturePosition(2000);
    patchSelected({ targetX: point.x, targetY: point.y });
    setCaptureText(`已捕获：${point.x}, ${point.y}`);
  }

  function addAction() {
    const next = createAction(Date.now());
    const used = new Set(config.actions.map((action) => action.hotkey));
    next.hotkey = "qwertasdfgzxcvbf123456".split("").find((key) => !used.has(key)) ?? "f6";
    next.name = `指令${config.actions.length + 1}`;
    setConfig((current) => ({ ...current, actions: [...current.actions, next] }));
    setSelectedId(next.id);
  }

  function removeSelected() {
    if (!selected) return;
    setConfig((current) => {
      const actions = current.actions.filter((action) => action.id !== selected.id);
      setSelectedId(actions[0]?.id ?? "");
      return { ...current, actions };
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Blue Archive Macro Tool</p>
          <h1>总力战宏控制台</h1>
        </div>
        <div className="status-cluster">
          <span className={`status-pill status-${status}`}><Activity size={16} />{statusText}</span>
          <span className="exit-key">停止键 {hotkeyLabel(config.exitKey)}</span>
          {status === "listening" ? <button className="danger" onClick={stop}><Square size={18} />停止</button> : <button className="primary" onClick={start} disabled={!canRun}><Play size={18} />开始</button>}
        </div>
      </header>

      <section className="toolbar">
        <button onClick={saveConfig}><Save size={17} />保存</button>
        <button onClick={loadConfig}><FileDown size={17} />载入</button>
        <button onClick={() => void api.openLegacyApp()}><FileUp size={17} />旧版</button>
        <button onClick={() => setLetterOpen(true)}><LetterText size={17} />信件</button>
      </section>

      <section className="workspace">
        <aside className="panel editor-panel">
          <div className="section-title"><h2>配置</h2><span>{config.resolution.width} x {config.resolution.height}</span></div>
          <div className="resolution-grid">
            {PRESET_RESOLUTIONS.map((preset) => (
              <button key={preset.label} className={preset.width === config.resolution.width && preset.height === config.resolution.height ? "choice active" : "choice"} onClick={() => patchConfig({ resolution: { width: preset.width, height: preset.height } })}>{preset.label}</button>
            ))}
          </div>
          <div className="field-row">
            <label>宽度<input type="number" value={config.resolution.width} onChange={(event) => patchConfig({ resolution: { ...config.resolution, width: Number(event.target.value) } })} /></label>
            <label>高度<input type="number" value={config.resolution.height} onChange={(event) => patchConfig({ resolution: { ...config.resolution, height: Number(event.target.value) } })} /></label>
            <label>停止键<div className="capture-field"><input value={hotkeyLabel(config.exitKey)} readOnly /><button className={recordingField === "exit" ? "capture recording" : "capture"} onClick={() => setRecordingField(recordingField === "exit" ? null : "exit")}><Keyboard size={17} />{recordingField === "exit" ? "按下任意键" : "录入"}</button></div></label>
          </div>

          <div className="section-title"><h2>编辑指令</h2><button className="icon-button" onClick={addAction} title="新增指令"><Plus size={18} /></button></div>
          {selected ? (
            <div className="form-stack">
              <label>名称<input value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })} /></label>
              <div className="field-row">
                <label>热键<div className="capture-field"><input value={hotkeyLabel(selected.hotkey)} readOnly /><button className={recordingField === "action" ? "capture recording" : "capture"} onClick={() => setRecordingField(recordingField === "action" ? null : "action")}><Keyboard size={17} />{recordingField === "action" ? "按下热键" : "录入"}</button></div></label>
                <label className="toggle-line"><input type="checkbox" checked={selected.enabled} onChange={(event) => patchSelected({ enabled: event.target.checked })} />启用</label>
              </div>
              <div className="type-grid">
                {(Object.keys(MACRO_LABELS) as MacroType[]).map((type) => {
                  const Icon = typeIcons[type];
                  return <button key={type} className={selected.type === type ? "type-card active" : "type-card"} onClick={() => patchSelected({ type })} title={MACRO_DESCRIPTIONS[type]}><Icon size={20} />{MACRO_LABELS[type]}</button>;
                })}
              </div>
              {selected.type !== "autoClick" && <div className="field-row"><label>X<input type="number" value={selected.targetX} onChange={(event) => patchSelected({ targetX: Number(event.target.value) })} /></label><label>Y<input type="number" value={selected.targetY} onChange={(event) => patchSelected({ targetY: Number(event.target.value) })} /></label><button className="capture" onClick={capture}><Crosshair size={17} />捕获</button></div>}
              {selected.type === "drag" && <div className="field-row"><label>距离<input type="number" value={selected.dragDistance} onChange={(event) => patchSelected({ dragDistance: Number(event.target.value) })} /></label><label>时长<input type="number" step="0.01" value={selected.dragDuration} onChange={(event) => patchSelected({ dragDuration: Number(event.target.value) })} /></label></div>}
              {selected.type === "autoClick" && <label>连点间隔<input type="number" step="0.01" value={selected.clickGap} onChange={(event) => patchSelected({ clickGap: Number(event.target.value) })} /></label>}
              <div className="action-row"><button className="primary ghost" onClick={testSelected} disabled={errors.length > 0}><Play size={17} />测试</button><button className="danger ghost" onClick={removeSelected}><Trash2 size={17} />删除</button></div>
              {captureText && <p className="hint">{captureText}</p>}
            </div>
          ) : <div className="empty">还没有指令</div>}
        </aside>

        <section className="panel list-panel">
          <div className="section-title"><h2>指令列表</h2><span>{config.actions.length} 条</span></div>
          <div className="macro-list">
            {config.actions.map((action) => {
              const Icon = typeIcons[action.type];
              return <button key={action.id} className={action.id === selectedId ? "macro-row selected" : "macro-row"} onClick={() => setSelectedId(action.id)}><span className="macro-icon"><Icon size={20} /></span><span><strong>{action.name}</strong><small>{MACRO_LABELS[action.type]} · {action.enabled ? "启用" : "停用"}</small></span><kbd>{hotkeyLabel(action.hotkey)}</kbd><span className="macro-meta">{action.type === "autoClick" ? `${action.clickGap}s` : `${action.targetX}, ${action.targetY}`}</span></button>;
            })}
          </div>
          {errors.length > 0 && <div className="error-box">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
          <div className="log-box"><h3>状态记录</h3>{logs.length === 0 ? <p>等待操作</p> : logs.map((log, index) => <p key={`${log}-${index}`}>{log}</p>)}</div>
        </section>
      </section>

      {letterOpen && <div className="modal-backdrop" onClick={() => setLetterOpen(false)}><article className="letter-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setLetterOpen(false)}>×</button><p className="eyebrow">Letter</p><h2>给老师的一封信</h2><p>谢谢你一直把这个小工具带到现在。新版保留旧版四种指令，同时把配置、停止清理和界面状态整理成更可靠的结构。</p><p>宏工具会影响系统输入，启动前请确认目标窗口和停止键；遇到异常时优先按停止键或点击顶部停止。</p><p className="signature">今后也请多指教啦，老师。</p></article></div>}
    </main>
  );
}
