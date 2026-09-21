import { describe, expect, test } from "bun:test";

import { ContractViolation } from "../../src/core/errors.ts";
import type { Bracket, Match, MatchOutcome, MatchSlot } from "../../src/core/types.ts";
import {
  advanceBracket,
  buildBracket,
  resolveSlot,
  revealBracket,
} from "../../src/match/bracket.ts";

function matchById(bracket: Bracket, matchId: string): Match {
  const match = bracket.rounds.flat().find((candidate) => candidate.matchId === matchId);
  if (match === undefined) throw new Error(`fixture bug: no match ${matchId} in bracket`);
  return match;
}

function competitorName(slot: MatchSlot): string {
  if (slot.kind !== "competitor") throw new Error(`fixture bug: expected a competitor slot, got ${slot.kind}`);
  return slot.competitor;
}

function seeds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `seed-${index + 1}`);
}

describe("buildBracket", () => {
  test("lays out 8 seeds as 3 rounds of 4, 2 and 1 matches with competitor slots in round 0", () => {
    const bracket = buildBracket({
      bracketId: "bracket-8",
      seasonId: "season-1",
      seeds: seeds(8),
      bestOf: 1,
    });

    expect(bracket.rounds).toHaveLength(3);
    expect(bracket.rounds[0]).toHaveLength(4);
    expect(bracket.rounds[1]).toHaveLength(2);
    expect(bracket.rounds[2]).toHaveLength(1);

    for (const match of bracket.rounds[0]!) {
      expect(match.a.kind).toBe("competitor");
      expect(match.b.kind).toBe("competitor");
    }
  });

  test("gives every match a stable, round/slot-derived id", () => {
    const args = {
      bracketId: "bracket-8",
      seasonId: "season-1",
      seeds: seeds(8),
      bestOf: 1,
    };

    const first = buildBracket(args);
    const second = buildBracket(args);
    expect(second).toEqual(first);

    for (const [round, matches] of first.rounds.entries()) {
      for (const [slot, match] of matches.entries()) {
        expect(match.matchId).toBe(`bracket-8:r${round}m${slot}`);
        expect(match.round).toBe(round);
        expect(match.slot).toBe(slot);
        expect(match.bracketId).toBe("bracket-8");
      }
    }
  });

  test("later rounds hold winner-of slots pointing at the two matches that feed them", () => {
    const bracket = buildBracket({
      bracketId: "bracket-8",
      seasonId: "season-1",
      seeds: seeds(8),
      bestOf: 1,
    });

    for (const round of [1, 2]) {
      const matches = bracket.rounds[round]!;
      for (const [slot, match] of matches.entries()) {
        const feederA = bracket.rounds[round - 1]![slot * 2]!;
        const feederB = bracket.rounds[round - 1]![slot * 2 + 1]!;
        expect(match.a).toEqual({ kind: "winner-of", matchId: feederA.matchId });
        expect(match.b).toEqual({ kind: "winner-of", matchId: feederB.matchId });
      }
    }
  });

  test("seeds the top seed against the weakest live opponent", () => {
    const all = seeds(8);
    const bracket = buildBracket({
      bracketId: "bracket-8",
      seasonId: "season-1",
      seeds: all,
      bestOf: 1,
    });

    const topSeedMatch = bracket.rounds[0]!.find(
      (match) => competitorName(match.a) === all[0] || competitorName(match.b) === all[0],
    );
    if (topSeedMatch === undefined) throw new Error("fixture bug: top seed missing from round 0");

    const opponent =
      competitorName(topSeedMatch.a) === all[0]
        ? competitorName(topSeedMatch.b)
        : competitorName(topSeedMatch.a);
    expect(opponent).toBe(all[all.length - 1]!);
  });

  test("keeps seeds 1 and 2 on opposite halves so they can only meet in the final", () => {
    const all = seeds(8);
    const bracket = buildBracket({
      bracketId: "bracket-8",
      seasonId: "season-1",
      seeds: all,
      bestOf: 1,
    });

    function leaves(slot: MatchSlot): Set<string> {
      if (slot.kind === "competitor") return new Set([slot.competitor]);
      if (slot.kind === "bye") return new Set();
      const feeder = matchById(bracket, slot.matchId);
      return new Set([...leaves(feeder.a), ...leaves(feeder.b)]);
    }

    const final = bracket.rounds[bracket.rounds.length - 1]![0]!;
    const sideA = leaves(final.a);
    const sideB = leaves(final.b);

    const [top, second] = [all[0]!, all[1]!];
    const oneSideHasBoth = sideA.has(top) && sideA.has(second);
    const otherSideHasBoth = sideB.has(top) && sideB.has(second);
    expect(oneSideHasBoth || otherSideHasBoth).toBe(false);
    expect(sideA.has(top) !== sideB.has(top)).toBe(true);
    expect(sideA.has(second) !== sideB.has(second)).toBe(true);
  });

  test("pads 6 seeds up to 8 and gives the byes to the two strongest seeds", () => {
    const all = seeds(6);
    const bracket = buildBracket({
      bracketId: "bracket-6",
      seasonId: "season-1",
      seeds: all,
      bestOf: 1,
    });

    expect(bracket.rounds).toHaveLength(3);
    expect(bracket.rounds[0]).toHaveLength(4);

    const byeMatches = bracket.rounds[0]!.filter(
      (match) => match.a.kind === "bye" || match.b.kind === "bye",
    );
    expect(byeMatches).toHaveLength(2);

    const liveSidesOfByeMatches = byeMatches
      .map((match) => (match.a.kind === "bye" ? match.b : match.a))
      .map(competitorName)
      .sort();
    expect(liveSidesOfByeMatches).toEqual([all[0]!, all[1]!].sort());

    const noByeMatches = bracket.rounds[0]!.filter(
      (match) => match.a.kind !== "bye" && match.b.kind !== "bye",
    );
    for (const match of noByeMatches) {
      expect([all[0]!, all[1]!]).not.toContain(competitorName(match.a));
      expect([all[0]!, all[1]!]).not.toContain(competitorName(match.b));
    }
  });

  test("rejects fewer than two seeds", () => {
    expect(() =>
      buildBracket({ bracketId: "b", seasonId: "s", seeds: [], bestOf: 1 }),
    ).toThrow(ContractViolation);
    expect(() =>
      buildBracket({ bracketId: "b", seasonId: "s", seeds: ["only-one"], bestOf: 1 }),
    ).toThrow(ContractViolation);
  });
});

