import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } from "electron";
import { createIngestServer } from "./ingestServer.js";
import { HookInstaller } from "./hooks.js";
import { PetWindowDragController } from "./petWindowDrag.js";
import { PetWindowDismissals } from "./petWindowLifecycle.js";
import { AppStore, APP_NAME, INGEST_PORT, getDataRoot } from "./storage.js";
import { CHAT_PET_ID } from "../shared/types.js";
import type { AppSettings, AppSnapshot, PetProfile, PetWindowSize } from "../shared/types.js";

const petWindows = new Map<string, BrowserWindow>();
const petWindowDismissals = new PetWindowDismissals();
const petWindowDragController = new PetWindowDragController();
let historyWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let codexChatSession: CodexChatSession | null = null;
let codexChatInFlight = false;

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDirPath, "..", "..");
const preloadEntryPath = path.join(projectRoot, "scripts", "preload.cjs");
const rendererRoot = path.join(projectRoot, "dist-renderer");
const store = new AppStore(projectRoot);
const hookInstaller = new HookInstaller(store, projectRoot);
const ingestServer = createIngestServer(store, () => {
  syncPetWindows();
  broadcastSnapshot();
}, rendererRoot, projectRoot, {
  getSnapshot,
  installHooks: () => hookInstaller.installAll(),
  uninstallHooks: () => hookInstaller.uninstallAll(),
  updatePet: (petId, payload) => store.updatePetProfile(petId, payload)
});
const QUIT_FROM_TASKBAR_ARG = "--vibepet-quit";
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const shouldQuitFromTaskbar = process.argv.includes(QUIT_FROM_TASKBAR_ARG);
const INITIAL_PET_WINDOW_SIZE: PetWindowSize = { width: 160, height: 180 };
const MIN_PET_WINDOW_SIZE: PetWindowSize = { width: 96, height: 96 };
const MAX_PET_WINDOW_SIZE: PetWindowSize = { width: 440, height: 760 };

interface CodexChatSession {
  id: string;
  filePath: string;
}

interface CodexLaunch {
  command: string;
  argsPrefix: string[];
  shell?: boolean;
}

interface CodexRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_NAME);
}
if (!hasSingleInstanceLock || shouldQuitFromTaskbar) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes(QUIT_FROM_TASKBAR_ARG)) {
      app.quit();
      return;
    }

    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    window?.focus();
  });

  app.whenReady().then(async () => {
    configureTaskbarTasks();
    ensureTray();
    await startServer();
    store.ensureChatPet();
    store.ensureStartupPet();
    syncPetWindows();
    broadcastSnapshot();
    store.flushSpool();
    store.resetTransientPetsToIdle();
    syncPetWindows();
    broadcastSnapshot();
    ensureVisibleStartupWindow();

    setInterval(() => {
      if (store.markIdlePets()) {
        broadcastSnapshot();
      }
    }, 5000);
  });
}

app.on("window-all-closed", () => {
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  ingestServer.close();
  tray?.destroy();
  tray = null;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    quitCompletely();
  });
}

