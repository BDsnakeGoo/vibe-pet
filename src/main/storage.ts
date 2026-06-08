import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { classifyEvent, nextPetState } from "../shared/stateMachine.js";
import { resolveSessionId } from "../shared/session.js";
import { summarizeEvent } from "../shared/summarizer.js";
import type { AppSettings, AppSnapshot, GifGroup, GifMap, HistoryItem, HookEvent, PetProfile, Provider } from "../shared/types.js";

export const APP_NAME = "VibePet";
export const INGEST_PORT = 44557;
export const MAX_HISTORY = 200;
const IDLE_AFTER_MS = 10000;
const BUILTIN_GIF_GROUP_ID = "builtin";
const DEFAULT_FILE_GIF_GROUP_ID = "default";
const STARTUP_PET_PROVIDER: Provider = "codex";
const STARTUP_PET_SESSION_ID = "startup";
const STARTUP_PET_ID = `${STARTUP_PET_PROVIDER}:${STARTUP_PET_SESSION_ID}`;

interface PersistedState {
  pets: PetProfile[];
  history: HistoryItem[];
  settings: AppSettings;
}

export interface IncomingHookEnvelope {
  provider: Provider;
  eventName?: string;
  payload: Record<string, unknown>;
  receivedAt?: string;
}

export function getDataRoot(): string {
  const base =
    process.env.LOCALAPPDATA ??
    process.env.APPDATA ??
    path.join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local");
  return path.join(base, APP_NAME);
}

export function getDataFilePath(): string {
  return path.join(getDataRoot(), "data.json");
}

export function getSpoolDir(): string {
  return path.join(getDataRoot(), "spool");
}

export function getBackupsDir(): string {
  return path.join(getDataRoot(), "backups");
}

export function getDefaultGifMap(): GifMap {
  return {
    idle: "",
    working: "",
    waiting: "",
    completed: ""
  };
}

export function getBuiltInGifGroup(): GifGroup {
  return {
    id: BUILTIN_GIF_GROUP_ID,
    name: "内置占位动画",
    gifMap: getDefaultGifMap(),
    builtIn: true
  };
}

export function getDefaultSettings(): AppSettings {
  return {
    petWindow: {
      width: 220,
      height: 260,
      fontSize: 13
    },
    defaultGifGroupId: DEFAULT_FILE_GIF_GROUP_ID
  };
}