describe("advanceBracket", () => {
  function simpleFourBracket(): Bracket {
    return buildBracket({
      bracketId: "bracket-4",
      seasonId: "season-1",
      seeds: seeds(4),
      bestOf: 1,
    });
  }

  function scoreOutcome(match: Match, winnerSlot: "a" | "b"): MatchOutcome {
    const winner = competitorName(winnerSlot === "a" ? match.a : match.b);
    const loser = competitorName(winnerSlot === "a" ? match.b : match.a);
    return {
      matchId: match.matchId,
      winner,
      loser,
      scoreA: winnerSlot === "a" ? 1 : 0,
      scoreB: winnerSlot === "a" ? 0 : 1,
      decidedBy: "score",
    };
  }

  test("sets a winner and promotes it into the next round's slot, leaving the sibling as winner-of", () => {
    const bracket = simpleFourBracket();
    const [m0, m1] = bracket.rounds[0]!;
    const final = bracket.rounds[1]![0]!;
    const outcome = scoreOutcome(m0!, "a");

    const advanced = advanceBracket(bracket, [outcome]);

    expect(matchById(advanced, m0!.matchId).winner).toBe(outcome.winner);
    expect(matchById(advanced, m1!.matchId).winner).toBeUndefined();

    const advancedFinal = matchById(advanced, final.matchId);
    const slotFedByM0 = final.a.kind === "winner-of" && final.a.matchId === m0!.matchId ? "a" : "b";
    const slotFedByM1 = slotFedByM0 === "a" ? "b" : "a";

    expect(advancedFinal[slotFedByM0]).toEqual({ kind: "competitor", competitor: outcome.winner });
    expect(advancedFinal[slotFedByM1]).toEqual({ kind: "winner-of", matchId: m1!.matchId });
  });

  test("resolves a match against a bye in favour of the live side with no outcome supplied", () => {
    const bracket = buildBracket({
      bracketId: "bracket-3",
      seasonId: "season-1",
      seeds: seeds(3),
      bestOf: 1,
    });
    const byeMatch = bracket.rounds[0]!.find(
      (match) => match.a.kind === "bye" || match.b.kind === "bye",
    );
    if (byeMatch === undefined) throw new Error("fixture bug: expected a bye in a 3-seed bracket");
    const liveName = competitorName(byeMatch.a.kind === "bye" ? byeMatch.b : byeMatch.a);
    const liveMatch = bracket.rounds[0]!.find(
      (match) => match.matchId !== byeMatch.matchId,
    )!;

    const advanced = advanceBracket(bracket, []);

    expect(matchById(advanced, byeMatch.matchId).winner).toBe(liveName);
    expect(byeMatch.gameIds).toEqual([]);
    expect(matchById(advanced, liveMatch.matchId).winner).toBeUndefined();
  });

  test("is idempotent: reapplying the same outcomes changes nothing", () => {
    const bracket = simpleFourBracket();
    const [m0] = bracket.rounds[0]!;
    const outcome = scoreOutcome(m0!, "b");

    const once = advanceBracket(bracket, [outcome]);
    const twice = advanceBracket(once, [outcome]);

    expect(twice).toEqual(once);
  });

  test("keeps earlier winners when only the next round's outcomes arrive", () => {
    const bracket = simpleFourBracket();
    const firstRound = bracket.rounds[0]!.map((match) => scoreOutcome(match, "a"));
    const semifinal = advanceBracket(bracket, firstRound);
    const final = semifinal.rounds[1]![0]!;
    const finalOutcome = scoreOutcome(final, "b");
    const completed = advanceBracket(semifinal, [finalOutcome]);

    expect(completed.rounds[0]).toEqual(semifinal.rounds[0]);
    expect(completed.rounds[1]![0]).toEqual({ ...final, winner: finalOutcome.winner });
    expect(advanceBracket(completed, [])).toEqual(completed);
  });

  test("rejects an outcome for a match id that is not in the bracket", () => {
    const bracket = simpleFourBracket();
    const outcome: MatchOutcome = {
      matchId: "not-a-real-match",
      winner: "nobody",
      loser: "nobody-else",
      scoreA: 1,
      scoreB: 0,
      decidedBy: "score",
    };

    expect(() => advanceBracket(bracket, [outcome])).toThrow(ContractViolation);
  });
});

