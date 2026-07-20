import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { BackendEvent, CapturePayload, MacroAction, MacroConfig, StatusPayload } from "../src/types";

const isDev = !app.isPackaged;
const appDir = app.getAppPath();
const resourcesDir = process.resourcesPath;
const backendDir = isDev ? path.join(appDir, "backend") : path.join(resourcesDir, "backend");
const preloadPath = path.join(appDir, "dist-electron", "electron", "preload.js");
const projectDir = isDev ? appDir : path.dirname(process.execPath);
const configPath = path.join(app.getPath("userData"), "blue_archive_config.json");
const legacyConfigPath = path.join(projectDir, "BAMTb", "BAMT", "blue_archive_config.json");
const legacyExePath = path.join(projectDir, "BAMTb", "BAMT", "BlueArchiveMacroTool.exe");

let mainWindow: BrowserWindow | null = null;
let backend: MacroBackend | null = null;

class MacroBackend {
  private child: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly onEvent: (event: BackendEvent) => void) {}

  async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    const backendPath = path.join(backendDir, "macro_service.py");
    if (!fs.existsSync(backendPath)) throw new Error(`找不到后端服务：${backendPath}`);
    const candidates = process.env.BAMT_PYTHON ? [process.env.BAMT_PYTHON] : ["python", "py", "python3"];
    let lastError: unknown;
    for (const command of candidates) {
      try {
        await this.spawnWith(command, backendPath);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`无法启动 Python 后端。请安装 Python 3 并执行 pip install -r backend/requirements.txt。${String(lastError)}`);
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
    try {
      this.child.stdin.write(`${JSON.stringify({ id: ++this.seq, command: "shutdown" })}\n`);
    } catch {
      // Process may already be closed.
    }
    this.child.kill();
    this.child = null;
  }

  private async spawnWith(command: string, backendPath: string): Promise<void> {
    const args = command === "py" ? ["-3", backendPath] : [backendPath];
    const child = spawn(command, args, {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, BAMT_CONFIG_PATH: configPath, BAMT_LEGACY_CONFIG_PATH: legacyConfigPath, PYTHONIOENCODING: "utf-8" }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${command} 启动超时`)), 2500);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.once("error", fail);
      child.once("spawn", () => {
        child.off("error", fail);
        clearTimeout(timer);
        this.child = child;
        this.attachReaders(child);
        resolve();
      });
    });
  }

  private attachReaders(child: ChildProcessWithoutNullStreams): void {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string; event?: BackendEvent };
        if (message.event) {
          this.onEvent(message.event);
          return;
        }
        if (typeof message.id === "number" && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error ?? "后端返回未知错误"));
        }
      } catch (error) {
        this.onEvent({ type: "log", payload: { level: "warn", message: `后端输出解析失败：${String(error)}` } });
      }
    });

    child.stderr.on("data", (chunk) => this.onEvent({ type: "log", payload: { level: "error", message: chunk.toString("utf8") } }));
    child.on("exit", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("后端进程已退出"));
      this.pending.clear();
      this.child = null;
      this.onEvent({ type: "status", payload: { status: "unavailable", message: "后端进程已退出" } });
    });
  }
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    title: "BAMT Next",
    backgroundColor: "#f5f7fb",
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
  });
  if (isDev) await mainWindow.loadURL("http://127.0.0.1:5173");
  else await mainWindow.loadFile(path.join(appDir, "dist", "index.html"));
}

function emit(event: BackendEvent): void {
  mainWindow?.webContents.send("macro:event", event);
}

function registerIpc(): void {
  backend = new MacroBackend(emit);
  ipcMain.handle("macro:get-initial-config", async () => backend!.request<MacroConfig>("get_initial_config"));
  ipcMain.handle("macro:save-config", async (_, config: MacroConfig) => backend!.request<MacroConfig>("save_config", config));
  ipcMain.handle("macro:load-config", async () => backend!.request<MacroConfig>("load_config"));
  ipcMain.handle("macro:start-listening", async (_, config: MacroConfig) => backend!.request<StatusPayload>("start_listening", config));
  ipcMain.handle("macro:stop-listening", async () => backend!.request<StatusPayload>("stop_listening"));
  ipcMain.handle("macro:test-macro", async (_, action: MacroAction, config: MacroConfig) => backend!.request<StatusPayload>("test_macro", { action, config }));
  ipcMain.handle("macro:capture-position", async (_, delayMs: number) => backend!.request<CapturePayload>("capture_position", { delayMs }));
  ipcMain.handle("macro:open-legacy-app", async () => {
    if (!fs.existsSync(legacyExePath)) return { status: "error", message: "找不到旧版 EXE" };
    const error = await shell.openPath(legacyExePath);
    return error ? { status: "error", message: error } : { status: "ready", message: "已打开旧版工具" };
  });
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => {
  backend?.stop();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => backend?.stop());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
