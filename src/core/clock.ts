import { ContractViolation } from "./errors.ts";
import type { Clock, FixedClock } from "./types.ts";

export function createSystemClock(): Clock {
  return { now: () => performance.now() };
}

export function createFixedClock(startMs = 0): FixedClock {
  if (!Number.isFinite(startMs)) {
    throw new ContractViolation("clock.createFixedClock", "start must be finite");
  }

  let currentMs = startMs;
  return {
    now: () => currentMs,
    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new ContractViolation("clock.advance", "advance must be finite and non-negative");
      }
      currentMs += ms;
    },
  };
}
