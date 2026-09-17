import { NotImplemented } from "./errors.ts";
import type { Clock, FixedClock } from "./types.ts";

export function createSystemClock(): Clock {
  throw new NotImplemented("clock.createSystemClock");
}

export function createFixedClock(startMs?: number): FixedClock {
  throw new NotImplemented("clock.createFixedClock");
}
