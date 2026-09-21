// Cloudflare Access verification for /api/admin/*.
//
// Access puts a signed JWT in the Cf-Access-Jwt-Assertion header (or the
// CF_Authorization cookie, when the console is opened straight in a browser).
// Nothing here trusts a claim before the signature is checked: the team's
// public keys are fetched from Access's own certs endpoint, cached for an
// hour because keys rotate, and the RS256 signature is verified with
// WebCrypto before aud/iss/exp/nbf/iat are read at all.
import type { Env } from "../core/env.ts";

export interface AccessIdentity {
  readonly email: string;
  readonly sub: string;
}

export type AccessCheck =
  | { readonly ok: true; readonly identity: AccessIdentity }
  | { readonly ok: false; readonly response: Response };

const UNCONFIGURED_RESPONSE = (): Response => new Response(null, { status: 503 });
const REJECTED_RESPONSE = (): Response => new Response(null, { status: 401 });

/** Keys rotate on Cloudflare's side but not so often that every request needs a fetch. */
const KEYS_TTL_MS = 60 * 60 * 1000;

/** Small allowance for clock drift between this Worker and the identity provider. */
const CLOCK_SKEW_SECONDS = 60;

interface AccessJwk {
  readonly kty: string;
  readonly kid?: string;
  readonly n: string;
  readonly e: string;
}

interface CachedKeys {
  readonly domain: string;
  readonly fetchedAt: number;
  readonly keys: readonly AccessJwk[];
}

let cachedKeys: CachedKeys | undefined;

function isAccessJwk(value: unknown): value is AccessJwk {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.kty === "string" &&
    typeof record.n === "string" &&
    typeof record.e === "string" &&
    (record.kid === undefined || typeof record.kid === "string")
  );
}

function isJwkSet(value: unknown): value is { readonly keys: readonly AccessJwk[] } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.keys) && record.keys.every(isAccessJwk);
}

async function fetchKeys(domain: string, now: number): Promise<readonly AccessJwk[]> {
  if (
    cachedKeys !== undefined &&
    cachedKeys.domain === domain &&
    now - cachedKeys.fetchedAt < KEYS_TTL_MS
  ) {
    return cachedKeys.keys;
  }
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new Error(`Access certs fetch failed with status ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isJwkSet(body)) {
    throw new Error("Access certs response is not a JWK set");
  }
  cachedKeys = { domain, fetchedAt: now, keys: body.keys };
  return body.keys;
}

interface AccessHeader {
  readonly alg: string;
  readonly kid?: string;
}

function isAccessHeader(value: unknown): value is AccessHeader {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.alg === "string" && (record.kid === undefined || typeof record.kid === "string");
}

interface AccessClaims {
  readonly aud: string | readonly string[];
  readonly iss: string;
  readonly exp: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly email?: string;
  readonly sub?: string;
}

function isAccessClaims(value: unknown): value is AccessClaims {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const audienceOk =
    typeof record.aud === "string" ||
    (Array.isArray(record.aud) && record.aud.every((item) => typeof item === "string"));
  return (
    audienceOk &&
    typeof record.iss === "string" &&
    typeof record.exp === "number" &&
    (record.nbf === undefined || typeof record.nbf === "number") &&
    (record.iat === undefined || typeof record.iat === "number") &&
    (record.email === undefined || typeof record.email === "string") &&
    (record.sub === undefined || typeof record.sub === "string")
  );
}

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const jsonDecoder = new TextDecoder();

/** Reads the assertion off the header Access sets, falling back to its cookie. */
function tokenFrom(request: Request): string | undefined {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header !== null && header.length > 0) return header;

  const cookie = request.headers.get("Cookie");
  if (cookie === null) return undefined;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== "CF_Authorization") continue;
    const value = part.slice(separator + 1).trim();
    if (value.length > 0) return value;
  }
  return undefined;
}

async function verifySignature(
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  keys: readonly AccessJwk[],
  kid: string | undefined,
): Promise<boolean> {
  const pool = kid === undefined ? keys : keys.filter((key) => key.kid === kid);
  const candidates = pool.length > 0 ? pool : keys;
  const signature = base64UrlDecode(signatureB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  for (const jwk of candidates) {
    let cryptoKey: CryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    } catch {
      continue;
    }
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      signedData,
    );
    if (verified) return true;
  }
  return false;
}

/**
 * Verifies the Access assertion on an /api/admin/* request.
 *
 * Contract:
 * - No configured team domain or audience means every admin route 503s and
 *   never opens, exactly like `requireAdmin`'s unconfigured contract.
 * - A missing, malformed, badly signed, wrong-audience, wrong-issuer, expired,
 *   not-yet-valid, or implausibly future-dated token is a 401 with no detail
 *   about which, so a prober learns nothing from the failure mode.
 * - Only alg RS256 is accepted: a header naming any other algorithm (e.g.
 *   "none") is rejected before its claims are even read.
 */
export type AccessEnv = Pick<Env, "CF_ACCESS_TEAM_DOMAIN" | "CF_ACCESS_AUD">;

export async function verifyAccessRequest(
  request: Request,
  env: AccessEnv,
  now: number,
): Promise<AccessCheck> {
  const domain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (domain === undefined || domain.length === 0 || audience === undefined || audience.length === 0) {
    return { ok: false, response: UNCONFIGURED_RESPONSE() };
  }

  const token = tokenFrom(request);
  if (token === undefined) return { ok: false, response: REJECTED_RESPONSE() };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, response: REJECTED_RESPONSE() };
  const [headerB64, payloadB64, signatureB64] = parts;
  if (headerB64 === undefined || payloadB64 === undefined || signatureB64 === undefined) {
    return { ok: false, response: REJECTED_RESPONSE() };
  }

  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(jsonDecoder.decode(base64UrlDecode(headerB64)));
    claims = JSON.parse(jsonDecoder.decode(base64UrlDecode(payloadB64)));
  } catch {
    return { ok: false, response: REJECTED_RESPONSE() };
  }
  if (!isAccessHeader(header) || !isAccessClaims(claims) || header.alg !== "RS256") {
    return { ok: false, response: REJECTED_RESPONSE() };
  }

  let keys: readonly AccessJwk[];
  try {
    keys = await fetchKeys(domain, now);
  } catch {
    return { ok: false, response: REJECTED_RESPONSE() };
  }

  const verified = await verifySignature(headerB64, payloadB64, signatureB64, keys, header.kid);
  if (!verified) return { ok: false, response: REJECTED_RESPONSE() };

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return { ok: false, response: REJECTED_RESPONSE() };
  if (claims.iss !== `https://${domain}`) return { ok: false, response: REJECTED_RESPONSE() };

  const nowSeconds = Math.floor(now / 1000);
  if (claims.exp <= nowSeconds) return { ok: false, response: REJECTED_RESPONSE() };
  if (claims.nbf !== undefined && claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, response: REJECTED_RESPONSE() };
  }
  if (claims.iat !== undefined && claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    return { ok: false, response: REJECTED_RESPONSE() };
  }

  const email = claims.email;
  const sub = claims.sub;
  if (email === undefined || email.length === 0 || sub === undefined || sub.length === 0) {
    return { ok: false, response: REJECTED_RESPONSE() };
  }

  return { ok: true, identity: { email, sub } };
}
