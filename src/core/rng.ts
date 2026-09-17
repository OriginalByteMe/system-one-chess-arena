import { ContractViolation } from "./errors.ts";
import type { Rng } from "./types.ts";

export function createRng(seed: string): Rng {
  let state = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16_777_619);
  }

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  const nextInt = (boundExclusive: number): number => {
    if (!Number.isSafeInteger(boundExclusive) || boundExclusive <= 0) {
      throw new ContractViolation("rng.nextInt", "bound must be a positive integer");
    }
    return Math.floor(next() * boundExclusive);
  };

  return {
    next,
    nextInt,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new ContractViolation("rng.pick", "items must not be empty");
      }
      return items[nextInt(items.length)]!;
    },
  };
}
