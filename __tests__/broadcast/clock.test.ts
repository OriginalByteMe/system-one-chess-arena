import { describe, expect, test } from "bun:test";
import { ContractViolation } from "../../src/core/errors";
import type { BroadcastSchedule } from "../../src/core/types";
import { broadcastEndsAt, revealWindow } from "../../src/broadcast/clock";

const START_AT = 1_000_000;
const MS_PER_PLY = 1_000;
const MOVES = 7;
const SCHEDULE: BroadcastSchedule = { startAt: START_AT, msPerPly: MS_PER_PLY };

describe("revealWindow", () => {
  test("reveals nothing at the exact start instant", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT);
    expect(window.revealedPlies).toBe(0);
    expect(window.status).toBe("on-air");
  });

  test("reveals one ply once a full msPerPly has elapsed", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + MS_PER_PLY);
    expect(window.revealedPlies).toBe(1);
  });

  test("floors partial elapsed time to the ply boundary just below it", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + 3 * MS_PER_PLY - 1);
    expect(window.revealedPlies).toBe(2);
  });

  test("crosses to the next ply exactly at the boundary", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + 3 * MS_PER_PLY);
    expect(window.revealedPlies).toBe(3);
  });

  test("stays on the same ply just after a boundary", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + 3 * MS_PER_PLY + 1);
    expect(window.revealedPlies).toBe(3);
  });

  test("clamps revealedPlies at moves for a long-finished broadcast", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + 500 * MS_PER_PLY);
    expect(window.revealedPlies).toBe(MOVES);
  });

  test("is scheduled before startAt", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT - 1);
    expect(window.status).toBe("scheduled");
    expect(window.revealedPlies).toBe(0);
  });

  test("is on-air strictly between start and end", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + 2 * MS_PER_PLY);
    expect(window.status).toBe("on-air");
  });

  test("is finished once every recorded decision is revealed", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + MOVES * MS_PER_PLY);
    expect(window.status).toBe("finished");
    expect(window.revealedPlies).toBe(MOVES);
  });

  test("nextBoundaryAt for a scheduled game is the first ply boundary, not startAt", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT - 5_000);
    expect(window.status).toBe("scheduled");
    expect(window.nextBoundaryAt).toBe(START_AT + MS_PER_PLY);
  });

  test("nextBoundaryAt advances with each revealed ply while on air", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + 2 * MS_PER_PLY + 400);
    expect(window.revealedPlies).toBe(2);
    expect(window.nextBoundaryAt).toBe(START_AT + 3 * MS_PER_PLY);
  });

  test("nextBoundaryAt is absent once finished", () => {
    const window = revealWindow(SCHEDULE, MOVES, START_AT + MOVES * MS_PER_PLY);
    expect(window.nextBoundaryAt).toBeUndefined();
  });

  test("a zero-move game is finished immediately once it goes on air", () => {
    const window = revealWindow(SCHEDULE, 0, START_AT);
    expect(window.status).toBe("finished");
    expect(window.revealedPlies).toBe(0);
    expect(window.nextBoundaryAt).toBeUndefined();
  });

  test.each([0, -1, -1_000])(
    "rejects msPerPly of %p",
    (msPerPly) => {
      expect(() =>
        revealWindow({ startAt: START_AT, msPerPly }, MOVES, START_AT),
      ).toThrow(ContractViolation);
    },
  );

  test("rejects a non-integer msPerPly", () => {
    expect(() =>
      revealWindow({ startAt: START_AT, msPerPly: 100.5 }, MOVES, START_AT),
    ).toThrow(ContractViolation);
  });

  test("rejects a negative moves count", () => {
    expect(() => revealWindow(SCHEDULE, -1, START_AT)).toThrow(
      ContractViolation,
    );
  });

  test("rejects a non-integer moves count", () => {
    expect(() => revealWindow(SCHEDULE, 2.5, START_AT)).toThrow(
      ContractViolation,
    );
  });
});

describe("broadcastEndsAt", () => {
  test("is startAt plus moves times msPerPly", () => {
    expect(broadcastEndsAt(SCHEDULE, MOVES)).toBe(START_AT + MOVES * MS_PER_PLY);
  });

  test("is the instant revealWindow first reports finished", () => {
    const end = broadcastEndsAt(SCHEDULE, MOVES);
    const atEnd = revealWindow(SCHEDULE, MOVES, end);
    const beforeEnd = revealWindow(SCHEDULE, MOVES, end - 1);
    expect(atEnd.status).toBe("finished");
    expect(atEnd.revealedPlies).toBe(MOVES);
    expect(beforeEnd.status).toBe("on-air");
    expect(beforeEnd.revealedPlies).toBeLessThan(MOVES);
  });

  test("is startAt for a zero-move game", () => {
    expect(broadcastEndsAt(SCHEDULE, 0)).toBe(START_AT);
  });
});
