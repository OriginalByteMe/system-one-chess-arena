import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";

import { ContractViolation } from "../../src/core/errors.ts";
import { OPENINGS, openingById } from "../../src/season/openings.ts";

describe("OPENINGS", () => {
  test("contains exactly five uniquely identified openings", () => {
    expect(OPENINGS).toHaveLength(5);
    expect(OPENINGS.map((opening) => opening.id).sort()).toEqual([
      "italian-game",
      "kings-indian",
      "london-system",
      "queens-gambit",
      "sicilian-najdorf",
    ]);
    expect(new Set(OPENINGS.map((opening) => opening.id)).size).toBe(5);
  });

  test("every SAN sequence is legal and reaches its declared FEN", () => {
    for (const opening of OPENINGS) {
      const chess = new Chess();
      for (const move of opening.moves) {
        expect(chess.moves()).toContain(move);
        chess.move(move);
      }
      expect(chess.fen()).toBe(opening.fen);
    }
  });
});

describe("openingById", () => {
  test("returns the catalogue object with the requested id", () => {
    const expected = OPENINGS.find((opening) => opening.id === "sicilian-najdorf");
    if (expected === undefined) throw new Error("Sicilian Najdorf fixture is missing");

    expect(openingById("sicilian-najdorf")).toBe(expected);
  });

  test("rejects an unknown opening id", () => {
    expect(() => openingById("not-an-opening")).toThrow(ContractViolation);
    expect(() => openingById("not-an-opening")).toThrow(
      "contract violation in openings.openingById: unknown opening id: not-an-opening",
    );
  });
});
