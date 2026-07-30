export type MacroType = "point" | "drag" | "autoClick" | "click" | "fastPlay" | "script";
export type BackendStatus = "booting" | "ready" | "listening" | "stopped" | "error" | "unavailable";
export type InputBackend = "cursor" | "windowMessage" | "touch";

export interface Resolution {
  width: number;
  height: number;
}

export interface MacroAction {
  id: string;
  name: string;
  hotkey: string;
  type: MacroType;
  cardKey?: string;
  targetX: number;
  targetY: number;
  dragDistance: number;
  dragDuration: number;
  clickGap: number;
  cardClickGap: number;
  loopGap: number;
  enabled: boolean;
  script?: string;
}

export interface MacroConfig {
  version: string;
  resolution: Resolution;
  exitKey: string;
  inputTakeoverEnabled: boolean;
  inputBackend: InputBackend;
  skillSlotXOffsets: number[];
  skillSlotBottomOffsetRatio: number;
  smoothMoveMinSteps: number;
  smoothMoveStepRate: number;
  actions: MacroAction[];
}

export interface StatusPayload {
  status: BackendStatus;
  message: string;
}

export interface PresetFilePayload {
  name: string;
  path: string;
  text: string;
}

export interface StoragePaths {
  projectDir: string;
  dataDir: string;
  configPath: string;
  presetLibraryPath: string;
  presetImportDir: string;
  presetExportDir: string;
  ahkDataDir: string;
  timelineDir: string;
  relative: {
    dataDir: string;
    configPath: string;
    presetLibraryPath: string;
    presetImportDir: string;
    presetExportDir: string;
    ahkDataDir: string;
    timelineDir: string;
  };
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
  getStoragePaths(): Promise<StoragePaths>;
  loadPresetLibrary(): Promise<unknown[]>;
  savePresetLibrary(presets: unknown[]): Promise<StatusPayload>;
  exportPresetPackage(filename: string, value: unknown): Promise<StatusPayload>;
  saveTimelineFile(filename: string, value: unknown): Promise<StatusPayload>;
  pickTimelineFile(): Promise<PresetFilePayload | null>;
  pickPresetPackage(): Promise<PresetFilePayload | null>;
  openDataDir(): Promise<StatusPayload>;
  getInitialConfig(): Promise<MacroConfig>;
  saveConfig(config: MacroConfig): Promise<MacroConfig>;
  loadConfig(): Promise<MacroConfig>;
  startListening(config: MacroConfig): Promise<StatusPayload>;
  stopListening(): Promise<StatusPayload>;
  testMacro(action: MacroAction, config: MacroConfig): Promise<StatusPayload>;
  capturePosition(delayMs: number): Promise<CapturePayload>;
  openScheduleTool(): Promise<StatusPayload>;
  openTimelinePreview(text: string): Promise<StatusPayload>;
  setTimelinePreviewAlwaysOnTop(enabled: boolean): Promise<StatusPayload>;
  runAhkScript(script: string): Promise<StatusPayload>;
  stopAhkScript(): Promise<StatusPayload>;
  runRustFastPlayDemo(): Promise<StatusPayload>;
  stopRustFastPlayDemo(): Promise<StatusPayload>;
  onEvent(listener: (event: BackendEvent) => void): () => void;
}

declare global {
  interface Window {
    bamt?: MacroApi;
  }
}

