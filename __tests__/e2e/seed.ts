import type { MatchSlot } from "../../src/core/types.ts";
import { DECISION_INSERT, decisionValues } from "../../src/season/decisions.ts";
import {
  E2E_BRACKET,
  E2E_DECISIONS,
  E2E_GAME,
  E2E_MANIFESTS,
  PREPARED_E2E_DECISIONS,
  PREPARED_E2E_GAME,
  SEASON_ID,
} from "./fixture.ts";

type SqlValue = string | number | null;

function sqlValue(value: SqlValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("E2E seed contains a non-finite number");
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function insert(table: string, columns: readonly string[], values: readonly SqlValue[]): string {
  if (columns.length !== values.length) {
    throw new Error(`E2E seed ${table} column/value count mismatch`);
  }
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.map(sqlValue).join(", ")});`;
}

function decisionInsert(values: readonly SqlValue[]): string {
  let index = 0;
  const statement = DECISION_INSERT.replaceAll("?", () => {
    const value = values[index];
    if (value === undefined) throw new Error("E2E decision seed is missing a value");
    index += 1;
    return sqlValue(value);
  });
  if (index !== values.length) throw new Error("E2E decision seed has extra values");
  return `${statement};`;
}

function slotColumns(slot: MatchSlot): readonly [SqlValue, SqlValue] {
  if (slot.kind === "competitor") return [slot.competitor, null];
  if (slot.kind === "winner-of") return [null, slot.matchId];
  return [null, null];
}

export function e2eSeedSql(): string {
  const statements: string[] = [];

  for (const manifest of E2E_MANIFESTS) {
    statements.push(
      insert(
        "competitor_versions",
        [
          "season_id",
          "competitor",
          "version",
          "manifest_json",
          "parent_version",
          "traits_json",
          "rationale",
        ],
        [SEASON_ID, manifest.name, manifest.version, JSON.stringify(manifest), null, "[]", null],
      ),
      insert(
        "competitors",
        ["name", "first_season_id"],
        [manifest.name, SEASON_ID],
      ),
    );
  }

  const games = [
    { game: E2E_GAME, decisions: E2E_DECISIONS },
    { game: PREPARED_E2E_GAME, decisions: PREPARED_E2E_DECISIONS },
  ] as const;

  for (const { game, decisions } of games) {
    const { summary, schedule, matchId } = game;
    statements.push(
      insert(
        "games",
        [
          "season_id",
          "game_id",
          "white_competitor",
          "white_version",
          "black_competitor",
          "black_version",
          "opening_id",
          "result",
          "reason",
          "adjudicated_cp",
          "plies",
          "pgn",
          "match_id",
          "broadcast_start_at",
          "ms_per_ply",
        ],
        [
          summary.seasonId,
          summary.gameId,
          summary.white.name,
          summary.white.version,
          summary.black.name,
          summary.black.version,
          summary.openingId,
          summary.result,
          summary.reason,
          summary.adjudicatedCp ?? null,
          summary.plies,
          summary.pgn,
          matchId ?? null,
          schedule.startAt,
          schedule.msPerPly,
        ],
      ),
    );

    for (const decision of decisions) {
      statements.push(decisionInsert(decisionValues(decision)));
    }
  }

  statements.push(
    insert(
      "brackets",
      ["bracket_id", "season_id", "best_of"],
      [E2E_BRACKET.bracketId, E2E_BRACKET.seasonId, 1],
    ),
  );

  for (const round of E2E_BRACKET.rounds) {
    for (const match of round) {
      const [competitorA, feederA] = slotColumns(match.a);
      const [competitorB, feederB] = slotColumns(match.b);
      statements.push(
        insert(
          "matches",
          [
            "match_id",
            "bracket_id",
            "round",
            "slot",
            "competitor_a",
            "competitor_b",
            "feeder_a",
            "feeder_b",
            "best_of",
            "game_ids_json",
            "winner",
          ],
          [
            match.matchId,
            match.bracketId,
            match.round,
            match.slot,
            competitorA,
            competitorB,
            feederA,
            feederB,
            match.bestOf,
            JSON.stringify(match.gameIds),
            match.winner ?? null,
          ],
        ),
      );
    }
  }

  statements.push(
    insert(
      "site_settings",
      ["key", "value", "updated_at"],
      ["featured_season", SEASON_ID, 1],
    ),
  );
  return `${statements.join("\n")}\n`;
}
