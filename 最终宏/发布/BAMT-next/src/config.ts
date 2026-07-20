import type { MacroAction, MacroConfig, MacroType } from "./types";

export const MACRO_LABELS: Record<MacroType, string> = {
  point: "点位",
  drag: "拖动",
  autoClick: "连点",
  click: "点击"
};

export const MACRO_DESCRIPTIONS: Record<MacroType, string> = {
  point: "按住热键时按下目标点，松开后释放并返回原位置",
  drag: "按住热键时循环拖动技能点到当前鼠标位置",
  autoClick: "按住热键时连续点击当前鼠标位置",
  click: "按下热键时点击目标点一次并返回原位置"
};

export const PRESET_RESOLUTIONS = [
  { label: "1920 x 1080", width: 1920, height: 1080 },
  { label: "2560 x 1440", width: 2560, height: 1440 },
  { label: "2500 x 1600", width: 2500, height: 1600 },
  { label: "3840 x 2160", width: 3840, height: 2160 }
];

export function createAction(seed = Date.now()): MacroAction {
  return {
    id: `macro-${seed}`,
    name: "指令",
    hotkey: "q",
    type: "point",
    targetX: 1280,
    targetY: 800,
    dragDistance: 300,
    dragDuration: 0.03,
    clickGap: 0.1,
    enabled: true
  };
}

export const DEFAULT_CONFIG: MacroConfig = {
  version: "2.1",
  resolution: { width: 2560, height: 1600 },
  exitKey: "s",
  actions: [{ ...createAction(1), id: "macro-q-drag", name: "指令1", type: "drag", targetX: 2038, targetY: 1365 }]
};

export function validateConfig(config: MacroConfig): string[] {
  const errors: string[] = [];
  if (config.resolution.width < 100 || config.resolution.height < 100) errors.push("分辨率需要大于 100 x 100");
  if (!config.exitKey) errors.push("停止键不能为空");

  const used = new Map<string, string>();
  for (const action of config.actions) {
    if (!action.enabled) continue;
    if (!action.name.trim()) errors.push("指令名称不能为空");
    if (!action.hotkey) errors.push(`${action.name || "未命名指令"} 的热键不能为空`);
    if (action.hotkey === config.exitKey) errors.push(`${action.name} 的热键不能与停止键相同`);
    if (used.has(action.hotkey)) errors.push(`${action.name} 与 ${used.get(action.hotkey)} 使用了相同热键 ${action.hotkey}`);
    used.set(action.hotkey, action.name);
    if (action.targetX < 0 || action.targetY < 0) errors.push(`${action.name} 的坐标不能为负数`);
    if (action.targetX > config.resolution.width || action.targetY > config.resolution.height) errors.push(`${action.name} 的坐标超出当前分辨率`);
    if (action.dragDistance <= 0 || action.dragDuration <= 0 || action.clickGap <= 0) errors.push(`${action.name} 的数值参数必须大于 0`);
  }
  if (!config.actions.some((action) => action.enabled)) errors.push("至少需要启用一条指令");
  return errors;
}
