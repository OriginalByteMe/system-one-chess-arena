import { NotImplemented } from "../../src/core/errors.ts";
import type {
  DecisionRecord,
  Fen,
  RevealedGame,
  Uci,
} from "../../src/core/types.ts";

export interface ProbabilityBar {
  readonly move: Uci;
  readonly probability: number;
  /** True for the move actually played. */
  readonly chosen: boolean;
}

/**
 * Bars for the move just played, highest probability first.
 *
 * Contract:
 * - Built from the recorded distribution, which is already stored, so nothing
 *   is inferred.
 * - The played move always appears, even when the distribution omits it, at
 *   probability zero, because the panel must never hide what happened.
 * - No distribution gives a single bar for the played move at probability 1
 *   when confidence is absent, and at the stated confidence when it is not.
 * - `limit` keeps the top n, and the played move survives the cut.
 */
export function probabilityBars(
  decision: DecisionRecord,
  limit?: number,
): readonly ProbabilityBar[] {
  void decision;
  void limit;
  throw new NotImplemented("web.watchModel.probabilityBars");
}

export interface GuessState {
  /** Ply the outstanding guess was made at, if any. */
  readonly ply?: number;
  readonly guess?: Uci;
  readonly settled: number;
  readonly hits: number;
  /** Whether the last settled guess was right, for the flash of feedback. */
  readonly lastCorrect?: boolean;
}

export const NO_GUESSES: GuessState = { settled: 0, hits: 0 };

/**
 * Records a guess for the position about to be played.
 *
 * Contract: one outstanding guess at a time; a second guess at the same ply
 * replaces it, and a guess at a new ply abandons the old one unsettled rather
 * than scoring it. Guesses live in local storage, so there are no accounts.
 */
export function recordGuess(
  state: GuessState,
  ply: number,
  guess: Uci,
): GuessState {
  void state;
  void ply;
  void guess;
  throw new NotImplemented("web.watchModel.recordGuess");
}

/**
 * Scores the outstanding guess once the move is revealed.
 *
 * Contract: only a guess whose ply matches the revealed decision scores;
 * anything else leaves the state alone, so a late reveal cannot inflate a hit
 * rate. Settling twice on the same decision counts once.
 */
export function settleGuess(
  state: GuessState,
  decision: DecisionRecord,
): GuessState {
  void state;
  void decision;
  throw new NotImplemented("web.watchModel.settleGuess");
}

export interface ScrubFrame {
  readonly fen: Fen;
  readonly index: number;
  readonly decision?: DecisionRecord;
}

/**
 * The board at one point in a revealed game, for scrub and rewind.
 *
 * Contract:
 * - `index` counts revealed decisions: 0 is the opening position, n is after
 *   the nth revealed move.
 * - Every frame comes from a stored fen, so no chess engine ships to the
 *   browser.
 * - An index past the revealed prefix clamps to the live frame. A viewer may
 *   lag the broadcast but must never run ahead of it.
 */
export function scrub(game: RevealedGame, index: number): ScrubFrame {
  void game;
  void index;
  throw new NotImplemented("web.watchModel.scrub");
}
