import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("runtime preload bridge", () => {
  it("exposes resizePetWindow from the CommonJS preload used by Electron", () => {
    const sentMessages: unknown[][] = [];
    let exposedApi: Record<string, unknown> | undefined;
    const preloadPath = path.resolve(process.cwd(), "scripts", "preload.cjs");
    const source = fs.readFileSync(preloadPath, "utf8");
    const context = {
      require: (name: string) => {
        if (name !== "electron") {
          throw new Error(`Unexpected require: ${name}`);
        }

        return {
          contextBridge: {
            exposeInMainWorld: vi.fn((_name: string, api: Record<string, unknown>) => {
              exposedApi = api;
            })
          },
          ipcRenderer: {
            invoke: vi.fn(),
            on: vi.fn(),
            removeListener: vi.fn(),
            send: vi.fn((...args: unknown[]) => {
              sentMessages.push(args);
            })
          }
        };
      }
    };

    vm.runInNewContext(source, context, { filename: preloadPath });

    expect(exposedApi?.resizePetWindow).toEqual(expect.any(Function));
    (exposedApi?.resizePetWindow as (petId: string, size: { width: number; height: number }) => void)("pet-1", {
      width: 180,
      height: 220
    });
    expect(sentMessages).toContainEqual(["pet:resize-window", "pet-1", { width: 180, height: 220 }]);
  });

  it("exposes manual pet window drag commands from the CommonJS preload", () => {
    const sentMessages: unknown[][] = [];
    let exposedApi: Record<string, unknown> | undefined;
    const preloadPath = path.resolve(process.cwd(), "scripts", "preload.cjs");
    const source = fs.readFileSync(preloadPath, "utf8");
    const context = {
      require: (name: string) => {
        if (name !== "electron") {
          throw new Error(`Unexpected require: ${name}`);
        }

        return {
          contextBridge: {
            exposeInMainWorld: vi.fn((_name: string, api: Record<string, unknown>) => {
              exposedApi = api;
            })
          },
          ipcRenderer: {
            invoke: vi.fn(),
            on: vi.fn(),
            removeListener: vi.fn(),
            send: vi.fn((...args: unknown[]) => {
              sentMessages.push(args);
            })
          }
        };
      }
    };

    vm.runInNewContext(source, context, { filename: preloadPath });

    expect(exposedApi?.startPetWindowDrag).toEqual(expect.any(Function));
    expect(exposedApi?.dragPetWindow).toEqual(expect.any(Function));
    expect(exposedApi?.endPetWindowDrag).toEqual(expect.any(Function));
    (exposedApi?.startPetWindowDrag as (point: { x: number; y: number }) => void)({ x: 100, y: 120 });
    (exposedApi?.dragPetWindow as (point: { x: number; y: number }) => void)({ x: 110, y: 150 });
    (exposedApi?.endPetWindowDrag as () => void)();

    expect(sentMessages).toContainEqual(["pet:drag-start", { x: 100, y: 120 }]);
    expect(sentMessages).toContainEqual(["pet:drag-move", { x: 110, y: 150 }]);
    expect(sentMessages).toContainEqual(["pet:drag-end"]);
  });
});
