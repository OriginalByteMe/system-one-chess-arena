import { Chess, type Move, type PieceSymbol } from "chess.js";

import type {
  DecisionRecord,
  Fen,
  RevealedGame,
  San,
  Uci,
} from "../../src/core/types.ts";
import { OPENINGS } from "../../src/season/openings.ts";

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
  const { distribution } = decision;
  if (distribution === undefined) {
    return [
      { move: decision.move, probability: decision.confidence ?? 1, chosen: true },
    ];
  }

  const probabilities = new Map<Uci, number>(Object.entries(distribution));
  probabilities.set(decision.move, probabilities.get(decision.move) ?? 0);

  const bars: ProbabilityBar[] = [...probabilities].map(([move, probability]) => ({
    move,
    probability,
    chosen: move === decision.move,
  }));

  const byRank = (a: ProbabilityBar, b: ProbabilityBar): number =>
    b.probability - a.probability || (a.move < b.move ? -1 : a.move > b.move ? 1 : 0);

  bars.sort(byRank);

  if (limit === undefined || bars.length <= limit) {
    return bars;
  }

  const kept = bars.filter((bar) => bar.chosen);
  for (const bar of bars) {
    if (kept.length >= limit) break;
    if (!bar.chosen) kept.push(bar);
  }
  return kept.sort(byRank);
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
  return { ply, guess, settled: state.settled, hits: state.hits };
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
  if (state.ply === undefined || state.ply !== decision.ply) {
    return state;
  }

  const correct = state.guess === decision.move;
  return {
    settled: state.settled + 1,
    hits: state.hits + (correct ? 1 : 0),
    lastCorrect: correct,
  };
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
  const clamped = Math.min(Math.max(index, 0), game.decisions.length);
  const decision = clamped === 0 ? undefined : game.decisions[clamped - 1];
  const fen: Fen = clamped < game.decisions.length
    ? (game.decisions[clamped] as DecisionRecord).fen
    : game.fen;
  return { fen, index: clamped, decision };
}

const PIECE_VALUES: Readonly<Record<PieceSymbol, number>> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const ROLE_NAMES: Readonly<Record<PieceSymbol, string>> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export interface MoveMeta {
  readonly san: San;
  readonly capturedRole: string | undefined;
  readonly capturedValue: number;
  readonly isCheck: boolean;
}

export interface Replay {
  /** One FEN per step: index 0 is the position before the first decision, index i (i >= 1) is right after decisions[i - 1] landed. */
  readonly positions: readonly Fen[];
  /** Parallel to `decisions`: the move that produced `positions[i + 1]` from `positions[i]`. */
  readonly moves: readonly MoveMeta[];
}

export interface OpeningReplay extends Replay {
  readonly name: string;
  /** UCI for each prepared move, parallel to `moves`. */
  readonly uciMoves: readonly Uci[];
}

function moveMeta(move: Move, chess: Chess): MoveMeta {
  return {
    san: move.san,
    capturedRole: move.captured === undefined ? undefined : ROLE_NAMES[move.captured],
    capturedValue: move.captured === undefined ? 0 : PIECE_VALUES[move.captured],
    isCheck: chess.inCheck(),
  };
}

/**
 * Reconstructs a configured prepared opening only when the recording starts
 * at that opening's declared position. Unknown or stale metadata must never
 * invent moves that were not part of the recorded game.
 */
export function replayOpening(
  openingId: string | undefined,
  firstFen: Fen | undefined,
): OpeningReplay | undefined {
  if (openingId === undefined || firstFen === undefined) return undefined;
  const opening = OPENINGS.find((candidate) => candidate.id === openingId);
  if (opening === undefined || opening.fen !== firstFen) return undefined;

  const chess = new Chess();
  const positions: Fen[] = [chess.fen()];
  const moves: MoveMeta[] = [];
  const uciMoves: Uci[] = [];

  for (const san of opening.moves) {
    const played = chess.move(san);
    positions.push(chess.fen());
    moves.push(moveMeta(played, chess));
    uciMoves.push(`${played.from}${played.to}${played.promotion ?? ""}`);
  }

  return { name: opening.name, positions, moves, uciMoves };
}

/**
 * Replays a revealed decision list through chess.js to recover the
 * algebraic detail (SAN, capture, check) the recorded rows do not carry.
 *
 * Contract: an empty list replays to an empty result rather than throwing,
 * because a scheduled or freshly-started game has aired nothing yet.
 */
export function replayDecisions(decisions: readonly DecisionRecord[]): Replay {
  const first = decisions[0];
  if (first === undefined) return { positions: [], moves: [] };

  const chess = new Chess(first.fen);
  const positions: Fen[] = [first.fen];
  const moves: MoveMeta[] = [];

  for (const decision of decisions) {
    const from = decision.move.slice(0, 2);
    const to = decision.move.slice(2, 4);
    const promotion = decision.move.length > 4 ? decision.move.slice(4, 5) : undefined;
    const result = chess.move({ from, to, ...(promotion === undefined ? {} : { promotion }) });
    positions.push(chess.fen());
    moves.push(moveMeta(result, chess));
  }

  return { positions, moves };
}

