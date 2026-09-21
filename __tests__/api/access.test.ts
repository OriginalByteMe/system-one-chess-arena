import { afterEach, describe, expect, test } from "bun:test";
import { verifyAccessRequest, type AccessEnv } from "../../src/api/access.ts";

const AUDIENCE = "test-audience-tag";
const REQUEST_URL = "https://arena.test/api/admin/whoami";
const NOW = 1_700_000_000_000;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RsaPublicJwk {
  readonly kty: string;
  readonly n: string;
  readonly e: string;
  readonly kid: string;
}

function isRsaPublicJwk(value: unknown): value is Omit<RsaPublicJwk, "kid"> {
  return isObject(value) && typeof value.kty === "string" && typeof value.n === "string" && typeof value.e === "string";
}

interface Keypair {
  readonly privateKey: CryptoKey;
  readonly jwk: RsaPublicJwk;
}

async function generateKeypair(kid: string): Promise<Keypair> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported: unknown = await crypto.subtle.exportKey("jwk", publicKey);
  if (!isRsaPublicJwk(exported)) throw new Error("expected a JWK export with kty, n and e");
  return { privateKey, jwk: { kty: exported.kty, n: exported.n, e: exported.e, kid } };
}

interface TokenOptions {
  readonly alg?: string;
  readonly kid?: string;
}

async function signToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  options: TokenOptions = {},
): Promise<string> {
  const header = { alg: options.alg ?? "RS256", kid: options.kid ?? "test-key" };
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function validClaims(domain: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(NOW / 1000);
  return {
    aud: AUDIENCE,
    iss: `https://${domain}`,
    exp: nowSeconds + 3600,
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    email: "operator@example.com",
    sub: "user-123",
    ...overrides,
  };
}

function requestWith(token?: string): Request {
  return new Request(REQUEST_URL, {
    headers: token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token },
  });
}

let restoreFetch: (() => void) | undefined;

/** Each Access team domain gets its own certs stub, so cases never share the module-level key cache. */
function stubCerts(domain: string, jwk: RsaPublicJwk): void {
  const certsUrl = `https://${domain}/cdn-cgi/access/certs`;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const requested = typeof input === "string" ? input : input.toString();
    if (requested === certsUrl) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch during test: ${requested}`);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

let domainCounter = 0;

function nextDomain(): string {
  domainCounter += 1;
  return `arena-test-${domainCounter}.cloudflareaccess.com`;
}

interface Setup {
  readonly domain: string;
  readonly env: AccessEnv;
  readonly privateKey: CryptoKey;
}

/** A configured Access app with a freshly minted, freshly published signing key. */
async function setup(): Promise<Setup> {
  const domain = nextDomain();
  const { privateKey, jwk } = await generateKeypair("key-1");
  stubCerts(domain, jwk);
  return { domain, env: { CF_ACCESS_TEAM_DOMAIN: domain, CF_ACCESS_AUD: AUDIENCE }, privateKey };
}

describe("verifyAccessRequest", () => {
  test("503s when the team domain is not configured", async () => {
    const env: AccessEnv = { CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: AUDIENCE };
    const check = await verifyAccessRequest(requestWith("anything"), env, NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(503);
  });

  test("503s when the audience is not configured", async () => {
    const env: AccessEnv = { CF_ACCESS_TEAM_DOMAIN: nextDomain(), CF_ACCESS_AUD: undefined };
    const check = await verifyAccessRequest(requestWith("anything"), env, NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(503);
  });

  test("401s a request with no token even when configured", async () => {
    const env: AccessEnv = { CF_ACCESS_TEAM_DOMAIN: nextDomain(), CF_ACCESS_AUD: AUDIENCE };
    const check = await verifyAccessRequest(requestWith(), env, NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("passes a validly signed token and returns the identity", async () => {
    const { domain, env, privateKey } = await setup();
    const token = await signToken(privateKey, validClaims(domain));

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.identity).toEqual({ email: "operator@example.com", sub: "user-123" });
    }
  });

  test("reads the token from the CF_Authorization cookie when the header is absent", async () => {
    const { domain, env, privateKey } = await setup();
    const token = await signToken(privateKey, validClaims(domain));
    const request = new Request(REQUEST_URL, { headers: { Cookie: `CF_Authorization=${token}` } });

    const check = await verifyAccessRequest(request, env, NOW);

    expect(check.ok).toBe(true);
  });

  test("rejects a token minted for a different Access application", async () => {
    const { domain, env, privateKey } = await setup();
    const token = await signToken(privateKey, validClaims(domain, { aud: "someone-elses-app" }));

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects an expired token", async () => {
    const { domain, env, privateKey } = await setup();
    const nowSeconds = Math.floor(NOW / 1000);
    const token = await signToken(privateKey, validClaims(domain, { exp: nowSeconds - 1 }));

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects a token not yet valid", async () => {
    const { domain, env, privateKey } = await setup();
    const nowSeconds = Math.floor(NOW / 1000);
    const token = await signToken(privateKey, validClaims(domain, { nbf: nowSeconds + 3600 }));

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects a token whose issuer is not this team's domain", async () => {
    const { domain, env, privateKey } = await setup();
    const token = await signToken(
      privateKey,
      validClaims(domain, { iss: "https://someone-else.cloudflareaccess.com" }),
    );

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects a token whose signature does not verify against the fetched keys", async () => {
    const { domain, env } = await setup();
    const { privateKey: wrongKey } = await generateKeypair("key-2");
    const token = await signToken(wrongKey, validClaims(domain));

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects a token that names an algorithm other than RS256", async () => {
    const { domain, env, privateKey } = await setup();
    const token = await signToken(privateKey, validClaims(domain), { alg: "none" });

    const check = await verifyAccessRequest(requestWith(token), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects a token with a tampered payload even though the header and signature still parse", async () => {
    const { domain, env, privateKey } = await setup();
    const token = await signToken(privateKey, validClaims(domain));
    const [header, , signature] = token.split(".");
    const forgedPayload = encodeJson(validClaims(domain, { email: "attacker@example.com" }));
    const forged = `${header}.${forgedPayload}.${signature}`;

    const check = await verifyAccessRequest(requestWith(forged), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("rejects a malformed token that is not three dot-separated segments", async () => {
    const env: AccessEnv = { CF_ACCESS_TEAM_DOMAIN: nextDomain(), CF_ACCESS_AUD: AUDIENCE };
    const check = await verifyAccessRequest(requestWith("not-a-jwt"), env, NOW);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });
});
