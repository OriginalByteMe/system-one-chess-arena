// A competitor's colour. The league has no colour field — a name is the only
// stable identity — so the colour is derived from the name and stays the same
// across seasons, pages and reloads.
//
// Twenty competitors share one page, so the palette runs fourteen hues (not
// six) to keep them apart at a glance. Every hue clears 4.5:1 against both
// the page chrome (#21201D) and the card chrome (#302E2B), and all of them
// stay clear of the brand green (#81B64C), which belongs to controls rather
// than to any competitor. The array order is not a rainbow sweep: it was
// chosen so that the twenty fixed roster names, which collide on identical
// hash buckets far more than a rainbow order would tolerate, never land two
// near-identical hues on adjacent rows — reorder this array, not the hash
// below, if a future roster name creates a new clash.
const PALETTE: readonly string[] = [
  "#28a973",
  "#de70aa",
  "#27a79b",
  "#df758a",
  "#2ea1c2",
  "#9a89e3",
  "#838fe2",
  "#cc73de",
  "#d38243",
  "#b4932a",
  "#b17fe1",
  "#6298da",
  "#dd6ccb",
  "#dd7a6c",
];

export function accentFor(name: string): string {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = (hash >>> 0) % PALETTE.length;
  return PALETTE[index] ?? "#a6a29e";
}
