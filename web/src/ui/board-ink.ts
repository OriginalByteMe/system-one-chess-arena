// A persona's accent is tuned for the dark chrome, where it needs to be bright.
// The board is the opposite problem: arrows and last-move rings are drawn on a
// cream square, and a bright accent disappears on it. This darkens an accent
// along its own hue until it clears roughly 4:1 against the light square, so
// every competitor's colour stays recognisable and stays readable.
const LIGHT_SQUARE_LUMINANCE = 0.83;
/** Relative luminance that clears 4:1 against the light square. */
const TARGET = (LIGHT_SQUARE_LUMINANCE + 0.05) / 4 - 0.05;

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const cache = new Map<string, string>();

export function boardInk(accent: string): string {
  const cached = cache.get(accent);
  if (cached !== undefined) return cached;

  const hex = accent.replace("#", "");
  const parsed = hex.length === 6 ? Number.parseInt(hex, 16) : Number.NaN;
  if (Number.isNaN(parsed)) return accent;

  let r = (parsed >> 16) & 0xff;
  let g = (parsed >> 8) & 0xff;
  let b = parsed & 0xff;
  // Multiplicative steps keep the hue exactly where the persona put it.
  for (let step = 0; step < 40 && luminance(r, g, b) > TARGET; step += 1) {
    r = Math.round(r * 0.95);
    g = Math.round(g * 0.95);
    b = Math.round(b * 0.95);
  }

  const ink = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  cache.set(accent, ink);
  return ink;
}