describe("revealBracket", () => {
  function fullyDecidedEightBracket(): { pristine: Bracket; decided: Bracket } {
    const pristine = buildBracket({
      bracketId: "bracket-reveal",
      seasonId: "season-1",
      seeds: seeds(8),
      bestOf: 1,
    });

    function predictedWinner(slot: MatchSlot): string {
      if (slot.kind === "competitor") return slot.competitor;
      if (slot.kind === "bye") throw new Error("fixture bug: no bye expected in an 8-seed bracket");
      return predictedWinner(matchById(pristine, slot.matchId).a);
    }

    const outcomes: MatchOutcome[] = pristine.rounds.flat().map((match) => ({
      matchId: match.matchId,
      winner: predictedWinner(match.a),
      loser: predictedWinner(match.b),
      scoreA: 1,
      scoreB: 0,
      decidedBy: "score",
    }));

    return { pristine, decided: advanceBracket(pristine, outcomes) };
  }

  test("revealing nothing exactly reconstructs the pristine, undecided bracket", () => {
    const { pristine, decided } = fullyDecidedEightBracket();

    expect(revealBracket(decided, [])).toEqual(pristine);
  });

  test("revealing every match id exactly reproduces the fully decided bracket", () => {
    const { decided } = fullyDecidedEightBracket();
    const everyId = decided.rounds.flat().map((match) => match.matchId);

    expect(revealBracket(decided, everyId)).toEqual(decided);
  });

  test("revealing only round 0 strips every later winner and reverts every later slot, leaking nothing about the final", () => {
    const { decided } = fullyDecidedEightBracket();
    const round0Ids = decided.rounds[0]!.map((match) => match.matchId);

    const revealed = revealBracket(decided, round0Ids);

    for (const match of revealed.rounds[0]!) {
      const originalWinner = matchById(decided, match.matchId).winner;
      expect(match.winner).toBe(originalWinner);
    }

    for (const match of revealed.rounds[1]!) {
      expect(match.winner).toBeUndefined();
      const original = matchById(decided, match.matchId);
      expect(match.a).toEqual(original.a);
      expect(match.b).toEqual(original.b);
    }

    const revealedFinal = revealed.rounds[2]![0]!;
    expect(revealedFinal.winner).toBeUndefined();
    expect(revealedFinal.a.kind).toBe("winner-of");
    expect(revealedFinal.b.kind).toBe("winner-of");
    const semifinalIds = decided.rounds[1]!.map((match) => match.matchId);
    const revealedFeederIds = [revealedFinal.a, revealedFinal.b]
      .filter((slot): slot is Extract<MatchSlot, { kind: "winner-of" }> => slot.kind === "winner-of")
      .map((slot) => slot.matchId);
    expect(revealedFeederIds.sort()).toEqual(semifinalIds.sort());

    const finalJson = JSON.stringify(revealedFinal);
    for (const name of seeds(8)) {
      expect(finalJson.includes(name)).toBe(false);
    }
  });

  test("keeps the bracket's shape: same round count, same match ids, same feeders", () => {
    const { decided } = fullyDecidedEightBracket();
    const revealed = revealBracket(decided, [decided.rounds[0]![0]!.matchId]);

    expect(revealed.rounds).toHaveLength(decided.rounds.length);
    for (const [round, matches] of decided.rounds.entries()) {
      expect(revealed.rounds[round]!.map((match) => match.matchId)).toEqual(
        matches.map((match) => match.matchId),
      );
    }
  });
});

