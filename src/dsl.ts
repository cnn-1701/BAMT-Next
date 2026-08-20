export type DslPoint =
  | { kind: "absolute"; x: number; y: number }
  | { kind: "origin" | "target" | "here"; offsetX: number; offsetY: number };

export type DslCommand =
  | { kind: "wait"; durationUs: number; line: number }
  | { kind: "move"; point: DslPoint; durationUs: number; line: number }
  | { kind: "click"; point: DslPoint; holdUs: number; line: number }
  | { kind: "press"; point: DslPoint; line: number }
  | { kind: "release"; point: DslPoint; line: number }
  | { kind: "drag"; from: DslPoint; to: DslPoint; durationUs: number; line: number }
  | { kind: "key"; operation: "tap" | "down" | "up"; key: string; holdUs: number; line: number }
  | { kind: "restore"; durationUs: number; line: number }
  | { kind: "releaseActions"; line: number }
  | { kind: "releaseAll"; line: number }
  | { kind: "repeat"; count: number; body: DslCommand[]; line: number }
  | { kind: "loopUntilRelease"; body: DslCommand[]; line: number };

export interface DslDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface DslStats {
  commandCount: number;
  blockCount: number;
  loopUntilReleaseCount: number;
}

export interface DslParseResult {
  commands: DslCommand[];
  diagnostics: DslDiagnostic[];
  stats: DslStats;
}

export interface DslCompletion {
  label: string;
  insertText: string;
  detail: string;
  replaceStart: number;
  replaceEnd: number;
}

interface CompletionDefinition {
  label: string;
  insertText: string;
  detail: string;
}

const COMMAND_COMPLETIONS: CompletionDefinition[] = [
  { label: "wait", insertText: "wait 7ms", detail: "高精度等待" },
  { label: "sleep", insertText: "sleep 7ms", detail: "wait 的兼容别名" },
  { label: "move", insertText: "move target", detail: "移动光标" },
  { label: "click", insertText: "click target 7ms", detail: "移动并单击左键" },
  { label: "press", insertText: "press target", detail: "移动并按下左键" },
  { label: "release", insertText: "release here", detail: "移动并释放左键" },
  { label: "drag", insertText: "drag target to target offset 0 -300 20ms", detail: "按下、拖动并释放" },
  { label: "key tap", insertText: "key tap 1 7ms", detail: "按下并释放键盘按键" },
  { label: "key down", insertText: "key down 1", detail: "保持键盘按键" },
  { label: "key up", insertText: "key up 1", detail: "释放键盘按键" },
  { label: "key_press", insertText: "key_press 1", detail: "MuMu 兼容：按下键盘按键" },
  { label: "key_release", insertText: "key_release 1", detail: "MuMu 兼容：释放键盘按键" },
  { label: "mouse_press", insertText: "mouse_press left", detail: "MuMu 兼容：按下鼠标左键" },
  { label: "mouse_release", insertText: "mouse_release left", detail: "MuMu 兼容：释放鼠标左键" },
  { label: "release_actions", insertText: "release_actions", detail: "后续命令在宏热键松开时执行" },
  { label: "release_all", insertText: "release_all", detail: "释放脚本保持的鼠标和键盘输入" },
  { label: "restore", insertText: "restore", detail: "释放输入并回到触发位置" },
  { label: "loop", insertText: "loop\n  wait 7ms\nloop_end", detail: "MuMu 兼容：循环到热键松开" },
  { label: "loop N", insertText: "loop 3\n  wait 7ms\nloop_end", detail: "MuMu 兼容：固定次数循环" },
  { label: "loop until_release", insertText: "loop until_release\n  wait 7ms\nloop_end", detail: "显式循环到宏热键松开" },
  { label: "repeat", insertText: "repeat 3\n  wait 7ms\nend", detail: "BAMT 兼容：固定次数循环" },
  { label: "loop_end", insertText: "loop_end", detail: "MuMu 兼容：结束循环模块" },
  { label: "end", insertText: "end", detail: "BAMT 兼容：结束循环模块" }
];