ipcMain.handle("snapshot:get", () => getSnapshot());
ipcMain.handle("pet:update", (_event, petId: string, payload: Partial<Pick<PetProfile, "name" | "position" | "gifGroupId">>) => {
  const pet = store.updatePetProfile(petId, payload);
  broadcastSnapshot();
  return pet;
});
ipcMain.on("pet:resize-window", (_event, petId: string, size: PetWindowSize) => resizePetWindow(petId, size));
ipcMain.handle("settings:update", (_event, payload: Partial<AppSettings>) => {
  const settings = store.updateSettings(payload);
  syncPetWindows();
  broadcastSnapshot();
  return settings;
});
ipcMain.handle("ai:submit-prompt", (_event, prompt: string) => submitPromptToCodex(prompt));
ipcMain.handle("hooks:install", () => {
  const status = hookInstaller.installAll();
  broadcastSnapshot();
  return status;
});
ipcMain.handle("hooks:uninstall", () => {
  const status = hookInstaller.uninstallAll();
  broadcastSnapshot();
  return status;
});
ipcMain.on("pet:menu", (_event, petId: string) => {
  const pet = store.getPets().find((item) => item.id === petId);
  const menu = Menu.buildFromTemplate([
    {
      label: pet ? `历史：${pet.name}` : "历史",
      click: () => openHistoryWindow(petId)
    },
    {
      label: "设置",
      click: () => openSettingsWindow()
    },
    {
      label: "设为空闲",
      enabled: !!pet && pet.state !== "idle",
      click: () => {
        if (pet && store.markPetIdle(pet.id)) {
          broadcastSnapshot();
        }
      }
    },
    {
      label: "隐藏",
      click: () => hidePetWindow(petId)
    },
    {
      label: "关闭",
      click: () => closePetWindow(petId)
    },
    {
      label: "安装 Hooks",
      click: () => {
        hookInstaller.installAll();
        broadcastSnapshot();
      }
    },
    {
      label: "卸载 Hooks",
      click: () => {
        hookInstaller.uninstallAll();
        broadcastSnapshot();
      }
    },
    {
      label: "打开数据目录",
      click: async () => {
        await shell.openPath(getDataRoot());
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit()
    }
  ]);
  menu.popup();
});
ipcMain.on("history:open", (_event, petId?: string) => openHistoryWindow(petId));
ipcMain.on("settings:open", () => openSettingsWindow());
ipcMain.on("pet:drag-start", (event, point: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const screenPoint = normalizeScreenPoint(point);
  if (!window || !screenPoint) {
    return;
  }

  petWindowDragController.start(event.sender.id, window, screenPoint);
});
ipcMain.on("pet:drag-move", (event, point: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const screenPoint = normalizeScreenPoint(point);
  if (!window || !screenPoint) {
    return;
  }

  const position = petWindowDragController.move(event.sender.id, screenPoint);
  const petId = findPetIdByWindow(window);
  if (petId && position) {
    persistPetPosition(petId, position);
  }
});
ipcMain.on("pet:drag-end", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const petId = window ? findPetIdByWindow(window) : undefined;
  petWindowDragController.end(event.sender.id);
  if (window && petId) {
    persistPetWindowPosition(petId, window);
  }
});

function getSnapshot(): AppSnapshot {
  return store.getSnapshot(hookInstaller.getStatus());
}

function ensureVisibleStartupWindow(): void {
  const status = hookInstaller.getStatus();
  if (!status.codexInstalled || !status.claudeInstalled) {
    openSettingsWindow();
  }
}

function ensureTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIconImage());
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(createTrayMenu());
  tray.on("click", () => openSettingsWindow());
}

function createTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "打开设置",
      click: () => openSettingsWindow()
    },
    {
      label: "显示所有宠物",
      click: () => showAllPetWindows()
    },
    { type: "separator" },
    {
      label: "完全退出",
      click: () => quitCompletely()
    }
  ]);
}

function createTrayIconImage(): Electron.NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * size + x) * 4;
      if (distance > 7.2) {
        buffer[offset + 3] = 0;
        continue;
      }

      const isEye = (x === 5 || x === 10) && y >= 6 && y <= 8;
      const isMouth = y === 11 && x >= 6 && x <= 9;
      if (isEye || isMouth) {
        buffer[offset] = 30;
        buffer[offset + 1] = 38;
        buffer[offset + 2] = 42;
      } else {
        buffer[offset] = 95;
        buffer[offset + 1] = 169;
        buffer[offset + 2] = 63;
      }
      buffer[offset + 3] = 255;
    }
  }

  const image = nativeImage.createFromBitmap(buffer, {
    width: size,
    height: size,
    scaleFactor: 1
  });
  image.setTemplateImage(false);
  return image;
}

function attachMinimizeToTray(window: BrowserWindow): void {
  window.on("minimize", () => {
    ensureTray();
    window.hide();
  });
}

function showAllPetWindows(): void {
  petWindowDismissals.restoreAll();
  syncPetWindows();
  for (const window of petWindows.values()) {
    if (!window.isDestroyed()) {
      window.show();
    }
  }
}

function quitCompletely(): void {
  isQuitting = true;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
  app.quit();
}

function hidePetWindow(petId: string): void {
  petWindowDismissals.dismiss(petId);
  const window = petWindows.get(petId);
  if (!window || window.isDestroyed()) {
    petWindows.delete(petId);
    return;
  }

  window.close();
}

