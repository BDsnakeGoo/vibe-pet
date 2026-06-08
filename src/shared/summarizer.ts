import type { HistoryItem, HookEvent, PetState } from "./types.js";

export function summarizeEvent(event: HookEvent, state: PetState, petId: string): HistoryItem {
  return {
    id: `${event.id}-summary`,
    petId,
    kind: state,
    summary: buildSummary(event, state),
    sourceEventId: event.id,
    createdAt: event.receivedAt
  };
}

function buildSummary(event: HookEvent, state: PetState): string {
  if (state === "waiting") {
    return "等待人工确认";
  }

  if (state === "idle") {
    return "任务进入空闲";
  }

  if (state === "completed") {
    return "任务已完成";
  }

  const toolName = readString(event.raw, "tool_name") ?? readString(event.raw, "toolName");
  const command = readNestedString(event.raw, ["tool_input", "command"]) ?? readNestedString(event.raw, ["toolInput", "command"]);
  if (toolName && command) {
    return `执行 ${toolName}：${compact(command)}`;
  }

  if (toolName) {
    return `执行 ${toolName}`;
  }

  const prompt = readString(event.raw, "prompt") ?? readString(event.raw, "message");
  if (prompt) {
    return `思考 ${compact(prompt)}`;
  }

  return `处理 ${event.eventName}`;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNestedString(source: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = source;
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" && current.trim().length > 0 ? current.trim() : undefined;
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}
