import { describe, expect, it } from "vitest";
import { resolveSessionId } from "../../src/shared/session";

describe("resolveSessionId", () => {
  it("uses explicit session_id when present", () => {
    expect(resolveSessionId("codex", { session_id: "abc" })).toBe("abc");
  });

  it("derives a stable session id from cwd and transcript path when session_id is absent", () => {
    const payload = { cwd: "D:\\aiproj\\VibePet", transcript_path: "C:\\tmp\\session.jsonl" };

    expect(resolveSessionId("claude", payload)).toBe(resolveSessionId("claude", payload));
    expect(resolveSessionId("claude", payload)).toMatch(/^claude-/);
  });
});
