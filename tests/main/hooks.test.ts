import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookInstaller } from "../../src/main/hooks";
import type { AppStore } from "../../src/main/storage";

let previousUserProfile: string | undefined;
let previousNodeExecPath: string | undefined;
let tempRoot: string;

beforeEach(() => {
  previousUserProfile = process.env.USERPROFILE;
  previousNodeExecPath = process.env.npm_node_execpath;
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibepet-hooks-"));
  process.env.USERPROFILE = tempRoot;
});

afterEach(() => {
  if (previousUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = previousUserProfile;
  }

  if (previousNodeExecPath === undefined) {
    delete process.env.npm_node_execpath;
  } else {
    process.env.npm_node_execpath = previousNodeExecPath;
  }

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("HookInstaller", () => {
  it("writes hook commands with the npm Node executable when available", () => {
    const nodePath = path.join(tempRoot, "node.exe");
    fs.writeFileSync(nodePath, "");
    process.env.npm_node_execpath = nodePath;

    const installer = new HookInstaller(createStoreDouble(), tempRoot);
    installer.installAll();

    const codexHooks = JSON.parse(fs.readFileSync(path.join(tempRoot, ".codex", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = codexHooks.hooks.UserPromptSubmit[0].hooks[0].command;

    expect(command).toContain(`"${nodePath}"`);
    expect(command).toContain(`"${path.join(tempRoot, "scripts", "hook-dispatcher.mjs")}"`);
    expect(command).toContain("--provider codex");
  });
});

function createStoreDouble(): AppStore {
  return {
    getBackupPath: (fileName: string) => path.join(tempRoot, "backups", fileName)
  } as AppStore;
}
