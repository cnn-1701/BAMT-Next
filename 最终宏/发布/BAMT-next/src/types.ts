export type MacroType = "point" | "drag" | "autoClick" | "click";
export type BackendStatus = "booting" | "ready" | "listening" | "stopped" | "error" | "unavailable";

export interface Resolution {
  width: number;
  height: number;
}

export interface MacroAction {
  id: string;
  name: string;
  hotkey: string;
  type: MacroType;
  targetX: number;
  targetY: number;
  dragDistance: number;
  dragDuration: number;
  clickGap: number;
  enabled: boolean;
}

export interface MacroConfig {
  version: string;
  resolution: Resolution;
  exitKey: string;
  actions: MacroAction[];
}

export interface StatusPayload {
  status: BackendStatus;
  message: string;
}

export interface CapturePayload {
  x: number;
  y: number;
}

export type BackendEvent =
  | { type: "status"; payload: StatusPayload }
  | { type: "log"; payload: { level: "info" | "warn" | "error"; message: string } }
  | { type: "execution"; payload: { actionId: string; actionName: string; phase: "start" | "end" } }
  | { type: "capture"; payload: CapturePayload }
  | { type: "error"; payload: { message: string } };

export interface MacroApi {
  getInitialConfig(): Promise<MacroConfig>;
  saveConfig(config: MacroConfig): Promise<MacroConfig>;
  loadConfig(): Promise<MacroConfig>;
  startListening(config: MacroConfig): Promise<StatusPayload>;
  stopListening(): Promise<StatusPayload>;
  testMacro(action: MacroAction, config: MacroConfig): Promise<StatusPayload>;
  capturePosition(delayMs: number): Promise<CapturePayload>;
  openLegacyApp(): Promise<StatusPayload>;
  onEvent(listener: (event: BackendEvent) => void): () => void;
}

declare global {
  interface Window {
    bamt?: MacroApi;
  }
}
