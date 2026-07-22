import type { MacroAction, MacroConfig, MacroType, Resolution } from "./types";

export const FIXED_EMERGENCY_EXIT_KEY = "x";
export type CoordinateTransformMode = "centerAxisScale" | "topLeftScale" | "containFit";

export interface MacroPreset {
  id: string;
  name: string;
  baseResolution: Resolution;
  transformMode: CoordinateTransformMode;
  actions: MacroAction[];
}

export interface MacroPresetPackage {
  schema: "bamt.macro-package.v1";
  name: string;
  exportedAt: string;
  presets: MacroPreset[];
}

export const MACRO_LABELS: Record<MacroType, string> = {
  point: "点位",
  drag: "拖动",
  autoClick: "连点",
  click: "点击",
  script: "脚本"
};

export const MACRO_DESCRIPTIONS: Record<MacroType, string> = {
  point: "按住热键时在目标点按下，松开后释放并返回原鼠标位置。",
  drag: "按住热键循环执行：从技能卡按下，竖直上拖预设距离，再回到触发前鼠标位置释放。",
  autoClick: "按住热键时连续点击目标坐标，松开后停止并返回原鼠标位置。",
  click: "留空选牌键时点击目标点一次；填写 1/2/3 后，按住热键会循环交替执行：选牌键、当前鼠标位置左键。",
  script: "按固定脚本语法执行一组鼠标动作，支持循环到松开热键。"
};

export const PRESET_RESOLUTIONS = [
  { label: "1920 x 1080", width: 1920, height: 1080 },
  { label: "2560 x 1440", width: 2560, height: 1440 },
  { label: "2500 x 1600", width: 2500, height: 1600 },
  { label: "3840 x 2160", width: 3840, height: 2160 }
];

export const DEFAULT_SCRIPT_MACRO = [
  "# BAMT 宏脚本示例，坐标使用当前屏幕绝对坐标",
  "# mouse 表示触发热键瞬间的鼠标位置",
  "loop until_release",
  "  drag 2688 1853 2688 1500 80",
  "  move mouse 45",
  "  sleep 50",
  "end"
].join("\n");

export const DEFAULT_SKILL_SLOT_X_OFFSETS = [0.200, 0.280, 0.362];
export const DEFAULT_SKILL_SLOT_BOTTOM_OFFSET_RATIO = 0.071;
export const DEFAULT_SMOOTH_MOVE_MIN_STEPS = 2;
export const DEFAULT_SMOOTH_MOVE_STEP_RATE = 80;

export const DEFAULT_MACRO_TUNING = {
  skillSlotXOffsets: DEFAULT_SKILL_SLOT_X_OFFSETS,
  skillSlotBottomOffsetRatio: DEFAULT_SKILL_SLOT_BOTTOM_OFFSET_RATIO,
  smoothMoveMinSteps: DEFAULT_SMOOTH_MOVE_MIN_STEPS,
  smoothMoveStepRate: DEFAULT_SMOOTH_MOVE_STEP_RATE
};

type MacroTuning = Partial<Pick<MacroConfig, "skillSlotXOffsets" | "skillSlotBottomOffsetRatio" | "smoothMoveMinSteps" | "smoothMoveStepRate">>;

export function normalizeSkillSlotXOffsets(offsets?: number[]) {
  const source = Array.isArray(offsets) && offsets.length >= 3 ? offsets : DEFAULT_SKILL_SLOT_X_OFFSETS;
  return DEFAULT_SKILL_SLOT_X_OFFSETS.map((fallback, index) => {
    const value = Number(source[index]);
    return Number.isFinite(value) ? Math.max(-0.45, Math.min(0.45, value)) : fallback;
  });
}

export function normalizeSkillSlotBottomOffsetRatio(value?: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0.03, Math.min(0.16, number)) : DEFAULT_SKILL_SLOT_BOTTOM_OFFSET_RATIO;
}

export function normalizeSmoothMoveMinSteps(value?: number) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(60, number)) : DEFAULT_SMOOTH_MOVE_MIN_STEPS;
}

