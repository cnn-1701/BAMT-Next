import { DEFAULT_CONFIG } from "./config";
import type { BackendEvent, CapturePayload, MacroAction, MacroApi, MacroConfig, StatusPayload, StoragePaths } from "./types";

class BrowserFallbackApi implements MacroApi {
  private config = DEFAULT_CONFIG;
  getStoragePaths = async (): Promise<StoragePaths> => ({
    projectDir: ".",
    dataDir: "data",
    configPath: "data/config/blue_archive_config.json",
    presetLibraryPath: "data/presets/preset-library.json",
    presetImportDir: "data/imports",
    presetExportDir: "data/exports",
    ahkDataDir: "data/ahk",
    timelineDir: "data/timelines",
    relative: {
      dataDir: "data",
      configPath: "data/config/blue_archive_config.json",
      presetLibraryPath: "data/presets/preset-library.json",
      presetImportDir: "data/imports",
      presetExportDir: "data/exports",
      ahkDataDir: "data/ahk",
      timelineDir: "data/timelines"
    }
  });
  private presets: unknown[] = [];
  loadPresetLibrary = async () => this.presets;
  savePresetLibrary = async (presets: unknown[]): Promise<StatusPayload> => {
    this.presets = Array.isArray(presets) ? presets : [];
    return { status: "ready", message: "浏览器预览已在内存中暂存宏预设库" };
  };
  exportPresetPackage = async (filename: string, value: unknown): Promise<StatusPayload> => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return { status: "ready", message: "浏览器预览已下载宏预设" };
  };
  saveTimelineFile = async (filename: string, value: unknown): Promise<StatusPayload> => {
    localStorage.setItem("bamt-timeline-" + filename, JSON.stringify(value, null, 2));
    return { status: "ready", message: "浏览器预览已自动保存排轴：" + filename };
  };
  pickTimelineFile = async () => null;
  pickPresetPackage = async () => null;
  openDataDir = async (): Promise<StatusPayload> => ({ status: "unavailable", message: "浏览器预览不能打开 data 目录" });
  getInitialConfig = async () => this.config;
  saveConfig = async (config: MacroConfig) => {
    this.config = config;
    localStorage.setItem("bamt-config", JSON.stringify(config));
    return config;
  };
  loadConfig = async () => {
    const saved = localStorage.getItem("bamt-config");
    if (saved) this.config = JSON.parse(saved) as MacroConfig;
    return this.config;
  };
  startListening = async (): Promise<StatusPayload> => ({ status: "unavailable", message: "请在 Electron 中运行以使用全局输入" });
  stopListening = async (): Promise<StatusPayload> => ({ status: "stopped", message: "已停止" });
  testMacro = async (_action: MacroAction): Promise<StatusPayload> => ({ status: "unavailable", message: "浏览器预览不执行鼠标输入" });
  capturePosition = async (): Promise<CapturePayload> => ({ x: 0, y: 0 });
  openLegacyApp = async (): Promise<StatusPayload> => ({ status: "unavailable", message: "浏览器预览不能打开旧版程序" });
  openScheduleTool = async (): Promise<StatusPayload> => ({ status: "unavailable", message: "浏览器预览不能打开排轴工具" });
  openTimelinePreview = async (text: string): Promise<StatusPayload> => {
    const preview = window.open("", "bamt-timeline-preview", "width=900,height=720");
    if (!preview) return { status: "error", message: "浏览器阻止了预览窗口" };
    preview.document.title = "排轴文本预览";
    preview.document.body.innerHTML = `<pre style="white-space:pre-wrap;font:16px/1.65 Consolas, 'Microsoft YaHei', monospace;padding:28px;color:#18324a;background:#f5f9fc;">${text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char))}</pre>`;
    return { status: "ready", message: "已打开独立排轴预览窗口" };
  };
  runAhkScript = async (): Promise<StatusPayload> => ({ status: "unavailable", message: "浏览器预览不能运行 AHK" });
  setTimelinePreviewAlwaysOnTop = async (): Promise<StatusPayload> => ({ status: "unavailable", message: "浏览器预览不能控制窗口置顶" });
  stopAhkScript = async (): Promise<StatusPayload> => ({ status: "stopped", message: "浏览器预览没有 AHK 进程" });
  onEvent = (_listener: (event: BackendEvent) => void) => () => undefined;
}

export function getMacroApi(): MacroApi {
  return window.bamt ?? new BrowserFallbackApi();
}
