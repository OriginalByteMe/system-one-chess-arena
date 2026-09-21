# Deploying AgentMate

An ordered runbook for taking this repository from a checkout to a live
Cloudflare Worker at `chess.noahrijkaard.com`. Follow it top to bottom on the
first deploy; later deploys are just step 8.

Steps marked **(dashboard)** happen in the Cloudflare dashboard, not the CLI.
Everything else is a copy-pasteable command run from the repo root.

## 0. Prerequisites

- A Cloudflare account with Workers, D1 and Analytics Engine available (all
  on the free plan; Analytics Engine and D1 are GA).
- The `noahrijkaard.com` zone in that same account. `wrangler.jsonc` claims
  `chess.noahrijkaard.com` as a custom domain, so the deploy creates the DNS
  record and the certificate for you. If the zone lives in another account,
  either move it or delete the `routes` block and use the `*.workers.dev`
  hostname instead.
- `bun install` already run.
- Authenticate wrangler once:

  ```sh
  bunx wrangler login
  ```

  This opens a browser and stores a token under `~/.wrangler`; no
  `CLOUDFLARE_API_TOKEN` is needed for anything in this document.

## 1. Create the D1 database

```sh
bunx wrangler d1 create arena
```

The command prints a block like:

```jsonc
{
  "d1_databases": [
    { "binding": "DB", "database_name": "arena", "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
  ]
}
```

Copy the `database_id` value into `wrangler.jsonc`, replacing
`"local-development-placeholder"` in the existing `d1_databases` entry. Do not
touch `binding` or `database_name`.

## 2. Apply migrations

Locally first, so `wrangler dev` matches what production will have:

```sh
bun run db:migrate:local
```

Then against the real remote database, once `database_id` from step 1 is in
`wrangler.jsonc`:

```sh
bun run db:migrate:remote
```

Both commands run all four migrations in `migrations/` (`0001_init.sql`
through `0004_site.sql`) in order; wrangler tracks which ones a database has
already applied, so re-running either command later only applies what is new.

## 3. Set secrets

Each of these is `wrangler secret put`, never a `vars` entry in
`wrangler.jsonc`, because they grant access rather than describe
configuration:

```sh
bunx wrangler secret put ARENA_ADMIN_TOKEN
```
A bearer token you invent yourself (e.g. `openssl rand -hex 32`). It gates the
scripted admin routes (`POST /api/seasons/:id/start`, `/record`, `/complete`,
`GET /api/seasons/:id/standings`). Without it those routes refuse every
request with 503, which is the safe state if you skip this step.

```sh
bunx wrangler secret put CF_ANALYTICS_TOKEN
```
A Cloudflare API token scoped to **Account Analytics: Read** only, for
querying the Analytics Engine SQL API. Create it under **My Profile > API
Tokens > Create Token > Custom Token** (dashboard), account resource set to
the account this Worker lives in, and the single permission
`Account.Account Analytics:Read`.

```sh
bunx wrangler secret put TYPESAFE_API_KEY
```
The Jev/TypeSafe API key, if you have one. Leave it unset (`wrangler secret
put` still needs a value, so put an empty string or skip this entirely) to
keep the adapter running against the fallback contract described in
`.env.example`.

## 4. Set the non-secret vars

`ARENA_FEATURED_SEASON`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and
`CF_ACCOUNT_ID` are already declared in `wrangler.jsonc` under `vars`, each
defaulting to `""`. Edit those four values directly in `wrangler.jsonc`
(they are not secret, so they are committed):

