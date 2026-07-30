import { app, BrowserWindow, ipcMain, shell, dialog, type OpenDialogOptions } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { BackendEvent, CapturePayload, MacroAction, MacroConfig, StatusPayload } from "../src/types";

const isDev = !app.isPackaged;
const appDir = app.getAppPath();
const resourcesDir = process.resourcesPath;
const preloadPath = path.join(appDir, "dist-electron", "electron", "preload.js");
const projectDir = isDev ? appDir : path.dirname(process.execPath);
const dataRoot = isDev ? appDir : app.getPath("userData");
const dataDir = path.join(dataRoot, "data");
const configDir = path.join(dataDir, "config");
const presetDir = path.join(dataDir, "presets");
const presetImportDir = path.join(dataDir, "imports");
const presetExportDir = path.join(dataDir, "exports");
const ahkDataDir = path.join(dataDir, "ahk");
const timelineDir = path.join(dataDir, "timelines");
const configPath = path.join(configDir, "blue_archive_config.json");
const presetLibraryPath = path.join(presetDir, "preset-library.json");

let mainWindow: BrowserWindow | null = null;
let backend: MacroBackend | null = null;
let ahkProcess: ChildProcessWithoutNullStreams | null = null;
let timelinePreviewWindow: BrowserWindow | null = null;

function ahkCandidates(): string[] {
  const candidates = [
    process.env.BAMT_AHK,
    path.join(appDir, "tools", "AutoHotkey", "AutoHotkey64.exe"),
    path.join(resourcesDir, "AutoHotkey", "AutoHotkey64.exe"),
    "AutoHotkey64.exe",
    "AutoHotkey.exe"
  ].filter(Boolean) as string[];
  return [...new Set(candidates)];
}



function rustBackendCandidates(): string[] {
  const exeName = "bamt-rust-backend.exe";
  const candidates = [
    process.env.BAMT_RUST_BACKEND,
    path.join(appDir, "rust-backend", "target", "release", exeName),
    path.join(projectDir, "rust-backend", "target", "release", exeName),
    path.join(appDir, "tools", "rust-backend", exeName),
    path.join(projectDir, "tools", "rust-backend", exeName),
    path.join(resourcesDir, "rust-backend", exeName)
  ].filter(Boolean) as string[];
  return [...new Set(candidates)];
}
function ensureDataDirs(): void {
  for (const dir of [dataDir, configDir, presetDir, presetImportDir, presetExportDir, ahkDataDir, timelineDir]) fs.mkdirSync(dir, { recursive: true });
}

