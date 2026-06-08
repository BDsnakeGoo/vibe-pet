#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const APP_NAME = "VibePet";
const INGEST_URL = "http://127.0.0.1:44557/hook-event";

const provider = readArg("--provider") || "codex";
const payload = await readPayload();
const envelope = {
  provider,
  eventName:
    readString(payload, "hook_event_name") ||
    readString(payload, "event_name") ||
    readString(payload, "eventName") ||
    readString(payload, "event") ||
    "UnknownEvent",
  payload,
  receivedAt: new Date().toISOString()
};

try {
  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(envelope)
  });

  if (!response.ok) {
    throw new Error(`ingest failed: ${response.status}`);
  }
} catch {
  persistSpool(envelope);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return "";
  }
  return process.argv[index + 1];
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function readString(source, key) {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function persistSpool(envelope) {
  const spoolDir = path.join(getDataRoot(), "spool");
  fs.mkdirSync(spoolDir, { recursive: true });
  const filePath = path.join(spoolDir, `${Date.now()}-${randomUUID()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), "utf8");
}

function getDataRoot() {
  const base =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Local");
  return path.join(base, APP_NAME);
}
