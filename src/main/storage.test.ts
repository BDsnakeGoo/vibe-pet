import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "./storage";

vi.mock("electron", () => ({
  app: {}
}));

let previousLocalAppData: string | undefined;
let tempRoot: string;
let projectRoot: string;

beforeEach(() => {
  previousLocalAppData = process.env.LOCALAPPDATA;
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibepet-"));
  projectRoot = path.join(tempRoot, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  process.env.LOCALAPPDATA = tempRoot;
});

afterEach(() => {
  if (previousLocalAppData === undefined) {
    delete process.env.LOCALAPPDATA;
  } else {
    process.env.LOCALAPPDATA = previousLocalAppData;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("AppStore", () => {
  it("loads gif groups from project folders and keeps builtin available", () => {
    const packDir = path.join(projectRoot, "assets", "gif-packs", "pixel-cat");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "idle.gif"), "");
    fs.writeFileSync(path.join(packDir, "working.gif"), "");
    fs.writeFileSync(path.join(packDir, "waiting.gif"), "");

    const store = new AppStore(projectRoot);
    const groups = store.getSnapshot({ codexInstalled: false, claudeInstalled: false }).gifGroups;

    expect(groups.map((group) => group.id)).toEqual(["builtin", "pixel-cat"]);
    expect(groups.find((group) => group.id === "pixel-cat")?.gifMap.idle).toContain("idle.gif");
  });

  it("uses renderer-loadable urls for project gif groups", () => {
    const packDir = path.join(projectRoot, "assets", "gif-packs", "pixel-cat");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "idle.gif"), "");
    fs.writeFileSync(path.join(packDir, "working.gif"), "");
    fs.writeFileSync(path.join(packDir, "waiting.gif"), "");

    const store = new AppStore(projectRoot);
    const group = store.getSnapshot({ codexInstalled: false, claudeInstalled: false }).gifGroups.find((item) => item.id === "pixel-cat");

    expect(group?.gifMap).toEqual({
      idle: "/gif-packs/pixel-cat/idle.gif",
      working: "/gif-packs/pixel-cat/working.gif",
      waiting: "/gif-packs/pixel-cat/waiting.gif",
      completed: "/gif-packs/pixel-cat/idle.gif"
    });
  });

  it("uses project default gif group by default when it exists", () => {
    const packDir = path.join(projectRoot, "assets", "gif-packs", "default");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "idle.gif"), "");
    fs.writeFileSync(path.join(packDir, "working.gif"), "");
    fs.writeFileSync(path.join(packDir, "waiting.gif"), "");

    const store = new AppStore(projectRoot);

    expect(store.getSnapshot({ codexInstalled: false, claudeInstalled: false }).settings.defaultGifGroupId).toBe("default");
  });

  it("uses the selected default gif group when creating a pet", () => {
    const packDir = path.join(projectRoot, "assets", "gif-packs", "pixel-cat");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "idle.gif"), "");
    fs.writeFileSync(path.join(packDir, "working.gif"), "");
    fs.writeFileSync(path.join(packDir, "waiting.gif"), "");
    const store = new AppStore(projectRoot);

    store.updateSettings({
      defaultGifGroupId: "pixel-cat"
    });
    const pet = store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    expect(pet.gifGroupId).toBe("pixel-cat");
    expect(pet.gifMap.working).toContain("working.gif");
  });

  it("creates a startup idle pet when no active pets exist", () => {
    const store = new AppStore(projectRoot);

    const pet = store.ensureStartupPet("2026-06-08T00:00:00.000Z");

    expect(pet?.id).toBe("codex:startup");
    expect(pet?.name).toBe("VibePet");
    expect(pet?.state).toBe("idle");
    expect(store.getPets()).toHaveLength(1);
  });

  it("promotes the startup pet to the first real hook session", () => {
    const store = new AppStore(projectRoot);
    const startupPet = store.ensureStartupPet("2026-06-08T00:00:00.000Z");

    const pet = store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:01:00.000Z"
    });

    expect(pet.id).toBe("codex:session-1");
    expect(pet.name).toBe("codex-1");
    expect(pet.position).toEqual(startupPet?.position);
    expect(store.getPets()).toHaveLength(1);
  });

  it("updates an existing pet gif group and gif map", () => {
    for (const packName of ["pixel-cat", "pixel-dog"]) {
      const packDir = path.join(projectRoot, "assets", "gif-packs", packName);
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(path.join(packDir, "idle.gif"), "");
      fs.writeFileSync(path.join(packDir, "working.gif"), "");
      fs.writeFileSync(path.join(packDir, "waiting.gif"), "");
    }
    const store = new AppStore(projectRoot);
    store.updateSettings({
      defaultGifGroupId: "pixel-cat"
    });
    const pet = store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    const updated = store.updatePetProfile(pet.id, {
      gifGroupId: "pixel-dog"
    });

    expect(updated?.gifGroupId).toBe("pixel-dog");
    expect(updated?.gifMap.working).toBe("/gif-packs/pixel-dog/working.gif");
  });

  it("provides default pet window settings", () => {
    const store = new AppStore();

    expect(store.getSnapshot({ codexInstalled: false, claudeInstalled: false }).settings.petWindow).toEqual({
      width: 220,
      height: 260,
      fontSize: 13
    });
  });

  it("updates and persists pet window settings with bounds", () => {
    const store = new AppStore();

    store.updateSettings({
      petWindow: {
        width: 50,
        height: 2000,
        fontSize: 40
      }
    });

    expect(store.getSnapshot({ codexInstalled: false, claudeInstalled: false }).settings.petWindow).toEqual({
      width: 160,
      height: 720,
      fontSize: 24
    });

    const restored = new AppStore();

    expect(restored.getSnapshot({ codexInstalled: false, claudeInstalled: false }).settings.petWindow).toEqual({
      width: 160,
      height: 720,
      fontSize: 24
    });
  });

  it("does not restore historical active pets on startup", () => {
    const dataDir = path.join(tempRoot, "VibePet");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "data.json"),
      JSON.stringify({
        pets: [
          {
            id: "codex:old-session",
            provider: "codex",
            sessionId: "old-session",
            name: "old pet",
            state: "waiting",
            gifMap: {
              idle: "",
              working: "",
              waiting: ""
            },
            position: {
              x: 10,
              y: 20
            },
            createdAt: "2026-06-08T00:00:00.000Z",
            lastSeenAt: "2026-06-08T00:01:00.000Z"
          }
        ],
        history: [
          {
            id: "history-1",
            petId: "codex:old-session",
            kind: "waiting",
            summary: "等待人工确认",
            sourceEventId: "event-1",
            createdAt: "2026-06-08T00:01:00.000Z"
          }
        ]
      }),
      "utf8"
    );

    const store = new AppStore();

    expect(store.getPets()).toEqual([]);
    expect(store.getSnapshot({ codexInstalled: false, claudeInstalled: false }).history).toHaveLength(1);
  });

  it("marks a session pet completed when its task stops", () => {
    const store = new AppStore();

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    expect(store.getPets().some((pet) => pet.id === "codex:session-1")).toBe(true);

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "Stop",
      payload: {
        session_id: "session-1"
      },
      receivedAt: "2026-06-08T00:01:00.000Z"
    });

    expect(store.getPets().find((pet) => pet.id === "codex:session-1")?.state).toBe("completed");
  });

  it("removes a session pet when a session exit event arrives", () => {
    const store = new AppStore();

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "SessionEnd",
      payload: {
        session_id: "session-1"
      },
      receivedAt: "2026-06-08T00:01:00.000Z"
    });

    expect(store.getPets().some((pet) => pet.id === "codex:session-1")).toBe(false);
  });

  it("removes a pet when it is manually closed", () => {
    const store = new AppStore();

    const pet = store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    expect(store.removePetProfile(pet.id)).toBe(true);
    expect(store.getPets().some((candidate) => candidate.id === pet.id)).toBe(false);
    expect(store.removePetProfile(pet.id)).toBe(false);
  });

  it("removes a session pet when a stop event reports SIGINT", () => {
    const store = new AppStore();

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "Stop",
      payload: {
        session_id: "session-1",
        signal: "SIGINT"
      },
      receivedAt: "2026-06-08T00:01:00.000Z"
    });

    expect(store.getPets().some((pet) => pet.id === "codex:session-1")).toBe(false);
  });

  it("removes a session pet when a stop event reports a nested interruption reason", () => {
    const store = new AppStore();

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "Stop",
      payload: {
        session_id: "session-1",
        result: {
          reason: "interrupted by ctrl-c"
        }
      },
      receivedAt: "2026-06-08T00:01:00.000Z"
    });

    expect(store.getPets().some((pet) => pet.id === "codex:session-1")).toBe(false);
  });

  it("marks completed pets idle after the idle timeout", () => {
    const store = new AppStore();

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserPromptSubmit",
      payload: {
        session_id: "session-1",
        prompt: "fix the build"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });
    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "Stop",
      payload: {
        session_id: "session-1"
      },
      receivedAt: "2026-06-08T00:01:00.000Z"
    });

    store.markIdlePets(Date.parse("2026-06-08T00:01:09.999Z"));

    expect(store.getPets().find((pet) => pet.id === "codex:session-1")?.state).toBe("completed");

    store.markIdlePets(Date.parse("2026-06-08T00:01:10.000Z"));

    expect(store.getPets().find((pet) => pet.id === "codex:session-1")?.state).toBe("idle");
  });

  it("keeps waiting pets waiting during idle marking", () => {
    const store = new AppStore();

    store.normalizeAndStoreEvent({
      provider: "codex",
      eventName: "UserApprovalRequest",
      payload: {
        session_id: "session-1",
        reason: "command requires approval"
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    });

    store.markIdlePets(Date.parse("2026-06-08T00:10:00.000Z"));

    expect(store.getPets().find((pet) => pet.id === "codex:session-1")?.state).toBe("waiting");
  });
});