const POINT_COMPLETIONS: CompletionDefinition[] = [
  { label: "target", insertText: "target", detail: "当前宏配置的 X/Y" },
  { label: "origin", insertText: "origin", detail: "触发宏瞬间的光标位置" },
  { label: "here", insertText: "here", detail: "执行到当前命令时的光标位置" },
  { label: "target offset", insertText: "target offset 0 0", detail: "相对宏目标点偏移" },
  { label: "origin offset", insertText: "origin offset 0 0", detail: "相对触发位置偏移" },
  { label: "here offset", insertText: "here offset 0 0", detail: "相对当前光标偏移" }
];

const DURATION_COMPLETIONS: CompletionDefinition[] = [
  { label: "500us", insertText: "500us", detail: "500 微秒" },
  { label: "1ms", insertText: "1ms", detail: "1 毫秒" },
  { label: "5ms", insertText: "5ms", detail: "5 毫秒" },
  { label: "7ms", insertText: "7ms", detail: "最速出牌常用阶段值" },
  { label: "16.667ms", insertText: "16.667ms", detail: "约一帧（60 FPS）" },
  { label: "20ms", insertText: "20ms", detail: "20 毫秒" },
  { label: "50ms", insertText: "50ms", detail: "50 毫秒" },
  { label: "1s", insertText: "1s", detail: "1 秒" }
];

const KEY_OPERATION_COMPLETIONS: CompletionDefinition[] = [
  { label: "tap", insertText: "tap", detail: "按下、等待、释放" },
  { label: "down", insertText: "down", detail: "仅按下" },
  { label: "up", insertText: "up", detail: "仅释放" }
];

