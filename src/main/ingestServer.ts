import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AppSnapshot, PetProfile } from "../shared/types.js";
import type { AppStore, IncomingHookEnvelope } from "./storage.js";

interface LocalApi {
  getSnapshot(): AppSnapshot;
  installHooks(): AppSnapshot["hookStatus"];
  uninstallHooks(): AppSnapshot["hookStatus"];
  updatePet(petId: string, payload: Partial<Pick<PetProfile, "name" | "position" | "gifGroupId">>): PetProfile | undefined;
}

export function createIngestServer(store: AppStore, onEvent: () => void, rendererRoot: string, projectRoot: string, api: LocalApi): http.Server {
  return http.createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/local-gif") {
      const gifPath = resolveLocalGifPath(projectRoot, url.searchParams.get("path"));
      if (!gifPath || !fs.existsSync(gifPath)) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        "content-type": "image/gif"
      });
      fs.createReadStream(gifPath).pipe(response);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/gif-packs/")) {
      const gifPath = resolveGifPackPath(projectRoot, url.pathname);
      if (!gifPath || !fs.existsSync(gifPath)) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        "content-type": "image/gif"
      });
      fs.createReadStream(gifPath).pipe(response);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      handleApi(request, response, url, api, onEvent);
      return;
    }

    if (request.method === "POST" && url.pathname === "/hook-event") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          const envelope = JSON.parse(body) as IncomingHookEnvelope;
          store.normalizeAndStoreEvent(envelope);
          onEvent();
          response.writeHead(204);
          response.end();
        } catch {
          response.writeHead(400);
          response.end();
        }
      });
      return;
    }

    if (request.method === "GET") {
      const assetPath = resolveRendererPath(rendererRoot, url.pathname);
      if (!assetPath || !fs.existsSync(assetPath)) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        "content-type": getContentType(assetPath)
      });
      fs.createReadStream(assetPath).pipe(response);
      return;
    }

    response.writeHead(405);
    response.end();
  });
}

function handleApi(request: http.IncomingMessage, response: http.ServerResponse, url: URL, api: LocalApi, onEvent: () => void): void {
  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    writeJson(response, 200, api.getSnapshot());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/hooks/install") {
    writeJson(response, 200, api.installHooks());
    onEvent();
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/hooks/uninstall") {
    writeJson(response, 200, api.uninstallHooks());
    onEvent();
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/pets/")) {
    const petId = decodeURIComponent(url.pathname.replace("/api/pets/", ""));
    readJsonBody(request, (payload) => {
      const pet = api.updatePet(petId, payload as Partial<Pick<PetProfile, "name" | "position" | "gifGroupId">>);
      onEvent();
      writeJson(response, pet ? 200 : 404, pet ?? { error: "Pet not found" });
    });
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

function readJsonBody(request: http.IncomingMessage, callback: (body: unknown) => void): void {
  const chunks: Buffer[] = [];
  request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  request.on("end", () => {
    try {
      callback(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    } catch {
      callback({});
    }
  });
}

function writeJson(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function resolveRendererPath(rendererRoot: string, pathname: string): string | undefined {
  if (pathname === "/" || pathname === "/index.html") {
    return path.join(rendererRoot, "index.html");
  }

  const relativePath = pathname.replace(/^\/+/, "");
  const candidate = path.normalize(path.join(rendererRoot, relativePath));
  if (!candidate.startsWith(path.normalize(rendererRoot))) {
    return undefined;
  }
  return candidate;
}

function resolveGifPackPath(projectRoot: string, pathname: string): string | undefined {
  const routePrefix = "/gif-packs/";
  if (!pathname.startsWith(routePrefix)) {
    return undefined;
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(routePrefix.length));
  } catch {
    return undefined;
  }

  if (path.isAbsolute(relativePath) || path.extname(relativePath).toLowerCase() !== ".gif") {
    return undefined;
  }

  const gifRoot = path.resolve(projectRoot, "assets", "gif-packs");
  const candidate = path.resolve(gifRoot, relativePath);
  return isInsidePath(candidate, gifRoot) ? candidate : undefined;
}

function resolveLocalGifPath(projectRoot: string, requestedPath: string | null): string | undefined {
  if (!requestedPath || path.extname(requestedPath).toLowerCase() !== ".gif") {
    return undefined;
  }

  const gifRoot = path.resolve(projectRoot, "assets", "gif-packs");
  const candidate = path.resolve(requestedPath);
  return isInsidePath(candidate, gifRoot) ? candidate : undefined;
}

function isInsidePath(candidate: string, root: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".gif":
      return "image/gif";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
