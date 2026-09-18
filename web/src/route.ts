/**
 * Query-string routing. The Worker serves one HTML document, so a path router
 * would need a server change; query parameters need none.
 *
 *   ?game=<id>                        the Phase 1 live board
 *   ?season=<id>                      dashboard
 *   ?season=<id>&view=leaderboard     leaderboard
 *   ?season=<id>&game=<id>            the broadcast watch page
 *   ?bracket=<id>                     bracket
 *   ?competitor=<name>                competitor profile
 *   ?competitor=<name>&rival=<name>   head to head
 */

const ID = /^[A-Za-z0-9._:@-]+$/;

export type Route =
  | { readonly kind: "index" }
  | { readonly kind: "live"; readonly gameId: string }
  | { readonly kind: "watch"; readonly seasonId: string; readonly gameId: string }
  | { readonly kind: "dashboard"; readonly seasonId: string }
  | { readonly kind: "leaderboard"; readonly seasonId: string }
  | { readonly kind: "bracket"; readonly bracketId: string }
  | { readonly kind: "competitor"; readonly competitor: string }
  | {
      readonly kind: "rivalry";
      readonly competitor: string;
      readonly opponent: string;
    };

function id(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value !== undefined && value !== "" && ID.test(value) ? value : undefined;
}

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const seasonId = id(params, "season");
  const gameId = id(params, "game");
  const competitor = id(params, "competitor");
  const opponent = id(params, "rival");
  const bracketId = id(params, "bracket");

  if (competitor !== undefined && opponent !== undefined) {
    return { kind: "rivalry", competitor, opponent };
  }
  if (competitor !== undefined) return { kind: "competitor", competitor };
  if (bracketId !== undefined) return { kind: "bracket", bracketId };
  if (seasonId !== undefined && gameId !== undefined) {
    return { kind: "watch", seasonId, gameId };
  }
  if (gameId !== undefined) return { kind: "live", gameId };
  if (seasonId !== undefined) {
    return params.get("view") === "leaderboard"
      ? { kind: "leaderboard", seasonId }
      : { kind: "dashboard", seasonId };
  }
  return { kind: "index" };
}

export function href(route: Route): string {
  switch (route.kind) {
    case "index":
      return "/";
    case "live":
      return `/?game=${encodeURIComponent(route.gameId)}`;
    case "watch":
      return `/?season=${encodeURIComponent(route.seasonId)}&game=${encodeURIComponent(route.gameId)}`;
    case "dashboard":
      return `/?season=${encodeURIComponent(route.seasonId)}`;
    case "leaderboard":
      return `/?season=${encodeURIComponent(route.seasonId)}&view=leaderboard`;
    case "bracket":
      return `/?bracket=${encodeURIComponent(route.bracketId)}`;
    case "competitor":
      return `/?competitor=${encodeURIComponent(route.competitor)}`;
    case "rivalry":
      return `/?competitor=${encodeURIComponent(route.competitor)}&rival=${encodeURIComponent(route.opponent)}`;
  }
}