function closePetWindow(petId: string): void {
  const removed = store.removePetProfile(petId);
  petWindowDismissals.forget(petId);
  const window = petWindows.get(petId);
  if (!window || window.isDestroyed()) {
    petWindows.delete(petId);
  } else {
    window.close();
    petWindows.delete(petId);
  }

  if (removed) {
    broadcastSnapshot();
  }
}

function broadcastSnapshot(): void {
  const snapshot = getSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("snapshot:update", snapshot);
    }
  }
}

function syncPetWindows(): void {
  const pets = store.getPets();
  const knownIds = new Set(pets.map((pet) => pet.id));

  for (const pet of pets) {
    let window = petWindows.get(pet.id);
    if (!petWindowDismissals.shouldCreateWindow(pet.id)) {
      if (window?.isDestroyed()) {
        petWindows.delete(pet.id);
      }
      continue;
    }

    if (!window || window.isDestroyed()) {
      window = createPetWindow(pet);
      petWindows.set(pet.id, window);
    }
  }

  for (const [petId, window] of petWindows.entries()) {
    if (!knownIds.has(petId)) {
      petWindowDismissals.forget(petId);
    }

    if (!knownIds.has(petId) && !window.isDestroyed()) {
      window.close();
      petWindows.delete(petId);
    }
  }
}

function createPetWindow(pet: PetProfile): BrowserWindow {
  const window = new BrowserWindow({
    width: INITIAL_PET_WINDOW_SIZE.width,
    height: INITIAL_PET_WINDOW_SIZE.height,
    x: pet.position.x,
    y: pet.position.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadEntryPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenuBarVisibility(false);
  attachMinimizeToTray(window);
  loadView(window, "pet", pet.id);
  window.on("moved", () => {
    persistPetWindowPosition(pet.id, window);
  });
  window.on("move", () => {
    persistPetWindowPosition(pet.id, window);
  });
  window.on("resized", () => {
    persistPetWindowPosition(pet.id, window);
  });
  window.on("resize", () => {
    persistPetWindowPosition(pet.id, window);
  });
  window.on("closed", () => {
    if (petWindows.get(pet.id) === window) {
      petWindows.delete(pet.id);
    }
  });
  window.on("close", () => {
    petWindowDismissals.markClosed({
      petId: pet.id,
      isQuitting,
      petStillExists: store.getPets().some((candidate) => candidate.id === pet.id)
    });
  });
  return window;
}

function persistPetWindowPosition(petId: string, window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  const [x, y] = window.getPosition();
  persistPetPosition(petId, { x, y });
}

function persistPetPosition(petId: string, position: { x: number; y: number }): void {
  const pet = store.getPets().find((candidate) => candidate.id === petId);
  if (pet?.position.x === position.x && pet.position.y === position.y) {
    return;
  }

  store.updatePetProfile(petId, { position });
  broadcastSnapshot();
}

function findPetIdByWindow(targetWindow: BrowserWindow): string | undefined {
  for (const [petId, window] of petWindows.entries()) {
    if (window === targetWindow) {
      return petId;
    }
  }
  return undefined;
}

function resizePetWindow(petId: string, size: PetWindowSize): void {
  const window = petWindows.get(petId);
  if (!window || window.isDestroyed()) {
    return;
  }

  const width = clampWindowSize(size.width, MIN_PET_WINDOW_SIZE.width, MAX_PET_WINDOW_SIZE.width);
  const height = clampWindowSize(size.height, MIN_PET_WINDOW_SIZE.height, MAX_PET_WINDOW_SIZE.height);
  const [currentWidth, currentHeight] = window.getSize();
  if (currentWidth === width && currentHeight === height) {
    return;
  }

  window.setSize(width, height);
}

function openHistoryWindow(petId?: string): void {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.restore();
    historyWindow.focus();
    historyWindow.webContents.send("history:focus", petId ?? "");
    return;
  }

  historyWindow = new BrowserWindow({
    width: 520,
    height: 680,
    title: "VibePet History",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadEntryPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  attachMinimizeToTray(historyWindow);
  loadView(historyWindow, "history", petId);
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.restore();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 720,
    title: "VibePet Settings",
    autoHideMenuBar: true,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadEntryPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  attachMinimizeToTray(settingsWindow);
  loadView(settingsWindow, "settings");
}

function loadView(window: BrowserWindow, view: "pet" | "history" | "settings", petId?: string): void {
  const target = new URL(getRendererEntry());
  target.searchParams.set("view", view);
  if (petId) {
    target.searchParams.set("petId", petId);
  }
  attachRendererDiagnostics(window, view);
  window.loadURL(target.toString());
}

function getRendererEntry(): string {
  const devServerUrl = process.env.VIBEPET_RENDERER_URL?.trim();
  if (devServerUrl) {
    return devServerUrl.endsWith("/") ? devServerUrl : `${devServerUrl}/`;
  }

  return `http://127.0.0.1:${INGEST_PORT}/`;
}

function attachRendererDiagnostics(window: BrowserWindow, view: string): void {
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[VibePet:${view}] load failed ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  window.webContents.on("console-message", (details) => {
    console.log(`[VibePet:${view}] console(${details.level}) ${details.message} ${details.sourceId}:${details.lineNumber}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[VibePet:${view}] renderer gone ${details.reason}`);
  });
}

async function startServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    ingestServer.listen(INGEST_PORT, "127.0.0.1", () => resolve());
  });
}

