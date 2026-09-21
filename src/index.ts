import { requireAdmin } from "./api/admin.ts";
import {
  apiRouteName,
  countryOf,
  deviceClass,
  referrerHost,
  writeRequestEvent,
} from "./api/analytics.ts";
import { handleAdmin } from "./api/admin-api.ts";
import { handleRead } from "./api/read.ts";
import { tickCampaign } from "./api/campaign.ts";
import { siteView } from "./api/site.ts";
import { d1SiteStore } from "./api/site-store.ts";
import { d1Store } from "./api/store.ts";
import { cacheControl } from "./broadcast/gate.ts";
import { ContractViolation } from "./core/errors.ts";
import type { Env } from "./core/env.ts";
import type { LiveGameSnapshot } from "./core/types.ts";
import { parseRecordRequest, parseStartRequest } from "./core/record-request.ts";
import { createRng } from "./core/rng.ts";
import { parseSeasonConfig } from "./core/season-config.ts";
import { buildPairings } from "./season/pairings.ts";

export { GameDurableObject } from "./do/game.ts";
export { SeasonDurableObject } from "./do/season.ts";

const SPECTATE = /^\/api\/games\/([^/]+)\/spectate$/;
const GAME_ID = /^[A-Za-z0-9._:@-]+$/;
const START_SEASON = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/start$/;
const RECORD_SEASON = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/record$/;
const SEASON_STANDINGS = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/standings$/;
const SEASON_LIVE = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/live$/;
const COMPLETE_SEASON = /^\/api\/seasons\/([A-Za-z0-9._:-]+)\/complete$/;

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

/**
 * What the pinned season is playing right now, or nothing at all. A season
 * that was never started has no Durable Object state, which is an empty
 * answer rather than a failure — the front page still has filed games to show.
 */
async function liveGamesFor(
  env: Env,
  seasonId: string | undefined,
): Promise<readonly LiveGameSnapshot[]> {
  if (seasonId === undefined || seasonId === "") return [];
  try {
    const season = env.SEASON.get(env.SEASON.idFromName(seasonId));
    return await season.liveGames();
  } catch {
    return [];
  }
}

async function handle(request: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === "/api/health") {
    return Response.json({ ok: true, phase: 2 });
  }

  // The operator console. Behind Cloudflare Access, and it refuses outright
  // when Access is not configured, so an unprotected deploy cannot expose it.
  const admin = await handleAdmin(request, env, now);
  if (admin !== undefined) return admin;

  // The front page's single request. Gated like every other read, and it also
  // carries whatever is playing right now, which the filed ledger cannot know.
  if (request.method === "GET" && pathname === "/api/site") {
    const live = await liveGamesFor(env, env.ARENA_FEATURED_SEASON);
    const view = await siteView(
      { store: d1Store(env.DB), now },
      d1SiteStore(env.DB),
      env.ARENA_FEATURED_SEASON,
      live,
    );
    if (view === undefined) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(view), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Never immutable, unlike a filed game: the next season can start at
        // any moment, and a front page cached for a year would never show it.
        // A live game changes every second, so then it is not cached at all.
        "Cache-Control": live.length > 0 ? "no-store" : "public, max-age=10",
      },
    });
  }

  // Reads next: they are the bulk of the traffic and the only cached ones.
  const read = await handleRead(request, { store: d1Store(env.DB), now });
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
      const { config, pairings: requested } = parseStartRequest(
        await jsonBody(request, "index.startSeason"),
      );
      if (config.seasonId !== startSeason[1]) {
        throw new ContractViolation(
          "index.startSeason",
          "path seasonId must match body seasonId",
        );
      }
      // Starting a season starts its games playing, one ply per alarm. An
      // explicit pairing list is how a knockout adds its next round to a
      // season that is already running.
      const pairings = requested ?? buildPairings(config, createRng(config.seed));
      const season = env.SEASON.get(env.SEASON.idFromName(config.seasonId));
      await season.start(config, pairings);
      return Response.json(pairings);
    } catch (error) {
      return badRequest(error);
    }
  }

  if (request.method === "POST" && recordSeason?.[1] !== undefined) {
    try {
      const recordRequest = parseRecordRequest(await jsonBody(request, "index.recordSeason"));
      if (recordRequest.config.seasonId !== recordSeason[1]) {
        throw new ContractViolation(
          "index.recordSeason",
          "path seasonId must match body seasonId",
        );
      }
      const season = env.SEASON.get(env.SEASON.idFromName(recordRequest.config.seasonId));
      return Response.json(await season.record(recordRequest));
    } catch (error) {
      return badRequest(error);
    }
  }

  if (request.method === "POST" && completeSeason?.[1] !== undefined) {
    const season = env.SEASON.get(env.SEASON.idFromName(completeSeason[1]));
    return Response.json(await season.complete());
  }

  // What is playing right now. Not gated and not cached: a live game has no
  // future to spoil, because its next move has not been decided yet.
  const seasonLive = SEASON_LIVE.exec(pathname);
  if (request.method === "GET" && seasonLive?.[1] !== undefined) {
    const season = env.SEASON.get(env.SEASON.idFromName(seasonLive[1]));
    try {
      return new Response(JSON.stringify(await season.liveGames()), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch {
      // A season nobody has started has no live games, which is an answer
      // rather than an error.
      return Response.json([]);
    }
  }

  const seasonStandings = SEASON_STANDINGS.exec(pathname);
  if (request.method === "GET" && seasonStandings?.[1] !== undefined) {
    const season = env.SEASON.get(env.SEASON.idFromName(seasonStandings[1]));
    try {
      return Response.json(await season.standings());
    } catch (error) {
      // A season nobody started has no standings. That is a 404, not a 500,
      // and it must not surface as an unhandled rejection.
      if (error instanceof Error && error.message.includes("has not been started")) {
        return new Response(null, { status: 404 });
      }
      throw error;
    }
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

  // Anything else is a site path. The assets binding serves the SPA for it,
  // and this only runs for /api/* because of run_worker_first.
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const response = await handle(request, env, started);
    const url = new URL(request.url);

    // One datapoint per API request. The site's page views come from the
    // cookieless Web Analytics beacon instead: asset requests never reach the
    // Worker, so counting them here would count nothing.
    writeRequestEvent(env, {
      kind: "api",
      route: apiRouteName(url.pathname),
      seasonId: url.pathname.split("/")[3] ?? "",
      gameId: url.pathname.split("/")[5] ?? "",
      country: countryOf(request),
      device: deviceClass(request.headers.get("User-Agent")),
      referrer: referrerHost(request.headers.get("Referer"), url.hostname),
      status: response.status,
      durationMs: Date.now() - started,
      cached: response.headers.get("Cache-Control") !== null,
    });

    return response;
  },

  /**
   * The hourly tick that plays a campaign.
   *
   * Hourly rather than daily so a failed hour retries by itself and a finished
   * game is filed within the hour. Most firings start nothing: tickCampaign
   * deals matches only inside the plan's daily window, and decides what is due
   * by reading the filed ledger, which is what makes a missed or doubled cron
   * harmless.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tickCampaign(env, Date.now()).then(
        (state) => {
          console.log({ event: "campaign-tick", ...(state === undefined ? { idle: true } : {
            seasonId: state.seasonId,
            started: state.started.length,
            phase: state.phase,
          }) });
        },
        (error: unknown) => {
          console.error({ event: "campaign-tick-failed", error });
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
