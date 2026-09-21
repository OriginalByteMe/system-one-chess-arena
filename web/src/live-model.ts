// Bridges the live spectator stream into the exact shape the recorded
// broadcast already renders from, so the broadcast page is a source swap
// rather than a second UI. Also carries the small decision logic for which
// source is live right now and what to tell a viewer before either source
// has anything to show.
import type {
  Colour,
  CompetitorRef,
  DecisionRecord,
  Fen,
  ResultEvent,
  RevealWindow,
  SpectatorState,
  TerminalState,
} from "../../src/core/types.ts";
import type { ConnectionState } from "./use-spectator.ts";

/**
 * The competitor playing `colour`, once it has moved at least once. A live
 * stream names only the mover of each decision, so a side that has not
 * played yet - true only before its very first move - has no known identity.
 */
export function liveCompetitor(decisions: readonly DecisionRecord[], colour: Colour): CompetitorRef | undefined {
  const found = decisions.find((decision) => decision.colour === colour);
  return found === undefined ? undefined : { name: found.competitor, version: found.version };
}

/**
 * The season a live game belongs to, known as soon as its first decision
 * lands even when the route that opened the socket carried none, as
 * `/live/<gameId>` does.
 */
export function liveSeasonId(decisions: readonly DecisionRecord[]): string | undefined {
  return decisions[0]?.seasonId;
}

/** A finished live game's result, in the same shape the recorded outcome uses. */
export function liveOutcome(finished: ResultEvent | undefined): TerminalState | undefined {
  if (finished === undefined) return undefined;
  return {
    result: finished.result,
    reason: finished.reason,
    ...(finished.adjudicatedCp === undefined ? {} : { adjudicatedCp: finished.adjudicatedCp }),
  };
}

/**
 * The recorded broadcast's own shape, so the page can render either source
 * through one set of components. A live game replays in full on every join -
 * the socket has no spoiler gate - so `catchUp` is always true and there is
 * never a scheduled reveal to count down to.
 */
export interface BroadcastView {
  readonly seasonId: string | undefined;
  readonly gameId: string;
  readonly white: CompetitorRef | undefined;
  readonly black: CompetitorRef | undefined;
  readonly openingId: string | undefined;
  readonly window: RevealWindow;
  readonly fen: Fen;
  readonly decisions: readonly DecisionRecord[];
  readonly outcome?: TerminalState;
  readonly catchUp: boolean;
}

export function viewFromLive(state: SpectatorState, gameId: string): BroadcastView {
  return {
    seasonId: liveSeasonId(state.decisions),
    gameId,
    white: liveCompetitor(state.decisions, "white"),
    black: liveCompetitor(state.decisions, "black"),
    openingId: undefined,
    window: {
      status: state.finished === undefined ? "on-air" : "finished",
      revealedPlies: state.decisions.length,
    },
    fen: state.fen,
    decisions: state.decisions,
    outcome: liveOutcome(state.finished),
    catchUp: true,
  };
}

export type BroadcastStatusScreen = "connecting" | "not-started" | "error";

export interface StatusInput {
  readonly hasSeasonId: boolean;
  readonly recordedError: string | undefined;
  readonly spectatorConnection: ConnectionState;
  readonly spectatorEverConnected: boolean;
}

/**
 * What to tell a viewer before either source has anything to render.
 *
 * A recorded 404 only means the game has not been filed - it says nothing
 * about whether it has started - so it never surfaces as an error by itself;
 * only a socket that has never once opened downgrades the screen to "not
 * started", since that is the one signal a nonexistent game and a slow
 * connection cannot both produce.
 */
export function classifyStatus(input: StatusInput): BroadcastStatusScreen {
  if (input.hasSeasonId && input.recordedError !== undefined && input.recordedError !== "Not found.") {
    return "error";
  }
  if (input.spectatorConnection === "offline" && !input.spectatorEverConnected) {
    return "not-started";
  }
  return "connecting";
}