const KEY_COMPLETIONS: CompletionDefinition[] = [
  ..."1234567890qwertyuiopasdfghjklzxcvbnm".split("").map((key) => ({ label: key, insertText: key, detail: "键盘按键" })),
  ...["space", "tab", "enter", "esc", "up", "down", "left", "right", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"].map((key) => ({ label: key, insertText: key, detail: "特殊按键" }))
];

function completionRange(source: string, caret: number) {
  let start = Math.max(0, Math.min(caret, source.length));
  while (start > 0 && !/[\s]/.test(source[start - 1])) start -= 1;
  let end = Math.max(0, Math.min(caret, source.length));
  while (end < source.length && !/[\s]/.test(source[end])) end += 1;
  return { start, end };
}

function completedPointEnd(tokens: string[], start: number): number | null {
  const first = tokens[start]?.toLowerCase();
  if (!first) return null;
  if (["origin", "mouse", "target", "here", "current"].includes(first)) {
    if (tokens[start + 1]?.toLowerCase() !== "offset") return start + 1;
    return tokens[start + 2] !== undefined && tokens[start + 3] !== undefined ? start + 4 : null;
  }
  return /^-?\d+$/.test(first) && /^-?\d+$/.test(tokens[start + 1] || "") ? start + 2 : null;
}

export function getDslCompletions(source: string, caret: number, force = false): DslCompletion[] {
  const safeCaret = Math.max(0, Math.min(caret, source.length));
  const lineStart = source.lastIndexOf("\n", safeCaret - 1) + 1;
  const beforeCaret = source.slice(lineStart, safeCaret);
  const content = beforeCaret.trimStart();
  if (!force && (content.startsWith("#") || content.startsWith(";") || content.startsWith("//"))) return [];

  const range = completionRange(source, safeCaret);
  const prefix = source.slice(range.start, safeCaret).toLowerCase();
  const tokens = content.split(/\s+/).filter(Boolean);
  const afterSeparator = /\s$/.test(beforeCaret);
  const command = tokens[0]?.toLowerCase() || "";
  let definitions = COMMAND_COMPLETIONS;

  if (tokens.length === 1 && !afterSeparator) {
    definitions = COMMAND_COMPLETIONS;
  } else if (command === "key") {
    if (tokens.length < 2 || (tokens.length === 2 && !afterSeparator)) definitions = KEY_OPERATION_COMPLETIONS;
    else if (tokens.length < 3 || (tokens.length === 3 && !afterSeparator)) definitions = KEY_COMPLETIONS;
    else definitions = tokens[1]?.toLowerCase() === "tap" ? DURATION_COMPLETIONS : [];
  } else if (command === "key_press" || command === "key_release") {
    definitions = KEY_COMPLETIONS;
  } else if (command === "mouse_press" || command === "mouse_release") {
    definitions = [{ label: "left", insertText: "left", detail: "鼠标左键" }];
  } else if (command === "wait" || command === "sleep" || command === "restore") {
    definitions = DURATION_COMPLETIONS;
  } else if (["move", "click", "press", "release"].includes(command)) {
    const pointEnd = completedPointEnd(tokens, 1);
    if (pointEnd !== null && afterSeparator && tokens.length === pointEnd) {
      definitions = command === "move" || command === "click" ? DURATION_COMPLETIONS : [];
    } else {
      definitions = POINT_COMPLETIONS;
    }
  } else if (command === "drag") {
    const fromEnd = completedPointEnd(tokens, 1);
    const toIndex = fromEnd !== null && tokens[fromEnd]?.toLowerCase() === "to" ? fromEnd + 1 : fromEnd;
    const toEnd = toIndex === null ? null : completedPointEnd(tokens, toIndex);
    if (fromEnd === null) definitions = POINT_COMPLETIONS;
    else if (toIndex === fromEnd && afterSeparator && tokens.length === fromEnd) definitions = [{ label: "to", insertText: "to", detail: "分隔拖动起点与终点" }];
    else if (toEnd !== null && afterSeparator && tokens.length === toEnd) definitions = DURATION_COMPLETIONS;
    else definitions = POINT_COMPLETIONS;
  } else if (command === "loop") {
    definitions = [
      { label: "until_release", insertText: "until_release", detail: "循环直到触发热键松开" },
      { label: "3", insertText: "3", detail: "固定循环 3 次" }
    ];
  } else if (tokens.length > 1) {
    definitions = [];
  }

  return definitions
    .filter((item) => !prefix || item.label.toLowerCase().startsWith(prefix) || item.insertText.toLowerCase().startsWith(prefix))
    .slice(0, 20)
    .map((item) => ({ ...item, replaceStart: range.start, replaceEnd: range.end }));
}

export const DSL_EXAMPLES = {
  singleSequence: [
    "# 未写 loop：按下热键后只执行一次",
    "click 1280,720 7ms",
    "sleep 20",
    "click 1600,900 7ms",
    "restore"
  ].join("\n"),
  multiClick: [
    "# 点击两个位置，并重复到触发热键松开",
    "loop until_release",
    "  click 1280 720 7ms",
    "  wait 20ms",
    "  click 1600 900 7ms",
    "  wait 20ms",
    "loop_end",
    "restore 0ms"
  ].join("\n"),
  finiteRepeat: [
    "# 有限重复三次",
    "loop 3",
    "  click target 7ms",
    "  wait 16.667ms",
    "loop_end",
    "restore"
  ].join("\n"),
  keyAndClick: [
    "# 模拟选牌键，再点击触发时的鼠标位置",
    "loop until_release",
    "  key tap 1 7ms",
    "  wait 7ms",
    "  click origin 7ms",
    "  wait 7ms",
    "loop_end"
  ].join("\n"),
  drag: [
    "# 从预设目标点拖到目标点上方 300 像素",
    "loop until_release",
    "  drag target to target offset 0 -300 20ms",
    "  restore 0ms",
    "  wait 50ms",
    "loop_end"
  ].join("\n")
} as const;

const MAX_NESTING = 8;
const MAX_REPEAT = 100_000;
const MAX_DURATION_US = 3_600_000_000;
const KEY_PATTERN = /^(?:[a-z0-9]|space|tab|enter|esc|escape|up|down|left|right|f(?:[1-9]|1[0-2]))$/i;

interface SourceLine {
  number: number;
  text: string;
}

function removeComment(line: string): string {
  const markers = [line.indexOf("#"), line.indexOf(";"), line.indexOf("//")].filter((index) => index >= 0);
  return (markers.length ? line.slice(0, Math.min(...markers)) : line).trim();
}

function diagnostic(line: number, message: string): DslDiagnostic {
  return { line, column: 1, message };
}

function parseNumber(token: string | undefined, line: number, name: string, diagnostics: DslDiagnostic[]): number | null {
  if (token === undefined || !/^-?\d+(?:\.\d+)?$/.test(token)) {
    diagnostics.push(diagnostic(line, `${name}需要是数字`));
    return null;
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    diagnostics.push(diagnostic(line, `${name}超出可用范围`));
    return null;
  }
  return value;
}

function parseInteger(token: string | undefined, line: number, name: string, diagnostics: DslDiagnostic[]): number | null {
  const value = parseNumber(token, line, name, diagnostics);
  if (value === null) return null;
  if (!Number.isInteger(value)) diagnostics.push(diagnostic(line, `${name}必须是整数`));
  return Number.isInteger(value) ? value : null;
}

function parseDuration(token: string | undefined, line: number, name: string, diagnostics: DslDiagnostic[], fallbackUs?: number): number | null {
  if (token === undefined && fallbackUs !== undefined) return fallbackUs;
  const match = /^(\d+(?:\.\d+)?)(us|ms|s)?$/i.exec(token || "");
  if (!match) {
    diagnostics.push(diagnostic(line, `${name}格式无效，请使用 500us、7ms 或 0.02s`));
    return null;
  }
  const factor = match[2]?.toLowerCase() === "s" ? 1_000_000 : match[2]?.toLowerCase() === "us" ? 1 : 1_000;
  const durationUs = Math.round(Number(match[1]) * factor);
  if (durationUs < 0 || durationUs > MAX_DURATION_US) {
    diagnostics.push(diagnostic(line, `${name}必须在 0 到 1 小时之间`));
    return null;
  }
  return durationUs;
}

function parsePoint(tokens: string[], start: number, line: number, diagnostics: DslDiagnostic[]): { point: DslPoint; next: number } | null {
  const first = tokens[start]?.toLowerCase();
  if (!first) {
    diagnostics.push(diagnostic(line, "缺少坐标，可使用 x y、origin、target 或 here"));
    return null;
  }
  if (["origin", "mouse", "target", "here", "current"].includes(first)) {
    const kind = first === "mouse" ? "origin" : first === "current" ? "here" : first as "origin" | "target" | "here";
    let next = start + 1;
    let offsetX = 0;
    let offsetY = 0;
    if (tokens[next]?.toLowerCase() === "offset") {
      const x = parseInteger(tokens[next + 1], line, "X 偏移", diagnostics);
      const y = parseInteger(tokens[next + 2], line, "Y 偏移", diagnostics);
      if (x === null || y === null) return null;
      offsetX = x;
      offsetY = y;
      next += 3;
    }
    return { point: { kind, offsetX, offsetY }, next };
  }
  const x = parseInteger(tokens[start], line, "X 坐标", diagnostics);
  const y = parseInteger(tokens[start + 1], line, "Y 坐标", diagnostics);
  if (x === null || y === null) return null;
  return { point: { kind: "absolute", x, y }, next: start + 2 };
}

function ensureEnd(tokens: string[], next: number, line: number, diagnostics: DslDiagnostic[]): boolean {
  if (next === tokens.length) return true;
  diagnostics.push(diagnostic(line, `多余参数：${tokens.slice(next).join(" ")}`));
  return false;
}

function hasTimedCommand(commands: DslCommand[]): boolean {
  return commands.some((command) => {
    if (command.kind === "wait" || command.kind === "click" || command.kind === "drag") return true;
    if (command.kind === "key" && command.operation === "tap") return true;
    if ((command.kind === "move" || command.kind === "restore") && command.durationUs > 0) return true;
    if (command.kind === "repeat" || command.kind === "loopUntilRelease") return hasTimedCommand(command.body);
    return false;
  });
}

export function parseDsl(source: string): DslParseResult {
  const diagnostics: DslDiagnostic[] = [];
  const lines: SourceLine[] = source.replace(/\r\n/g, "\n").split("\n").map((text, index) => ({ number: index + 1, text: removeComment(text) })).filter((line) => line.text.length > 0);
  let index = 0;
  let releaseActionsSeen = false;

  function parseBlock(depth: number, expectsEnd: boolean): DslCommand[] {
    const commands: DslCommand[] = [];
    if (depth > MAX_NESTING) {
      diagnostics.push(diagnostic(lines[Math.max(0, index - 1)]?.number || 1, `嵌套层数不能超过 ${MAX_NESTING} 层`));
      return commands;
    }
    while (index < lines.length) {
      const sourceLine = lines[index++];
      const tokens = sourceLine.text.replace(/(-?\d+)\s*,\s*(-?\d+)/g, "$1 $2").split(/\s+/);
      const keyword = tokens[0].toLowerCase();
      const line = sourceLine.number;
      if (keyword === "end" || keyword === "loop_end") {
        if (!expectsEnd) diagnostics.push(diagnostic(line, "这里没有可结束的 loop 或 repeat 块"));
        else if (tokens.length > 1) diagnostics.push(diagnostic(line, `${keyword} 后不能添加参数`));
        return commands;
      }
      if (keyword === "loop") {
        const mode = tokens[1]?.toLowerCase();
        const fixedCount = mode && mode !== "until_release" ? parseInteger(tokens[1], line, "循环次数", diagnostics) : null;
        if (tokens.length > 2) ensureEnd(tokens, 2, line, diagnostics);
        const body = parseBlock(depth + 1, true);
        if (body.length === 0) diagnostics.push(diagnostic(line, "loop 循环体不能为空"));
        else if (!hasTimedCommand(body)) diagnostics.push(diagnostic(line, "loop 循环体必须包含 wait、click、drag、key tap 或带等待的 move，避免空转占满 CPU"));
        if (!mode || mode === "until_release") commands.push({ kind: "loopUntilRelease", body, line });
        else if (fixedCount !== null && fixedCount >= 1 && fixedCount <= MAX_REPEAT) commands.push({ kind: "repeat", count: fixedCount, body, line });
        else if (fixedCount !== null) diagnostics.push(diagnostic(line, `循环次数必须在 1 到 ${MAX_REPEAT} 之间`));
        continue;
      }
      if (keyword === "repeat") {
        const count = parseInteger(tokens[1], line, "重复次数", diagnostics);
        if (tokens.length !== 2) ensureEnd(tokens, 2, line, diagnostics);
        const body = parseBlock(depth + 1, true);
        if (count !== null && (count < 1 || count > MAX_REPEAT)) diagnostics.push(diagnostic(line, `重复次数必须在 1 到 ${MAX_REPEAT} 之间`));
        if (body.length === 0) diagnostics.push(diagnostic(line, "repeat 循环体不能为空"));
        if (count !== null && count >= 1 && count <= MAX_REPEAT) commands.push({ kind: "repeat", count, body, line });
        continue;
      }
      if (keyword === "wait" || keyword === "sleep") {
        const durationUs = parseDuration(tokens[1], line, "等待时间", diagnostics);
        if (durationUs !== null && ensureEnd(tokens, 2, line, diagnostics)) commands.push({ kind: "wait", durationUs, line });
        continue;
      }
      if (keyword === "release_actions") {
        if (depth !== 0) diagnostics.push(diagnostic(line, "release_actions 只能位于脚本顶层"));
        else if (releaseActionsSeen) diagnostics.push(diagnostic(line, "每个脚本只能包含一个 release_actions"));
        else if (ensureEnd(tokens, 1, line, diagnostics)) {
          releaseActionsSeen = true;
          commands.push({ kind: "releaseActions", line });
        }
        continue;
      }
      if (keyword === "release_all") {
        if (ensureEnd(tokens, 1, line, diagnostics)) commands.push({ kind: "releaseAll", line });
        continue;
      }
      if (keyword === "move") {
        const parsed = parsePoint(tokens, 1, line, diagnostics);
        if (!parsed) continue;
        const durationUs = parseDuration(tokens[parsed.next], line, "移动后等待时间", diagnostics, 0);
        const next = tokens[parsed.next] === undefined ? parsed.next : parsed.next + 1;
        if (durationUs !== null && ensureEnd(tokens, next, line, diagnostics)) commands.push({ kind: "move", point: parsed.point, durationUs, line });
        continue;
      }
      if (keyword === "click") {
        const parsed = tokens.length === 1 ? { point: { kind: "here", offsetX: 0, offsetY: 0 } as DslPoint, next: 1 } : parsePoint(tokens, 1, line, diagnostics);
        if (!parsed) continue;
        const holdUs = parseDuration(tokens[parsed.next], line, "点击按住时间", diagnostics, 7_000);
        const next = tokens[parsed.next] === undefined ? parsed.next : parsed.next + 1;
        if (holdUs !== null && holdUs > 0 && ensureEnd(tokens, next, line, diagnostics)) commands.push({ kind: "click", point: parsed.point, holdUs, line });
        else if (holdUs === 0) diagnostics.push(diagnostic(line, "点击按住时间必须大于 0"));
        continue;
      }
      if (keyword === "press" || keyword === "release") {
        const parsed = tokens.length === 1 && keyword === "release" ? { point: { kind: "here", offsetX: 0, offsetY: 0 } as DslPoint, next: 1 } : parsePoint(tokens, 1, line, diagnostics);
        if (parsed && ensureEnd(tokens, parsed.next, line, diagnostics)) commands.push(keyword === "press" ? { kind: "press", point: parsed.point, line } : { kind: "release", point: parsed.point, line });
        continue;
      }
      if (keyword === "drag") {
        const from = parsePoint(tokens, 1, line, diagnostics);
        if (!from) continue;
        const destinationStart = tokens[from.next]?.toLowerCase() === "to" ? from.next + 1 : from.next;
        const to = parsePoint(tokens, destinationStart, line, diagnostics);
        if (!to) continue;
        const durationUs = parseDuration(tokens[to.next], line, "拖动时间", diagnostics);
        if (durationUs !== null && durationUs > 0 && ensureEnd(tokens, to.next + 1, line, diagnostics)) commands.push({ kind: "drag", from: from.point, to: to.point, durationUs, line });
        else if (durationUs === 0) diagnostics.push(diagnostic(line, "拖动时间必须大于 0"));
        continue;
      }
      if (keyword === "key") {
        const operation = tokens[1]?.toLowerCase();
        const key = tokens[2]?.toLowerCase();
        if (!(["tap", "down", "up"].includes(operation)) || !key || !KEY_PATTERN.test(key)) {
          diagnostics.push(diagnostic(line, "按键语法：key tap|down|up <按键> [按住时间]"));
          continue;
        }
        const holdUs = operation === "tap" ? parseDuration(tokens[3], line, "按键按住时间", diagnostics, 7_000) : 0;
        const next = operation === "tap" && tokens[3] !== undefined ? 4 : 3;
        if (holdUs !== null && holdUs >= 0 && ensureEnd(tokens, next, line, diagnostics)) commands.push({ kind: "key", operation: operation as "tap" | "down" | "up", key, holdUs, line });
        continue;
      }
      if (keyword === "key_press" || keyword === "key_release") {
        const key = tokens[1]?.toLowerCase();
        if (!key || !KEY_PATTERN.test(key)) diagnostics.push(diagnostic(line, `${keyword} 需要一个受支持的按键`));
        else if (ensureEnd(tokens, 2, line, diagnostics)) commands.push({ kind: "key", operation: keyword === "key_press" ? "down" : "up", key, holdUs: 0, line });
        continue;
      }
      if (keyword === "mouse_press" || keyword === "mouse_release") {
        const button = tokens[1]?.toLowerCase();
        if (button !== "left") diagnostics.push(diagnostic(line, "Windows 原生后端目前仅支持 mouse_press left / mouse_release left"));
        else if (ensureEnd(tokens, 2, line, diagnostics)) {
          const point = { kind: "here", offsetX: 0, offsetY: 0 } as DslPoint;
          commands.push(keyword === "mouse_press" ? { kind: "press", point, line } : { kind: "release", point, line });
        }
        continue;
      }
      if (keyword === "restore") {
        const durationUs = parseDuration(tokens[1], line, "回原位后等待时间", diagnostics, 0);
        const next = tokens[1] === undefined ? 1 : 2;
        if (durationUs !== null && ensureEnd(tokens, next, line, diagnostics)) commands.push({ kind: "restore", durationUs, line });
        continue;
      }
      diagnostics.push(diagnostic(line, `不支持的命令“${tokens[0]}”`));
    }
    if (expectsEnd) diagnostics.push(diagnostic(lines[lines.length - 1]?.number || 1, "脚本结束前缺少 loop_end（也兼容 end）"));
    return commands;
  }

  const commands = parseBlock(0, false);
  let commandCount = 0;
  let blockCount = 0;
  let loopUntilReleaseCount = 0;
  const visit = (items: DslCommand[]) => items.forEach((command) => {
    commandCount += 1;
    if (command.kind === "repeat" || command.kind === "loopUntilRelease") {
      blockCount += 1;
      if (command.kind === "loopUntilRelease") loopUntilReleaseCount += 1;
      visit(command.body);
    }
  });
  visit(commands);
  if (commands.length === 0 && diagnostics.length === 0) diagnostics.push(diagnostic(1, "脚本不能为空"));
  return { commands, diagnostics, stats: { commandCount, blockCount, loopUntilReleaseCount } };
}

function durationText(durationUs: number): string {
  if (durationUs % 1_000_000 === 0 && durationUs >= 1_000_000) return `${durationUs / 1_000_000}s`;
  if (durationUs % 1_000 === 0) return `${durationUs / 1_000}ms`;
  return `${durationUs}us`;
}

function pointText(point: DslPoint): string {
  if (point.kind === "absolute") return `${point.x},${point.y}`;
  const offset = point.offsetX || point.offsetY ? ` offset ${point.offsetX} ${point.offsetY}` : "";
  return `${point.kind}${offset}`;
}

export function formatDsl(commands: DslCommand[]): string {
  const lines: string[] = [];
  const write = (items: DslCommand[], depth: number) => items.forEach((command) => {
    const pad = "  ".repeat(depth);
    switch (command.kind) {
      case "wait": lines.push(`${pad}wait ${durationText(command.durationUs)}`); break;
      case "move": lines.push(`${pad}move ${pointText(command.point)}${command.durationUs ? ` ${durationText(command.durationUs)}` : ""}`); break;
      case "click": lines.push(`${pad}click ${pointText(command.point)} ${durationText(command.holdUs)}`); break;
      case "press": lines.push(`${pad}press ${pointText(command.point)}`); break;
      case "release": lines.push(`${pad}release ${pointText(command.point)}`); break;
      case "drag": lines.push(`${pad}drag ${pointText(command.from)} to ${pointText(command.to)} ${durationText(command.durationUs)}`); break;
      case "key": lines.push(`${pad}key ${command.operation} ${command.key}${command.operation === "tap" ? ` ${durationText(command.holdUs)}` : ""}`); break;
      case "restore": lines.push(`${pad}restore${command.durationUs ? ` ${durationText(command.durationUs)}` : ""}`); break;
      case "releaseActions": lines.push(`${pad}release_actions`); break;
      case "releaseAll": lines.push(`${pad}release_all`); break;
      case "repeat":
        lines.push(`${pad}loop ${command.count}`);
        write(command.body, depth + 1);
        lines.push(`${pad}loop_end`);
        break;
      case "loopUntilRelease":
        lines.push(`${pad}loop until_release`);
        write(command.body, depth + 1);
        lines.push(`${pad}loop_end`);
        break;
    }
  });
  write(commands, 0);
  return lines.join("\n");
}

export const DSL_COMMAND_REFERENCE = [
  ["click 1280,720", "MuMu 坐标写法；没有 loop 时只执行一次"],
  ["wait 7ms", "高精度等待；支持 us、ms、s"],
  ["move 1280 720 1ms", "移动到坐标，最后参数为移动后等待"],
  ["click target 7ms", "点击预设 X/Y，按住 7ms"],
  ["click origin", "点击触发热键瞬间的鼠标位置"],
  ["drag target to target offset 0 -300 20ms", "从目标点拖到目标点上方"],
  ["key tap 1 7ms", "模拟一次键盘按下与释放"],
  ["loop 3 ... loop_end", "固定执行 3 次"],
  ["loop / loop until_release", "循环到触发热键松开"],
  ["release_actions", "后续命令等待宏热键松开后执行"],
  ["key_press 1 / key_release 1", "MuMu 兼容键盘按下与释放"],
  ["mouse_press left / mouse_release left", "MuMu 兼容鼠标左键按下与释放"],
  ["release_all", "释放脚本保持的全部输入"],
  ["restore", "释放输入后回到触发时鼠标位置"]
] as const;