export function normalizeSmoothMoveStepRate(value?: number) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(1, Math.min(600, number)) : DEFAULT_SMOOTH_MOVE_STEP_RATE;
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function clampPoint(point: { x: number; y: number }, resolution: Resolution) {
  return {
    x: Math.max(0, Math.min(resolution.width - 1, Math.round(point.x))),
    y: Math.max(0, Math.min(resolution.height - 1, Math.round(point.y)))
  };
}

export function transformPoint(
  point: { x: number; y: number },
  from: Resolution,
  to: Resolution,
  mode: CoordinateTransformMode = "centerAxisScale"
) {
  if (mode === "topLeftScale") {
    return clampPoint({ x: point.x * (to.width / from.width), y: point.y * (to.height / from.height) }, to);
  }

  if (mode === "containFit") {
    const sourceAspect = from.width / from.height;
    const targetAspect = to.width / to.height;
    const scale = targetAspect > sourceAspect ? to.height / from.height : to.width / from.width;
    const displayedWidth = from.width * scale;
    const displayedHeight = from.height * scale;
    const offsetX = (to.width - displayedWidth) / 2;
    const offsetY = (to.height - displayedHeight) / 2;
    return clampPoint({ x: offsetX + point.x * scale, y: offsetY + point.y * scale }, to);
  }

  return clampPoint(
    {
      x: to.width / 2 + (point.x - from.width / 2) * (to.width / from.width),
      y: to.height / 2 + (point.y - from.height / 2) * (to.height / from.height)
    },
    to
  );
}

export function transformUiPoint(point: { x: number; y: number }, from: Resolution, to: Resolution) {
  const scale = to.width / from.width;
  return clampPoint({
    x: point.x * scale,
    y: to.height - (from.height - point.y) * scale
  }, to);
}

export function transformAction(action: MacroAction, from: Resolution, to: Resolution, mode: CoordinateTransformMode) {
  const point = action.type === "drag"
    ? transformUiPoint({ x: action.targetX, y: action.targetY }, from, to)
    : transformPoint({ x: action.targetX, y: action.targetY }, from, to, mode);
  return {
    ...action,
    id: uid(action.id || "imported"),
    targetX: point.x,
    targetY: point.y,
    dragDistance: action.type === "drag"
      ? Math.max(1, Math.round(action.dragDistance * (to.width / from.width)))
      : Math.max(1, Math.round(action.dragDistance * (to.height / from.height)))
  };
}

export function isSkillDragAction(action: MacroAction) {
  return skillSlotIndex(action) >= 0;
}

function skillSlotIndex(action: MacroAction) {
  const idMatch = /^skill-drag-(\d+)$/.exec(action.id);
  if (idMatch) return Number(idMatch[1]) - 1;
const nameMatch = /(?:\u6280\u80fd\u62d6\u52a8|\u624b\u724c|\u6280\u80fd\u724c)\s*(\d+)/.exec(action.name);
  if (nameMatch) return Number(nameMatch[1]) - 1;
  return -1;
}

export function transformActionsToResolution(actions: MacroAction[], from: Resolution, to: Resolution, mode: CoordinateTransformMode = "centerAxisScale", tuning?: MacroTuning) {
  const targetSkillSlots = createSkillDragActions(to, tuning);
  return actions.map((action) => {
    const index = skillSlotIndex(action);
    if (index >= 0 && index < targetSkillSlots.length) {
      const slot = targetSkillSlots[index];
      return {
        ...action,
        id: action.id || slot.id,
        name: action.name || slot.name,
        type: "drag" as const,
        cardKey: "",
        targetX: slot.targetX,
        targetY: slot.targetY,
        dragDistance: slot.dragDistance,
        dragDuration: normalizeDragDuration(action) || slot.dragDuration,
        loopGap: normalizeLoopGap({ ...action, loopGap: action.loopGap || slot.loopGap }),
        hotkey: action.hotkey || slot.hotkey,
        enabled: action.enabled,
        script: action.script
      };
    }
    return transformAction(action, from, to, mode);
  });
}

