import { NotImplemented } from "./errors.ts";
import type { Rng } from "./types.ts";

export function createRng(seed: string): Rng {
  throw new NotImplemented("rng.createRng");
}
