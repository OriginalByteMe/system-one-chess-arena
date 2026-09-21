import { useEffect, useState } from "react";

import type { EpochMs } from "../../../../src/core/types.ts";

/**
 * Milliseconds remaining until `target`, ticking twice a second while a
 * target is set.
 *
 * Contract: an undefined target — a finished broadcast has no next boundary
 * — yields undefined rather than a stale number, so a caller never renders a
 * countdown toward nothing.
 */
export function useCountdown(target: EpochMs | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (target === undefined) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [target]);

  return target === undefined ? undefined : Math.max(0, target - now);
}

/** "94000" -> "1:34", "8000" -> "8s". */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}