export function transformPresetToResolution(preset: MacroPreset, resolution: Resolution, tuning?: MacroTuning) {
  const targetSkillSlots = createSkillDragActions(resolution, tuning);
  return preset.actions.map((action) => {
    const index = skillSlotIndex(action);
    if (index >= 0 && index < targetSkillSlots.length) {
      const slot = targetSkillSlots[index];
      return {
        ...action,
        id: action.id || slot.id,
        name: action.name || slot.name,
        type: "drag" as const,
        cardKey: "",
        targetX: slot.targetX,
        targetY: slot.targetY,
        dragDistance: slot.dragDistance,
        dragDuration: normalizeDragDuration(action) || slot.dragDuration,
        loopGap: normalizeLoopGap({ ...action, loopGap: action.loopGap || slot.loopGap }),
        hotkey: action.hotkey || slot.hotkey,
        enabled: action.enabled,
        script: action.script
      };
    }
    return transformAction(action, preset.baseResolution, resolution, preset.transformMode);
  });
}

export function createMacroPackage(name: string, presets: MacroPreset[]): MacroPresetPackage {
  return {
    schema: "bamt.macro-package.v1",
    name,
    exportedAt: new Date().toISOString(),
    presets
  };
}

export function normalizeMacroPackage(raw: unknown): MacroPresetPackage {
  const data = raw as Partial<MacroPresetPackage>;
  if (!data || data.schema !== "bamt.macro-package.v1" || !Array.isArray(data.presets)) {
    throw new Error("不是有效的 BAMT 宏预设包");
  }
  return {
    schema: "bamt.macro-package.v1",
    name: String(data.name || "BAMT 宏预设包"),
    exportedAt: String(data.exportedAt || ""),
    presets: data.presets.map((preset, index) => ({
      id: String(preset.id || uid(`preset-${index + 1}`)),
      name: String(preset.name || `预设 ${index + 1}`),
      baseResolution: {
        width: Number(preset.baseResolution?.width || 2560),
        height: Number(preset.baseResolution?.height || 1600)
      },
      transformMode: preset.transformMode || "centerAxisScale",
      actions: Array.isArray(preset.actions) ? preset.actions : []
    }))
  };
}

export function calculateSkillSlots(resolution: Resolution, tuning?: MacroTuning) {
  const xOffsets = normalizeSkillSlotXOffsets(tuning?.skillSlotXOffsets);
  const bottomOffsetRatio = normalizeSkillSlotBottomOffsetRatio(tuning?.skillSlotBottomOffsetRatio);
  const y = Math.round(resolution.height - resolution.width * bottomOffsetRatio);
  return xOffsets.map((offset) => ({
    x: Math.round(resolution.width * (0.5 + offset)),
    y
  }));
}

function normalizeDragDuration(action: MacroAction) {
  if (action.type === "drag" && action.dragDuration >= 0.079) return 0.02;
  return action.dragDuration;
}

function normalizeLoopGap(action: MacroAction) {
  const value = Number(action.loopGap);
  if (action.type === "drag") return Number.isFinite(value) ? Math.max(0.05, value) : 0.05;
  return Number.isFinite(value) ? Math.max(0.001, value) : 0.005;
}

export function createAction(seed = Date.now()): MacroAction {
  return {
    id: `macro-${seed}`,
    name: "指令",
    hotkey: "q",
    type: "point",
    cardKey: "",
    targetX: 1280,
    targetY: 800,
    dragDistance: 300,
    dragDuration: 0.02,
    clickGap: 0.1,
    cardClickGap: 0.005,
    loopGap: 0.05,
    enabled: true,
    script: DEFAULT_SCRIPT_MACRO
  };
}

export function createSkillDragActions(resolution: Resolution, tuning?: MacroTuning): MacroAction[] {
  const slots = calculateSkillSlots(resolution, tuning);
  const keys = ["q", "w", "e"];
  return slots.map((slot, index) => ({
    id: `skill-drag-${index + 1}`,
    name: `技能拖动 ${index + 1}`,
    hotkey: keys[index],
    type: "drag",
    cardKey: "",
    targetX: slot.x,
    targetY: slot.y,
    dragDistance: 300,
    dragDuration: 0.02,
    clickGap: 0.1,
    cardClickGap: 0.005,
    loopGap: 0.05,
    enabled: true,
    script: DEFAULT_SCRIPT_MACRO
  }));
}

