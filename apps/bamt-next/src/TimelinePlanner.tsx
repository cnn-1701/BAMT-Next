import { Download, Eye, FileDown, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MacroApi } from "./types";

type TriggerType = "time" | "cost" | "chain";
type PlayMode = "normal" | "lock" | "copy";

interface TimelineEntry {
  id: string;
  triggerType: TriggerType;
  triggerValue: string;
  card: string;
  target: string;
  note: string;
  kind?: "play" | "transition" | "retreat" | "death";
  cardIndex?: number;
  playMode?: PlayMode;
  copyTargetIndex?: number;
}

interface PhaseState {
  id: string;
  title: string;
  students: string[];
  training: string;
  refs: string;
  selectedCards: number[];
  deckOrder: number[];
  copiedCards: Record<number, string>;
  entries: TimelineEntry[];
  defaultTrigger: TriggerType;
  defaultTriggerValue: string;
  defaultTarget: string;
  defaultNote: string;
  playMode: PlayMode;
  copyTargetIndex: number;
  sendTargetIndex: number;
}

const triggerLabels: Record<TriggerType, string> = { time: "时间", cost: "费用", chain: "衔接" };
const playModeLabels: Record<PlayMode, string> = { normal: "普通沉底", lock: "锁牌留位", copy: "复制留位" };
const emptyStudents = ["", "", "", "", "", ""];
const defaultStudents = ["角色1", "角色2", "角色3", "角色4", "角色5", "角色6"];

function uid(prefix: string) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function safeFileName(value: string) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
  return cleaned || "总力战轴";
}

function cardFromIndex(phase: PhaseState, index: number) {
  return phase.students[index]?.trim() || "角色" + (index + 1);
}

function activeIndexes(phase: Pick<PhaseState, "students">) {
  return phase.students.map((name, index) => ({ name: name.trim(), index })).filter((item) => item.name).map((item) => item.index);
}

function makeTrainingTemplate(phase: Pick<PhaseState, "students">) {
  const names = activeIndexes(phase).map((index) => phase.students[index].trim());
  const rows = names.map((name) => name + "\t 3x   5MMM   101010   ❤20").join("\n");
  return ["参考练度：", rows].filter(Boolean).join("\n");
}

function createPhase(title: string, students = emptyStudents): PhaseState {
  const phaseBase = { students: [...students, ...emptyStudents].slice(0, 6) };
  return {
    id: uid("phase"),
    title,
    students: phaseBase.students,
    training: makeTrainingTemplate(phaseBase),
    refs: "视频参考：",
    selectedCards: [],
    deckOrder: [],
    copiedCards: {},
    entries: [],
    defaultTrigger: "cost",
    defaultTriggerValue: "",
    defaultTarget: "",
    defaultNote: "",
    playMode: "normal",
    copyTargetIndex: 0,
    sendTargetIndex: 0
  };
}

function normalizePhase(raw: Partial<PhaseState>, index: number): PhaseState {
  const students = Array.isArray(raw.students) ? [...raw.students, ...emptyStudents].slice(0, 6).map((name) => String(name || "")) : [...emptyStudents];
  const phase = createPhase(String(raw.title || "P" + (index + 1)), students);
  return {
    ...phase,
    id: String(raw.id || phase.id),
    training: typeof raw.training === "string" ? raw.training : makeTrainingTemplate({ students }),
    refs: typeof raw.refs === "string" ? raw.refs : "视频参考：",
    selectedCards: Array.isArray(raw.selectedCards) ? raw.selectedCards.filter((item) => Number.isInteger(item)) : [],
    deckOrder: Array.isArray(raw.deckOrder) ? raw.deckOrder.filter((item) => Number.isInteger(item)) : [],
    copiedCards: raw.copiedCards && typeof raw.copiedCards === "object" ? raw.copiedCards as Record<number, string> : {},
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    defaultTrigger: raw.defaultTrigger === "time" || raw.defaultTrigger === "chain" || raw.defaultTrigger === "cost" ? raw.defaultTrigger : "cost",
    defaultTriggerValue: String(raw.defaultTriggerValue || ""),
    defaultTarget: String(raw.defaultTarget || ""),
    defaultNote: String(raw.defaultNote || ""),
    playMode: raw.playMode === "lock" || raw.playMode === "copy" || raw.playMode === "normal" ? raw.playMode : "normal",
    copyTargetIndex: Number.isInteger(raw.copyTargetIndex) ? raw.copyTargetIndex! : 0,
    sendTargetIndex: Number.isInteger(raw.sendTargetIndex) ? raw.sendTargetIndex! : 0
  };
}

