import { describe, expect, it } from "vitest";
import { classifyEvent, nextPetState } from "../../src/shared/stateMachine";
import type { HookEvent } from "../../src/shared/types";

function event(eventName: string, raw: Record<string, unknown> = {}): HookEvent {
  return {
    id: "event-1",
    provider: "claude",
    sessionId: "session-1",
    eventName,
    raw,
    receivedAt: "2026-06-08T00:00:00.000Z"
  };
}

describe("classifyEvent", () => {
  it("maps tool activity to working", () => {
    expect(classifyEvent(event("PostToolUse", { tool_name: "Bash" }))).toBe("working");
  });

  it("maps confirmation events to waiting", () => {
    expect(classifyEvent(event("UserApprovalRequest", { reason: "command requires approval" }))).toBe("waiting");
  });

  it("does not treat ordinary permission metadata as waiting", () => {
    expect(
      classifyEvent(
        event("UserPromptSubmit", {
          prompt: "fix the build",
          permission_mode: "never",
          sandbox_permissions: "danger-full-access"
        })
      )
    ).toBe("working");
  });

  it("does not treat approval words inside tool input as waiting", () => {
    expect(
      classifyEvent(
        event("PreToolUse", {
          tool_name: "Bash",
          tool_input: {
            command: "echo approval confirmation required"
          }
        })
      )
    ).toBe("working");
  });

  it("maps plan-mode unanswered questions to waiting", () => {
    expect(
      classifyEvent(
        event("UserPromptSubmit", {
          prompt: "Question 1/1 (1 unanswered)\n扫描回收外来器械信息时，这三项应按哪种优先级代入？"
        })
      )
    ).toBe("waiting");
  });

  it("maps request_user_input tool activity to waiting", () => {
    expect(
      classifyEvent(
        event("PreToolUse", {
          tool_name: "request_user_input"
        })
      )
    ).toBe("waiting");
  });

  it("maps stop or completion events to completed", () => {
    expect(classifyEvent(event("Stop"))).toBe("completed");
    expect(classifyEvent(event("Complete"))).toBe("completed");
  });

  it("keeps unknown events from interrupting the current state", () => {
    expect(nextPetState("waiting", event("UnknownCustomEvent"))).toBe("waiting");
  });
});