export const DEFAULT_CONFIG: MacroConfig = {
  version: "2.5",
  resolution: { width: 2560, height: 1600 },
  exitKey: FIXED_EMERGENCY_EXIT_KEY,
  inputTakeoverEnabled: false,
  inputBackend: "cursor",
  ...DEFAULT_MACRO_TUNING,
  actions: createSkillDragActions({ width: 2560, height: 1600 }, DEFAULT_MACRO_TUNING)
};

export function createPresetFromConfig(config: MacroConfig, name: string): MacroPreset {
  return {
    id: uid("preset"),
    name,
    baseResolution: config.resolution,
    transformMode: "centerAxisScale",
    actions: config.actions
  };
}

export function validateConfig(config: MacroConfig): string[] {
  const errors: string[] = [];
  if (config.resolution.width < 100 || config.resolution.height < 100) errors.push("分辨率需要大于 100 x 100");
  
  if (normalizeSkillSlotXOffsets(config.skillSlotXOffsets).length !== 3) errors.push("Q/W/E 手牌 X 偏移需要 3 个数值");
  if (config.skillSlotBottomOffsetRatio < 0.03 || config.skillSlotBottomOffsetRatio > 0.16) errors.push("手牌底边偏移比例建议在 0.03 - 0.16 之间");
  if (config.smoothMoveMinSteps < 1 || config.smoothMoveStepRate < 1) errors.push("虚拟移动步长参数必须大于 0");
  const used = new Map<string, string>();
  for (const action of config.actions) {
    if (!action.enabled) continue;
    if (!action.name.trim()) errors.push("指令名称不能为空");
    if (!action.hotkey) errors.push(`${action.name || "未命名指令"} 的热键不能为空`);
    if (action.hotkey === FIXED_EMERGENCY_EXIT_KEY) errors.push(`${action.name} 的热键不能使用固定紧急停止键 X`);
    if (used.has(action.hotkey)) errors.push(`${action.name} 与 ${used.get(action.hotkey)} 使用了相同热键 ${action.hotkey}`);
    used.set(action.hotkey, action.name);
    if (action.targetX < 0 || action.targetY < 0) errors.push(`${action.name} 的坐标不能为负数`);
    if (action.targetX > config.resolution.width || action.targetY > config.resolution.height) errors.push(`${action.name} 的坐标超出当前分辨率`);
    if (action.type === "script" && !(action.script || "").trim()) errors.push(`${action.name} 的脚本内容不能为空`);
    if (action.dragDistance <= 0 || action.dragDuration <= 0 || action.clickGap <= 0 || action.cardClickGap < 0 || normalizeLoopGap(action) <= 0) errors.push(`${action.name} 的数值参数必须大于 0`);
  }
  if (!config.actions.some((action) => action.enabled)) errors.push("至少需要启用一条指令");
  return errors;
}


