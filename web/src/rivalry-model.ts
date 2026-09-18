import { NotImplemented } from "../../src/core/errors.ts";
import type {
  HeadToHeadResult,
  RivalrySummary,
} from "../../src/core/types.ts";

export interface RivalryEvent {
  readonly gameId: string;
  readonly result: HeadToHeadResult;
  /** Trait ids that became active because of this game. */
  readonly triggered: readonly string[];
}

/**
 * The head-to-head timeline, oldest first.
 *
 * Contract: a trait is attributed to the game that completed its condition, so
 * "nemesis" appears on the third loss and not the first. Only games the server
 * revealed appear, since the summary is already gated.
 */
export function rivalryTimeline(
  summary: RivalrySummary,
): readonly RivalryEvent[] {
  void summary;
  throw new NotImplemented("web.rivalryModel.rivalryTimeline");
}

/** One-line banner text, or undefined when the pair has no history worth it. */
export function rivalryBanner(summary: RivalrySummary): string | undefined {
  void summary;
  throw new NotImplemented("web.rivalryModel.rivalryBanner");
}
