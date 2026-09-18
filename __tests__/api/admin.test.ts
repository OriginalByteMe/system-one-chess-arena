import { describe, expect, test } from "bun:test";
import { requireAdmin } from "../../src/api/admin.ts";

const TOKEN = "test-admin-token-value";
const URL = "https://arena.test/api/admin/record";

function request(authorization?: string): Request {
  return authorization === undefined
    ? new Request(URL, { method: "POST" })
    : new Request(URL, { method: "POST", headers: { Authorization: authorization } });
}

describe("requireAdmin", () => {
  test("refuses with 503 when no token is configured", () => {
    const check = requireAdmin(request(`Bearer ${TOKEN}`), undefined);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(503);
  });

  test("refuses a request with no Authorization header when no token is configured", () => {
    const check = requireAdmin(request(), undefined);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(503);
  });

  test("never accepts any bearer when no token is configured", () => {
    const attempts = [request(), request("Bearer anything"), request("Bearer ")];

    for (const attempt of attempts) {
      expect(requireAdmin(attempt, undefined).ok).toBe(false);
    }
  });

  test("passes with the correct bearer token", () => {
    const check = requireAdmin(request(`Bearer ${TOKEN}`), TOKEN);

    expect(check.ok).toBe(true);
  });

  test.each([
    ["a missing header", undefined],
    ["an empty header", ""],
    ["a non-Bearer scheme", `Basic ${TOKEN}`],
    ["a wrong token", "Bearer wrong-token-value"],
    ["a token that is a prefix of the real one", `Bearer ${TOKEN.slice(0, -1)}`],
    ["a token that is the real one plus a suffix", `Bearer ${TOKEN}x`],
  ])("rejects %s with 401", (_description, authorization) => {
    const check = requireAdmin(request(authorization), TOKEN);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.response.status).toBe(401);
  });

  test("gives the same 401 body regardless of why the request was rejected", async () => {
    const attempts = [
      request(),
      request(""),
      request(`Basic ${TOKEN}`),
      request("Bearer wrong-token-value"),
      request(`Bearer ${TOKEN.slice(0, -1)}`),
      request(`Bearer ${TOKEN}x`),
    ];

    const bodies: string[] = [];
    for (const attempt of attempts) {
      const check = requireAdmin(attempt, TOKEN);
      if (check.ok) throw new Error("expected every attempt to be rejected");
      bodies.push(await check.response.text());
    }

    expect(new Set(bodies).size).toBe(1);
  });

  test("does not throw comparing tokens of very different lengths", () => {
    expect(() => requireAdmin(request("Bearer x"), TOKEN)).not.toThrow();
    expect(() => requireAdmin(request(`Bearer ${"y".repeat(500)}`), TOKEN)).not.toThrow();
    expect(() => requireAdmin(request(), "z")).not.toThrow();
  });
});
