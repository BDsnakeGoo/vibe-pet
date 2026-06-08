import { describe, expect, it } from "vitest";
import { PetWindowDismissals } from "./petWindowLifecycle";

describe("PetWindowDismissals", () => {
  it("keeps a manually closed pet dismissed until all pets are restored", () => {
    const dismissals = new PetWindowDismissals();

    dismissals.markClosed({
      isQuitting: false,
      petStillExists: true,
      petId: "codex:session-1"
    });

    expect(dismissals.shouldCreateWindow("codex:session-1")).toBe(false);

    dismissals.restoreAll();

    expect(dismissals.shouldCreateWindow("codex:session-1")).toBe(true);
  });

  it("does not dismiss windows closed because the app is quitting or the pet was removed", () => {
    const dismissals = new PetWindowDismissals();

    dismissals.markClosed({
      isQuitting: true,
      petStillExists: true,
      petId: "codex:quit"
    });
    dismissals.markClosed({
      isQuitting: false,
      petStillExists: false,
      petId: "codex:removed"
    });

    expect(dismissals.shouldCreateWindow("codex:quit")).toBe(true);
    expect(dismissals.shouldCreateWindow("codex:removed")).toBe(true);
  });
});
