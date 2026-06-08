#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const rendererUrl = "http://127.0.0.1:5173/";
const binExt = process.platform === "win32" ? ".cmd" : "";
const electronCmd = path.join(projectRoot, "node_modules", ".bin", `electron${binExt}`);
const tscCmd = path.join(projectRoot, "node_modules", ".bin", `tsc${binExt}`);

let viteProcess;
let electronProcess;
let restartTimer;
let compiling = false;
let restartPending = false;
let shuttingDown = false;

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});

async function main() {
  viteProcess = spawnCommand("npm", ["run", "dev:renderer"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env
  });
  viteProcess.on("error", (error) => {
    if (!shuttingDown) {
      console.error(`[dev] failed to start Vite: ${error.message}`);
      shutdown(1);
    }
  });
  viteProcess.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev] Vite exited with code ${code ?? 0}`);
      shutdown(code ?? 1);
    }
  });

  await Promise.all([waitForUrl(rendererUrl), compileMain()]);
  startElectron();
  watchMainSources();

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

function startElectron() {
  electronProcess = spawnCommand(electronCmd, ["."], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      VIBEPET_RENDERER_URL: rendererUrl
    }
  });
  electronProcess.on("error", (error) => {
    if (!shuttingDown) {
      console.error(`[dev] failed to start Electron: ${error.message}`);
    }
  });
  electronProcess.on("exit", (code) => {
    if (!shuttingDown && code !== 0 && code !== null) {
      console.error(`[dev] Electron exited with code ${code}`);
    }
  });
}

function watchMainSources() {
  for (const relativeDir of ["src/main", "src/preload", "src/shared"]) {
    const absoluteDir = path.join(projectRoot, relativeDir);
    fs.watch(absoluteDir, { recursive: true }, (_eventType, fileName) => {
      if (!fileName || !/\.(ts|tsx|js|cjs|mjs|json)$/.test(fileName)) {
        return;
      }

      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        void recompileAndRestart();
      }, 150);
    });
  }
}

async function recompileAndRestart() {
  if (compiling) {
    restartPending = true;
    return;
  }

  compiling = true;
  try {
    await compileMain();
    await stopElectron();
    if (!shuttingDown) {
      startElectron();
    }
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    compiling = false;
    if (restartPending && !shuttingDown) {
      restartPending = false;
      void recompileAndRestart();
    }
  }
}

function compileMain() {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(tscCmd, ["-p", "tsconfig.node.json"], {
      cwd: projectRoot,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`main process compile failed with code ${code ?? 1}`));
    });
  });
}

function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`timed out waiting for ${url}`));
          return;
        }

        setTimeout(check, 250);
      });
      request.setTimeout(1000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function stopElectron() {
  if (!electronProcess || electronProcess.exitCode !== null) {
    return Promise.resolve();
  }

  const processId = electronProcess.pid;
  return new Promise((resolve) => {
    electronProcess.once("exit", () => resolve());
    if (process.platform === "win32" && processId) {
      spawnCommand("taskkill", ["/pid", String(processId), "/t", "/f"], {
        stdio: "ignore"
      }).on("exit", () => resolve());
      return;
    }

    electronProcess.kill("SIGTERM");
    setTimeout(() => {
      if (electronProcess?.exitCode === null) {
        electronProcess.kill("SIGKILL");
      }
      resolve();
    }, 2000);
  });
}

async function shutdown(code) {
  shuttingDown = true;
  clearTimeout(restartTimer);
  await stopElectron();
  await stopVite();
  process.exit(code);
}

function stopVite() {
  if (!viteProcess || viteProcess.exitCode !== null) {
    return Promise.resolve();
  }

  const processId = viteProcess.pid;
  return new Promise((resolve) => {
    viteProcess.once("exit", () => resolve());
    if (process.platform === "win32" && processId) {
      spawnCommand("taskkill", ["/pid", String(processId), "/t", "/f"], {
        stdio: "ignore"
      }).on("exit", () => resolve());
      return;
    }

    viteProcess.kill("SIGTERM");
    setTimeout(() => {
      if (viteProcess?.exitCode === null) {
        viteProcess.kill("SIGKILL");
      }
      resolve();
    }, 2000);
  });
}

function spawnCommand(command, args, options = {}) {
  if (process.platform !== "win32") {
    return spawn(command, args, options);
  }

  return spawn(toCommandLine([command, ...args]), [], {
    ...options,
    shell: true
  });
}

function toCommandLine(parts) {
  return parts.map(quoteShellArg).join(" ");
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:\\-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\"\"")}"`;
}
