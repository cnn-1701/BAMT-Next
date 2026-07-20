import { DEFAULT_CONFIG } from "./config";
import type { BackendEvent, CapturePayload, MacroAction, MacroApi, MacroConfig, StatusPayload } from "./types";

class BrowserFallbackApi implements MacroApi {
  private config = DEFAULT_CONFIG;
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
  onEvent = (_listener: (event: BackendEvent) => void) => () => undefined;
}

export function getMacroApi(): MacroApi {
  return window.bamt ?? new BrowserFallbackApi();
}
