import fs from "node:fs";
import path from "node:path";
import type { AppStore } from "./storage.js";

type JsonObject = Record<string, unknown>;

const HOOK_MARKER = "vibepet-managed";
const MANAGED_EVENT_NAMES = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd", "SessionExit", "Interrupt", "Abort", "Cancel"];

export interface HookInstallStatus {
  codexInstalled: boolean;
  claudeInstalled: boolean;
}

export class HookInstaller {
  constructor(private readonly store: AppStore, private readonly projectRoot: string) {}

  getStatus(): HookInstallStatus {
    return {
      codexInstalled: this.hasCodexHooks(),
      claudeInstalled: this.hasClaudeHooks()
    };
  }

  installAll(): HookInstallStatus {
    this.installCodexHooks();
    this.installClaudeHooks();
    return this.getStatus();
  }

  uninstallAll(): HookInstallStatus {
    this.uninstallCodexHooks();
    this.uninstallClaudeHooks();
    return this.getStatus();
  }

  private installCodexHooks(): void {
    const codexDir = path.join(process.env.USERPROFILE ?? this.projectRoot, ".codex");
    const filePath = path.join(codexDir, "hooks.json");
    ensureDir(codexDir);
    backupIfNeeded(filePath, this.store.getBackupPath("codex-hooks.json.bak"));

    const document = readJson(filePath) ?? { hooks: {} };
    const hooksRoot = ensureObject(document, "hooks");
    const command = createHookCommand(this.projectRoot, "codex");
    for (const eventName of MANAGED_EVENT_NAMES) {
      hooksRoot[eventName] = mergeManagedEntries(hooksRoot[eventName], command);
    }

    writeJson(filePath, document);
  }

  private uninstallCodexHooks(): void {
    const filePath = path.join(process.env.USERPROFILE ?? this.projectRoot, ".codex", "hooks.json");
    const document = readJson(filePath);
    if (!document) {
      return;
    }

    const hooksRoot = ensureObject(document, "hooks");
    for (const eventName of Object.keys(hooksRoot)) {
      hooksRoot[eventName] = stripManagedEntries(hooksRoot[eventName]);
    }
    writeJson(filePath, document);
  }

  private installClaudeHooks(): void {
    const claudeDir = path.join(process.env.USERPROFILE ?? this.projectRoot, ".claude");
    const filePath = path.join(claudeDir, "settings.json");
    ensureDir(claudeDir);
    backupIfNeeded(filePath, this.store.getBackupPath("claude-settings.json.bak"));

    const document = readJson(filePath) ?? {};
    const hooksRoot = ensureObject(document, "hooks");
    const command = createHookCommand(this.projectRoot, "claude");
    for (const eventName of MANAGED_EVENT_NAMES) {
      hooksRoot[eventName] = mergeManagedEntries(hooksRoot[eventName], command);
    }

    writeJson(filePath, document);
  }

  private uninstallClaudeHooks(): void {
    const filePath = path.join(process.env.USERPROFILE ?? this.projectRoot, ".claude", "settings.json");
    const document = readJson(filePath);
    if (!document) {
      return;
    }

    const hooksRoot = ensureObject(document, "hooks");
    for (const eventName of Object.keys(hooksRoot)) {
      hooksRoot[eventName] = stripManagedEntries(hooksRoot[eventName]);
    }
    writeJson(filePath, document);
  }

  private hasCodexHooks(): boolean {
    const document = readJson(path.join(process.env.USERPROFILE ?? this.projectRoot, ".codex", "hooks.json"));
    if (!document) {
      return false;
    }
    return containsManagedHooks(ensureObject(document, "hooks"));
  }

  private hasClaudeHooks(): boolean {
    const document = readJson(path.join(process.env.USERPROFILE ?? this.projectRoot, ".claude", "settings.json"));
    if (!document) {
      return false;
    }
    return containsManagedHooks(ensureObject(document, "hooks"));
  }
}

function createHookCommand(projectRoot: string, provider: "codex" | "claude"): string {
  const dispatcherPath = path.join(projectRoot, "scripts", "hook-dispatcher.mjs");
  return `node "${dispatcherPath}" --provider ${provider}`;
}

function mergeManagedEntries(existingValue: unknown, command: string): unknown[] {
  const existing = Array.isArray(existingValue) ? existingValue : [];
  const filtered = existing.filter((entry) => !isManagedEntry(entry));
  filtered.push({
    matcher: "*",
    hooks: [
      {
        type: "command",
        command,
        timeout: 10,
        description: HOOK_MARKER
      }
    ]
  });
  return filtered;
}

function stripManagedEntries(existingValue: unknown): unknown[] {
  const existing = Array.isArray(existingValue) ? existingValue : [];
  return existing.filter((entry) => !isManagedEntry(entry));
}

function isManagedEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const hooks = (entry as Record<string, unknown>).hooks;
  if (!Array.isArray(hooks)) {
    return false;
  }
  return hooks.some((hook) => {
    if (!hook || typeof hook !== "object") {
      return false;
    }
    const description = (hook as Record<string, unknown>).description;
    const command = (hook as Record<string, unknown>).command;
    return description === HOOK_MARKER || (typeof command === "string" && command.includes("hook-dispatcher.mjs"));
  });
}

function containsManagedHooks(hooksRoot: JsonObject): boolean {
  return MANAGED_EVENT_NAMES.every((eventName) => {
    const entries = Array.isArray(hooksRoot[eventName]) ? (hooksRoot[eventName] as unknown[]) : [];
    return entries.some((entry) => isManagedEntry(entry));
  });
}

function ensureObject(container: JsonObject, key: string): JsonObject {
  const current = container[key];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    container[key] = {};
  }
  return container[key] as JsonObject;
}

function backupIfNeeded(filePath: string, backupPath: string): void {
  if (!fs.existsSync(filePath) || fs.existsSync(backupPath)) {
    return;
  }
  fs.copyFileSync(filePath, backupPath);
}

function readJson(filePath: string): JsonObject | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonObject;
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, value: JsonObject): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
