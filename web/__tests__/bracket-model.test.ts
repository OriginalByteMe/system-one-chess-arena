import { describe, expect, test } from "bun:test";

import type { Bracket, Match, MatchSlot } from "../../src/core/types.ts";
import { bracketColumns } from "../src/bracket-model.ts";

/**
 * Builds a full single-elimination bracket with `rounds` rounds (so
 * `2 ** rounds` competitors), every match undecided. Round 0's slots hold
 * seeded competitors named `p0`, `p1`, ...; later rounds hold `winner-of`
 * slots pointing at the matching pair of matches in the previous round.
 */
function buildElimBracket(rounds: number, shuffleWithinRound = false): Bracket {
  const roundMatches: Match[][] = [];

  for (let round = 0; round < rounds; round += 1) {
    const count = 2 ** (rounds - 1 - round);
    const matches: Match[] = [];

    for (let slot = 0; slot < count; slot += 1) {
      const a: MatchSlot =
        round === 0
          ? { kind: "competitor", competitor: `p${slot * 2}` }
          : { kind: "winner-of", matchId: `r${round - 1}-m${slot * 2}` };
      const b: MatchSlot =
        round === 0
          ? { kind: "competitor", competitor: `p${slot * 2 + 1}` }
          : { kind: "winner-of", matchId: `r${round - 1}-m${slot * 2 + 1}` };

      matches.push({
        matchId: `r${round}-m${slot}`,
        bracketId: "bracket-1",
        round,
        slot,
        a,
        b,
        bestOf: 3,
        gameIds: [],
      });
    }

    roundMatches.push(shuffleWithinRound ? [...matches].reverse() : matches);
  }

  return {
    bracketId: "bracket-1",
    seasonId: "season-1",
    rounds: roundMatches,
  };
}

describe("bracket model", () => {
  test("emits one column per round, cells in slot order regardless of input order", () => {
    const bracket = buildElimBracket(3, true);

    const columns = bracketColumns(bracket);

    expect(columns).toHaveLength(3);
    expect(columns.map((column) => column.cells.length)).toEqual([4, 2, 1]);
    for (const column of columns) {
      expect(column.cells.map((cell) => cell.match.slot)).toEqual(
        column.cells.map((_, index) => index),
      );
    }
  });

  test("numbers a winner-of slot within its own feeder round, not globally across the bracket", () => {
    const bracket = buildElimBracket(3);

    const columns = bracketColumns(bracket);
    const semifinal = columns[1]?.cells[1];
    const final = columns[2]?.cells[0];

    expect(semifinal?.a).toBe("Winner of match 3");
    expect(semifinal?.b).toBe("Winner of match 4");
    expect(final?.a).toBe("Winner of match 1");
    expect(final?.b).toBe("Winner of match 2");
  });

  test("prints a winner-of slot as its feeder's match number, never a competitor name", () => {
    const feederA: Match = {
      matchId: "r0-m0",
      bracketId: "bracket-1",
      round: 0,
      slot: 0,
      a: { kind: "competitor", competitor: "alice" },
      b: { kind: "competitor", competitor: "bob" },
      bestOf: 3,
      gameIds: [],
      winner: "alice",
    };
    const feederB: Match = {
      matchId: "r0-m1",
      bracketId: "bracket-1",
      round: 0,
      slot: 1,
      a: { kind: "competitor", competitor: "carol" },
      b: { kind: "bye" },
      bestOf: 3,
      gameIds: [],
      winner: "carol",
    };
    const final: Match = {
      matchId: "r1-m0",
      bracketId: "bracket-1",
      round: 1,
      slot: 0,
      a: { kind: "winner-of", matchId: "r0-m0" },
      b: { kind: "winner-of", matchId: "r0-m1" },
      bestOf: 3,
      gameIds: [],
    };
    const bracket: Bracket = {
      bracketId: "bracket-1",
      seasonId: "season-1",
      rounds: [
        [feederA, feederB],
        [final],
      ],
    };

    const columns = bracketColumns(bracket);
    const finalCell = columns[1]?.cells[0];

    expect(finalCell?.a).toBe("Winner of match 1");
    expect(finalCell?.b).toBe("Winner of match 2");
    expect(finalCell?.a).not.toContain("alice");
    expect(finalCell?.a).not.toContain("bob");
    expect(finalCell?.b).not.toContain("carol");
    expect(finalCell?.decided).toBe(false);
    expect(finalCell?.winner).toBeUndefined();
  });

  test("prints a bye and reports the decided match's winner", () => {
    const decided: Match = {
      matchId: "r0-m0",
      bracketId: "bracket-1",
      round: 0,
      slot: 0,
      a: { kind: "competitor", competitor: "alice" },
      b: { kind: "competitor", competitor: "bob" },
      bestOf: 3,
      gameIds: ["g1"],
      winner: "alice",
    };
    const bye: Match = {
      matchId: "r0-m1",
      bracketId: "bracket-1",
      round: 0,
      slot: 1,
      a: { kind: "competitor", competitor: "carol" },
      b: { kind: "bye" },
      bestOf: 3,
      gameIds: [],
      winner: "carol",
    };
    const bracket: Bracket = {
      bracketId: "bracket-1",
      seasonId: "season-1",
      rounds: [[decided, bye]],
    };

    const [column] = bracketColumns(bracket);
    const [decidedCell, byeCell] = column?.cells ?? [];

    expect(decidedCell?.a).toBe("alice");
    expect(decidedCell?.b).toBe("bob");
    expect(decidedCell?.winner).toBe("alice");
    expect(decidedCell?.decided).toBe(true);

    expect(byeCell?.b).toBe("Bye");
  });

  test("leaves an undecided match without a winner", () => {
    const undecided: Match = {
      matchId: "r0-m0",
      bracketId: "bracket-1",
      round: 0,
      slot: 0,
      a: { kind: "competitor", competitor: "alice" },
      b: { kind: "competitor", competitor: "bob" },
      bestOf: 3,
      gameIds: [],
    };
    const bracket: Bracket = {
      bracketId: "bracket-1",
      seasonId: "season-1",
      rounds: [[undecided]],
    };

    const [column] = bracketColumns(bracket);
    const [cell] = column?.cells ?? [];

    expect(cell?.decided).toBe(false);
    expect(cell?.winner).toBeUndefined();
  });

  test("titles a two-competitor bracket's single round as Final", () => {
    const bracket = buildElimBracket(1);

    const columns = bracketColumns(bracket);

    expect(columns.map((column) => column.title)).toEqual(["Final"]);
  });

  test("titles a three-round bracket counting back from Final", () => {
    const bracket = buildElimBracket(3);

    const columns = bracketColumns(bracket);

    expect(columns.map((column) => column.title)).toEqual([
      "Quarter-finals",
      "Semi-finals",
      "Final",
    ]);
  });

  test("titles a four-round bracket's opening round Round of 16", () => {
    const bracket = buildElimBracket(4);

    const columns = bracketColumns(bracket);

    expect(columns.map((column) => column.title)).toEqual([
      "Round of 16",
      "Quarter-finals",
      "Semi-finals",
      "Final",
    ]);
  });

  test("numbers columns by round, ascending from round 0", () => {
    const bracket = buildElimBracket(3);

    const columns = bracketColumns(bracket);

    expect(columns.map((column) => column.round)).toEqual([0, 1, 2]);
  });
});