function initialOrderFromSelection(phase: PhaseState) {
  const roster = activeIndexes(phase);
  const used = new Set(phase.selectedCards);
  return [...phase.selectedCards, ...roster.filter((index) => !used.has(index))];
}


function baseDeckOrder(phase: PhaseState) {
  const roster = activeIndexes(phase);
  if (phase.selectedCards.length > 0) {
    const selected = phase.selectedCards.filter((index) => roster.includes(index));
    const used = new Set(selected);
    return [...selected, ...roster.filter((index) => !used.has(index))];
  }
  if (phase.deckOrder.length > 0) {
    const order = phase.deckOrder.filter((index) => roster.includes(index));
    const used = new Set(order);
    return [...order, ...roster.filter((index) => !used.has(index))];
  }
  return [];
}

function cleanCopiedName(name: string) {
  return name.replace(/（复制）$/, "").trim();
}

function entryStudentIndex(phase: PhaseState, entry: TimelineEntry, deckOrder?: number[]) {
  if (Number.isInteger(entry.cardIndex) && entry.cardIndex! >= 0 && entry.cardIndex! < phase.students.length) return entry.cardIndex!;
  const numericTarget = Number(entry.target);
  if (entry.kind === "death" && Number.isInteger(numericTarget) && numericTarget >= 0 && numericTarget < phase.students.length) return numericTarget;
  const cardName = cleanCopiedName(entry.card || "");
  const searchOrder = deckOrder && deckOrder.length > 0 ? deckOrder : activeIndexes(phase);
  return searchOrder.find((index) => cardFromIndex(phase, index) === cardName) ?? activeIndexes(phase).find((index) => cardFromIndex(phase, index) === cardName) ?? -1;
}

function timelineDeckState(phase: PhaseState) {
  const deckOrder = baseDeckOrder(phase);
  const copiedCards: Record<number, string> = {};

  for (const entry of phase.entries) {
    if (entry.kind === "transition" || entry.kind === "retreat") continue;

    if (entry.kind === "death") {
      const deadIndex = entryStudentIndex(phase, entry, deckOrder);
      if (deadIndex >= 0) {
        const position = deckOrder.indexOf(deadIndex);
        if (position >= 0) deckOrder.splice(position, 1);
        delete copiedCards[deadIndex];
      }
      continue;
    }

    const cardIndex = entryStudentIndex(phase, entry, deckOrder.slice(0, 3));
    if (cardIndex < 0) continue;
    const mode = entry.playMode || "normal";

    if (mode === "copy") {
      const copiedName = Number.isInteger(entry.copyTargetIndex)
        ? cardFromIndex(phase, entry.copyTargetIndex!)
        : cleanCopiedName(entry.card);
      if (copiedName && copiedName !== cardFromIndex(phase, cardIndex)) copiedCards[cardIndex] = copiedName;
      continue;
    }

    if (mode === "lock") continue;

    const position = deckOrder.indexOf(cardIndex);
    if (position >= 0) {
      deckOrder.splice(position, 1);
      deckOrder.push(cardIndex);
    }
    delete copiedCards[cardIndex];
  }

  return { deckOrder, copiedCards };
}

function phaseLine(phase: PhaseState) {
  const names = activeIndexes(phase).map((index) => cardFromIndex(phase, index));
  return phase.title + "：" + names.join("   ");
}

function orderLine(phase: PhaseState) {
  const names = phase.selectedCards.map((index) => cardFromIndex(phase, index)).join(" ");
  return "牌序：\t" + (names || "未锁定");
}

function formatCardPart(entry: TimelineEntry) {
  const target = entry.target.trim() ? "（" + entry.target.trim() + "）" : "";
  const note = entry.note.trim() ? "（" + entry.note.trim() + "）" : "";
  return (entry.card + target + note).trim();
}