async function submitPromptToCodex(rawPrompt: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
  if (!prompt) {
    return { ok: false, error: "Prompt is empty" };
  }

  if (codexChatInFlight) {
    return { ok: false, error: "Codex is still working on the previous prompt" };
  }

  const codexLaunch = resolveCodexLaunch();
  if (!codexLaunch) {
    return { ok: false, error: "Codex executable was not found in PATH" };
  }

  codexChatInFlight = true;
  const startedAt = Date.now();
  const args = codexChatSession
    ? ["exec", "resume", codexChatSession.id, "-"]
    : ["exec", "--cd", projectRoot, "-"];

  try {
    store.ensureChatPet();
    store.setPetState(CHAT_PET_ID, "working");
    syncPetWindows();
    broadcastSnapshot();

    const result = await runCodexProcess(codexLaunch, args, prompt);
    const session = codexChatSession ?? findCodexSessionForPrompt(prompt, startedAt);
    if (session) {
      codexChatSession = session;
    }

    const output = session ? readLastCodexMessage(session.filePath) : "";
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: summarizeCodexFailure(result.stderr || result.stdout || `Codex exited with code ${result.exitCode}`)
      };
    }

    return {
      ok: true,
      output: output || result.stdout.trim() || "Codex finished without a final message."
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    store.setPetState(CHAT_PET_ID, "completed");
    broadcastSnapshot();
    codexChatInFlight = false;
  }
}

function resolveCodexLaunch(): CodexLaunch | undefined {
  if (process.platform === "win32") {
    const codexShim = findExecutableOnPath("codex.cmd") ?? findExecutableOnPath("codex");
    if (codexShim) {
      const shimDir = path.dirname(codexShim);
      const nativeCodex = path.join(
        shimDir,
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      );
      if (fs.existsSync(nativeCodex)) {
        return { command: nativeCodex, argsPrefix: [] };
      }

      const codexScript = path.join(shimDir, "node_modules", "@openai", "codex", "bin", "codex.js");
      const bundledNode = path.join(shimDir, "node.exe");
      const nodeCommand = fs.existsSync(bundledNode) ? bundledNode : findExecutableOnPath("node.exe") ?? findExecutableOnPath("node");
      if (fs.existsSync(codexScript) && nodeCommand) {
        return { command: nodeCommand, argsPrefix: [codexScript] };
      }

      return { command: codexShim, argsPrefix: [], shell: true };
    }
  }

  const codexCommand = findExecutableOnPath("codex");
  return codexCommand ? { command: codexCommand, argsPrefix: [] } : undefined;
}

