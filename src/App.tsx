import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Archive, BookOpen, Code2, CalendarDays, ChevronRight, Crosshair, FileDown, FileUp, FolderOpen, Hand, Home, Keyboard, LetterText, ListChecks, Menu, MousePointerClick, PanelLeftClose, PanelLeftOpen, Play, Plus, Save, Settings, Shuffle, Square, Trash2, Zap } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  calculateSkillSlots,
  createAction,
  createMacroPackage,
  createPresetFromConfig,
  createSkillDragActions,
  DEFAULT_CONFIG,
  MACRO_DESCRIPTIONS,
  MACRO_LABELS,
  normalizeMacroPackage,
  parseAhkMacroPackage,
  PRESET_RESOLUTIONS,
  recommendFastPlayTiming,
  transformActionsToResolution,
  transformPoint,
  transformPresetToResolution,
  validateConfig,
  type CoordinateTransformMode,
  type MacroPreset
} from "./config";
import { getMacroApi } from "./api";
import { hotkeyLabel, keyEventToHotkey, mouseEventToHotkey } from "./hotkeys";
import { ProjectManual } from "./ProjectManual";
import { AhkConsole } from "./AhkConsole";
import { TimelinePlanner } from "./TimelinePlanner";
import { DSL_COMMAND_REFERENCE, DSL_EXAMPLES, formatDsl, getDslCompletions, parseDsl, type DslCompletion } from "./dsl";
import type { BackendEvent, BackendStatus, MacroAction, MacroConfig, MacroType } from "./types";
import blueArchiveLogo from "./assets/blue-archive-logo-jp.svg";

const typeIcons: Record<MacroType, typeof Crosshair> = { point: Crosshair, drag: Hand, autoClick: Zap, click: MousePointerClick, fastPlay: Play, script: Code2 };
const knownMacroTypes = new Set(Object.keys(MACRO_LABELS));

function isKnownMacroType(type: unknown): type is MacroType {
  return typeof type === "string" && knownMacroTypes.has(type);
}

function macroIconFor(type: unknown) {
  return isKnownMacroType(type) ? typeIcons[type] : Crosshair;
}

function macroLabelFor(type: unknown) {
  return isKnownMacroType(type) ? MACRO_LABELS[type] : `未知宏(${String(type || "空")})`;
}

function baseSkillSlotIndex(action: MacroAction) {
  const match = /^skill-(?:drag|fast-play)-([1-3])$/.exec(action.id);
  return match ? Number(match[1]) - 1 : -1;
}

