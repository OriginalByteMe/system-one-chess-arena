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
