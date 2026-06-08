import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIngestServer } from "./ingestServer";
import type { AppSnapshot, PetProfile } from "../shared/types";
import type { AppStore } from "./storage";

let tempRoot: string;
let rendererRoot: string;
let projectRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibepet-server-"));
  rendererRoot = path.join(tempRoot, "dist-renderer");
  projectRoot = path.join(tempRoot, "project");
  fs.mkdirSync(rendererRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(rendererRoot, "index.html"), "<!doctype html>");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("createIngestServer", () => {
  it("serves gif pack files through a renderer-loadable route", async () => {
    const gifDir = path.join(projectRoot, "assets", "gif-packs", "default");
    fs.mkdirSync(gifDir, { recursive: true });
    fs.writeFileSync(path.join(gifDir, "working.gif"), "gif-data");

    const server = await listen();
    try {
      const response = await request(server, "/gif-packs/default/working.gif");

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/gif");
      expect(response.body).toBe("gif-data");
    } finally {
      await close(server);
    }
  });

  it("rejects gif pack path traversal", async () => {
    fs.writeFileSync(path.join(projectRoot, "outside.gif"), "outside");
    const server = await listen();
    try {
      const response = await request(server, "/gif-packs/default/../../outside.gif");

      expect(response.statusCode).toBe(404);
    } finally {
      await close(server);
    }
  });

  it("serves legacy local gif paths only from gif packs", async () => {
    const gifDir = path.join(projectRoot, "assets", "gif-packs", "default");
    const gifPath = path.join(gifDir, "idle.gif");
    fs.mkdirSync(gifDir, { recursive: true });
    fs.writeFileSync(gifPath, "legacy-gif");

    const server = await listen();
    try {
      const response = await request(server, `/api/local-gif?path=${encodeURIComponent(gifPath)}`);

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/gif");
      expect(response.body).toBe("legacy-gif");
    } finally {
      await close(server);
    }
  });

  it("rejects legacy local gif paths outside gif packs", async () => {
    const outsidePath = path.join(projectRoot, "outside.gif");
    fs.writeFileSync(outsidePath, "outside");

    const server = await listen();
    try {
      const response = await request(server, `/api/local-gif?path=${encodeURIComponent(outsidePath)}`);

      expect(response.statusCode).toBe(404);
    } finally {
      await close(server);
    }
  });
});

async function listen(): Promise<http.Server> {
  const store = {
    normalizeAndStoreEvent: vi.fn()
  } as unknown as AppStore;
  const snapshot: AppSnapshot = {
    pets: [],
    history: [],
    ingestUrl: "http://127.0.0.1:0/hook-event",
    gifGroups: [],
    settings: {
      defaultGifGroupId: "default",
      petWindow: {
        width: 220,
        height: 260,
        fontSize: 13
      }
    },
    hookStatus: {
      codexInstalled: false,
      claudeInstalled: false
    }
  };
  const api = {
    getSnapshot: () => snapshot,
    installHooks: () => snapshot.hookStatus,
    uninstallHooks: () => snapshot.hookStatus,
    updatePet: () => undefined as PetProfile | undefined
  };
  const server = createIngestServer(store, vi.fn(), rendererRoot, projectRoot, api);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return server;
}

async function request(server: http.Server, pathname: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }

  return await new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    req.on("error", reject);
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
