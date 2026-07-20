import { contextBridge, ipcRenderer } from "electron";
import type { BackendEvent, MacroAction, MacroConfig, MacroApi } from "../src/types";

const api: MacroApi = {
  getInitialConfig: () => ipcRenderer.invoke("macro:get-initial-config"),
  saveConfig: (config: MacroConfig) => ipcRenderer.invoke("macro:save-config", config),
  loadConfig: () => ipcRenderer.invoke("macro:load-config"),
  startListening: (config: MacroConfig) => ipcRenderer.invoke("macro:start-listening", config),
  stopListening: () => ipcRenderer.invoke("macro:stop-listening"),
  testMacro: (action: MacroAction, config: MacroConfig) => ipcRenderer.invoke("macro:test-macro", action, config),
  capturePosition: (delayMs: number) => ipcRenderer.invoke("macro:capture-position", delayMs),
  openLegacyApp: () => ipcRenderer.invoke("macro:open-legacy-app"),
  onEvent: (listener: (event: BackendEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: BackendEvent) => listener(event);
    ipcRenderer.on("macro:event", handler);
    return () => ipcRenderer.off("macro:event", handler);
  }
};

contextBridge.exposeInMainWorld("bamt", api);