- `ARENA_FEATURED_SEASON` — a season id, once one exists worth featuring on
  the front page. Leave `""` until then; the front page falls back to the
  most recently scheduled season.
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` — filled in during step 5
  below, from values Access hands you when you create the application.
- `CF_ACCOUNT_ID` — **(dashboard)** the account id shown in the right
  sidebar of any zone or account overview page in the Cloudflare dashboard.

## 5. Put Cloudflare Access in front of /admin

**(dashboard)** The operator console at `/admin` is a client-rendered route,
so it must be gated at the edge, not by page logic:

1. Cloudflare One / Zero Trust dashboard → **Access > Applications > Add an
   application**.
2. Application type: **Self-hosted**.
3. Application domain: `chess.noahrijkaard.com`, path `/admin`.
4. Add a policy: action **Allow**, include rule **Emails** → your own email
   address. This is a single-operator console; one email is the whole
   policy.
5. Save. The application detail page now shows an **Application Audience
   (AUD) Tag** — copy it into `CF_ACCESS_AUD` in `wrangler.jsonc`.
6. Your team domain is shown in **Settings > Custom Pages** (or in the URL
   Access redirects you to when you sign in), formatted like
   `your-team.cloudflareaccess.com`. Copy it into `CF_ACCESS_TEAM_DOMAIN`.

Signed out, a request to `/admin` (or to `/api/admin/*`) is intercepted by
Access before it reaches the Worker and gets Access's own sign-in redirect or
a 403 — never the operator console itself.

## 6. Enable Web Analytics and add the beacon token

**(dashboard)** Cloudflare dashboard → **Analytics & Logs > Web Analytics >
Add a site**, with hostname `chess.noahrijkaard.com`. The setup page shows a
JavaScript snippet with a `data-cf-beacon` token.

Open `web/index.html` and replace `REPLACE-ME-BEACON-TOKEN` (search for it;
it appears once, inside the `data-cf-beacon` attribute of the analytics
`<script>` tag) with the real token value, then rebuild:

```sh
bun run build:web
```

One placeholder is left in checked-in markup: `REPLACE-ME-BEACON-TOKEN`,
replaced above. It appears once, in `web/index.html`.

There is deliberately no `<link rel="canonical">` in the document until the
domain is live. Once step 7 has succeeded and `chess.noahrijkaard.com` serves
the site, add this line to `web/index.html`'s `<head>` and rebuild:

```html
<link rel="canonical" href="https://chess.noahrijkaard.com/" />
```

## 7. First deploy

```sh
bun run deploy
```

This runs `build:web` (typecheck + Vite build into `web/dist`) and then
`wrangler deploy`, which uploads the Worker, the static assets and every
binding declared in `wrangler.jsonc`.

## 8. Verify

The first deploy provisions `chess.noahrijkaard.com` and its certificate,
which usually takes under a minute and occasionally a few. Until it resolves,
the same checks work against the `*.workers.dev` hostname printed at the end
of the deploy output.

```sh
curl -s https://chess.noahrijkaard.com/api/health
```
Expect `{"ok":true,"phase":2}`.

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://chess.noahrijkaard.com/
```
Expect `200` — the front page, served from `web/dist` via the SPA fallback.

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://chess.noahrijkaard.com/admin
```
Signed out (no Access session cookie), Access intercepts this before the
Worker does; expect a redirect to Access's sign-in page (a `302`, or a `403`
if you `curl` it without following redirects) rather than a `200` serving
the console.

The domain and the worker's own `*.workers.dev` subdomain are both listed
under **Workers & Pages > (your Worker) > Settings > Domains & Routes**.

## Rolling back

```sh
bunx wrangler deployments list
bunx wrangler rollback [deployment-id]
```

Omitting `[deployment-id]` rolls back to the previous deployment. Rollback
reverts the Worker's code and static assets; it does not undo D1 migrations
or secrets, so a rollback that depends on an un-applied migration will still
see the new schema.

## Tailing logs

```sh
bunx wrangler tail
```

Streams live `console.log` output and request metadata from the deployed
Worker. Add `--format pretty` for human-readable output, or
`--status error` to filter to failing requests only.

## Every value the operator supplies, and where it comes from

| Value | Where it comes from | Where it goes |
| --- | --- | --- |
| D1 `database_id` | Output of `wrangler d1 create arena` (step 1) | `wrangler.jsonc` → `d1_databases[0].database_id` |
| `ARENA_ADMIN_TOKEN` | Invented by the operator (e.g. `openssl rand -hex 32`) | `wrangler secret put ARENA_ADMIN_TOKEN` (step 3) |
| `CF_ANALYTICS_TOKEN` | Cloudflare dashboard → My Profile → API Tokens, scoped to Account Analytics: Read | `wrangler secret put CF_ANALYTICS_TOKEN` (step 3) |
| `TYPESAFE_API_KEY` | Jev/TypeSafe account, if one exists | `wrangler secret put TYPESAFE_API_KEY` (step 3) |
| `CF_ACCOUNT_ID` | Cloudflare dashboard, right sidebar of any zone/account overview page | `wrangler.jsonc` → `vars.CF_ACCOUNT_ID` (step 4) |
| `CF_ACCESS_AUD` | Access application detail page, after creating the app in step 5 | `wrangler.jsonc` → `vars.CF_ACCESS_AUD` (step 4/5) |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust dashboard → Settings → Custom Pages | `wrangler.jsonc` → `vars.CF_ACCESS_TEAM_DOMAIN` (step 4/5) |
| `ARENA_FEATURED_SEASON` | A season id, once a season is worth pinning | `wrangler.jsonc` → `vars.ARENA_FEATURED_SEASON` (step 4) |
| Web Analytics beacon token | Cloudflare dashboard → Analytics & Logs → Web Analytics → Add a site | `web/index.html`, the `data-cf-beacon` attribute (step 6) |
| Canonical URL | Whatever custom domain (if any) ends up attached to the Worker | `web/index.html`, `<link rel="canonical">` href (step 6) |
