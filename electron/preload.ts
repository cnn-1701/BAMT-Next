import { contextBridge, ipcRenderer } from "electron";
import type { BackendEvent, MacroAction, MacroConfig, MacroApi } from "../src/types";

const api: MacroApi = {
  getStoragePaths: () => ipcRenderer.invoke("macro:get-storage-paths"),
  loadPresetLibrary: () => ipcRenderer.invoke("macro:load-preset-library"),
  savePresetLibrary: (presets: unknown[]) => ipcRenderer.invoke("macro:save-preset-library", presets),
  exportPresetPackage: (filename: string, value: unknown) => ipcRenderer.invoke("macro:export-preset-package", filename, value),
  saveTimelineFile: (filename: string, value: unknown) => ipcRenderer.invoke("macro:save-timeline-file", filename, value),
  pickTimelineFile: () => ipcRenderer.invoke("macro:pick-timeline-file"),
  pickPresetPackage: () => ipcRenderer.invoke("macro:pick-preset-package"),
  openDataDir: () => ipcRenderer.invoke("macro:open-data-dir"),
  openLogDir: () => ipcRenderer.invoke("macro:open-log-dir"),
  getInitialConfig: () => ipcRenderer.invoke("macro:get-initial-config"),
  saveConfig: (config: MacroConfig) => ipcRenderer.invoke("macro:save-config", config),
  loadConfig: () => ipcRenderer.invoke("macro:load-config"),
  startListening: (config: MacroConfig) => ipcRenderer.invoke("macro:start-listening", config),
  stopListening: () => ipcRenderer.invoke("macro:stop-listening"),
  testMacro: (action: MacroAction, config: MacroConfig) => ipcRenderer.invoke("macro:test-macro", action, config),
  capturePosition: (delayMs: number) => ipcRenderer.invoke("macro:capture-position", delayMs),
  openScheduleTool: () => ipcRenderer.invoke("macro:open-schedule-tool"),
  openTimelinePreview: (text: string) => ipcRenderer.invoke("macro:open-timeline-preview", text),
  setTimelinePreviewAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke("macro:set-timeline-preview-always-on-top", enabled),
  runAhkScript: (script: string) => ipcRenderer.invoke("macro:run-ahk-script", script),
  stopAhkScript: () => ipcRenderer.invoke("macro:stop-ahk-script"),
  onEvent: (listener: (event: BackendEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: BackendEvent) => listener(event);
    ipcRenderer.on("macro:event", handler);
    return () => ipcRenderer.off("macro:event", handler);
  }
};

contextBridge.exposeInMainWorld("bamt", api);
