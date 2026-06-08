export interface PetWindowLayoutInput {
  nameWidth: number;
  nameHeight: number;
  captionWidth: number;
  captionHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  fontSize?: number;
}

export interface PetWindowLayout {
  art: {
    width: number;
    height: number;
  };
  window: {
    width: number;
    height: number;
  };
}

const HORIZONTAL_PADDING = 16;
const VERTICAL_PADDING = 8;
const STACK_GAP = 2;
const MIN_WINDOW_WIDTH = 120;
const MIN_WINDOW_HEIGHT = 96;
const MAX_WINDOW_WIDTH = 420;
const MAX_WINDOW_HEIGHT = 760;
const MIN_ART_EDGE = 48;
const MAX_ART_EDGE = 260;
const DEFAULT_FONT_SIZE = 13;
const NAME_TEXT_HEIGHT_EM = 1.85;
const CAPTION_TEXT_HEIGHT_EM = 1.75;
const TEXT_RENDERING_SAFE_PADDING = 6;

export function calculatePetWindowLayout(input: PetWindowLayoutInput): PetWindowLayout {
  const aspectRatio = getAspectRatio(input.naturalWidth, input.naturalHeight);
  const normalizedNaturalWidth = normalizePositive(input.naturalWidth, 96);
  const normalizedNaturalHeight = normalizePositive(input.naturalHeight, 96);
  const hasFontSize = input.fontSize !== undefined;
  const fontSize = normalizePositive(input.fontSize ?? DEFAULT_FONT_SIZE, DEFAULT_FONT_SIZE);
  const nameHeight = hasFontSize
    ? Math.max(normalizePositive(input.nameHeight, 0), Math.ceil(fontSize * NAME_TEXT_HEIGHT_EM))
    : normalizePositive(input.nameHeight, 0);
  const captionHeight = hasFontSize
    ? Math.max(normalizePositive(input.captionHeight, 0), Math.ceil(fontSize * CAPTION_TEXT_HEIGHT_EM))
    : normalizePositive(input.captionHeight, 0);
  const textRenderingSafePadding = hasFontSize ? TEXT_RENDERING_SAFE_PADDING : 0;
  const maxArtWidth = Math.min(MAX_ART_EDGE, MAX_WINDOW_WIDTH - HORIZONTAL_PADDING);
  const maxArtHeight = Math.min(
    MAX_ART_EDGE,
    Math.max(1, MAX_WINDOW_HEIGHT - VERTICAL_PADDING - nameHeight - captionHeight - STACK_GAP * 2 - textRenderingSafePadding)
  );

  let scale = Math.min(1, maxArtWidth / normalizedNaturalWidth, maxArtHeight / normalizedNaturalHeight);
  const longestNaturalEdge = Math.max(normalizedNaturalWidth, normalizedNaturalHeight);
  if (longestNaturalEdge * scale < MIN_ART_EDGE) {
    scale = Math.min(maxArtWidth / normalizedNaturalWidth, maxArtHeight / normalizedNaturalHeight, MIN_ART_EDGE / longestNaturalEdge);
  }

  let artWidth = normalizedNaturalWidth * scale;
  let artHeight = normalizedNaturalHeight * scale;
  if (artWidth / artHeight !== aspectRatio) {
    artWidth = artHeight * aspectRatio;
  }

  const textWidth = Math.max(normalizePositive(input.nameWidth, 0), normalizePositive(input.captionWidth, 0));
  const contentWidth = Math.max(artWidth, Math.min(textWidth, MAX_WINDOW_WIDTH - HORIZONTAL_PADDING));
  const windowWidth = clamp(Math.ceil(contentWidth + HORIZONTAL_PADDING), MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
  const windowHeight = clamp(
    Math.ceil(nameHeight + artHeight + captionHeight + STACK_GAP * 2 + VERTICAL_PADDING + textRenderingSafePadding),
    MIN_WINDOW_HEIGHT,
    MAX_WINDOW_HEIGHT
  );

  return {
    art: {
      width: Math.max(1, Math.floor(artWidth)),
      height: Math.max(1, Math.floor(artHeight))
    },
    window: {
      width: windowWidth,
      height: windowHeight
    }
  };
}

function getAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }

  return width / height;
}

function normalizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
