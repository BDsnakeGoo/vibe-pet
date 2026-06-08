export interface ScreenPoint {
  x: number;
  y: number;
}

export interface DraggableWindow {
  isDestroyed(): boolean;
  getPosition(): number[];
  setPosition(x: number, y: number): void;
}

interface ActiveDrag {
  window: DraggableWindow;
  startPointer: ScreenPoint;
  startWindow: ScreenPoint;
}

export class PetWindowDragController {
  private readonly activeDrags = new Map<number, ActiveDrag>();

  start(key: number, window: DraggableWindow, pointer: ScreenPoint): void {
    if (window.isDestroyed()) {
      return;
    }

    const [x, y] = window.getPosition();
    this.activeDrags.set(key, {
      window,
      startPointer: pointer,
      startWindow: { x, y }
    });
  }

  move(key: number, pointer: ScreenPoint): ScreenPoint | undefined {
    const active = this.activeDrags.get(key);
    if (!active || active.window.isDestroyed()) {
      return undefined;
    }

    const nextPosition = {
      x: Math.round(active.startWindow.x + pointer.x - active.startPointer.x),
      y: Math.round(active.startWindow.y + pointer.y - active.startPointer.y)
    };
    active.window.setPosition(nextPosition.x, nextPosition.y);
    return nextPosition;
  }

  end(key: number): void {
    this.activeDrags.delete(key);
  }
}
