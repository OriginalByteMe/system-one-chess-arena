import { NotImplemented } from "../core/errors.ts";

export type AdminCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly response: Response };

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
  void request;
  void token;
  throw new NotImplemented("api.admin.requireAdmin");
}