export type MomentKind = "audible" | "capture" | "lowConfidence" | "slow";

export interface Moment {
  readonly index: number;
  readonly kinds: readonly MomentKind[];
  readonly headline: string;
}

const MOMENT_ORDER: readonly MomentKind[] = ["audible", "capture", "lowConfidence", "slow"];

const LOW_CONFIDENCE_THRESHOLD = 0.1;
const SLOW_THINK_Z_SCORE = 1;
const BIG_CAPTURE_SCORE = 5;

export const MOMENT_LABEL: Readonly<Record<MomentKind, string>> = {
  audible: "audible",
  capture: "capture",
  lowConfidence: "low confidence",
  slow: "slow think",
};

interface LatencyStat {
  readonly mean: number;
  readonly sd: number;
}

function latencyStatsByCompetitor(decisions: readonly DecisionRecord[]): ReadonlyMap<string, LatencyStat> {
  const byCompetitor = new Map<string, number[]>();
  for (const decision of decisions) {
    const list = byCompetitor.get(decision.competitor) ?? [];
    list.push(decision.latencyMs);
    byCompetitor.set(decision.competitor, list);
  }
  const stats = new Map<string, LatencyStat>();
  for (const [name, values] of byCompetitor) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    stats.set(name, { mean, sd: Math.sqrt(variance) });
  }
  return stats;
}

function headlineFor(decision: DecisionRecord, move: MoveMeta, kinds: readonly MomentKind[]): string {
  const parts: string[] = [];
  if (kinds.includes("audible")) parts.push("passed on its own top pick");
  if (kinds.includes("capture")) {
    const what = move.capturedRole === undefined ? "a piece" : `the ${move.capturedRole}`;
    parts.push(`took ${what}${move.isCheck ? " with check" : ""}`);
  }
  if (kinds.includes("lowConfidence")) {
    parts.push(`only ${Math.round((decision.confidence ?? 0) * 100)}% sure`);
  }
  if (kinds.includes("slow")) parts.push("burned extra time on this one");
  return parts.join(" · ");
}

/**
 * Flags outlier decisions within the given (already revealed) run.
 *
 * Contract: every flag is computed off the recorded numbers for this run —
 * a slow think is relative to the competitor's own median here, never a
 * fixed constant, so a naturally slow player is not flagged on every move.
 */
export function computeMoments(
  decisions: readonly DecisionRecord[],
  moves: readonly MoveMeta[],
): readonly Moment[] {
  const stats = latencyStatsByCompetitor(decisions);
  const moments: Moment[] = [];

  decisions.forEach((decision, index) => {
    const move = moves[index];
    if (move === undefined) return;

    const kinds: MomentKind[] = [];
    const stat = stats.get(decision.competitor);
    if (stat !== undefined && stat.sd > 0 && (decision.latencyMs - stat.mean) / stat.sd > SLOW_THINK_Z_SCORE) {
      kinds.push("slow");
    }
    if (decision.confidence !== undefined && decision.confidence < LOW_CONFIDENCE_THRESHOLD) {
      kinds.push("lowConfidence");
    }
    const topCandidate = decision.distribution === undefined
      ? undefined
      : Object.entries(decision.distribution).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topCandidate !== undefined && topCandidate !== decision.move) kinds.push("audible");
    if (move.capturedValue + (move.isCheck ? 3 : 0) >= BIG_CAPTURE_SCORE) kinds.push("capture");

    if (kinds.length === 0) return;
    const sorted = MOMENT_ORDER.filter((kind) => kinds.includes(kind));
    moments.push({ index, kinds: sorted, headline: headlineFor(decision, move, sorted) });
  });

  return moments;
}

/**
 * The decision at `index`, clamped into range.
 *
 * Contract: returns undefined only when the list itself is empty — a game
 * that has not aired a single ply yet has nothing to examine.
 */
export function decisionAtIndex(
  decisions: readonly DecisionRecord[],
  index: number,
): DecisionRecord | undefined {
  if (decisions.length === 0) return undefined;
  const clamped = Math.min(Math.max(index, 0), decisions.length - 1);
  return decisions[clamped];
}

/** The last decision `colour` made at or before `uptoIndex`. */
export function latestForColour(
  decisions: readonly DecisionRecord[],
  uptoIndex: number,
  colour: "white" | "black",
): DecisionRecord | undefined {
  let latest: DecisionRecord | undefined;
  for (let i = 0; i <= Math.min(uptoIndex, decisions.length - 1); i += 1) {
    const candidate = decisions[i];
    if (candidate !== undefined && candidate.colour === colour) latest = candidate;
  }
  return latest;
}
