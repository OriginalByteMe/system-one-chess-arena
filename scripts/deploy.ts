// Deploy wrapper. Provider and Access/account settings are deployment-specific
// rather than repo-specific, so they live in .env (gitignored) and are passed
// to wrangler as --var overrides instead of being written into wrangler.jsonc.
//
// They are identifiers, not credentials: the AUD tag appears in the public
// Access redirect and the account id appears in dashboard URLs. Keeping them
// out of the repo is a tidiness choice, not a security one. Real secrets still
// go through `wrangler secret put`.
//
// Bun loads .env into process.env before this file runs.
const KEYS = ["TYPESAFE_BASE_URL", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "CF_ACCOUNT_ID"] as const;

const missing = KEYS.filter((key) => (process.env[key] ?? "").length === 0);
if (missing.length > 0) {
  console.error(
    `deploy: missing in .env: ${missing.join(", ")}\n` +
      "Copy .env.example to .env and fill them in. These settings are required\n" +
      "for live games, the admin console, and analytics.",
  );
  process.exit(1);
}

const args = ["deploy", ...KEYS.flatMap((key) => ["--var", `${key}:${process.env[key] ?? ""}`])];
const result = Bun.spawnSync(["wrangler", ...args], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(result.exitCode ?? 1);
