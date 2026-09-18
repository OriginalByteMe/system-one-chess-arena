export type AdminCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly response: Response };

const UNCONFIGURED_RESPONSE = (): Response => new Response(null, { status: 503 });
const REJECTED_RESPONSE = (): Response => new Response(null, { status: 401 });
const BEARER_PREFIX = "Bearer ";

/** Compares two strings over a fixed number of bytes; never branches early on length. */
function constantTimeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length, 1);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

/**
 * The admin routes spend provider money, so this is a trust boundary.
 *
 * Contract:
 * - No configured token means the route refuses with 503, never opens. An
 *   unconfigured deployment must not be startable by a stranger.
 * - A missing, malformed or wrong Authorization header is 401 with no detail
 *   about which.
 * - The comparison is length-safe and constant-time over the configured token.
 */
export function requireAdmin(
  request: Request,
  token: string | undefined,
): AdminCheck {
  if (token === undefined || token.length === 0) {
    return { ok: false, response: UNCONFIGURED_RESPONSE() };
  }

  const authorization = request.headers.get("Authorization");
  const provided =
    authorization !== null && authorization.startsWith(BEARER_PREFIX)
      ? authorization.slice(BEARER_PREFIX.length)
      : "";

  const valid =
    authorization !== null &&
    authorization.startsWith(BEARER_PREFIX) &&
    constantTimeEquals(provided, token);

  if (!valid) {
    return { ok: false, response: REJECTED_RESPONSE() };
  }

  return { ok: true };
}