export class AppStore {
  private readonly filePath: string;
  private readonly spoolDir: string;
  private readonly backupsDir: string;
  private readonly projectRoot: string;
  private state: PersistedState;

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.filePath = getDataFilePath();
    this.spoolDir = getSpoolDir();
    this.backupsDir = getBackupsDir();
    ensureDir(path.dirname(this.filePath));
    ensureDir(this.spoolDir);
    ensureDir(this.backupsDir);
    this.state = this.load();
  }

  getSnapshot(hookStatus: AppSnapshot["hookStatus"]): AppSnapshot {
    return {
      pets: [...this.state.pets],
      history: [...this.state.history].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      ingestUrl: `http://127.0.0.1:${INGEST_PORT}/hook-event`,
      gifGroups: this.getGifGroups(),
      settings: this.getSettings(),
      hookStatus
    };
  }

  getSettings(): AppSettings {
    return {
      defaultGifGroupId: this.state.settings.defaultGifGroupId,
      petWindow: {
        ...this.state.settings.petWindow
      }
    };
  }

  getPets(): PetProfile[] {
    return [...this.state.pets];
  }

  ensureStartupPet(receivedAt = new Date().toISOString()): PetProfile | undefined {
    if (this.state.pets.length > 0) {
      return undefined;
    }

    const pet = this.createPetProfile(STARTUP_PET_ID, STARTUP_PET_PROVIDER, STARTUP_PET_SESSION_ID, receivedAt, "VibePet");
    this.state.pets.push(pet);
    this.save();
    return pet;
  }

  getGifGroups(): GifGroup[] {
    return [getBuiltInGifGroup(), ...this.readGifGroupsFromProject()];
  }

  getHistoryForPet(petId: string): HistoryItem[] {
    return this.state.history.filter((item) => item.petId === petId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  updatePetProfile(petId: string, changes: Partial<Pick<PetProfile, "name" | "position" | "gifGroupId">>): PetProfile | undefined {
    const pet = this.state.pets.find((candidate) => candidate.id === petId);
    if (!pet) {
      return undefined;
    }

    if (typeof changes.name === "string" && changes.name.trim().length > 0) {
      pet.name = changes.name.trim();
    }

    if (changes.position) {
      pet.position = changes.position;
    }

    if (typeof changes.gifGroupId === "string" && changes.gifGroupId.trim().length > 0) {
      const gifGroupId = changes.gifGroupId.trim();
      const group = this.getGifGroups().find((candidate) => candidate.id === gifGroupId);
      if (group) {
        pet.gifGroupId = group.id;
        pet.gifMap = {
          ...group.gifMap
        };
      }
    }

    this.save();
    return pet;
  }

  removePetProfile(petId: string): boolean {
    const nextPets = this.state.pets.filter((pet) => pet.id !== petId);
    if (nextPets.length === this.state.pets.length) {
      return false;
    }

    this.state.pets = nextPets;
    this.save();
    return true;
  }

  updateSettings(changes: Partial<AppSettings>): AppSettings {
    const settings = normalizeSettings({
      ...this.state.settings,
      ...changes,
      defaultGifGroupId: changes.defaultGifGroupId ?? this.state.settings.defaultGifGroupId,
      petWindow: {
        ...this.state.settings.petWindow,
        ...changes.petWindow
      }
    });
    this.state.settings = this.ensureAvailableGifGroup(settings);
    this.save();
    return this.getSettings();
  }

  normalizeAndStoreEvent(envelope: IncomingHookEnvelope): PetProfile {
    const raw = envelope.payload ?? {};
    const sessionId = resolveSessionId(envelope.provider, raw);
    const petId = `${envelope.provider}:${sessionId}`;
    const receivedAt = envelope.receivedAt ?? new Date().toISOString();
    const eventName = resolveEventName(envelope.eventName, raw);
    const cwd = readString(raw, "cwd");
    const transcriptPath = readString(raw, "transcript_path") ?? readString(raw, "transcriptPath");

    const hookEvent: HookEvent = {
      id: randomUUID(),
      provider: envelope.provider,
      sessionId,
      cwd,
      transcriptPath,
      eventName,
      raw,
      receivedAt
    };

    const eventState = classifyEvent(hookEvent);
    const existingPet = this.state.pets.find((candidate) => candidate.id === petId);
    const pet = existingPet ?? this.promoteStartupPet(petId, envelope.provider, sessionId) ?? this.getOrCreatePet(petId, envelope.provider, sessionId, receivedAt);
    pet.state = nextPetState(pet.state, hookEvent);
    pet.lastSeenAt = receivedAt;

    const historyItem = summarizeEvent(hookEvent, eventState, petId);
    this.state.history = [historyItem, ...this.state.history].slice(0, MAX_HISTORY);
    if (isSessionExitEvent(hookEvent)) {
      this.state.pets = this.state.pets.filter((candidate) => candidate.id !== petId);
    }
    this.save();
    return pet;
  }

  flushSpool(): PetProfile[] {
    const entries = fs.existsSync(this.spoolDir) ? fs.readdirSync(this.spoolDir, { withFileTypes: true }) : [];
    const updatedPets: PetProfile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(this.spoolDir, entry.name);
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as IncomingHookEnvelope;
        updatedPets.push(this.normalizeAndStoreEvent(payload));
        fs.unlinkSync(filePath);
      } catch {
        moveBadSpoolFile(this.spoolDir, filePath, entry.name);
      }
    }
    return updatedPets;
  }

  markIdlePets(now = Date.now()): boolean {
    let changed = false;
    for (const pet of this.state.pets) {
      if (pet.state !== "completed") {
        continue;
      }

      if (now - Date.parse(pet.lastSeenAt) >= IDLE_AFTER_MS) {
        pet.state = "idle";
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }

    return changed;
  }

  resetTransientPetsToIdle(receivedAt = new Date().toISOString()): boolean {
    let changed = false;
    for (const pet of this.state.pets) {
      if (pet.state !== "working" && pet.state !== "completed") {
        continue;
      }

      pet.state = "idle";
      pet.lastSeenAt = receivedAt;
      changed = true;
    }

    if (changed) {
      this.save();
    }

    return changed;
  }

  getBackupPath(fileName: string): string {
    return path.join(this.backupsDir, fileName);
  }

  private getOrCreatePet(id: string, provider: Provider, sessionId: string, receivedAt: string): PetProfile {
    const existing = this.state.pets.find((pet) => pet.id === id);
    if (existing) {
      return existing;
    }

    const pet = this.createPetProfile(id, provider, sessionId, receivedAt);
    this.state.pets.push(pet);
    return pet;
  }

  private promoteStartupPet(id: string, provider: Provider, sessionId: string): PetProfile | undefined {
    const pet = this.state.pets.find((candidate) => candidate.id === STARTUP_PET_ID);
    if (!pet) {
      return undefined;
    }

    const name = this.getNextPetName(provider);
    pet.id = id;
    pet.provider = provider;
    pet.sessionId = sessionId;
    pet.name = name;
    return pet;
  }

  private createPetProfile(id: string, provider: Provider, sessionId: string, receivedAt: string, name = this.getNextPetName(provider)): PetProfile {
    const pet: PetProfile = {
      id,
      provider,
      sessionId,
      name,
      state: "idle",
      gifGroupId: this.getSelectedGifGroup().id,
      gifMap: {
        ...this.getSelectedGifGroup().gifMap
      },
      position: {
        x: 80 + this.state.pets.length * 32,
        y: 80 + this.state.pets.length * 24
      },
      createdAt: receivedAt,
      lastSeenAt: receivedAt
    };
    return pet;
  }

  private getNextPetName(provider: Provider): string {
    const count = this.state.pets.filter((item) => item.provider === provider && item.id !== STARTUP_PET_ID).length;
    return `${provider}-${count + 1}`;
  }

  private load(): PersistedState {
    if (!fs.existsSync(this.filePath)) {
      const initial: PersistedState = { pets: [], history: [], settings: this.getDefaultSettingsForProject() };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PersistedState;
      const restored: PersistedState = {
        pets: [],
        history: parsed.history ?? [],
        settings: this.ensureAvailableGifGroup(normalizeSettings(parsed.settings))
      };
      if ((parsed.pets ?? []).length > 0 || !parsed.settings) {
        fs.writeFileSync(this.filePath, JSON.stringify(restored, null, 2), "utf8");
      }
      return restored;
    } catch {
      return {
        pets: [],
        history: [],
        settings: this.getDefaultSettingsForProject()
      };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  private getSelectedGifGroup(): GifGroup {
    return this.getGifGroups().find((group) => group.id === this.state.settings.defaultGifGroupId) ?? getBuiltInGifGroup();
  }

  private ensureAvailableGifGroup(settings: AppSettings): AppSettings {
    const hasSelectedGroup = this.getGifGroups().some((group) => group.id === settings.defaultGifGroupId);
    return hasSelectedGroup
      ? settings
      : {
          ...settings,
          defaultGifGroupId: BUILTIN_GIF_GROUP_ID
        };
  }

  private readGifGroupsFromProject(): GifGroup[] {
    const root = path.join(this.projectRoot, "assets", "gif-packs");
    if (!fs.existsSync(root)) {
      return [];
    }

    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readGifGroup(path.join(root, entry.name), entry.name))
      .filter((group): group is GifGroup => !!group)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  private readGifGroup(groupDir: string, id: string): GifGroup | undefined {
    const completedFileName = fs.existsSync(path.join(groupDir, "completed.gif")) ? "completed.gif" : "idle.gif";
    const gifMap: GifMap = {
      idle: getGifPackUrl(id, "idle.gif"),
      working: getGifPackUrl(id, "working.gif"),
      waiting: getGifPackUrl(id, "waiting.gif"),
      completed: getGifPackUrl(id, completedFileName)
    };

    if (["idle.gif", "working.gif", "waiting.gif"].some((fileName) => !fs.existsSync(path.join(groupDir, fileName)))) {
      return undefined;
    }

    return {
      id,
      name: id,
      gifMap,
      builtIn: false
    };
  }

  private getDefaultSettingsForProject(): AppSettings {
    const hasDefaultFileGroup = this.readGifGroupsFromProject().some((group) => group.id === DEFAULT_FILE_GIF_GROUP_ID);
    return {
      ...getDefaultSettings(),
      defaultGifGroupId: hasDefaultFileGroup ? DEFAULT_FILE_GIF_GROUP_ID : BUILTIN_GIF_GROUP_ID
    };
  }
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function moveBadSpoolFile(spoolDir: string, filePath: string, fileName: string): void {
  const badDir = path.join(spoolDir, "bad");
  ensureDir(badDir);
  const targetPath = path.join(badDir, `${Date.now()}-${fileName}.bad`);
  try {
    fs.renameSync(filePath, targetPath);
  } catch {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore quarantine failures; the next startup can try again.
    }
  }
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveEventName(explicitEventName: string | undefined, payload: Record<string, unknown>): string {
  return (
    explicitEventName ??
    readString(payload, "hook_event_name") ??
    readString(payload, "event_name") ??
    readString(payload, "eventName") ??
    readString(payload, "event") ??
    "UnknownEvent"
  );
}

function isSessionExitEvent(event: HookEvent): boolean {
  const eventName = event.eventName.toLowerCase();
  return (
    ["sessionend", "session_end", "exit", "quit", "shutdown", "terminate", "sigint", "interrupt", "abort", "cancel"].some((term) =>
      eventName.includes(term)
    ) || hasExitSignal(event.raw)
  );
}

function hasExitSignal(raw: Record<string, unknown>): boolean {
  return hasExitSignalValue(raw);
}

function hasExitSignalValue(source: unknown): boolean {
  if (!source || typeof source !== "object") {
    return false;
  }

  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string" && isExitSignalField(key) && isExitSignalText(value)) {
      return true;
    }

    if (value && typeof value === "object" && hasExitSignalValue(value)) {
      return true;
    }
  }

  return false;
}

function isExitSignalField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return (
    normalized.includes("signal") ||
    normalized.includes("reason") ||
    normalized === "status" ||
    normalized === "exitstatus" ||
    normalized === "terminationstatus"
  );
}

function isExitSignalText(value: string): boolean {
  return includesAny(value.toLowerCase(), [
    "sigint",
    "sigterm",
    "sighup",
    "interrupt",
    "interrupted",
    "aborted",
    "abort",
    "cancelled",
    "canceled",
    "terminated",
    "killed"
  ]);
}

function normalizeSettings(settings: AppSettings | undefined): AppSettings {
  const defaults = getDefaultSettings();
  return {
    petWindow: {
      width: clampNumber(settings?.petWindow?.width, 160, 720, defaults.petWindow.width),
      height: clampNumber(settings?.petWindow?.height, 160, 720, defaults.petWindow.height),
      fontSize: clampNumber(settings?.petWindow?.fontSize, 10, 24, defaults.petWindow.fontSize)
    },
    defaultGifGroupId:
      typeof settings?.defaultGifGroupId === "string" && settings.defaultGifGroupId.trim().length > 0
        ? settings.defaultGifGroupId.trim()
        : defaults.defaultGifGroupId
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function getGifPackUrl(groupId: string, fileName: string): string {
  return `/gif-packs/${encodeURIComponent(groupId)}/${encodeURIComponent(fileName)}`;
}
