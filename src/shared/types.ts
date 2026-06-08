export const CHAT_PET_ID = "chat:default";
export const CHAT_PET_NAME = "聊天宠物";

export type Provider = "codex" | "claude" | "chat";

export type PetState = "idle" | "working" | "waiting" | "completed";

export type GifMap = Record<PetState, string>;

export interface GifGroup {
  id: string;
  name: string;
  gifMap: GifMap;
  builtIn: boolean;
}

export interface HookEvent {
  id: string;
  provider: Provider;
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  eventName: string;
  raw: Record<string, unknown>;
  receivedAt: string;
}

export interface HistoryItem {
  id: string;
  petId: string;
  kind: PetState;
  summary: string;
  sourceEventId: string;
  createdAt: string;
}

export interface PetProfile {
  id: string;
  provider: Provider;
  sessionId: string;
  name: string;
  state: PetState;
  gifGroupId: string;
  gifMap: GifMap;
  position: {
    x: number;
    y: number;
  };
  createdAt: string;
  lastSeenAt: string;
}

export interface AppSettings {
  petWindow: {
    width: number;
    height: number;
    fontSize: number;
  };
  defaultGifGroupId: string;
}

export interface AppSnapshot {
  pets: PetProfile[];
  history: HistoryItem[];
  ingestUrl: string;
  gifGroups: GifGroup[];
  settings: AppSettings;
  hookStatus: {
    codexInstalled: boolean;
    claudeInstalled: boolean;
  };
}

export interface PetWindowSize {
  width: number;
  height: number;
}
