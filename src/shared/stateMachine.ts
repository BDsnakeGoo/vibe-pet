import type { HookEvent, PetState } from "./types.js";

export function classifyEvent(event: HookEvent): PetState {
  return classifyKnownEvent(event) ?? "idle";
}

export function nextPetState(current: PetState, event: HookEvent): PetState {
  return classifyKnownEvent(event) ?? current;
}

function classifyKnownEvent(event: HookEvent): PetState | undefined {
  const eventName = event.eventName.toLowerCase();

  if (includesAny(eventName, ["stop", "complete", "completed", "finish", "finished", "done"])) {
    return "completed";
  }

  if (includesAny(eventName, ["idle"])) {
    return "idle";
  }

  if (
    includesAny(eventName, [
      "approval",
      "approve",
      "confirm",
      "confirmation",
      "human",
      "inputrequired",
      "input_required",
      "waiting"
    ])
  ) {
    return "waiting";
  }

  if (hasHumanInputWaitSignal(event.raw)) {
    return "waiting";
  }

  if (
    includesAny(eventName, [
      "userpromptsubmit",
      "pretooluse",
      "posttooluse",
      "tool",
      "thinking",
      "assistant"
    ]) ||
    hasToolActivity(event.raw)
  ) {
    return "working";
  }

  return undefined;
}

function hasToolActivity(raw: Record<string, unknown>): boolean {
  return hasString(raw, "tool_name") || hasString(raw, "toolName") || hasObject(raw, "tool_input") || hasObject(raw, "toolInput");
}

function hasHumanInputWaitSignal(raw: Record<string, unknown>): boolean {
  const toolName = readString(raw, "tool_name") ?? readString(raw, "toolName");
  if (toolName === "request_user_input") {
    return true;
  }

  const rawText = JSON.stringify(raw).toLowerCase();
  return rawText.includes("unanswered") && /question\s+\d+\/\d+/.test(rawText);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasString(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0;
}

function hasObject(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}