function runCodexProcess(launch: CodexLaunch, args: string[], prompt: string): Promise<CodexRunResult> {
  return new Promise((resolve, reject) => {
    const commandArgs = [...launch.argsPrefix, ...args];
    const child = launch.shell
      ? spawn(toCommandLine([launch.command, ...commandArgs]), [], {
          cwd: projectRoot,
          env: {
            ...process.env,
            VIBEPET_SUPPRESS_HOOKS: "1"
          },
          shell: true,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        })
      : spawn(launch.command, commandArgs, {
          cwd: projectRoot,
          env: {
            ...process.env,
            VIBEPET_SUPPRESS_HOOKS: "1"
          },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        });
    let stdout = "";
    let stderr = "";

    child.once("error", (error) => {
      reject(error);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin?.end(prompt);
  });
}

function findCodexSessionForPrompt(prompt: string, startedAt: number): CodexChatSession | undefined {
  const candidates = listCodexSessionFiles()
    .filter((file) => file.mtimeMs >= startedAt - 2000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of candidates) {
    const id = extractCodexSessionId(candidate.filePath);
    if (id && sessionContainsUserPrompt(candidate.filePath, prompt)) {
      return { id, filePath: candidate.filePath };
    }
  }

  const fallback = candidates.find((candidate) => extractCodexSessionId(candidate.filePath));
  return fallback ? { id: extractCodexSessionId(fallback.filePath)!, filePath: fallback.filePath } : undefined;
}

function listCodexSessionFiles(): Array<{ filePath: string; mtimeMs: number }> {
  const sessionsRoot = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "sessions");
  const results: Array<{ filePath: string; mtimeMs: number }> = [];
  collectCodexSessionFiles(sessionsRoot, results);
  return results;
}

function collectCodexSessionFiles(directory: string, results: Array<{ filePath: string; mtimeMs: number }>): void {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectCodexSessionFiles(entryPath, results);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const stat = fs.statSync(entryPath);
    results.push({ filePath: entryPath, mtimeMs: stat.mtimeMs });
  }
}

function sessionContainsUserPrompt(filePath: string, prompt: string): boolean {
  return readJsonl(filePath).some((record) => {
    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      return false;
    }

    if (payload.type === "user_message" && payload.message === prompt) {
      return true;
    }

    if (payload.type === "message" && payload.role === "user" && Array.isArray(payload.content)) {
      return payload.content.some((item) => item?.type === "input_text" && item.text === prompt);
    }

    return false;
  });
}

function readLastCodexMessage(filePath: string): string {
  let lastMessage = "";
  for (const record of readJsonl(filePath)) {
    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      continue;
    }

    if (payload.type === "task_complete" && typeof payload.last_agent_message === "string") {
      lastMessage = payload.last_agent_message;
    } else if (payload.type === "agent_message" && typeof payload.message === "string") {
      lastMessage = payload.message;
    }
  }
  return lastMessage.trim();
}

function readJsonl(filePath: string): Array<{ payload?: Record<string, any> }> {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as { payload?: Record<string, any> }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function extractCodexSessionId(filePath: string): string | undefined {
  return path.basename(filePath).match(/rollout-.*-([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.jsonl$/i)?.[1];
}

function summarizeCodexFailure(value: string): string {
  const text = value.trim();
  if (!text) {
    return "Codex failed without an error message.";
  }

  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function findExecutableOnPath(command: string): string | undefined {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const commandHasExtension = path.extname(command).length > 0;

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    for (const extension of commandHasExtension ? [""] : extensions) {
      const candidate = path.join(directory, `${command}${extension.toLowerCase()}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function toCommandLine(parts: string[]): string {
  return parts.map(quoteShellArg).join(" ");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function configureTaskbarTasks(): void {
  if (process.platform !== "win32") {
    return;
  }

  app.setUserTasks([
    {
      program: process.execPath,
      arguments: `${getAppLaunchArgument()} ${QUIT_FROM_TASKBAR_ARG}`.trim(),
      iconPath: process.execPath,
      iconIndex: 0,
      title: `退出 ${APP_NAME}`,
      description: `关闭 ${APP_NAME}`
    }
  ]);
}

function getAppLaunchArgument(): string {
  if (!process.defaultApp) {
    return "";
  }

  return `"${app.getAppPath()}"`;
}

function clampWindowSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeScreenPoint(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const x = (value as Record<string, unknown>).x;
  const y = (value as Record<string, unknown>).y;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }

  return { x, y };
}
