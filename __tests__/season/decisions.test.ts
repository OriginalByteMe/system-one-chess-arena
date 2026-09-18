import { describe, expect, test } from "bun:test";
import { ContractViolation } from "../../src/core/errors";
import type { DecisionRecord } from "../../src/core/types";
import {
  DECISION_INSERT,
  decisionRow,
  decisionStatements,
  decisionValues,
  parseDecisionRow,
  type DecisionRowShape,
} from "../../src/season/decisions";

const MINIMAL_DECISION: DecisionRecord = {
  seasonId: "season-1",
  gameId: "game-1",
  ply: 7,
  competitor: "Alpha",
  version: "alpha-v1",
  colour: "white",
  fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
  legalMoveCount: 3,
  move: "a1a2",
  strategy: "endgame",
  latencyMs: 17,
  featuresSeen: ["materialBalance", "phase"],
  idempotencyKey: "game-1:7:alpha-v1",
};

const FULL_DECISION: DecisionRecord = {
  ...MINIMAL_DECISION,
  confidence: 0.75,
  distribution: { a1a2: 0.75, a1b1: 0.25 },
  tokens: { in: 120, out: 18 },
  fallback: "provider-error",
};

const VALID_ROW: DecisionRowShape = {
  season_id: "season-1",
  game_id: "game-1",
  ply: 7,
  competitor: "Alpha",
  version: "alpha-v1",
  colour: "white",
  fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
  legal_move_count: 3,
  move: "a1a2",
  strategy: "endgame",
  confidence: 0.75,
  distribution_json: JSON.stringify({ a1a2: 0.75, a1b1: 0.25 }),
  latency_ms: 17,
  tokens_in: 120,
  tokens_out: 18,
  fallback: "provider-error",
  features_seen_json: JSON.stringify(["materialBalance", "phase"]),
  idempotency_key: "game-1:7:alpha-v1",
};

function insertColumns(): readonly string[] {
  const match = DECISION_INSERT.match(/INSERT INTO decisions \(([^)]+)\)/);
  const columnList = match?.[1];
  if (columnList === undefined) {
    throw new Error("DECISION_INSERT is missing a column list");
  }
  return columnList.split(",").map((column) => column.trim());
}

function rowValue(
  row: DecisionRowShape,
  column: string,
): string | number | null {
  switch (column) {
    case "season_id":
      return row.season_id;
    case "game_id":
      return row.game_id;
    case "ply":
      return row.ply;
    case "competitor":
      return row.competitor;
    case "version":
      return row.version;
    case "colour":
      return row.colour;
    case "fen":
      return row.fen;
    case "legal_move_count":
      return row.legal_move_count;
    case "move":
      return row.move;
    case "strategy":
      return row.strategy;
    case "confidence":
      return row.confidence;
    case "distribution_json":
      return row.distribution_json;
    case "latency_ms":
      return row.latency_ms;
    case "tokens_in":
      return row.tokens_in;
    case "tokens_out":
      return row.tokens_out;
    case "fallback":
      return row.fallback;
    case "features_seen_json":
      return row.features_seen_json;
    case "idempotency_key":
      return row.idempotency_key;
    default:
      throw new Error(`DECISION_INSERT names an unknown column: ${column}`);
  }
}

interface RecordedCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class FakeStatement implements D1PreparedStatement {
  constructor(
    private readonly sql: string,
    private readonly onBind: (sql: string, values: readonly unknown[]) => void,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.onBind(this.sql, values);
    return this;
  }

  first(): Promise<never> {
    throw new Error("first() is unused by decisionStatements");
  }

  run(): Promise<never> {
    throw new Error("run() is unused by decisionStatements");
  }

  all(): Promise<never> {
    throw new Error("all() is unused by decisionStatements");
  }

  raw(): Promise<never> {
    throw new Error("raw() is unused by decisionStatements");
  }
}

class FakeDatabase implements D1Database {
  readonly calls: RecordedCall[] = [];

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(query, (sql, values) => {
      this.calls.push({ sql, values });
    });
  }

  batch(): Promise<never> {
    throw new Error("batch() is unused by decisionStatements");
  }

  exec(): Promise<never> {
    throw new Error("exec() is unused by decisionStatements");
  }

  withSession(): never {
    throw new Error("withSession() is unused by decisionStatements");
  }

  dump(): Promise<never> {
    throw new Error("dump() is unused by decisionStatements");
  }
}