function formatEntry(entry: TimelineEntry) {
  if (entry.kind === "transition") return "---转场";
  if (entry.kind === "retreat") return "---撤退";
  if (entry.kind === "death") return "---送人：" + entry.card;
  const trigger = entry.triggerValue.trim() || (entry.triggerType === "chain" ? "" : "最速");
  return trigger ? trigger + "\t" + formatCardPart(entry) : formatCardPart(entry);
}

function isSpecialEntry(entry: TimelineEntry) {
  return Boolean(entry.kind && entry.kind !== "play");
}

function formatEntryGroup(rows: TimelineEntry[]) {
  const lines: string[] = [];
  let canChainToLast = false;

  for (const row of rows) {
    if (isSpecialEntry(row)) {
      lines.push(formatEntry(row));
      canChainToLast = false;
      continue;
    }

    if (row.triggerType === "chain" && lines.length > 0 && canChainToLast) {
      lines[lines.length - 1] = lines[lines.length - 1] + " + " + formatCardPart(row);
    } else {
      lines.push(formatEntry(row));
    }

    canChainToLast = true;
  }

  return lines.join("\n");
}

function stripSectionHeading(text: string, heading: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index) => !(index === 0 && line.trim() === heading))
    .filter((line) => line.trim());
}

function formatTrainingSummary(phases: PhaseState[]) {
  const blocks = phases
    .map((phase) => {
      const rows = stripSectionHeading(phase.training, "参考练度：");
      return rows.length > 0 ? [phase.title + "：", ...rows].join("\n") : "";
    })
    .filter(Boolean);
  return ["参考练度：", ...blocks].join("\n");
}

function formatRefsSummary(phases: PhaseState[]) {
  const blocks = phases
    .map((phase) => {
      const rows = stripSectionHeading(phase.refs, "视频参考：");
      return rows.length > 0 ? [phase.title + "：", ...rows].join("\n") : "";
    })
    .filter(Boolean);
  return blocks.length > 0 ? ["视频参考：", ...blocks].join("\n") : "视频参考：";
}

function formatOrderSummary(phases: PhaseState[]) {
  const rows = phases
    .map((phase) => {
      const names = phase.selectedCards.map((index) => cardFromIndex(phase, index)).join(" ");
      return names ? phase.title + "\t" + names : "";
    })
    .filter(Boolean);
  return rows.length > 0 ? ["牌序：", ...rows].join("\n") : "";
}

function formatPhaseBody(phase: PhaseState) {
  return phase.title + "\n" + (phase.entries.length > 0 ? formatEntryGroup(phase.entries) : "暂无轴记录");
}

function formatTimelineText(title: string, phases: PhaseState[]) {
  const teamBlock = phases.map(phaseLine).join("\n");
  const orderBlock = formatOrderSummary(phases);
  const trainingBlock = formatTrainingSummary(phases);
  const refsBlock = formatRefsSummary(phases);
  const bodyBlock = phases.map(formatPhaseBody).join("\n\n");
  return [title, "", teamBlock, orderBlock, "", trainingBlock, "", refsBlock, "", bodyBlock, ""].filter((part) => part !== "").join("\n");
}

