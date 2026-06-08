import type { Provider } from "./types.js";

export function resolveSessionId(provider: Provider, payload: Record<string, unknown>): string {
  const explicit = readString(payload, "session_id") ?? readString(payload, "sessionId");
  if (explicit) {
    return explicit;
  }

  const seed = [
    provider,
    readString(payload, "cwd") ?? "",
    readString(payload, "transcript_path") ?? readString(payload, "transcriptPath") ?? "",
    readString(payload, "conversation_id") ?? ""
  ].join("|");

  return `${provider}-${hashString(seed || provider)}`;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