describe("decisionRow", () => {
  test("flattens every field of a fully populated record", () => {
    const row = decisionRow(FULL_DECISION);
    expect(row.season_id).toBe("season-1");
    expect(row.game_id).toBe("game-1");
    expect(row.ply).toBe(7);
    expect(row.competitor).toBe("Alpha");
    expect(row.version).toBe("alpha-v1");
    expect(row.colour).toBe("white");
    expect(row.fen).toBe("8/8/8/8/8/8/8/K6k w - - 0 1");
    expect(row.legal_move_count).toBe(3);
    expect(row.move).toBe("a1a2");
    expect(row.strategy).toBe("endgame");
    expect(row.confidence).toBe(0.75);
    expect(JSON.parse(row.distribution_json ?? "null")).toEqual({
      a1a2: 0.75,
      a1b1: 0.25,
    });
    expect(row.latency_ms).toBe(17);
    expect(row.tokens_in).toBe(120);
    expect(row.tokens_out).toBe(18);
    expect(row.fallback).toBe("provider-error");
    expect(JSON.parse(row.features_seen_json)).toEqual([
      "materialBalance",
      "phase",
    ]);
    expect(row.idempotency_key).toBe("game-1:7:alpha-v1");
  });

  test("turns absent optionals into SQL null instead of omitting the column", () => {
    const row = decisionRow(MINIMAL_DECISION);
    expect(Object.hasOwn(row, "confidence")).toBe(true);
    expect(row.confidence).toBeNull();
    expect(Object.hasOwn(row, "distribution_json")).toBe(true);
    expect(row.distribution_json).toBeNull();
    expect(Object.hasOwn(row, "tokens_in")).toBe(true);
    expect(row.tokens_in).toBeNull();
    expect(Object.hasOwn(row, "tokens_out")).toBe(true);
    expect(row.tokens_out).toBeNull();
    expect(Object.hasOwn(row, "fallback")).toBe(true);
    expect(row.fallback).toBeNull();
  });
});

describe("decisionValues", () => {
  test("binds every value in exactly the column order declared in DECISION_INSERT", () => {
    const columns = insertColumns();
    const row = decisionRow(FULL_DECISION);
    const expected = columns.map((column) => rowValue(row, column));
    expect(decisionValues(FULL_DECISION)).toEqual(expected);
  });

  test("binds exactly one value per declared column", () => {
    const columns = insertColumns();
    const placeholderCount = (DECISION_INSERT.match(/\?/g) ?? []).length;
    expect(placeholderCount).toBe(columns.length);
    expect(decisionValues(FULL_DECISION)).toHaveLength(columns.length);
  });
});

describe("parseDecisionRow", () => {
  test("round-trips a fully populated record", () => {
    const parsed = parseDecisionRow(decisionRow(FULL_DECISION));
    expect(parsed).toStrictEqual(FULL_DECISION);
  });

  test("round-trips a minimal record, keeping absent optionals absent rather than present-undefined", () => {
    const parsed = parseDecisionRow(decisionRow(MINIMAL_DECISION));
    expect(parsed).toStrictEqual(MINIMAL_DECISION);
    expect(Object.hasOwn(parsed, "confidence")).toBe(false);
    expect(Object.hasOwn(parsed, "distribution")).toBe(false);
    expect(Object.hasOwn(parsed, "tokens")).toBe(false);
    expect(Object.hasOwn(parsed, "fallback")).toBe(false);
  });

  const { move: _validRowMove, ...rowMissingMove } = VALID_ROW;

  test.each([
    ["a row missing a required column", rowMissingMove],
    ["an unknown strategy label", { ...VALID_ROW, strategy: "no-such-strategy" }],
    ["an unknown fallback reason", { ...VALID_ROW, fallback: "no-such-reason" }],
    ["an unknown colour", { ...VALID_ROW, colour: "red" }],
    ["a non-integer ply", { ...VALID_ROW, ply: 7.5 }],
    [
      "malformed distribution_json that is not valid JSON",
      { ...VALID_ROW, distribution_json: "{not json" },
    ],
    [
      "malformed features_seen_json that is not valid JSON",
      { ...VALID_ROW, features_seen_json: "[not json" },
    ],
    [
      "a feature key that is not in FEATURE_KEYS",
      {
        ...VALID_ROW,
        features_seen_json: JSON.stringify(["notARealFeature"]),
      },
    ],
    [
      "a distribution that is not a map of move to number",
      {
        ...VALID_ROW,
        distribution_json: JSON.stringify({ a1a2: "high" }),
      },
    ],
  ] as const)("rejects %s with ContractViolation", (_description, row) => {
    expect(() => parseDecisionRow(row)).toThrow(ContractViolation);
  });
});

describe("decisionStatements", () => {
  const recordA: DecisionRecord = {
    ...MINIMAL_DECISION,
    ply: 3,
    idempotencyKey: "game-1:3:alpha-v1",
  };
  const recordB: DecisionRecord = {
    ...FULL_DECISION,
    ply: 9,
    idempotencyKey: "game-1:9:alpha-v1",
  };

  test("prepares one statement per record", () => {
    const db = new FakeDatabase();
    const statements = decisionStatements(db, [recordA, recordB]);
    expect(statements).toHaveLength(2);
  });

  test("binds DECISION_INSERT with each record's own decisionValues, ordered by ply", () => {
    const db = new FakeDatabase();
    decisionStatements(db, [recordB, recordA]);
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0]?.sql).toBe(DECISION_INSERT);
    expect(db.calls[1]?.sql).toBe(DECISION_INSERT);
    expect(db.calls[0]?.values).toEqual(decisionValues(recordA));
    expect(db.calls[1]?.values).toEqual(decisionValues(recordB));
  });

  test("returns an empty array and never touches the database for no records", () => {
    const db = new FakeDatabase();
    const statements = decisionStatements(db, []);
    expect(statements).toHaveLength(0);
    expect(db.calls).toHaveLength(0);
  });
});

describe("DECISION_INSERT", () => {
  test("is a no-op on conflict so a failed alarm retry cannot duplicate a decision", () => {
    expect(DECISION_INSERT).toContain(
      "ON CONFLICT (season_id, game_id, ply) DO NOTHING",
    );
  });
});