describe("resolveSlot", () => {
  test("returns the name for a competitor slot", () => {
    const slot: MatchSlot = { kind: "competitor", competitor: "alpha" };
    expect(resolveSlot(slot, [])).toBe("alpha");
  });

  test("returns undefined for a bye", () => {
    const slot: MatchSlot = { kind: "bye" };
    expect(resolveSlot(slot, [])).toBeUndefined();
  });

  test("returns undefined for a winner-of slot whose match has no winner yet", () => {
    const bracket = buildBracket({
      bracketId: "bracket-8",
      seasonId: "season-1",
      seeds: seeds(8),
      bestOf: 1,
    });
    const final = bracket.rounds[2]![0]!;

    expect(resolveSlot(final.a, bracket.rounds.flat())).toBeUndefined();
  });

  test("returns the winner's name for a decided winner-of slot", () => {
    const bracket = buildBracket({
      bracketId: "bracket-4",
      seasonId: "season-1",
      seeds: seeds(4),
      bestOf: 1,
    });
    const [m0] = bracket.rounds[0]!;
    const final = bracket.rounds[1]![0]!;
    const outcome: MatchOutcome = {
      matchId: m0!.matchId,
      winner: competitorName(m0!.a),
      loser: competitorName(m0!.b),
      scoreA: 1,
      scoreB: 0,
      decidedBy: "score",
    };
    const advanced = advanceBracket(bracket, [outcome]);
    const slotFedByM0 = final.a.kind === "winner-of" && final.a.matchId === m0!.matchId ? final.a : final.b;

    expect(resolveSlot(slotFedByM0, advanced.rounds.flat())).toBe(outcome.winner);
  });
});
