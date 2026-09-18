import { describe, expect, test } from "bun:test";
import { legalMoves, positionFromFen } from "../../src/core/rules";
import type { EpochMs, RecordedGame, RevealWindow } from "../../src/core/types";
import { cacheControl, revealGame, revealedMoves } from "../../src/broadcast/gate";
import {
  BROADCAST_DECISIONS,
  BROADCAST_FINAL_FEN,
  BROADCAST_OUTCOME,
  broadcastSchedule,
  recordedGame,
  shuffledBroadcastDecisions,
} from "../fixtures/broadcast";

const MS_PER_PLY = 1_000;
const SCHEDULE = broadcastSchedule(0, MS_PER_PLY);
const GAME: RecordedGame = recordedGame(SCHEDULE);
const MOVES = BROADCAST_DECISIONS.length;
const BROADCAST_ENDS_AT: EpochMs = MOVES * MS_PER_PLY;

function decisionAt(ply: number) {
  const decision = BROADCAST_DECISIONS[ply];
  if (decision === undefined) throw new Error(`no fixture decision at ply ${ply}`);
  return decision;
}

function maxAgeOf(header: string): number {
  const match = /max-age=(\d+)/.exec(header);
  if (match === null) throw new Error(`no max-age in header: ${header}`);
  const value = match[1];
  if (value === undefined) throw new Error(`no max-age in header: ${header}`);
  return Number(value);
}

describe("revealGame", () => {
  test("slices decisions to the revealed prefix, sorted by ply, from a shuffled input", () => {
    const now: EpochMs = 2 * MS_PER_PLY + 500;
    const revealed = revealGame(GAME, shuffledBroadcastDecisions(), now);
    expect(revealed.decisions).toEqual([decisionAt(0), decisionAt(1)]);
    expect(revealed.decisions.map((d) => d.ply)).toEqual([0, 1]);
  });

  test("never lets an unrevealed move or a further fen leak into the response", () => {
    const now: EpochMs = 2 * MS_PER_PLY + 500;
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, now);
    const revealedPlies = revealed.window.revealedPlies;
    expect(revealedPlies).toBe(2);

    const serialized = JSON.stringify(revealed);
    for (let ply = revealedPlies; ply < MOVES; ply += 1) {
      expect(serialized).not.toContain(decisionAt(ply).move);
    }
    for (let ply = revealedPlies + 1; ply < MOVES; ply += 1) {
      expect(serialized).not.toContain(decisionAt(ply).fen);
    }
    expect(revealed.outcome).toBeUndefined();
  });

  test("hides the outcome while scheduled", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, -500);
    expect(revealed.window.status).toBe("scheduled");
    expect(revealed.outcome).toBeUndefined();
  });

  test("hides the outcome while on air", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, 5 * MS_PER_PLY);
    expect(revealed.window.status).toBe("on-air");
    expect(revealed.outcome).toBeUndefined();
  });

  test("reveals the outcome once finished", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, BROADCAST_ENDS_AT);
    expect(revealed.window.status).toBe("finished");
    expect(revealed.outcome).toEqual(BROADCAST_OUTCOME);
  });

  test("catchUp is false while scheduled", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, -500);
    expect(revealed.catchUp).toBe(false);
  });

  test("catchUp is false for the instant right before the broadcast ends", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, BROADCAST_ENDS_AT - 1);
    expect(revealed.window.status).toBe("on-air");
    expect(revealed.catchUp).toBe(false);
  });

  test("catchUp is true once finished", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, BROADCAST_ENDS_AT);
    expect(revealed.catchUp).toBe(true);
  });

  test("fen is the opening position before the broadcast starts", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, -500);
    expect(revealed.fen).toBe(decisionAt(0).fen);
  });

  test("fen is the position after the last revealed decision mid-broadcast", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, 2 * MS_PER_PLY + 500);
    expect(revealed.fen).toBe(decisionAt(2).fen);
  });

  test("fen is the final position once finished", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, BROADCAST_ENDS_AT);
    expect(revealed.fen).toBe(BROADCAST_FINAL_FEN);
  });

  test("revealedPlies never exceeds the recorded decision count", () => {
    const revealed = revealGame(GAME, BROADCAST_DECISIONS, 1_000 * MS_PER_PLY);
    expect(revealed.window.revealedPlies).toBe(MOVES);
    expect(revealed.decisions).toHaveLength(MOVES);
  });
});

describe("revealedMoves", () => {
  test("returns the legal moves at the revealed position and includes the played move", () => {
    const now: EpochMs = 2 * MS_PER_PLY + 500;
    const result = revealedMoves(GAME, BROADCAST_DECISIONS, now);
    const nextDecision = decisionAt(2);
    expect(result.fen).toBe(nextDecision.fen);
    expect(result.ply).toBe(2);

    const expectedLegalMoves = legalMoves(positionFromFen(nextDecision.fen));
    expect([...result.legalMoves].sort()).toEqual([...expectedLegalMoves].sort());
    expect(result.legalMoves).toContain(nextDecision.move);
  });

  test("carries no field revealing which legal move was actually played", () => {
    const now: EpochMs = 2 * MS_PER_PLY + 500;
    const result = revealedMoves(GAME, BROADCAST_DECISIONS, now);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["fen", "gameId", "legalMoves", "ply"].sort());
  });

  test("returns no legal moves once the game has ended in checkmate", () => {
    const result = revealedMoves(GAME, BROADCAST_DECISIONS, BROADCAST_ENDS_AT);
    expect(result.fen).toBe(BROADCAST_FINAL_FEN);
    expect(result.legalMoves).toEqual([]);
  });
});

describe("cacheControl", () => {
  function windowAt(now: EpochMs): RevealWindow {
    return revealGame(GAME, BROADCAST_DECISIONS, now).window;
  }

  test("expires at the next reveal boundary while on air, rounding up", () => {
    const now: EpochMs = 2 * MS_PER_PLY + 500;
    const window = windowAt(now);
    expect(window.nextBoundaryAt).toBe(3 * MS_PER_PLY);
    expect(maxAgeOf(cacheControl(window, now))).toBe(1);
  });

  test("floors the max-age at one second even with a tiny remainder", () => {
    const now: EpochMs = 3 * MS_PER_PLY - 1;
    const window = windowAt(now);
    expect(window.nextBoundaryAt).toBe(3 * MS_PER_PLY);
    const maxAge = maxAgeOf(cacheControl(window, now));
    expect(maxAge).toBeGreaterThanOrEqual(1);
    expect(maxAge).toBe(1);
  });

  test("expires at the first ply boundary while scheduled", () => {
    const now: EpochMs = -3_500;
    const window = windowAt(now);
    expect(window.status).toBe("scheduled");
    expect(window.nextBoundaryAt).toBe(MS_PER_PLY);
    expect(maxAgeOf(cacheControl(window, now))).toBe(
      Math.ceil((MS_PER_PLY - now) / 1_000),
    );
  });

  test("is immutable with a long max-age once finished", () => {
    const now: EpochMs = BROADCAST_ENDS_AT;
    const window = windowAt(now);
    expect(window.status).toBe("finished");
    const header = cacheControl(window, now);
    expect(header).toContain("immutable");
    expect(maxAgeOf(header)).toBeGreaterThanOrEqual(86_400);
  });
});
