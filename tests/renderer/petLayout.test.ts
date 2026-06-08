import { describe, expect, it } from "vitest";
import { calculatePetWindowLayout } from "../../src/renderer/petLayout";

describe("calculatePetWindowLayout", () => {
  it("sizes the window from gif, top text, and bottom text", () => {
    const result = calculatePetWindowLayout({
      nameWidth: 58,
      nameHeight: 42,
      captionWidth: 52,
      captionHeight: 33,
      naturalWidth: 96,
      naturalHeight: 96
    });

    expect(result.art).toEqual({
      width: 96,
      height: 96
    });
    expect(result.window).toEqual({
      width: 120,
      height: 183
    });
  });

  it("preserves wide gif aspect ratio while fitting the max art edge", () => {
    const result = calculatePetWindowLayout({
      nameWidth: 80,
      nameHeight: 24,
      captionWidth: 60,
      captionHeight: 18,
      naturalWidth: 300,
      naturalHeight: 100
    });

    expect(result.art).toEqual({
      width: 260,
      height: 86
    });
    expect(result.window).toEqual({
      width: 276,
      height: 141
    });
  });

  it("preserves tall gif aspect ratio while fitting the max art edge", () => {
    const result = calculatePetWindowLayout({
      nameWidth: 80,
      nameHeight: 24,
      captionWidth: 60,
      captionHeight: 18,
      naturalWidth: 100,
      naturalHeight: 300
    });

    expect(result.art).toEqual({
      width: 86,
      height: 260
    });
    expect(result.window).toEqual({
      width: 120,
      height: 314
    });
  });

  it("uses text width up to the maximum window width", () => {
    const result = calculatePetWindowLayout({
      nameWidth: 900,
      nameHeight: 24,
      captionWidth: 60,
      captionHeight: 18,
      naturalWidth: 96,
      naturalHeight: 96
    });

    expect(result.window.width).toBe(420);
  });

  it("reserves text height and bottom safety from font size when measured text is clipped", () => {
    const result = calculatePetWindowLayout({
      nameWidth: 58,
      nameHeight: 10,
      captionWidth: 52,
      captionHeight: 10,
      naturalWidth: 96,
      naturalHeight: 96,
      fontSize: 24
    });

    expect(result.window.height).toBeGreaterThanOrEqual(200);
  });
});
