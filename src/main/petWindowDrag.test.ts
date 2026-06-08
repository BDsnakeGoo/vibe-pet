import { describe, expect, it, vi } from "vitest";
import { PetWindowDragController } from "./petWindowDrag";

describe("PetWindowDragController", () => {
  it("moves a window from the initial pointer and window position", () => {
    const window = {
      isDestroyed: () => false,
      getPosition: () => [80, 100] as [number, number],
      setPosition: vi.fn()
    };
    const drag = new PetWindowDragController();

    drag.start(1, window, { x: 200, y: 300 });
    const position = drag.move(1, { x: 212, y: 325 });

    expect(window.setPosition).toHaveBeenCalledWith(92, 125);
    expect(position).toEqual({ x: 92, y: 125 });
  });

  it("ignores drag moves after the drag ends", () => {
    const window = {
      isDestroyed: () => false,
      getPosition: () => [80, 100] as [number, number],
      setPosition: vi.fn()
    };
    const drag = new PetWindowDragController();

    drag.start(1, window, { x: 200, y: 300 });
    drag.end(1);
    const position = drag.move(1, { x: 212, y: 325 });

    expect(window.setPosition).not.toHaveBeenCalled();
    expect(position).toBeUndefined();
  });
});
