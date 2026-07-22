const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  escape: "esc",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right"
};

export function normalizeHotkey(value: string): string {
  return value.trim().toLowerCase();
}

export function keyEventToHotkey(event: KeyboardEvent): string {
  const raw = event.key.length === 1 ? event.key : event.key.toLowerCase();
  return normalizeHotkey(KEY_ALIASES[raw.toLowerCase()] ?? raw);
}

export function mouseEventToHotkey(event: MouseEvent): string | null {
  if (event.button === 3) return "mouse4";
  if (event.button === 4) return "mouse5";
  return null;
}

export function hotkeyLabel(value: string): string {
  const key = normalizeHotkey(value);
  if (!key) return "未设置";
  if (key === "space") return "Space";
  if (key === "esc") return "Esc";
  if (key.startsWith("mouse")) return key === "mouse4" ? "侧键 1" : "侧键 2";
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  return key.length === 1 ? key.toUpperCase() : key;
}