function normalizeUiConfig(raw: Partial<MacroConfig>): MacroConfig {
  const merged = { ...DEFAULT_CONFIG, ...raw } as MacroConfig;
  const rawActions = Array.isArray(raw.actions) ? raw.actions : DEFAULT_CONFIG.actions;
  const baseSkillSlots = createSkillDragActions(merged.resolution, merged);
  const actions = rawActions.map((action, index) => {
    const fallback = createAction(Date.now() + index);
    const mergedAction = { ...fallback, ...action } as MacroAction;
    const normalizedAction = isKnownMacroType(mergedAction.type) ? mergedAction : { ...mergedAction, type: "point" as MacroType, name: `${mergedAction.name || "未知宏"}（已转为点位）` };
    const slotIndex = baseSkillSlotIndex(normalizedAction);
    if (slotIndex >= 0) {
      const slot = baseSkillSlots[slotIndex];
      return {
        ...normalizedAction,
        name: slot.name,
        type: slot.type,
        cardKey: slot.cardKey,
        targetX: slot.targetX,
        targetY: slot.targetY,
        dragDistance: slot.dragDistance,
        cardHoldDuration: normalizedAction.cardHoldDuration ?? slot.cardHoldDuration,
        dragDuration: normalizedAction.dragDuration ?? slot.dragDuration,
        clickGap: slot.clickGap,
        cardClickGap: normalizedAction.cardClickGap ?? slot.cardClickGap,
        loopGap: normalizedAction.loopGap ?? slot.loopGap,
        hotkey: normalizedAction.hotkey || slot.hotkey,
        enabled: normalizedAction.enabled
      };
    }
    return normalizedAction;
  });
  return { ...merged, actions };
}
const backgroundModules = import.meta.glob("./assets/backgrounds/*.{png,jpg,jpeg,webp,avif}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

function pickBackgroundIndex(length: number) {
  if (length <= 0) return -1;
  const last = Number(localStorage.getItem("bamt.lastBackgroundIndex") ?? "-1");
  if (length === 1) return 0;
  let next = Math.floor(Math.random() * length);
  if (next === last) next = (next + 1 + Math.floor(Math.random() * (length - 1))) % length;
  localStorage.setItem("bamt.lastBackgroundIndex", String(next));
  return next;
}


export function App() {
  const api = useMemo(() => getMacroApi(), []);
  const backgrounds = useMemo(() => Object.values(backgroundModules).sort(), []);
  const [backgroundIndex, setBackgroundIndex] = useState(() => pickBackgroundIndex(backgrounds.length));
  const activeBackground = backgroundIndex >= 0 ? backgrounds[backgroundIndex] : "";
  const appStyle = { "--app-bg-image": activeBackground ? `url("${activeBackground}")` : "none" } as CSSProperties;

  const [config, setConfig] = useState<MacroConfig>(DEFAULT_CONFIG);
  const configRef = useRef<MacroConfig>(DEFAULT_CONFIG);
  const scriptEditorRef = useRef<HTMLTextAreaElement>(null);
  const [selectedId, setSelectedId] = useState(DEFAULT_CONFIG.actions[0]?.id ?? "");
  const [status, setStatus] = useState<BackendStatus>("booting");
  const [statusText, setStatusText] = useState("正在连接后端");
  const [logs, setLogs] = useState<string[]>([]);
  const [letterOpen, setLetterOpen] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const [recordingField, setRecordingField] = useState<"action" | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(true);
  const [converterOpen, setConverterOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const [presetName, setPresetName] = useState("默认总力战预设");
  const [presetLibrary, setPresetLibrary] = useState<MacroPreset[]>([]);
  const [presetLibraryReady, setPresetLibraryReady] = useState(false);
  const [storagePaths, setStoragePaths] = useState<{ relative: Record<string, string> } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [converter, setConverter] = useState({ fromW: 3840, fromH: 2160, toW: 2560, toH: 1600, x: 0, y: 0, mode: "centerAxisScale" as CoordinateTransformMode });
  const [dslCaret, setDslCaret] = useState(0);
  const [dslCompletionOpen, setDslCompletionOpen] = useState(false);
  const [dslCompletionIndex, setDslCompletionIndex] = useState(0);

  const selected = config.actions.find((action) => action.id === selectedId) ?? config.actions[0];
  const errors = validateConfig(config);
  const enabledCount = config.actions.filter((action) => action.enabled).length;
  const canRun = errors.length === 0 && enabledCount > 0;
  const converterResult = transformPoint({ x: converter.x, y: converter.y }, { width: converter.fromW, height: converter.fromH }, { width: converter.toW, height: converter.toH }, converter.mode);
  const fastPlayTiming = recommendFastPlayTiming(config.displayRefreshRate, config.gameFrameRate, config.verticalSyncEnabled);
  const scriptAnalysis = useMemo(() => selected?.type === "script" ? parseDsl(selected.script || "") : null, [selected?.type, selected?.script]);
  const dslCompletions = useMemo(() => selected?.type === "script" && dslCompletionOpen ? getDslCompletions(selected.script || "", dslCaret) : [], [selected?.type, selected?.script, dslCaret, dslCompletionOpen]);

  useEffect(() => {
    setDslCompletionOpen(false);
    setDslCompletionIndex(0);
  }, [selectedId]);

  useEffect(() => {
    void api.getStoragePaths().then(setStoragePaths).catch(() => undefined);
    void api.loadPresetLibrary().then((presets) => {
      setPresetLibrary(Array.isArray(presets) ? presets as MacroPreset[] : []);
      setPresetLibraryReady(true);
    }).catch((error) => {
      pushLog("宏预设库读取失败：" + String(error instanceof Error ? error.message : error));
      setPresetLibraryReady(true);
    });
  }, [api]);

  useEffect(() => {
    if (!presetLibraryReady) return;
    void api.savePresetLibrary(presetLibrary as unknown[]).catch((error) => pushLog("宏预设库保存失败：" + String(error instanceof Error ? error.message : error)));
  }, [api, presetLibrary, presetLibraryReady]);

  useEffect(() => {
    void api.getInitialConfig().then((loaded) => {
      const normalized = normalizeUiConfig(loaded);
      configRef.current = normalized;
      setConfig(normalized);
      setSelectedId(normalized.actions[0]?.id ?? "");
      setStatusText("就绪");
    }).catch((error) => {
      setStatus("unavailable");
      setStatusText(String(error.message ?? error));
    });
    return api.onEvent(handleEvent);
  }, [api]);

  useEffect(() => {
    if (!recordingField) return undefined;
    const commitHotkey = (hotkey: string) => {
      patchSelected({ hotkey });
      pushLog(`已录入热键：${hotkeyLabel(hotkey)}`);
      setRecordingField(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const hotkey = keyEventToHotkey(event);
      if (!hotkey) return;
      event.preventDefault();
      commitHotkey(hotkey);
    };
    const onMouseDown = (event: MouseEvent) => {
      const hotkey = mouseEventToHotkey(event);
      if (!hotkey) return;
      event.preventDefault();
      commitHotkey(hotkey);
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
    setLogs((current) => [message, ...current].slice(0, 8));
  }

  function stopBeforeEditing(reason = "编辑配置") {
    if (status !== "listening") return;
    void api.stopListening().then((result) => {
      setStatus(result.status);
      setStatusText(result.message);
    }).catch((error) => {
      setStatus("error");
      setStatusText(String(error instanceof Error ? error.message : error));
    });
    pushLog(`${reason}：已自动暂停宏监听`);
  }

  function setConfigLive(next: MacroConfig) {
    configRef.current = next;
    setConfig(next);
  }

  function updateConfigLive(updater: (current: MacroConfig) => MacroConfig) {
    const next = updater(configRef.current);
    setConfigLive(next);
    return next;
  }
  function adaptPresetForCurrentResolution(preset: MacroPreset): MacroPreset {
    return {
      ...preset,
      id: `${preset.id}-adapted-${Date.now()}`,
      name: preset.baseResolution.width === config.resolution.width && preset.baseResolution.height === config.resolution.height
        ? preset.name
        : `${preset.name}（已适配 ${config.resolution.width}×${config.resolution.height}）`,
      baseResolution: config.resolution,
      actions: transformPresetToResolution(preset, config.resolution, config)
    };
  }

  function jumpTo(section: string) {
    setActiveSection(section);
    if (section === "converter") setConverterOpen(true);
  }

  function changeBackground() {
    if (backgrounds.length <= 1) return;
    setBackgroundIndex((current) => {
      let next = Math.floor(Math.random() * backgrounds.length);
      if (next === current) next = (next + 1) % backgrounds.length;
      localStorage.setItem("bamt.lastBackgroundIndex", String(next));
      return next;
    });
  }

  async function openScheduleTool() {
    const result = await api.openScheduleTool();
    pushLog(result.message);
  }

  function patchConfig(patch: Partial<MacroConfig>) {
    stopBeforeEditing();
    updateConfigLive((current) => ({ ...current, ...patch }));
  }

  function patchSelected(patch: Partial<MacroAction>) {
    if (!selected) return;
    stopBeforeEditing();
    updateConfigLive((current) => ({ ...current, actions: current.actions.map((action) => action.id === selected.id ? { ...action, ...patch } : action) }));
  }

  function applyResolutionAndSkillSlots(resolution: MacroConfig["resolution"]) {
    stopBeforeEditing("修改分辨率");
    updateConfigLive((current) => {
      const actions = transformActionsToResolution(current.actions, current.resolution, resolution, "centerAxisScale", current);
      return { ...current, resolution, actions };
    });
    pushLog("已按当前调参重算 Q/W/E 手牌位，并按新分辨率换算其他坐标宏");
  }

  function patchSkillSlotXOffset(index: number, value: number) {
    const offsets = [...(config.skillSlotXOffsets || [0.2, 0.28, 0.362])];
    offsets[index] = value;
    patchConfig({ skillSlotXOffsets: offsets });
  }

  function insertDslSnippet(snippet: string) {
    if (!selected || selected.type !== "script") return;
    const editor = scriptEditorRef.current;
    const source = selected.script || "";
    const start = editor?.selectionStart ?? source.length;
    const end = editor?.selectionEnd ?? start;
    const prefix = start > 0 && source[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < source.length && source[end] !== "\n" ? "\n" : "";
    const next = source.slice(0, start) + prefix + snippet + suffix + source.slice(end);
    patchSelected({ script: next });
    requestAnimationFrame(() => {
      const position = start + prefix.length + snippet.length;
      scriptEditorRef.current?.focus();
      scriptEditorRef.current?.setSelectionRange(position, position);
    });
  }

  function formatSelectedDsl() {
    if (!scriptAnalysis || scriptAnalysis.diagnostics.length > 0) return;
    patchSelected({ script: formatDsl(scriptAnalysis.commands) });
  }

  function updateDslCaret(editor: HTMLTextAreaElement, open = false) {
    setDslCaret(editor.selectionStart);
    if (open) {
      setDslCompletionOpen(true);
      setDslCompletionIndex(0);
    }
  }

  function acceptDslCompletion(completion: DslCompletion) {
    if (!selected || selected.type !== "script") return;
    const source = selected.script || "";
    const next = source.slice(0, completion.replaceStart) + completion.insertText + source.slice(completion.replaceEnd);
    const nextCaret = completion.replaceStart + completion.insertText.length;
    patchSelected({ script: next });
    setDslCaret(nextCaret);
    setDslCompletionOpen(false);
    requestAnimationFrame(() => {
      scriptEditorRef.current?.focus();
      scriptEditorRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleDslEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.ctrlKey && event.code === "Space") {
      event.preventDefault();
      updateDslCaret(event.currentTarget, true);
      return;
    }
    if (!dslCompletionOpen || dslCompletions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setDslCompletionIndex((current) => (current + direction + dslCompletions.length) % dslCompletions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptDslCompletion(dslCompletions[Math.min(dslCompletionIndex, dslCompletions.length - 1)]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDslCompletionOpen(false);
    }
  }

  function withRecommendedFastPlayTiming(current: MacroConfig) {
    const timing = recommendFastPlayTiming(current.displayRefreshRate, current.gameFrameRate, current.verticalSyncEnabled);
    return {
      ...current,
      actions: current.actions.map((action) => action.type === "fastPlay" ? {
        ...action,
        cardHoldDuration: timing.cardHoldDuration,
        cardClickGap: timing.cardClickGap,
        dragDuration: timing.clickHoldDuration,
        loopGap: timing.loopGap
      } : action)
    };
  }

  function applyRecommendedFastPlayTiming() {
    stopBeforeEditing("应用最速出牌推荐时序");
    const next = updateConfigLive(withRecommendedFastPlayTiming);
    const timing = recommendFastPlayTiming(next.displayRefreshRate, next.gameFrameRate, next.verticalSyncEnabled);
    pushLog(`已应用最速出牌推荐时序：${timing.stageMs}/${timing.stageMs}/${timing.stageMs}/${timing.stageMs}ms`);
  }

  async function confirmStartup() {
    let next = configRef.current;
    if (next.autoTuneFastPlayTiming) next = withRecommendedFastPlayTiming(next);
    setConfigLive(next);
    try {
      const saved = await api.saveConfig(next);
      setConfigLive(normalizeUiConfig(saved));
      if (next.autoTuneFastPlayTiming) {
        const timing = recommendFastPlayTiming(next.displayRefreshRate, next.gameFrameRate, next.verticalSyncEnabled);
        pushLog(`启动设置已保存，最速出牌使用 ${timing.stageMs}/${timing.stageMs}/${timing.stageMs}/${timing.stageMs}ms`);
      }
    } catch (error) {
      pushLog(`启动设置保存失败：${String(error instanceof Error ? error.message : error)}`);
    }
    setOnboardingOpen(false);
  }

  function addAction() {
    stopBeforeEditing("新增指令");
    const next = createAction(Date.now());
    const used = new Set(config.actions.map((action) => action.hotkey));
    next.hotkey = "qwertasdfgzxcvbf123456".split("").find((key) => !used.has(key)) ?? "f6";
    next.name = `指令${config.actions.length + 1}`;
    updateConfigLive((current) => ({ ...current, actions: [...current.actions, next] }));
    setSelectedId(next.id);
  }

  function addScriptAction(script = "") {
    stopBeforeEditing("新增脚本宏");
    const next = createAction(Date.now());
    const used = new Set(config.actions.map((action) => action.hotkey));
    next.hotkey = "qwertasdfgzxcvbf123456".split("").find((key) => !used.has(key)) ?? "f6";
    next.name = `脚本宏 ${config.actions.filter((action) => action.type === "script").length + 1}`;
    next.type = "script";
    next.script = script || next.script;
    updateConfigLive((current) => ({ ...current, actions: [...current.actions, next] }));
    setSelectedId(next.id);
  }

  async function importDslScriptAction() {
    stopBeforeEditing("导入 DSL 脚本宏");
    const file = await api.pickPresetPackage();
    if (!file) {
      pushLog("已取消导入 DSL 脚本宏");
      return;
    }
    const analysis = parseDsl(file.text);
    if (analysis.diagnostics.length > 0) {
      pushLog(`DSL 导入失败：第 ${analysis.diagnostics[0].line} 行 ${analysis.diagnostics[0].message}`);
      return;
    }
    const next = createAction(Date.now());
    const used = new Set(config.actions.map((action) => action.hotkey));
    next.hotkey = "qwertasdfgzxcvbf123456".split("").find((key) => !used.has(key)) ?? "f6";
    next.name = file.name.replace(/\.(?:dsl|bamt|txt)$/i, "") || `脚本宏 ${config.actions.filter((action) => action.type === "script").length + 1}`;
    next.type = "script";
    next.script = formatDsl(analysis.commands);
    updateConfigLive((current) => ({ ...current, actions: [...current.actions, next] }));
    setSelectedId(next.id);
    pushLog(`已导入 DSL 脚本宏：${file.path}`);
  }


  function removeSelected() {
    if (!selected) return;
    stopBeforeEditing("删除指令");
    updateConfigLive((current) => {
      const actions = current.actions.filter((action) => action.id !== selected.id);
      setSelectedId(actions[0]?.id ?? "");
      return { ...current, actions };
    });
  }

  async function saveConfig() {
    const saved = await api.saveConfig(configRef.current);
    setConfigLive(saved);
    pushLog("配置已保存");
  }

  async function loadConfig() {
    stopBeforeEditing("载入配置");
    const loaded = await api.loadConfig();
    const normalized = normalizeUiConfig(loaded);
    setConfigLive(normalized);
    setSelectedId(normalized.actions[0]?.id ?? "");
  }

  async function start() {
    const liveConfig = configRef.current;
    const liveErrors = validateConfig(liveConfig);
    const enabledActions = liveConfig.actions.filter((action) => action.enabled);
    if (liveErrors.length > 0 || enabledActions.length === 0) return;
    if (status === "listening") await api.stopListening();
    pushLog(`前端发送 ${enabledActions.length} 条启用宏：${enabledActions.map((action) => `${action.hotkey}:${action.type}:${action.name}@${action.targetX},${action.targetY}`).join("，")}`);
    const result = await api.startListening(liveConfig);
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
    const liveSelected = configRef.current.actions.find((action) => action.id === selected.id) ?? selected;
    const result = await api.testMacro(liveSelected, configRef.current);
    setStatusText(result.message);
    pushLog(result.message);
  }

  async function capture() {
    stopBeforeEditing("捕获点位");
    setCaptureText("2 秒后捕获鼠标位置");
    const point = await api.capturePosition(2000);
    patchSelected({ targetX: point.x, targetY: point.y });
    setCaptureText(`已捕获：${point.x}, ${point.y}`);
  }

  function downloadJson(filename: string, value: unknown) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function saveCurrentAsPreset() {
    stopBeforeEditing("保存预设");
    const preset = createPresetFromConfig(config, presetName.trim() || `预设 ${presetLibrary.length + 1}`);
    setPresetLibrary((current) => [preset, ...current]);
    pushLog(`已保存预设：${preset.name}`);
  }

  function loadPreset(preset: MacroPreset) {
    stopBeforeEditing("载入预设");
    const actions = transformPresetToResolution(preset, config.resolution, config);
    setConfig((current) => ({ ...current, actions }));
    setSelectedId(actions[0]?.id ?? "");
    setPresetName(preset.name);
    pushLog(`已载入预设并适配当前分辨率：${preset.name}`);
  }

  function deletePreset(id: string) {
    const preset = presetLibrary.find((item) => item.id === id);
    setPresetLibrary((current) => current.filter((item) => item.id !== id));
    if (preset) pushLog(`已删除预设：${preset.name}`);
  }

  function exportCurrentPreset() {
    downloadJson(`bamt-preset-${config.resolution.width}x${config.resolution.height}.json`, createMacroPackage(presetName || "当前预设", [createPresetFromConfig(config, presetName || "当前预设")]));
    pushLog("已导出当前预设");
  }

  function exportAllPresets() {
    const currentPreset = createPresetFromConfig(config, presetName || "当前预设");
    downloadJson("bamt-all-presets.json", createMacroPackage("BAMT 全部宏预设", [currentPreset, ...presetLibrary]));
    pushLog("已导出全部预设");
  }

  async function importPresetPackage(mode: "addPresets" | "mergeIntoCurrent") {
    stopBeforeEditing(mode === "addPresets" ? "导入全局宏" : "合并导入全局宏");
    const file = await api.pickPresetPackage();
    if (!file) {
      pushLog("已取消导入。默认导入目录：data/imports");
      return;
    }
    try {
      const pack = file.name.toLowerCase().endsWith(".ahk")
        ? parseAhkMacroPackage(file.text, file.name, config.resolution)
        : normalizeMacroPackage(JSON.parse(file.text));
      if (mode === "addPresets") {
        const adaptedPresets = pack.presets.map(adaptPresetForCurrentResolution);
        setPresetLibrary((current) => [...adaptedPresets, ...current]);
        pushLog(`已从 ${file.path} 导入并适配 ${adaptedPresets.length} 套全局宏到 ${config.resolution.width}x${config.resolution.height}`);
        return;
      }
      const merged = pack.presets.flatMap((preset) => transformPresetToResolution(preset, config.resolution, config));
      setConfig((current) => ({ ...current, actions: [...current.actions, ...merged] }));
      setSelectedId(merged[0]?.id ?? selectedId);
      pushLog(`已从 ${file.path} 合并 ${merged.length} 条宏，并完成坐标适配`);
    } catch (error) {
      pushLog(String(error instanceof Error ? error.message : error));
    }
  }

  return (
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"} style={appStyle}>
      <aside className="side-nav">
        <div className="logo-lockup"><span className="logo-mark">BA</span><strong>BAMT</strong><small>Next Console</small><button className="sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
        <nav>
          <button className={activeSection === "home" ? "nav-active" : ""} onClick={() => jumpTo("home")}><Home size={18} />宏控制台</button>
          <button className={activeSection === "converter" ? "nav-active" : ""} onClick={() => jumpTo("converter")}><Crosshair size={18} />点位转换器</button>
          <button className={activeSection === "timeline" ? "nav-active" : ""} onClick={() => jumpTo("timeline")}><CalendarDays size={18} />排轴编辑器</button>
          <button className={activeSection === "ahk" ? "nav-active" : ""} onClick={() => jumpTo("ahk")}><Code2 size={18} />AHK 解释器</button>
          <button onClick={() => setManualOpen(true)}><BookOpen size={18} />使用说明书</button>
        </nav>
        <div className="nav-foot"><span className={`dot dot-${status}`} />{statusText}</div>
      </aside>

      <section className="stage">
        <header className="stage-top">
          <div><p className="eyebrow">Schale Tactical Automation</p><h1>总力战宏控制台</h1></div>
          <div className="runbar">
            <span className="exit-key">紧急停止 X</span>
            <button className="ghost" onClick={changeBackground} disabled={backgrounds.length <= 1}><Shuffle size={18} />换背景</button>
            {status === "listening" ? <button className="danger" onClick={stop}><Square size={18} />停止</button> : <button className="primary" onClick={start} disabled={!canRun}><Play size={18} />开始</button>}
          </div>
        </header>

        <section id="section-home" className={activeSection === "home" ? "welcome-panel section-view" : "welcome-panel section-view hidden"}>
          <div className="assistant-orbit logo-showcase"><img src={blueArchiveLogo} alt="Blue Archive" /></div>
          <div className="welcome-copy">
            <p className="eyebrow">Current Preset</p>
            <h2>{presetName}</h2>
            <p>当前宏可保存为命名预设，也可以导出给其他玩家。导入时会根据当前分辨率自动换算点位。</p>
            <div className="metric-row"><span>{config.actions.length} 指令</span><span>{enabledCount} 启用</span><span>{config.resolution.width}×{config.resolution.height}</span></div>
          </div>
          <div className="quick-actions preset-actions">
            <input value={presetName} onChange={(event) => setPresetName(event.target.value)} />
            <button onClick={() => setConverterOpen(true)}><Crosshair size={17} />点位转换器</button>
            <button onClick={() => applyResolutionAndSkillSlots(config.resolution)}><Crosshair size={17} />重算技能位</button>
            <button onClick={saveCurrentAsPreset}><Archive size={17} />保存预设</button>
            <button onClick={exportCurrentPreset}><FileUp size={17} />导出当前</button>
            <button onClick={exportAllPresets}><FileUp size={17} />导出全部</button>
            <button onClick={() => importPresetPackage("addPresets")}><FileDown size={17} />导入全局宏</button>
            <button onClick={() => importPresetPackage("mergeIntoCurrent")}><Plus size={17} />合并全局宏</button>
            <button onClick={saveConfig}><Save size={17} />保存</button>
            <button onClick={loadConfig}><FileDown size={17} />载入</button>
            <button onClick={() => void api.openDataDir().then((result) => pushLog(result.message))}><Archive size={17} />打开 data</button>
            <button onClick={() => void api.openLogDir().then((result) => pushLog(result.message))}><FolderOpen size={17} />宏诊断日志</button>
            <button onClick={() => setLetterOpen(true)}><LetterText size={17} />信件</button>
          </div>
        </section>

        <section id="section-macros" className={activeSection === "home" || activeSection === "macros" || activeSection === "settings" || activeSection === "presets" ? "control-grid section-view" : "control-grid section-view hidden"}>
          <section id="section-settings" className="glass-card editor-card">
            <div className="section-title"><h2>作战配置</h2><span>{config.resolution.width} x {config.resolution.height}</span></div>
            <div className="resolution-grid">{PRESET_RESOLUTIONS.map((preset) => <button key={preset.label} className={preset.width === config.resolution.width && preset.height === config.resolution.height ? "choice active" : "choice"} onClick={() => applyResolutionAndSkillSlots({ width: preset.width, height: preset.height })}>{preset.label}</button>)}</div>
            <div className="field-row">
              <label>宽度<input type="number" min="100" value={config.resolution.width} onChange={(event) => patchConfig({ resolution: { ...config.resolution, width: Number(event.target.value) } })} /></label>
              <label>高度<input type="number" min="100" value={config.resolution.height} onChange={(event) => patchConfig({ resolution: { ...config.resolution, height: Number(event.target.value) } })} /></label>
              <label>自定义分辨率<button className="capture custom-resolution-button" onClick={() => applyResolutionAndSkillSlots(config.resolution)}><Crosshair size={17} />应用并重算</button></label>
              

              <div className="macro-tuning-panel">
                <div className="tuning-heading">
                  <div>
                    <strong>手牌点位与虚拟移动</strong>
                    <span>改完后点“应用并重算”，Q/W/E 会按这些参数刷新。</span>
                  </div>
                  <button className="capture" onClick={() => applyResolutionAndSkillSlots(config.resolution)}><Crosshair size={17} />应用并重算</button>
                </div>
                <div className="field-row tuning-row">
                  <label>底边偏移比例<input type="number" step="0.001" min="0.03" max="0.16" value={config.skillSlotBottomOffsetRatio} onChange={(event) => patchConfig({ skillSlotBottomOffsetRatio: Number(event.target.value) })} /></label>
                  <label>虚拟最少步数<input type="number" min="1" max="60" value={config.smoothMoveMinSteps} onChange={(event) => patchConfig({ smoothMoveMinSteps: Number(event.target.value) })} /></label>
                  <label>虚拟步长倍率<input type="number" min="1" max="600" value={config.smoothMoveStepRate} onChange={(event) => patchConfig({ smoothMoveStepRate: Number(event.target.value) })} /></label>
                </div>
                <div className="slot-offset-grid">
                  {["Q", "W", "E"].map((key, index) => <label key={key}>{key} 中心 X 偏移<input type="number" step="0.001" min="-0.45" max="0.45" value={(config.skillSlotXOffsets || [0.2, 0.28, 0.362])[index]} onChange={(event) => patchSkillSlotXOffset(index, Number(event.target.value))} /></label>)}
                </div>
                <div className="slot-preview">
                  {calculateSkillSlots(config.resolution, config).map((slot, index) => <span key={index}>{["Q", "W", "E"][index]} {slot.x}, {slot.y}</span>)}
                </div>
              </div>
              <div className="backend-label"><span>输入后端</span><div className="backend-picker">{([
                { value: "cursor", title: "系统光标模式", note: "默认推荐。适配度最高，通常能进原生游戏；会移动并占用真实鼠标。" },
                { value: "windowMessage", title: "Win 窗口消息模式", note: "不会移动光标；部分原生游戏聚焦后可能拒收窗口消息。" },
                { value: "touch", title: "Win 触控注入模式", note: "模拟触控输入，不抢鼠标；目前仍在测试中，兼容性不稳定。" }
              ] as const).map((backend) => <button key={backend.value} type="button" className={(config.inputBackend || "cursor") === backend.value ? "backend-option active" : "backend-option"} onClick={() => patchConfig({ inputBackend: backend.value as MacroConfig["inputBackend"] })}><strong>{backend.title}</strong><small>{backend.note}</small></button>)}</div></div>
              <label className="takeover-line"><input type="checkbox" checked={config.inputTakeoverEnabled} onChange={(event) => patchConfig({ inputTakeoverEnabled: event.target.checked })} />键盘接管模式</label>
              <p className="takeover-note">默认关闭。开启后监听期间会尽量屏蔽常用键盘输入，只保留宏键和固定强制停止 X。</p>
            </div>

            <div className="section-title second"><h2>编辑指令</h2><button className="icon-button" onClick={addAction} title="新增指令"><Plus size={18} /></button></div>
            {selected ? <div className="form-stack">
              <label>名称<input value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })} /></label>
              <div className="field-row">
                <label>热键<div className="capture-field"><input value={hotkeyLabel(selected.hotkey)} readOnly /><button className={recordingField === "action" ? "capture recording" : "capture"} onClick={() => setRecordingField(recordingField === "action" ? null : "action")}><Keyboard size={17} />{recordingField === "action" ? "按下热键" : "录入"}</button></div></label>
                <label className="toggle-line"><input type="checkbox" checked={selected.enabled} onChange={(event) => patchSelected({ enabled: event.target.checked })} />启用</label>
              </div>
              <div className="type-grid">{(Object.keys(MACRO_LABELS).filter((type) => type !== "script") as MacroType[]).map((type) => { const Icon = typeIcons[type]; return <button key={type} className={selected.type === type ? "type-card active" : "type-card"} onClick={() => patchSelected({ type })} title={MACRO_DESCRIPTIONS[type]}><Icon size={20} />{MACRO_LABELS[type]}</button>; })}</div>
              <div className="script-action-row"><button className={selected.type === "script" ? "capture active" : "capture"} onClick={() => addScriptAction()}><Plus size={17} />{"新增脚本宏"}</button><button className="capture" onClick={importDslScriptAction}><FileDown size={17} />{"导入 DSL 文件"}</button></div>
              <div className="field-row"><label>X<input type="number" value={selected.targetX} onChange={(event) => patchSelected({ targetX: Number(event.target.value) })} /></label><label>Y<input type="number" value={selected.targetY} onChange={(event) => patchSelected({ targetY: Number(event.target.value) })} /></label><button className="capture" onClick={capture}><Crosshair size={17} />捕获</button></div>
              {selected.type === "drag" && <div className="field-row"><label>距离<input type="number" value={selected.dragDistance} onChange={(event) => patchSelected({ dragDistance: Number(event.target.value) })} /></label><label>时长<input type="number" step="0.001" value={selected.dragDuration} onChange={(event) => patchSelected({ dragDuration: Number(event.target.value) })} /></label></div>}
              {selected.type === "point" && <label>{"\u6309\u4f4f\u65f6\u957f"}<input type="number" step="0.001" min="0.005" max="0.2" value={selected.clickGap ?? 0.03} onChange={(event) => patchSelected({ clickGap: Number(event.target.value) })} /></label>}
              {selected.type === "fastPlay" && <label>选牌键<input value={selected.cardKey || ""} placeholder="1 / 2 / 3" onChange={(event) => patchSelected({ cardKey: event.target.value.trim() })} /></label>}
              {selected.type === "script" && scriptAnalysis && <div className="dsl-editor">
                <div className="dsl-editor-head">
                  <div><strong>Rust DSL 编辑器</strong><small>启动监听时由 Rust 预编译一次，执行阶段不再重复解析</small></div>
                  <span className={scriptAnalysis.diagnostics.length === 0 ? "dsl-status ok" : "dsl-status error"}>{scriptAnalysis.diagnostics.length === 0 ? "语法通过" : `${scriptAnalysis.diagnostics.length} 个错误`}</span>
                </div>
                <div className="dsl-toolbar">
                  <button type="button" onClick={() => insertDslSnippet("click target 7ms")}>+ 点击</button>
                  <button type="button" onClick={() => insertDslSnippet("wait 7ms")}>+ 等待</button>
                  <button type="button" onClick={() => insertDslSnippet("loop 3\n  click target 7ms\n  sleep 20\nloop_end")}>+ 重复</button>
                  <button type="button" onClick={() => insertDslSnippet("loop until_release\n  click target 7ms\n  sleep 20\nloop_end")}>+ 按住循环</button>
                  <button type="button" onClick={() => insertDslSnippet("release_actions")}>+ 松键动作</button>
                  <button type="button" onClick={() => insertDslSnippet("drag target to target offset 0 -300 20ms")}>+ 拖动</button>
                  <button type="button" onClick={formatSelectedDsl} disabled={scriptAnalysis.diagnostics.length > 0}>格式化</button>
                </div>
                <div className="dsl-example-tabs">
                  <span>示例：</span>
                  <button type="button" onClick={() => patchSelected({ script: DSL_EXAMPLES.singleSequence })}>单次顺序</button>
                  <button type="button" onClick={() => patchSelected({ script: DSL_EXAMPLES.multiClick })}>多点循环</button>
                  <button type="button" onClick={() => patchSelected({ script: DSL_EXAMPLES.keyAndClick })}>选牌点击</button>
                  <button type="button" onClick={() => patchSelected({ script: DSL_EXAMPLES.drag })}>拖动循环</button>
                  <button type="button" onClick={() => patchSelected({ script: DSL_EXAMPLES.finiteRepeat })}>有限重复</button>
                </div>
                <div className="dsl-code-area">
                  <textarea
                    ref={scriptEditorRef}
                    className="macro-script-editor"
                    aria-label="Rust DSL 脚本内容"
                    aria-autocomplete="list"
                    aria-expanded={dslCompletionOpen && dslCompletions.length > 0}
                    value={selected.script || ""}
                    onChange={(event) => {
                      patchSelected({ script: event.target.value });
                      updateDslCaret(event.target, true);
                    }}
                    onClick={(event) => updateDslCaret(event.currentTarget)}
                    onKeyUp={(event) => {
                      if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) updateDslCaret(event.currentTarget);
                    }}
                    onKeyDown={handleDslEditorKeyDown}
                    onBlur={() => window.setTimeout(() => setDslCompletionOpen(false), 120)}
                    spellCheck={false}
                  />
                  {dslCompletionOpen && dslCompletions.length > 0 && <div className="dsl-completions" role="listbox" aria-label="DSL 代码补全">
                    {dslCompletions.map((completion, index) => <button
                      type="button"
                      role="option"
                      aria-selected={index === dslCompletionIndex}
                      className={index === dslCompletionIndex ? "active" : ""}
                      key={`${completion.label}-${completion.insertText}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => acceptDslCompletion(completion)}
                    ><code>{completion.label}</code><span>{completion.detail}</span></button>)}
                    <small>↑↓ 选择　Tab / Enter 补全　Esc 关闭　Ctrl+Space 唤出</small>
                  </div>}
                </div>
                <div className="dsl-summary">
                  <span>{scriptAnalysis.stats.commandCount} 条命令</span>
                  <span>{scriptAnalysis.stats.blockCount} 个模块</span>
                  <span>{scriptAnalysis.stats.loopUntilReleaseCount} 个按住循环</span>
                  <span>时间支持 us / ms / s</span>
                </div>
                {scriptAnalysis.diagnostics.length > 0 && <div className="dsl-diagnostics">{scriptAnalysis.diagnostics.slice(0, 8).map((problem, index) => <button type="button" key={`${problem.line}-${index}`} onClick={() => {
                  const editor = scriptEditorRef.current;
                  if (!editor) return;
                  const offset = (selected.script || "").split("\n").slice(0, problem.line - 1).reduce((total, line) => total + line.length + 1, 0);
                  editor.focus();
                  editor.setSelectionRange(offset, offset);
                }}><b>第 {problem.line} 行</b><span>{problem.message}</span></button>)}</div>}
                <details className="dsl-reference"><summary>语法速查</summary><div>{DSL_COMMAND_REFERENCE.map(([syntax, note]) => <p key={syntax}><code>{syntax}</code><span>{note}</span></p>)}</div></details>
                <p className="hint">没有 <code>loop</code> 时，按一次热键只完整执行一次。MuMu 坐标可写作 <code>1280,720</code>；<code>target</code> 为本宏 X/Y，<code>origin</code> 为触发瞬间的鼠标位置。脚本结束会兜底释放输入并返回原位。</p>
              </div>}
              {selected.type === "drag" && <label>循环间隔<input type="number" step="0.001" value={selected.loopGap ?? 0.05} onChange={(event) => patchSelected({ loopGap: Number(event.target.value) })} /></label>}
              {selected.type === "fastPlay" && <div className="fast-play-timing-grid"><label>选牌按下<input type="number" step="0.001" min="0.001" value={selected.cardHoldDuration ?? 0.007} onChange={(event) => patchSelected({ cardHoldDuration: Number(event.target.value) })} /></label><label>牌到点击<input type="number" step="0.001" min="0.001" value={selected.cardClickGap ?? 0.007} onChange={(event) => patchSelected({ cardClickGap: Number(event.target.value) })} /></label><label>点击按住<input type="number" step="0.001" min="0.001" value={selected.dragDuration ?? 0.007} onChange={(event) => patchSelected({ dragDuration: Number(event.target.value) })} /></label><label>循环间隔<input type="number" step="0.001" min="0.001" value={selected.loopGap ?? 0.007} onChange={(event) => patchSelected({ loopGap: Number(event.target.value) })} /></label></div>}
              {selected.type === "autoClick" && <label>连点间隔<input type="number" step="0.01" value={selected.clickGap} onChange={(event) => patchSelected({ clickGap: Number(event.target.value) })} /></label>}
              <div className="action-row"><button className="primary ghost" onClick={testSelected} disabled={errors.length > 0}><Play size={17} />测试</button><button className="danger ghost" onClick={removeSelected}><Trash2 size={17} />删除</button></div>
              {captureText && <p className="hint">{captureText}</p>}
            </div> : <div className="empty">还没有指令</div>}
          </section>

          <section className="glass-card list-card">
            <div className="section-title"><h2>指令列表</h2><span>{config.actions.length} 条</span></div>
            <div className="macro-list">{config.actions.map((action) => { const Icon = macroIconFor(action.type); return <button key={action.id} className={action.id === selectedId ? "macro-row selected" : "macro-row"} onClick={() => setSelectedId(action.id)}><span className="macro-icon"><Icon size={20} /></span><span><strong>{action.name}</strong><small>{macroLabelFor(action.type)} · {action.enabled ? "启用" : "停用"}</small></span><kbd>{hotkeyLabel(action.hotkey)}</kbd><span className="macro-meta">{action.type === "autoClick" ? `${action.targetX}, ${action.targetY} / ${action.clickGap}s` : `${action.targetX}, ${action.targetY}`}</span><ChevronRight size={16} /></button>; })}</div>
            <div id="section-presets" className="preset-library">
              <h3>全局宏预设库</h3>
              {presetLibrary.length === 0 ? <p>还没有保存的预设</p> : presetLibrary.map((preset) => (
                <div className="preset-item" key={preset.id}>
                  <button className="preset-load" onClick={() => loadPreset(preset)}><Archive size={16} /><span>{preset.name}</span><small>{preset.baseResolution.width}×{preset.baseResolution.height} · {preset.actions.length} 条</small></button>
                  <button className="preset-delete" onClick={() => deletePreset(preset.id)} title="删除这个预设"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            {errors.length > 0 && <div className="error-box">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
            <div className="log-box">
              <div className="log-heading"><h3>状态记录</h3><div><button className="log-tool" onClick={() => void api.openLogDir().then((result) => pushLog(result.message))}><FolderOpen size={15} />打开诊断日志</button><button className="log-tool" onClick={() => setLogs([])}>清空</button></div></div>
              {logs.length === 0 ? <p>等待操作</p> : logs.map((log, index) => <p key={`${log}-${index}`}>{log}</p>)}
            </div>
          </section>
        </section>


        {activeSection === "timeline" && <TimelinePlanner api={api} pushLog={pushLog} />}
        {activeSection === "ahk" && <AhkConsole api={api} pushLog={pushLog} />}
      </section>

      {manualOpen && <ProjectManual onClose={() => setManualOpen(false)} />}

      {onboardingOpen && (
        <div className="modal-backdrop startup-backdrop">
          <article className="startup-modal">
            <p className="eyebrow">Startup Check</p>
            <h2>启动前确认</h2>
            <div className="startup-copy">
              <p>BAMT Next 是给总力战手操准备的宏控制台。它负责保存热键、点位、拖动距离和多套预设；真正开始前，你只需要先把当前游戏窗口分辨率确认对。</p>
              <p>默认会生成 Q / W / E 三个基础技能拖动宏，对应战斗界面底部从左到右的 1 / 2 / 3 号手牌。这个位置是按截图比例估算出来的，能当起点，但第一次使用请自己校准一遍。</p>
              <p>普通点位宏支持跨分辨率导入导出；别人的预设会按你的当前分辨率换算。Q / W / E 三个基础手牌不跟普通点位混算，它们有单独的手牌位置算法。</p>
              <p>键盘接管模式默认关闭。开启后监听期间会尽量拦截常用键盘输入，只放行宏键和固定强制停止键 X。拿不准的时候，先保持关闭。</p>
            </div>
            <div className="resolution-grid startup-resolutions">{PRESET_RESOLUTIONS.map((preset) => <button key={preset.label} className={preset.width === config.resolution.width && preset.height === config.resolution.height ? "choice active" : "choice"} onClick={() => applyResolutionAndSkillSlots({ width: preset.width, height: preset.height })}>{preset.label}</button>)}</div>
            <section className="startup-performance">
              <div className="startup-performance-heading"><div><h3>最速出牌时序</h3><p>根据运行环境推荐四阶段间隔，避免多个输入挤在同一次游戏更新中。</p></div><label className="startup-auto-toggle"><input type="checkbox" checked={config.autoTuneFastPlayTiming} onChange={(event) => patchConfig({ autoTuneFastPlayTiming: event.target.checked })} />自动应用</label></div>
              <div className="startup-setting-grid">
                <label>屏幕刷新率 Hz<input type="number" min="30" max="1000" value={config.displayRefreshRate} onChange={(event) => patchConfig({ displayRefreshRate: Number(event.target.value) })} /></label>
                <div className="startup-option-group"><span>游戏帧率</span><div>{[30, 60].map((fps) => <button key={fps} type="button" className={config.gameFrameRate === fps ? "choice active" : "choice"} onClick={() => patchConfig({ gameFrameRate: fps })}>{fps}FPS</button>)}</div></div>
                <div className="startup-option-group"><span>垂直同步</span><div><button type="button" className={config.verticalSyncEnabled ? "choice active" : "choice"} onClick={() => patchConfig({ verticalSyncEnabled: true })}>开启</button><button type="button" className={!config.verticalSyncEnabled ? "choice active" : "choice"} onClick={() => patchConfig({ verticalSyncEnabled: false })}>关闭</button></div></div>
              </div>
              <div className="startup-refresh-presets"><span>刷新率预设</span><div>{[60, 90, 120, 144, 160, 240, 300].map((rate) => <button key={rate} type="button" className={config.displayRefreshRate === rate ? "choice active" : "choice"} onClick={() => patchConfig({ displayRefreshRate: rate })}>{rate}</button>)}</div></div>
              <div className="timing-recommendation"><div><span>计算基准</span><strong>{fastPlayTiming.effectiveRate} Hz · {fastPlayTiming.frameMs.toFixed(2)}ms/帧</strong></div><div><span>推荐四阶段</span><strong>{fastPlayTiming.stageMs} / {fastPlayTiming.stageMs} / {fastPlayTiming.stageMs} / {fastPlayTiming.stageMs} ms</strong></div><button type="button" className="capture" onClick={applyRecommendedFastPlayTiming}>立即应用</button></div>
            </section>
            <div className="startup-summary">{calculateSkillSlots(config.resolution, config).map((slot, index) => <span key={index}>{["Q", "W", "E"][index]}: {slot.x}, {slot.y}</span>)}</div>
            <div className="startup-checklist">
              <span>1. 选对分辨率</span>
              <span>2. 进入后校准 Q/W/E</span>
              <span>3. 保存成自己的预设</span>
            </div>
            <p className="startup-warning">固定紧急停止键：<strong>X</strong>。这个按键不可修改，也不会被键盘接管模式屏蔽。</p>
            <button className="primary" onClick={() => void confirmStartup()}>确认并进入</button>
          </article>
        </div>
      )}

      {converterOpen && (
        <div className="modal-backdrop" onClick={() => setConverterOpen(false)}>
          <article className="converter-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setConverterOpen(false)}>×</button>
            <p className="eyebrow">Point Converter</p>
            <h2>点位转换器</h2>
            <p>默认使用中轴独立缩放：以屏幕中心为原点，X/Y 分别按目标分辨率比例换算。</p>
            <div className="converter-grid">
              <label>来源宽度<input type="number" value={converter.fromW} onChange={(event) => setConverter({ ...converter, fromW: Number(event.target.value) })} /></label>
              <label>来源高度<input type="number" value={converter.fromH} onChange={(event) => setConverter({ ...converter, fromH: Number(event.target.value) })} /></label>
              <label>目标宽度<input type="number" value={converter.toW} onChange={(event) => setConverter({ ...converter, toW: Number(event.target.value) })} /></label>
              <label>目标高度<input type="number" value={converter.toH} onChange={(event) => setConverter({ ...converter, toH: Number(event.target.value) })} /></label>
              <label>来源 X<input type="number" value={converter.x} onChange={(event) => setConverter({ ...converter, x: Number(event.target.value) })} /></label>
              <label>来源 Y<input type="number" value={converter.y} onChange={(event) => setConverter({ ...converter, y: Number(event.target.value) })} /></label>
              <label>转换模式<select value={converter.mode} onChange={(event) => setConverter({ ...converter, mode: event.target.value as CoordinateTransformMode })}><option value="centerAxisScale">中轴独立缩放</option><option value="topLeftScale">左上角比例缩放</option><option value="containFit">等比适配留边</option></select></label>
              <div className="converter-result"><span>目标 X</span><strong>{converterResult.x}</strong><span>目标 Y</span><strong>{converterResult.y}</strong></div>
            </div>
          </article>
        </div>
      )}

      {letterOpen && <div className="modal-backdrop" onClick={() => setLetterOpen(false)}><article className="letter-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setLetterOpen(false)}>×</button><p className="eyebrow">Letter</p><h2>给老师的一封信</h2><p>宏预设包会记录基准分辨率，导入时自动适配当前屏幕。第一次使用别人的点位仍建议捕获校准一次。</p></article></div>}
    </main>
  );
}