function safeTimelineName(filename: string): string {
  const base = path.basename(String(filename || "timeline.json")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return base.toLowerCase().endsWith(".json") ? base : base + ".json";
}

function safeExportName(filename: string): string {
  const base = path.basename(String(filename || "bamt-presets.json")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return base.toLowerCase().endsWith(".json") ? base : base + ".json";
}

function readPresetLibrary(): unknown[] {
  ensureDataDirs();
  if (!fs.existsSync(presetLibraryPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(presetLibraryPath, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function writePresetLibrary(presets: unknown): void {
  ensureDataDirs();
  fs.writeFileSync(presetLibraryPath, JSON.stringify(Array.isArray(presets) ? presets : [], null, 2), "utf8");
}

function storagePaths() {
  return {
    projectDir,
    dataDir,
    configPath,
    presetLibraryPath,
    presetImportDir,
    presetExportDir,
    ahkDataDir,
    timelineDir,
    relative: {
      dataDir: isDev ? "data" : "%APPDATA%/BAMT Next/data",
      configPath: isDev ? "data/config/blue_archive_config.json" : "%APPDATA%/BAMT Next/data/config/blue_archive_config.json",
      presetLibraryPath: isDev ? "data/presets/preset-library.json" : "%APPDATA%/BAMT Next/data/presets/preset-library.json",
      presetImportDir: isDev ? "data/imports" : "%APPDATA%/BAMT Next/data/imports",
      presetExportDir: isDev ? "data/exports" : "%APPDATA%/BAMT Next/data/exports",
      ahkDataDir: isDev ? "data/ahk" : "%APPDATA%/BAMT Next/data/ahk",
      timelineDir: isDev ? "data/timelines" : "%APPDATA%/BAMT Next/data/timelines"
    }
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function timelinePreviewHtml(text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>鎺掕酱鏂囨湰棰勮</title><style>
    body{margin:0;background:#f5f9fc;color:#18324a;font-family:"Microsoft YaHei",Segoe UI,sans-serif;}
    header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(245,249,252,.94);backdrop-filter:blur(12px);border-bottom:1px solid #d6e6f3;padding:14px 18px;}
    h1{margin:0;font-size:20px;} button{min-height:36px;padding:0 14px;border:1px solid #9fc8e8;border-radius:8px;background:#e8f6ff;color:#0b73af;font-weight:800;cursor:pointer;}
    button.active{background:#17314a;color:white;border-color:#17314a;} pre{white-space:pre-wrap;margin:0;padding:22px 24px;font:18px/1.78 Consolas,"Microsoft YaHei",monospace;}
  </style></head><body><header><h1>鎺掕酱鏂囨湰棰勮</h1><button id="topmost" class="active">缃《宸插紑鍚?/button></header><pre>${escapeHtml(text)}</pre><script>
    let enabled = true;
    const button = document.getElementById("topmost");
    button.addEventListener("click", async () => {
      enabled = !enabled;
      const result = await window.bamt?.setTimelinePreviewAlwaysOnTop?.(enabled);
      button.classList.toggle("active", enabled);
      button.textContent = enabled ? "缃《宸插紑鍚? : "缃《宸插叧闂?;
      if (!result) button.textContent = "缃《鎺у埗涓嶅彲鐢?;
    });
  </script></body></html>`;
}

async function spawnAhk(command: string, scriptPath: string): Promise<{ child: ChildProcessWithoutNullStreams | null; completed: boolean }> {
  if (path.isAbsolute(command) && !fs.existsSync(command)) throw new Error("AutoHotkey executable not found");
  const child = spawn(command, [scriptPath], { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); child.off("error", fail); child.off("exit", exitEarly); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const exitEarly = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ child: null, completed: true });
      else reject(new Error(`AutoHotkey exited before ready. code=${code ?? "null"} ${stderr}`));
    };
    const timer = setTimeout(() => { if (settled) return; settled = true; cleanup(); resolve({ child, completed: false }); }, 500);
    child.once("error", fail);
    child.once("exit", exitEarly);
  });
}

class MacroBackend {
  private child: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  constructor(private readonly onEvent: (event: BackendEvent) => void) {}
  async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    const errors: string[] = [];
    for (const command of rustBackendCandidates()) {
      try { await this.spawnRustWith(command); return; }
      catch (error) { errors.push(`${command}: ${String(error)}`); }
    }
    throw new Error(`Cannot start Rust backend. Set BAMT_RUST_BACKEND to bamt-rust-backend.exe. Tried:\n${errors.join("\n")}`);
  }
  async request<T>(command: string, payload?: unknown): Promise<T> {
    await this.ensureStarted();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child?.stdin.write(`${JSON.stringify({ id, command, payload })}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  stop(): void {
    if (!this.child) return;
    try { this.child.stdin.write(`${JSON.stringify({ id: ++this.seq, command: "shutdown" })}\n`); } catch {}
    this.child.kill();
    this.child = null;
  }
  private async spawnRustWith(command: string): Promise<void> {
    if (path.isAbsolute(command) && !fs.existsSync(command)) throw new Error("Rust backend executable not found");
    ensureDataDirs();
    const child = spawn(command, [], { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, BAMT_CONFIG_PATH: configPath } });
    this.onEvent({ type: "log", payload: { level: "info", message: `Rust backend exe: ${command}; config: ${configPath}` } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("exit", (code, signal) => {
      const detail = stderr.trim() ? ` stderr=${stderr.trim()}` : "";
      this.onEvent({ type: "log", payload: { level: code === 0 ? "info" : "error", message: `Rust backend exited: ${command} code=${code ?? "null"} signal=${signal ?? "null"}${detail}` } });
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); this.child = child; this.attachReaders(child); resolve(); }, 700);
      const fail = (error: Error) => { cleanup(); reject(error); };
      const exitEarly = (code: number | null) => { cleanup(); reject(new Error(`${command} exited before ready. code=${code ?? "null"} ${stderr}`)); };
      const cleanup = () => { clearTimeout(timer); child.off("error", fail); child.off("exit", exitEarly); };
      child.once("error", fail);
      child.once("exit", exitEarly);
    });
  }

  private attachReaders(child: ChildProcessWithoutNullStreams): void {
    child.stderr.on("data", (chunk) => this.onEvent({ type: "log", payload: { level: "error", message: chunk.toString("utf8") } }));
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string; event?: BackendEvent };
        if (message.event) { this.onEvent(message.event); return; }
        if (typeof message.id === "number" && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error ?? "Backend returned an unknown error"));
        }
      } catch (error) {
        this.onEvent({ type: "log", payload: { level: "warn", message: `Failed to parse backend output: ${String(error)} | raw=${line.slice(0, 160)}` } });
      }
    });
    child.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) pending.reject(new Error("Backend process exited"));
      this.pending.clear(); this.child = null;
      this.onEvent({ type: "status", payload: { status: "unavailable", message: `Backend process exited code=${code ?? "null"} signal=${signal ?? "null"}` } });
    });
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({ width: 1360, height: 860, minWidth: 1060, minHeight: 720, title: "BAMT Next", backgroundColor: "#edf5fb", webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false } });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details.reason, details.exitCode);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load ${url}: ${code} ${description}`);
  });
  if (isDev) await mainWindow.loadURL("http://127.0.0.1:5173");
  else await mainWindow.loadFile(path.join(appDir, "dist", "index.html"));
}
function emit(event: BackendEvent): void { mainWindow?.webContents.send("macro:event", event); }
function registerIpc(): void {
  ensureDataDirs();
  backend = new MacroBackend(emit);
  ipcMain.handle("macro:get-storage-paths", async () => storagePaths());
  ipcMain.handle("macro:load-preset-library", async () => readPresetLibrary());
  ipcMain.handle("macro:save-preset-library", async (_, presets: unknown) => {
    writePresetLibrary(presets);
    return { status: "ready", message: "宏预设库已保存到 data/presets/preset-library.json" };
  });
  ipcMain.handle("macro:save-timeline-file", async (_, filename: string, value: unknown) => {
    ensureDataDirs();
    const outPath = path.join(timelineDir, safeTimelineName(filename));
    fs.writeFileSync(outPath, JSON.stringify(value, null, 2), "utf8");
    return { status: "ready", message: "排轴已自动保存：data/timelines/" + path.basename(outPath) };
  });
  ipcMain.handle("macro:pick-timeline-file", async () => {
    ensureDataDirs();
    const options: OpenDialogOptions = { title: "选择排轴 JSON", defaultPath: timelineDir, properties: ["openFile"], filters: [{ name: "BAMT 排轴", extensions: ["json"] }, { name: "全部文件", extensions: ["*"] }] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return { name: path.basename(filePath), path: filePath, text: fs.readFileSync(filePath, "utf8") };
  });
  ipcMain.handle("macro:pick-preset-package", async () => {
    ensureDataDirs();
    const dialogOptions: OpenDialogOptions = {
      title: "选择要导入的 BAMT 宏预设",
      defaultPath: presetImportDir,
      properties: ["openFile"],
      filters: [
        { name: "BAMT / AHK 预设", extensions: ["json", "ahk"] },
        { name: "全部文件", extensions: ["*"] }
      ]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return { name: path.basename(filePath), path: filePath, text: fs.readFileSync(filePath, "utf8") };
  });
  ipcMain.handle("macro:export-preset-package", async (_, filename: string, value: unknown) => {
    ensureDataDirs();
    const outPath = path.join(presetExportDir, safeExportName(filename));
    fs.writeFileSync(outPath, JSON.stringify(value, null, 2), "utf8");
    return { status: "ready", message: "宏预设已导出：" + outPath };
  });
  ipcMain.handle("macro:open-data-dir", async () => {
    ensureDataDirs();
    const error = await shell.openPath(dataDir);
    return error ? { status: "error", message: error } : { status: "ready", message: "已打开数据目录" };
  });
  ipcMain.handle("macro:get-initial-config", async () => backend!.request<MacroConfig>("get_initial_config"));
  ipcMain.handle("macro:save-config", async (_, config: MacroConfig) => backend!.request<MacroConfig>("save_config", config));
  ipcMain.handle("macro:load-config", async () => backend!.request<MacroConfig>("load_config"));
  ipcMain.handle("macro:start-listening", async (_, config: MacroConfig) => backend!.request<StatusPayload>("start_listening", config));
  ipcMain.handle("macro:stop-listening", async () => backend!.request<StatusPayload>("stop_listening"));
  ipcMain.handle("macro:test-macro", async (_, action: MacroAction, config: MacroConfig) => backend!.request<StatusPayload>("test_macro", { action, config }));
  ipcMain.handle("macro:capture-position", async (_, delayMs: number) => backend!.request<CapturePayload>("capture_position", { delayMs }));
  ipcMain.handle("macro:open-schedule-tool", async () => ({ status: "ready", message: "排轴编辑器已内置在侧边栏中" }));
  ipcMain.handle("macro:open-timeline-preview", async (_, text: string) => {
    if (timelinePreviewWindow && !timelinePreviewWindow.isDestroyed()) {
      await timelinePreviewWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(timelinePreviewHtml(String(text || ""))));
      timelinePreviewWindow.setAlwaysOnTop(true, "screen-saver");
      timelinePreviewWindow.show();
      timelinePreviewWindow.focus();
      return { status: "ready", message: "已刷新独立排轴预览窗口" };
    }
    timelinePreviewWindow = new BrowserWindow({
      width: 680,
      height: 760,
      minWidth: 360,
      minHeight: 420,
      title: "排轴文本预览",
      backgroundColor: "#f5f9fc",
      alwaysOnTop: true,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
    });
    timelinePreviewWindow.setAlwaysOnTop(true, "screen-saver");
    timelinePreviewWindow.once("closed", () => { timelinePreviewWindow = null; });
    await timelinePreviewWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(timelinePreviewHtml(String(text || ""))));
    timelinePreviewWindow.show();
    timelinePreviewWindow.focus();
    return { status: "ready", message: "已打开置顶排轴预览窗口" };
  });
  ipcMain.handle("macro:set-timeline-preview-always-on-top", async (_, enabled: boolean) => {
    if (!timelinePreviewWindow || timelinePreviewWindow.isDestroyed()) return { status: "error", message: "排轴预览窗口未打开" };
    timelinePreviewWindow.setAlwaysOnTop(Boolean(enabled), "screen-saver");
    return { status: "ready", message: Boolean(enabled) ? "排轴预览窗口已置顶" : "排轴预览窗口已取消置顶" };
  });
  ipcMain.handle("macro:run-ahk-script", async (_, script: string) => {
    if (ahkProcess && !ahkProcess.killed) ahkProcess.kill();
    ensureDataDirs();
    const scriptPath = path.join(ahkDataDir, "bamt-inline.ahk");
    fs.writeFileSync(scriptPath, script, "utf8");
    const errors: string[] = [];
    for (const command of ahkCandidates()) {
      try {
        const result = await spawnAhk(command, scriptPath);
        if (result.child) {
          ahkProcess = result.child;
          result.child.once("exit", () => { if (ahkProcess === result.child) ahkProcess = null; });
          return { status: "ready", message: "AHK 脚本已运行：" + command };
        }
        return { status: "stopped", message: "AHK 脚本已执行并正常退出：" + command };
      } catch (error) {
        errors.push(command + ": " + String(error instanceof Error ? error.message : error));
      }
    }
    return { status: "error", message: "找不到可用的 AutoHotkey v2。请安装 AHK v2，或设置 BAMT_AHK 指向 AutoHotkey64.exe。\n" + errors.join("\n") };
  });
  ipcMain.handle("macro:stop-ahk-script", async () => {
    if (!ahkProcess || ahkProcess.killed) return { status: "stopped", message: "没有正在运行的 AHK 脚本" };
    ahkProcess.kill();
    ahkProcess = null;
    return { status: "stopped", message: "AHK 脚本已停止" };
  });
}
app.whenReady().then(async () => { registerIpc(); await createWindow(); });
app.on("window-all-closed", () => { backend?.stop(); if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { backend?.stop(); ahkProcess?.kill(); timelinePreviewWindow?.close(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });





