import { describe, expect, it } from "vitest";
import { summarizeEvent } from "../../src/shared/summarizer";
import type { HookEvent } from "../../src/shared/types";

describe("summarizeEvent", () => {
  it("summarizes command execution without exposing full raw payloads", () => {
    const event: HookEvent = {
      id: "event-1",
      provider: "claude",
      sessionId: "session-1",
      eventName: "PostToolUse",
      raw: {
        tool_name: "Bash",
        tool_input: {
          command: "npm run build && npm test -- --verbose"
        }
      },
      receivedAt: "2026-06-08T00:00:00.000Z"
    };

    const summary = summarizeEvent(event, "working", "pet-1");

    expect(summary.summary).toBe("执行 Bash：npm run build && npm test -- --verbose");
    expect(summary.petId).toBe("pet-1");
    expect(summary.kind).toBe("working");
  });

  it("summarizes waiting states as human confirmation", () => {
    const event: HookEvent = {
      id: "event-2",
      provider: "codex",
      sessionId: "session-2",
      eventName: "ApprovalRequired",
      raw: {},
      receivedAt: "2026-06-08T00:00:00.000Z"
    };

    expect(summarizeEvent(event, "waiting", "pet-2").summary).toBe("等待人工确认");
  });
});
