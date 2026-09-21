import { Chess } from "chess.js";

import type {
  Bracket,
  CompetitorManifest,
  CompetitorRef,
  DecisionRecord,
  Match,
  RecordedGame,
} from "../../src/core/types.ts";
import { buildManifest } from "../../src/core/manifest.ts";
import { advanceBracket, buildBracket } from "../../src/match/bracket.ts";
import { ROSTER } from "../../src/players/roster.ts";
import { OPENINGS } from "../../src/season/openings.ts";
import {
  BROADCAST_DECISIONS,
  BROADCAST_SUMMARY,
} from "../fixtures/broadcast.ts";

export const SEASON_ID = "e2e-season";
export const GAME_ID = "e2e-season:e2e-checkmate";
export const BRACKET_ID = "e2e-bracket";
export const WHITE = "aggressor";
export const BLACK = "fortress";
export const MOVE_COUNT = 7;
export const FIRST_PLY = 0;
export const PREPARED_GAME_ID = "e2e-season:prepared-italian";
export const PREPARED_OPENING_ID = "italian-game";
export const PREPARED_WHITE = "architect";
export const PREPARED_BLACK = "mason";

const MATCH_ID = `${BRACKET_ID}:r0m0`;

const roster = ROSTER.slice(0, 8).map(buildManifest);
function requiredManifest(name: string): CompetitorManifest {
  const manifest = roster.find((candidate) => candidate.name === name);
  if (manifest === undefined) {
    throw new Error(`E2E fixture roster is missing ${name}`);
  }
  return manifest;
}

const whiteManifest = requiredManifest(WHITE);
const blackManifest = requiredManifest(BLACK);
const whiteRef: CompetitorRef = { name: WHITE, version: whiteManifest.version };
const blackRef: CompetitorRef = { name: BLACK, version: blackManifest.version };
const preparedWhiteManifest = requiredManifest(PREPARED_WHITE);
const preparedBlackManifest = requiredManifest(PREPARED_BLACK);
const preparedWhiteRef: CompetitorRef = {
  name: PREPARED_WHITE,
  version: preparedWhiteManifest.version,
};
const preparedBlackRef: CompetitorRef = {
  name: PREPARED_BLACK,
  version: preparedBlackManifest.version,
};

export const E2E_MANIFESTS: readonly CompetitorManifest[] = roster;

export const E2E_DECISIONS: readonly DecisionRecord[] = BROADCAST_DECISIONS.map(
  (decision) => {
    const competitor = decision.colour === "white" ? whiteRef : blackRef;
    return {
      ...decision,
      seasonId: SEASON_ID,
      gameId: GAME_ID,
      competitor: competitor.name,
      version: competitor.version,
      idempotencyKey: `${GAME_ID}:${decision.ply}:${competitor.version}`,
    };
  },
);

export const E2E_GAME: RecordedGame = {
  summary: {
    ...BROADCAST_SUMMARY,
    seasonId: SEASON_ID,
    gameId: GAME_ID,
    white: whiteRef,
    black: blackRef,
  },
  schedule: { startAt: 1, msPerPly: 1 },
  matchId: MATCH_ID,
};

const preparedOpening = OPENINGS.find(
  (opening) => opening.id === PREPARED_OPENING_ID,
);
if (preparedOpening === undefined) {
  throw new Error(`E2E fixture opening is missing ${PREPARED_OPENING_ID}`);
}

export const PREPARED_BOOK_MOVE_COUNT = preparedOpening.moves.length;
export const PREPARED_FIRST_PLY = preparedOpening.moves.length;

const PREPARED_SAN_MOVES = ["d3", "Nf6", "O-O", "O-O"] as const;
const PREPARED_STRATEGIES = [
  "develop",
  "develop",
  "fortify",
  "fortify",
] as const;

function buildPreparedReplay(firstFen: string): {
  readonly decisions: readonly DecisionRecord[];
  readonly pgn: string;
} {
  const chess = new Chess(firstFen);
  const decisions: DecisionRecord[] = [];

  PREPARED_SAN_MOVES.forEach((san, index) => {
    const fen = chess.fen();
    const legal = chess.moves({ verbose: true });
    const colour = chess.turn() === "w" ? "white" : "black";
    const manifest =
      colour === "white" ? preparedWhiteManifest : preparedBlackManifest;
    const ref = colour === "white" ? preparedWhiteRef : preparedBlackRef;
    const played = chess.move(san);
    const move = `${played.from}${played.to}${played.promotion ?? ""}`;
    const alternative = legal.find(
      (candidate) =>
        `${candidate.from}${candidate.to}${candidate.promotion ?? ""}` !== move,
    );
    const alternativeMove =
      alternative === undefined
        ? undefined
        : `${alternative.from}${alternative.to}${alternative.promotion ?? ""}`;
    const ply = PREPARED_FIRST_PLY + index;

    decisions.push({
      seasonId: SEASON_ID,
      gameId: PREPARED_GAME_ID,
      ply,
      competitor: ref.name,
      version: ref.version,
      colour,
      fen,
      legalMoveCount: legal.length,
      move,
      strategy: PREPARED_STRATEGIES[index] ?? "direct",
      confidence: 0.72,
      distribution:
        alternativeMove === undefined
          ? { [move]: 1 }
          : { [move]: 0.72, [alternativeMove]: 0.28 },
      latencyMs: 240 + index * 20,
      featuresSeen: manifest.features,
      idempotencyKey: `${PREPARED_GAME_ID}:${ply}:${ref.version}`,
    });
  });

  return { decisions, pgn: chess.pgn() };
}

const preparedReplay = buildPreparedReplay(preparedOpening.fen);

export const PREPARED_E2E_DECISIONS = preparedReplay.decisions;

export const PREPARED_E2E_GAME: RecordedGame = {
  summary: {
    seasonId: SEASON_ID,
    gameId: PREPARED_GAME_ID,
    white: preparedWhiteRef,
    black: preparedBlackRef,
    openingId: PREPARED_OPENING_ID,
    result: "draw",
    reason: "move-limit",
    plies: PREPARED_FIRST_PLY + PREPARED_E2E_DECISIONS.length,
    pgn: preparedReplay.pgn,
  },
  // Keep the existing game featured: finished games are selected by newest
  // broadcast start, and its startAt remains 1.
  schedule: { startAt: 0, msPerPly: 1 },
};

const seededBracket = buildBracket({
  bracketId: BRACKET_ID,
  seasonId: SEASON_ID,
  seeds: roster.map((manifest) => manifest.name),
  bestOf: 1,
});
const advancedBracket = advanceBracket(seededBracket, [
  {
    matchId: MATCH_ID,
    winner: WHITE,
    loser: BLACK,
    scoreA: 1,
    scoreB: 0,
    decidedBy: "score",
  },
]);

export const E2E_BRACKET: Bracket = {
  ...advancedBracket,
  rounds: advancedBracket.rounds.map((round) =>
    round.map(
      (match): Match =>
        match.matchId === MATCH_ID
          ? { ...match, gameIds: [GAME_ID] }
          : match,
    ),
  ),
};