function download(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TimelinePlanner({ api, pushLog }: { api: MacroApi; pushLog: (message: string) => void }) {
  const [title, setTitle] = useState("总力战轴");
  const [timelineFileName, setTimelineFileName] = useState("总力战轴");
  const [phases, setPhases] = useState<PhaseState[]>([createPhase("P1", defaultStudents)]);
  const [activePhaseIndex, setActivePhaseIndex] = useState(0);
  const [saveState, setSaveState] = useState("等待自动保存");
  const autoSaveReady = useRef(false);

  const activePhase = phases[activePhaseIndex] ?? phases[0];
  const roster = activeIndexes(activePhase);
  const requiredSelectionCount = Math.min(5, roster.length);
  const previewOrder = initialOrderFromSelection(activePhase);
  const currentDeckState = timelineDeckState(activePhase);
  const effectiveDeckOrder = currentDeckState.deckOrder;
  const playable = effectiveDeckOrder.slice(0, 3);
  const waiting = effectiveDeckOrder.slice(3);
  const filenameBase = safeFileName(timelineFileName || title);
  const selectedOrderLine = activePhase.selectedCards.map((index) => cardFromIndex(activePhase, index)).join(" ");

  const timelineText = useMemo(() => formatTimelineText(title, phases), [phases, title]);
  const timelinePayload = useMemo(() => ({ schema: "bamt.timeline.v1", title, fileName: timelineFileName, phases, activePhaseIndex, updatedAt: new Date().toISOString() }), [activePhaseIndex, phases, timelineFileName, title]);

  useEffect(() => {
    if (!autoSaveReady.current) {
      autoSaveReady.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void api.saveTimelineFile(safeFileName(timelineFileName || title) + ".json", timelinePayload)
        .then((result) => setSaveState(result.message))
        .catch((error) => setSaveState("自动保存失败：" + String(error instanceof Error ? error.message : error)));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [api, timelineFileName, timelinePayload, title]);

  function patchPhase(index: number, patch: Partial<PhaseState>) {
    setPhases((current) => current.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase));
  }

  function updateActivePhase(updater: (phase: PhaseState) => PhaseState) {
    setPhases((current) => current.map((phase, index) => index === activePhaseIndex ? updater(phase) : phase));
  }

  function displayCardName(index: number) {
    const copied = currentDeckState.copiedCards[index];
    return copied ? copied + "（复制）" : cardFromIndex(activePhase, index);
  }

  function resetDraftFields(phase: PhaseState): PhaseState {
    return { ...phase, defaultTriggerValue: "", defaultTarget: "", defaultNote: "" };
  }

  function createNewTimeline() {
    const baseName = safeFileName(timelineFileName || title || "总力战轴");
    const nextName = baseName + "-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const nextPhase = createPhase("P1", defaultStudents);
    setTitle(nextName);
    setTimelineFileName(nextName);
    setPhases([nextPhase]);
    setActivePhaseIndex(0);
    autoSaveReady.current = true;
    void api.saveTimelineFile(nextName + ".json", { schema: "bamt.timeline.v1", title: nextName, fileName: nextName, phases: [nextPhase], activePhaseIndex: 0, updatedAt: new Date().toISOString() })
      .then((result) => setSaveState(result.message))
      .catch((error) => setSaveState("新建失败：" + String(error instanceof Error ? error.message : error)));
    pushLog("已新建排轴文件：" + nextName + ".json");
  }

  async function openTimelineFile() {
    const file = await api.pickTimelineFile();
    if (!file) return;
    const data = JSON.parse(file.text);
    const importedPhases = Array.isArray(data.phases) && data.phases.length > 0
      ? data.phases.map((phase: Partial<PhaseState>, index: number) => normalizePhase(phase, index))
      : [createPhase("P1", defaultStudents)];
    setTitle(String(data.title || file.name.replace(/\.json$/i, "") || "总力战轴"));
    setTimelineFileName(String(data.fileName || file.name.replace(/\.json$/i, "") || data.title || "总力战轴"));
    setPhases(importedPhases);
    setActivePhaseIndex(Math.max(0, Math.min(Number(data.activePhaseIndex || 0), importedPhases.length - 1)));
    pushLog("已打开排轴文件：" + file.name);
  }

  function switchPhase(index: number) {
    setActivePhaseIndex(index);
  }

  function addPhase() {
    const nextTitle = "P" + (phases.length + 1);
    setPhases((current) => [...current, createPhase(nextTitle)]);
    setActivePhaseIndex(phases.length);
    pushLog("已添加 " + nextTitle + "，它会拥有完全独立的队伍、牌序和轴记录");
  }

  function addRetreatPhase() {
    updateActivePhase((phase) => ({
      ...phase,
      entries: [...phase.entries, { id: uid("retreat"), triggerType: "chain", triggerValue: "", card: "", target: "", note: "", kind: "retreat" }]
    }));
    addPhase();
  }

  function removePhase(index: number) {
    if (phases.length <= 1) return;
    const removed = phases[index];
    setPhases((current) => current.filter((_, phaseIndex) => phaseIndex !== index));
    setActivePhaseIndex((current) => Math.max(0, Math.min(current >= index ? current - 1 : current, phases.length - 2)));
    pushLog("已删除 " + removed.title);
  }

  function patchStudent(studentIndex: number, name: string) {
    updateActivePhase((phase) => {
      const students = [...phase.students];
      students[studentIndex] = name;
      return { ...phase, students };
    });
  }

  function toggleSelectedCard(index: number) {
    if (activePhase.deckOrder.length > 0 || !roster.includes(index)) return;
    updateActivePhase((phase) => {
      const selectedCards = phase.selectedCards.includes(index)
        ? phase.selectedCards.filter((item) => item !== index)
        : phase.selectedCards.length >= requiredSelectionCount
          ? phase.selectedCards
          : [...phase.selectedCards, index];
      return { ...phase, selectedCards };
    });
  }

  function resetDeck(log = true) {
    updateActivePhase((phase) => ({
      ...phase,
      selectedCards: [],
      deckOrder: [],
      copiedCards: {},
      defaultTriggerValue: "",
      defaultTarget: "",
      defaultNote: "",
      playMode: "normal",
      copyTargetIndex: 0,
      sendTargetIndex: 0
    }));
    if (log) pushLog("已重置 " + activePhase.title + " 的牌序");
  }

  function startDeck() {
    if (roster.length === 0) {
      pushLog("请先填写当前 P 的出场学生");
      return;
    }
    if (activePhase.selectedCards.length !== requiredSelectionCount) {
      pushLog("请按顺序点选 " + requiredSelectionCount + " 张牌；前三张为初始牌，后两张为固定顺序牌");
      return;
    }
    updateActivePhase((phase) => ({ ...phase, deckOrder: baseDeckOrder(phase), copiedCards: {} }));
    pushLog("已锁定 " + activePhase.title + " 的牌序");
  }

  function playCard(cardIndex: number) {
    const currentDeckOrder = timelineDeckState(activePhase).deckOrder;
    const position = currentDeckOrder.indexOf(cardIndex);
    if (position < 0 || position > 2) return;
    if (activePhase.playMode === "copy" && activePhase.copyTargetIndex === cardIndex) {
      pushLog("复制牌不能复制自己，请选择其他学生");
      return;
    }

    updateActivePhase((phase) => {
      const state = timelineDeckState(phase);
      const copied = state.copiedCards[cardIndex];
      const copyTarget = cardFromIndex(phase, phase.copyTargetIndex);
      const cardName = phase.playMode === "copy" ? copyTarget + "（复制）" : copied ? copied + "（复制）" : cardFromIndex(phase, cardIndex);
      const entry: TimelineEntry = {
        id: uid("entry"),
        triggerType: phase.defaultTrigger,
        triggerValue: phase.defaultTrigger === "chain" ? "" : phase.defaultTriggerValue,
        card: cardName,
        target: phase.defaultTarget,
        note: phase.defaultNote,
        kind: "play",
        cardIndex,
        playMode: phase.playMode,
        copyTargetIndex: phase.playMode === "copy" ? phase.copyTargetIndex : undefined
      };
      return resetDraftFields({ ...phase, entries: [...phase.entries, entry] });
    });
  }

  function addTransition() {
    updateActivePhase((phase) => ({
      ...phase,
      entries: [...phase.entries, { id: uid("transition"), triggerType: "chain", triggerValue: "", card: "", target: "", note: "", kind: "transition" }]
    }));
  }

  function sendStudent(index: number) {
    if (!timelineDeckState(activePhase).deckOrder.includes(index)) {
      pushLog("这名学生不在当前时间点的牌池里");
      return;
    }
    updateActivePhase((phase) => {
      const state = timelineDeckState(phase);
      const name = state.copiedCards[index] ? state.copiedCards[index] + "（复制）" : cardFromIndex(phase, index);
      return {
        ...phase,
        entries: [...phase.entries, { id: uid("death"), triggerType: "chain", triggerValue: "", card: name, target: String(index), note: "", kind: "death", cardIndex: index }]
      };
    });
  }

  function patchEntry(id: string, patch: Partial<TimelineEntry>) {
    updateActivePhase((phase) => ({
      ...phase,
      entries: phase.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry)
    }));
  }

  function deleteEntry(id: string) {
    updateActivePhase((phase) => ({
      ...phase,
      entries: phase.entries.filter((entry) => entry.id !== id)
    }));
  }

  function generateTraining() {
    updateActivePhase((phase) => ({ ...phase, training: makeTrainingTemplate(phase) }));
    pushLog("已根据 " + activePhase.title + " 的队伍编成生成参考练度模板");
  }

  async function openPreviewWindow() {
    if (typeof api.openTimelinePreview === "function") {
      const result = await api.openTimelinePreview(timelineText);
      pushLog(result.message);
      return;
    }
    const preview = window.open("", "bamt-timeline-preview", "width=920,height=760");
    if (!preview) {
      pushLog("预览窗口被拦截");
      return;
    }
    preview.document.title = "排轴文本预览";
    preview.document.body.innerHTML = "<pre style=\"white-space:pre-wrap;font:16px/1.7 Consolas, Microsoft YaHei, monospace;padding:28px;background:#f5f9fc;color:#18324a;\"></pre>";
    preview.document.querySelector("pre")!.textContent = timelineText;
    pushLog("已打开预览窗口");
  }

  function exportTxt() {
    download(filenameBase + ".txt", timelineText, "text/plain");
    pushLog("已导出排轴 TXT");
  }

  function exportMd() {
    download(filenameBase + ".md", "\\x60\\x60\\x60text\n" + timelineText + "\\x60\\x60\\x60\n", "text/markdown");
    pushLog("已导出排轴 MD");
  }

  function exportJson() {
    download(filenameBase + ".json", JSON.stringify({ title, phases, activePhaseIndex }, null, 2), "application/json");
    pushLog("已导出排轴 JSON");
  }

  function importJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      const importedPhases = Array.isArray(data.phases) && data.phases.length > 0
        ? data.phases.map((phase: Partial<PhaseState>, index: number) => normalizePhase(phase, index))
        : Array.isArray(data.teams) && data.teams.length > 0
          ? data.teams.map((team: Partial<PhaseState>, index: number) => normalizePhase({ ...team, entries: index === 0 && Array.isArray(data.entries) ? data.entries : [] }, index))
          : [createPhase("P1", defaultStudents)];
      setTitle(String(data.title || "总力战轴"));
      setTimelineFileName(String(data.fileName || file.name.replace(/\.json$/i, "") || data.title || "总力战轴"));
      setPhases(importedPhases);
      setActivePhaseIndex(Math.max(0, Math.min(Number(data.activePhaseIndex || 0), importedPhases.length - 1)));
      pushLog("已导入排轴 JSON");
    };
    input.click();
  }

  return (
    <section id="section-timeline" className="timeline-v2 timeline-top-team phase-editor">
      <div className="glass-card timeline-team-panel phase-shell">
        <div className="section-title">
          <div>
            <p className="eyebrow">Raid Timeline</p>
            <h2>排轴编辑器</h2>
          </div>
          <div className="action-row">
            <button className="capture" onClick={createNewTimeline}>新建轴</button>
            <button className="capture" onClick={openTimelineFile}><FileDown size={17} />打开轴</button>
            <button className="capture" onClick={importJson}><FileDown size={17} />导入 JSON</button>
            <button className="primary ghost" onClick={exportTxt}><Download size={17} />导出 TXT</button>
            <button className="primary ghost" onClick={exportMd}><Download size={17} />导出 MD</button>
            <button className="primary ghost" onClick={exportJson}><Download size={17} />导出 JSON</button>
          </div>
        </div>

        <div className="timeline-team-grid phase-top-grid">
          <label>文件名<input value={timelineFileName} onChange={(event) => setTimelineFileName(event.target.value)} /></label>
          <label>轴名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <p className="hint autosave-hint">{saveState}；保存目录：data/timelines</p>
          <label>当前 P 名称<input value={activePhase.title} onChange={(event) => patchPhase(activePhaseIndex, { title: event.target.value || "P" + (activePhaseIndex + 1) })} /></label>
          <div className="team-tabs phase-tabs">
            {phases.map((phase, index) => (
              <span className="team-tab-item" key={phase.id}>
                <button className={index === activePhaseIndex ? "active" : ""} onClick={() => switchPhase(index)}>{phase.title || "P" + (index + 1)}</button>
                {phases.length > 1 && <button className="team-delete" onClick={() => removePhase(index)} title="删除这一 P"><Trash2 size={14} /></button>}
              </span>
            ))}
            <button onClick={addPhase}>新增 P{phases.length + 1}</button>
            <button onClick={addRetreatPhase}>当前 P 撤退并新建</button>
          </div>
        </div>
      </div>

      <div className="timeline-workbench phase-workbench">
        <div className="glass-card timeline-write-panel phase-editor-panel">
          <section className="timeline-block phase-roster-block">
            <div className="section-title">
              <h3>{activePhase.title} 队伍配置</h3>
              <span>只影响当前 P</span>
            </div>
            <div className="student-grid timeline-student-grid">
              {activePhase.students.map((name, index) => (
                <label key={index}>角色 {index + 1}<input value={name} placeholder={"角色" + (index + 1)} onChange={(event) => patchStudent(index, event.target.value)} /></label>
              ))}
            </div>
            <button className="capture" onClick={generateTraining}>根据当前 P 队伍生成参考练度模板</button>
            <label>参考练度<textarea spellCheck={false} value={activePhase.training} onChange={(event) => patchPhase(activePhaseIndex, { training: event.target.value })} /></label>
            <label>点位/视频参考<textarea spellCheck={false} value={activePhase.refs} onChange={(event) => patchPhase(activePhaseIndex, { refs: event.target.value })} /></label>
          </section>

          <div className="phase-columns">
            <section className="timeline-block deck-lock-block">
              <h3>{activePhase.title} 牌序锁定</h3>
              <p className="hint">每个 P 的牌序完全独立。按 1-5 的顺序点选，前三张是初始牌，后两张是固定顺序牌；出场人数不足时按实际人数锁定。</p>
              <div className="card-pick-grid compact-pick-grid">
                {activePhase.students.map((name, index) => {
                  const rank = activePhase.selectedCards.indexOf(index);
                  const active = roster.includes(index);
                  return (
                    <button key={index} className={rank >= 0 ? "pick-card selected" : "pick-card"} disabled={!active || activePhase.deckOrder.length > 0} onClick={() => toggleSelectedCard(index)}>
                      <strong>{active ? cardFromIndex(activePhase, index) : "未出场"}</strong>
                      <span>{rank >= 0 ? (rank + 1 <= 3 ? "初始 " + (rank + 1) : "顺序 " + (rank + 1)) : active ? "点按加入牌序" : "填写角色名后可选"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="order-preview">
                <span>牌序：{selectedOrderLine || "未选择"}</span>
                {previewOrder.map((index, slot) => <strong key={slot} className={slot < 3 ? "in-hand" : slot < 5 ? "fixed-order" : ""}>{slot + 1}. {cardFromIndex(activePhase, index)}</strong>)}
              </div>
              <div className="action-row">
                <button className="primary ghost" onClick={startDeck}>锁定牌序</button>
                <button className="danger ghost" onClick={() => resetDeck()}><RotateCcw size={17} />重置当前 P 牌序</button>
              </div>
            </section>

            <section className="timeline-block next-card-block">
              <h3>{activePhase.title} 下一张牌</h3>
              <div className="trigger-mode">
                {(["time", "cost", "chain"] as TriggerType[]).map((type) => <button key={type} className={activePhase.defaultTrigger === type ? "active" : ""} onClick={() => patchPhase(activePhaseIndex, { defaultTrigger: type })}>{triggerLabels[type]}</button>)}
              </div>
              {activePhase.defaultTrigger !== "chain" && <label>{triggerLabels[activePhase.defaultTrigger]}内容<input value={activePhase.defaultTriggerValue} placeholder={activePhase.defaultTrigger === "time" ? "3:39.200" : "10c / 约9.5c"} onChange={(event) => patchPhase(activePhaseIndex, { defaultTriggerValue: event.target.value })} /></label>}
              <label>对象/点位<input value={activePhase.defaultTarget} placeholder="妹爱 / 沫花 / 点位1" onChange={(event) => patchPhase(activePhaseIndex, { defaultTarget: event.target.value })} /></label>
              <label>备注<input value={activePhase.defaultNote} placeholder="连射启动 / 挡球 / 最后方即可" onChange={(event) => patchPhase(activePhaseIndex, { defaultNote: event.target.value })} /></label>

              <div className="play-mode-toggle">
                <span>出牌后</span>
                {(["normal", "lock", "copy"] as PlayMode[]).map((mode) => <button key={mode} className={activePhase.playMode === mode ? "active" : ""} onClick={() => patchPhase(activePhaseIndex, { playMode: mode })}>{playModeLabels[mode]}</button>)}
              </div>
              {activePhase.playMode === "copy" && (
                <div className="copy-target-grid">
                  <span>复制目标</span>
                  {roster.map((index) => <button key={index} className={activePhase.copyTargetIndex === index ? "active" : ""} onClick={() => patchPhase(activePhaseIndex, { copyTargetIndex: index })}>{cardFromIndex(activePhase, index)}</button>)}
                </div>
              )}

              <div className="timeline-event-tools">
                <span>轴事件</span>
                <button onClick={addTransition}>转场</button>
                <button onClick={addRetreatPhase}>撤退并进入下一 P</button>
                <select value={effectiveDeckOrder.includes(activePhase.sendTargetIndex) ? activePhase.sendTargetIndex : effectiveDeckOrder[0] ?? 0} onChange={(event) => patchPhase(activePhaseIndex, { sendTargetIndex: Number(event.target.value) })}>
                  {effectiveDeckOrder.map((index) => <option key={index} value={index}>{displayCardName(index)}</option>)}
                </select>
                <button onClick={() => sendStudent(effectiveDeckOrder.includes(activePhase.sendTargetIndex) ? activePhase.sendTargetIndex : effectiveDeckOrder[0] ?? 0)} disabled={effectiveDeckOrder.length === 0}>送人</button>
              </div>

              <div className="release-card-list">
                <span>当前出牌区</span>
                {playable.length === 0 ? <p className="hint">锁定当前 P 牌序后，这里会列出可释放的 1/2/3 号牌</p> : playable.map((index, slot) => (
                  <button key={index} className={currentDeckState.copiedCards[index] ? "copied-card" : ""} disabled={activePhase.playMode === "copy" && activePhase.copyTargetIndex === index} onClick={() => playCard(index)}><small>{slot + 1}</small>{displayCardName(index)}</button>
                ))}
              </div>
              <div className="deck-board">
                <h3>待命区</h3>
                <div className="waiting-cards">{waiting.map((index, slot) => <span key={index} className={currentDeckState.copiedCards[index] ? "copied-card" : ""}>{slot + 4}. {displayCardName(index)}</span>)}</div>
              </div>
            </section>


            <div className="timeline-v2-preview timeline-inline-preview">
          <div className="section-title"><h2>文本预览</h2><div className="preview-title-actions"><span>{phases.reduce((sum, phase) => sum + phase.entries.length, 0)} 条动作</span><button className="capture" onClick={openPreviewWindow}><Eye size={17} />独立预览</button></div></div>
          <pre>{timelineText}</pre>
            </div>
          </div>

          <section className="timeline-block timeline-records">
            <div className="section-title"><h3>{activePhase.title} 已记录动作</h3><span>{activePhase.entries.length} 条</span></div>
            <div className="timeline-v2-head"><span>规则</span><span>释放条件</span><span>技能</span><span>对象/点位</span><span>备注</span><span /></div>
            {activePhase.entries.map((entry) => entry.kind && entry.kind !== "play" ? (
              <div className="timeline-v2-row event-row phase-event-row" key={entry.id}>
                <span>{entry.kind === "transition" ? "转场" : entry.kind === "retreat" ? "撤退" : "送人"}</span>
                <span className="event-line-preview">{formatEntry(entry)}</span>
                <button className="icon-button" onClick={() => deleteEntry(entry.id)}><Trash2 size={16} /></button>
              </div>
            ) : (
              <div className="timeline-v2-row phase-entry-row" key={entry.id}>
                <select value={entry.triggerType} onChange={(event) => patchEntry(entry.id, { triggerType: event.target.value as TriggerType })}><option value="time">时间</option><option value="cost">费用</option><option value="chain">衔接</option></select>
                <input value={entry.triggerValue} onChange={(event) => patchEntry(entry.id, { triggerValue: event.target.value })} />
                <input value={entry.card} onChange={(event) => patchEntry(entry.id, { card: event.target.value })} />
                <input value={entry.target} onChange={(event) => patchEntry(entry.id, { target: event.target.value })} />
                <input value={entry.note} onChange={(event) => patchEntry(entry.id, { note: event.target.value })} />
                <button className="icon-button" onClick={() => deleteEntry(entry.id)}><Trash2 size={16} /></button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}