function normalizeAhkKey(raw: string) {
  const key = raw.trim().replace(/^[$~*!^+#<>]+/, "").replace(/\s+up$/i, "").toLowerCase();
  const aliases: Record<string, string> = { lbutton: "mouse1", rbutton: "mouse2", mbutton: "mouse3", xbutton1: "mouse4", xbutton2: "mouse5", escape: "esc" };
  return aliases[key] || key;
}

function ahkNumber(value: string | undefined, fallback = 0) {
  if (!value) return fallback;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : fallback;
}

function parseAhkResolution(script: string, fallback: Resolution) {
  const explicit = /(?:resolution|分辨率|baseResolution|CoordModeResolution)\D{0,16}(\d{3,5})\D+(\d{3,5})/i.exec(script);
  if (explicit) return { width: Number(explicit[1]), height: Number(explicit[2]) };
  const screen = /A_ScreenWidth\s*:?=\s*(\d{3,5})[\s\S]{0,80}?A_ScreenHeight\s*:?=\s*(\d{3,5})/i.exec(script);
  if (screen) return { width: Number(screen[1]), height: Number(screen[2]) };
  return fallback;
}

function splitAhkHotkeyBlocks(script: string) {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const blocks: { hotkey: string; body: string }[] = [];
  let current: { hotkey: string; body: string[] } | null = null;
  for (const line of lines) {
    const hotkey = /^\s*([^;\s][^:]*?)::\s*(.*)$/.exec(line);
    if (hotkey && !/^\s*(if|while|for|loop)\b/i.test(line)) {
      if (current) blocks.push({ hotkey: current.hotkey, body: current.body.join("\n") });
      current = { hotkey: normalizeAhkKey(hotkey[1]), body: [hotkey[2] || ""] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) blocks.push({ hotkey: current.hotkey, body: current.body.join("\n") });
  return blocks;
}

function firstPointFromAhk(body: string) {
  const patterns = [
    /MouseClick(?:,\s*Left)?\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i,
    /Click\s*,?\s*(-?\d+)\s*,\s*(-?\d+)/i,
    /MouseMove\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match) return { x: ahkNumber(match[1]), y: ahkNumber(match[2]) };
  }
  return null;
}

function parseAhkAction(block: { hotkey: string; body: string }, index: number): MacroAction | null {
  const body = block.body;
  const drag = /MouseClickDrag\s*,\s*(?:Left|L)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*([\d.]+))?/i.exec(body);
  if (drag) {
    const y1 = ahkNumber(drag[2]);
    const y2 = ahkNumber(drag[4]);
    return {
      id: uid("ahk-drag"),
      name: `AHK 拖动 ${index + 1}`,
      hotkey: block.hotkey,
      type: "drag",
      targetX: ahkNumber(drag[1]),
      targetY: y1,
      dragDistance: Math.max(1, Math.abs(y1 - y2)),
      dragDuration: Math.max(0.01, ahkNumber(drag[5], 80) / 1000),
      clickGap: 0.1,
    cardClickGap: 0.005,
    loopGap: 0.05,
      enabled: true,
      script: DEFAULT_SCRIPT_MACRO
    };
  }

  const point = firstPointFromAhk(body);
  if (!point) return null;
  const hasDown = /\b(?:MouseDown|Down|Click\s+Down|MouseClick\s*,\s*Left\s*,[^\n]*,\s*D)\b/i.test(body);
  const hasUp = /\b(?:MouseUp|Up|Click\s+Up|MouseClick\s*,\s*Left\s*,[^\n]*,\s*U)\b/i.test(body);
  const hasLoop = /\b(?:Loop|While|SetTimer)\b/i.test(body);
  const clickCount = (body.match(/\b(?:Click|MouseClick)\b/gi) || []).length;
  const type: MacroType = hasLoop || clickCount > 1 ? "autoClick" : hasDown && !hasUp ? "point" : "click";
  const sleep = /Sleep\s*,\s*(\d+)/i.exec(body);
  return {
    id: uid("ahk-action"),
    name: `AHK ${MACRO_LABELS[type]} ${index + 1}`,
    hotkey: block.hotkey,
    type,
    targetX: point.x,
    targetY: point.y,
    dragDistance: 300,
    dragDuration: 0.05,
    clickGap: Math.max(0.03, ahkNumber(sleep?.[1], 100) / 1000),
    cardClickGap: 0.005,
    loopGap: 0.05,
    enabled: true,
    script: DEFAULT_SCRIPT_MACRO
  };
}

export function parseAhkMacroPackage(script: string, filename: string, fallbackResolution: Resolution): MacroPresetPackage {
  const baseResolution = parseAhkResolution(script, fallbackResolution);
  const actions = splitAhkHotkeyBlocks(script).map(parseAhkAction).filter(Boolean) as MacroAction[];
  if (actions.length === 0) throw new Error("没有从 AHK 文件中识别到可转换的点位、拖动、点击或连点宏");
  const name = filename.replace(/\.ahk$/i, "") || "AHK 导入宏";
  return createMacroPackage(name, [{
    id: uid("ahk-preset"),
    name,
    baseResolution,
    transformMode: "centerAxisScale",
    actions
  }]);
}
