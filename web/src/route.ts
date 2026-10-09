/**
 * Path routing. The Worker serves the SPA for every path that is not /api/*,
 * so the site has real URLs: they are shareable, they read as a site rather
 * than a tool, and they give the analytics a route name worth counting.
 *
 *   /                                 the championship front page
 *   /season/<id>                      one season's games
 *   /season/<id>/leaderboard          standings
 *   /watch/<season>/<game>            the broadcast
 *   /live/<game>                      a game played live over a socket
 *   /bracket/<id>                     bracket
 *   /competitor/<name>                competitor profile
 *   /competitor/<name>/vs/<name>      head to head
 *   /local                            run a persona on the visitor's own GPU
 *   /privacy                          what the site collects
 *   /admin                            operator console, behind Cloudflare Access
 *
 * The query-string form the site used before still resolves, so links already
 * shared keep working.
 */

const ID = /^[A-Za-z0-9._:@-]+$/;

export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "live"; readonly gameId: string }
  | { readonly kind: "watch"; readonly seasonId: string; readonly gameId: string }
  | { readonly kind: "season"; readonly seasonId: string }
  | { readonly kind: "leaderboard"; readonly seasonId: string }
  | { readonly kind: "bracket"; readonly bracketId: string }
  | { readonly kind: "competitor"; readonly competitor: string }
  | {
      readonly kind: "rivalry";
      readonly competitor: string;
      readonly opponent: string;
    }
  | { readonly kind: "local" }
  | { readonly kind: "privacy" }
  | { readonly kind: "admin" }
  | { readonly kind: "notFound"; readonly path: string };

function id(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  const decoded = decodeURIComponent(trimmed);
  return ID.test(decoded) ? decoded : undefined;
}

/** The pre-path links: /?season=x&game=y and friends. */
function fromQuery(search: string): Route | undefined {
  const params = new URLSearchParams(search);
  const seasonId = id(params.get("season"));
  const gameId = id(params.get("game"));
  const competitor = id(params.get("competitor"));
  const opponent = id(params.get("rival"));
  const bracketId = id(params.get("bracket"));

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
      : { kind: "season", seasonId };
  }
  return undefined;
}

export function parseRoute(pathname: string, search: string): Route {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const [head, first, second, third] = segments;

  if (segments.length === 0) return fromQuery(search) ?? { kind: "home" };
  if (segments.length === 1 && head === "local") return { kind: "local" };
  if (segments.length === 1 && head === "privacy") return { kind: "privacy" };
  if (segments.length === 1 && head === "admin") return { kind: "admin" };

  if (head === "season") {
    const seasonId = id(first);
    if (seasonId !== undefined && segments.length === 2) return { kind: "season", seasonId };
    if (seasonId !== undefined && segments.length === 3 && second === "leaderboard") {
      return { kind: "leaderboard", seasonId };
    }
  }

  if (head === "watch" && segments.length === 3) {
    const seasonId = id(first);
    const gameId = id(second);
    if (seasonId !== undefined && gameId !== undefined) {
      return { kind: "watch", seasonId, gameId };
    }
  }

  if (head === "live" && segments.length === 2) {
    const gameId = id(first);
    if (gameId !== undefined) return { kind: "live", gameId };
  }

  if (head === "bracket" && segments.length === 2) {
    const bracketId = id(first);
    if (bracketId !== undefined) return { kind: "bracket", bracketId };
  }

  if (head === "competitor") {
    const competitor = id(first);
    if (competitor !== undefined && segments.length === 2) {
      return { kind: "competitor", competitor };
    }
    if (competitor !== undefined && segments.length === 4 && second === "vs") {
      const opponent = id(third);
      if (opponent !== undefined) return { kind: "rivalry", competitor, opponent };
    }
  }

  return { kind: "notFound", path: pathname };
}

export function href(route: Route): string {
  const segment = (value: string): string => encodeURIComponent(value);
  switch (route.kind) {
    case "home":
      return "/";
    case "live":
      return `/live/${segment(route.gameId)}`;
    case "watch":
      return `/watch/${segment(route.seasonId)}/${segment(route.gameId)}`;
    case "season":
      return `/season/${segment(route.seasonId)}`;
    case "leaderboard":
      return `/season/${segment(route.seasonId)}/leaderboard`;
    case "bracket":
      return `/bracket/${segment(route.bracketId)}`;
    case "competitor":
      return `/competitor/${segment(route.competitor)}`;
    case "rivalry":
      return `/competitor/${segment(route.competitor)}/vs/${segment(route.opponent)}`;
    case "local":
      return "/local";
    case "privacy":
      return "/privacy";
    case "admin":
      return "/admin";
    case "notFound":
      return route.path;
  }
}

/** The name this route reports to analytics. Never carries an id. */
export function routeName(route: Route): string {
  return route.kind;
}
