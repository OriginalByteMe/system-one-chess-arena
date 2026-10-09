# System One Chess Arena

A chess league where AI decision systems compete as named players. Chess is the
laboratory: every turn has a closed set of legal choices, outcomes are
deterministic, and thousands of decisions run without human labelling. The
point is comparing decision architectures (typed decision models, LLMs,
heuristics, engines) on strength, latency, cost and calibration, not beating
Stockfish.

Hosted entirely on Cloudflare: one Worker serves the UI and API, Durable
Objects own season and game state, D1 holds the public read model.

See `PLAN.md` for the build order and `AGENTS.md`-adjacent vault note
`Project Ideas/System One Chess Arena.md` for the full design rationale.

## Development

```sh
bun install
bun run typecheck
bun run dev        # wrangler dev on :8787
```

## Running a persona on your own GPU (`/local`)

League games are decided by Jev on the server. `/local` is the opposite on
purpose: a small open model runs in the visitor's browser over WebGPU
(`@mlc-ai/web-llm`), plays a persona's brief against them, and answers with a
probability for each option read from the model's own token logprobs. Nothing
there is recorded, rated, or sent to the arena.

The model is picked by `web/src/local/tiers.ts` from what the browser reports
(WebGPU adapter limits, half-precision support, reported RAM, mobile) and a
half-second matmul benchmark (`bench.ts`): Llama 3.2 1B, then Qwen3.5 2B, 4B and
9B. Weights come from Hugging Face on an explicit click, and a model that fails
to load steps down a tier. The thresholds are first-pass estimates, not
calibrated on real devices; they sit in one file so they can be tuned.

WebLLM caps `top_logprobs` at 5, so a browser decision carries the model's top
five options (renormalised) plus the `tailMass` it could not see, where Jev
returns a full distribution.

## Deploying

The site runs live on Cloudflare Workers, Durable Objects and D1. First-time
setup (creating the D1 database, applying migrations, secrets, Cloudflare
Access in front of `/admin`, Web Analytics) and every deploy after that is
covered start to finish in `DEPLOY.md`. Once set up:

```sh
bun run deploy      # builds web/dist, then wrangler deploy
```
