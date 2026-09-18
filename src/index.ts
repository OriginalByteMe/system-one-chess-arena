import { requireAdmin } from "./api/admin.ts";
import { handleRead } from "./api/read.ts";
import { d1Store } from "./api/store.ts";
import { ContractViolation } from "./core/errors.ts";
import type { Env } from "./core/env.ts";
import { parseRecordRequest } from "./core/record-request.ts";
import { createRng } from "./core/rng.ts";
import { parseSeasonConfig } from "./core/season-config.ts";
import { buildPairings } from "./season/pairings.ts";

export { GameDurableObject } from "./do/game.ts";
export { SeasonDurableObject } from "./do/season.ts";

const SPECTATE = /^\/api\/games\/([^/]+)\/spectate$/;
const GAME_ID = /^[A-Za-z0-9._:@-]+$/;
const START_SEASON = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/start$/;
const RECORD_SEASON = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/record$/;
const SEASON_STANDINGS =
  /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/standings$/;
const COMPLETE_SEASON =
  /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/complete$/;

/** Body must be JSON. A parse failure is the caller's fault, not a 500. */
async function jsonBody(request: Request, subject: string): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ContractViolation(subject, "body must be valid JSON");
  }
}

function badRequest(error: unknown): Response {
  if (
    error instanceof ContractViolation ||
    (error instanceof Error && error.name === "ContractViolation")
  ) {
    return new Response(error.message, { status: 400 });
  }
  throw error;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/api/health") {
      return Response.json({ ok: true, phase: 2 });
    }

    // Reads first: they are the bulk of the traffic and the only cached ones.
    const read = await handleRead(request, {
      store: d1Store(env.DB),
      now: Date.now(),
    });
    if (read !== undefined) return read;

    // Everything below spends provider money or mutates a season.
    const startSeason = START_SEASON.exec(pathname);
    const recordSeason = RECORD_SEASON.exec(pathname);
    const completeSeason = COMPLETE_SEASON.exec(pathname);
    if (
      request.method === "POST" &&
      (startSeason !== null || recordSeason !== null || completeSeason !== null)
    ) {
      const admin = requireAdmin(request, env.ARENA_ADMIN_TOKEN);
      if (!admin.ok) return admin.response;
    }

    if (request.method === "POST" && startSeason?.[1] !== undefined) {
      try {
        const config = parseSeasonConfig(
          await jsonBody(request, "index.startSeason"),
        );
        if (config.seasonId !== startSeason[1]) {
          throw new ContractViolation(
            "index.startSeason",
            "path seasonId must match body seasonId",
          );
        }
        const pairings = buildPairings(config, createRng(config.seed));
        const season = env.SEASON.get(
          env.SEASON.idFromName(config.seasonId),
        );
        await season.start(config);
        return Response.json(pairings);
      } catch (error) {
        return badRequest(error);
      }
    }

    if (request.method === "POST" && recordSeason?.[1] !== undefined) {
      try {
        const recordRequest = parseRecordRequest(
          await jsonBody(request, "index.recordSeason"),
        );
        if (recordRequest.config.seasonId !== recordSeason[1]) {
          throw new ContractViolation(
            "index.recordSeason",
            "path seasonId must match body seasonId",
          );
        }
        const season = env.SEASON.get(
          env.SEASON.idFromName(recordRequest.config.seasonId),
        );
        return Response.json(await season.record(recordRequest));
      } catch (error) {
        return badRequest(error);
      }
    }

    if (request.method === "POST" && completeSeason?.[1] !== undefined) {
      const season = env.SEASON.get(
        env.SEASON.idFromName(completeSeason[1]),
      );
      return Response.json(await season.complete());
    }

    const seasonStandings = SEASON_STANDINGS.exec(pathname);
    if (
      request.method === "GET" &&
      seasonStandings?.[1] !== undefined
    ) {
      const season = env.SEASON.get(
        env.SEASON.idFromName(seasonStandings[1]),
      );
      return Response.json(await season.standings());
    }

    const spectate = SPECTATE.exec(pathname);
    if (spectate?.[1] !== undefined) {
      const gameId = decodeURIComponent(spectate[1]);
      if (!GAME_ID.test(gameId)) {
        return new Response("Not found", { status: 404 });
      }
      const game = env.GAME.get(env.GAME.idFromName(gameId));
      const spectateUrl = new URL("/spectate", url);
      spectateUrl.search = url.search;
      return game.fetch(spectateUrl, request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
