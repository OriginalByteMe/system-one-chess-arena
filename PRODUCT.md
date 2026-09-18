# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One primary visitor: a technically literate person who has an opinion about AI
systems and no particular opinion about chess. They arrive from a link, give
the page thirty seconds to explain itself, and either start watching or leave.
They are not a chess player looking for chess; they are here to see whether a
decision system is any good, and chess is the instrument.

A secondary user is the operator, Noah, who records seasons, seeds brackets and
reads the evidence. The operator's surfaces are admin endpoints behind a bearer
token, not part of the public site.

## Product Purpose

A league where AI decision systems compete at chess as named personas, so their
strength, cost, latency and self-assessment can be compared on identical
ground. Success is a visitor who can say which competitor is better and why,
having watched rather than read a claim.

The unit of the product is the recorded season, broadcast on a shared clock.
Games are played and stored up front, then revealed one ply at a time, so
everyone watching sees the same position at the same second and nobody can see
the ending early.

## Positioning

Every competitor plays with the same engine behind it. What differs is the
brief: a paragraph of playstyle prose, a declared set of strategies, a declared
set of board features, a time and money budget. The league therefore measures
the brief, not the model, and that is the comparison a benchmark table cannot
make.

Two things a neighbouring product could not truthfully copy:

- Every move is stored with the reasoning that produced it: the strategy the
  system declared before moving, its stated confidence, its probability
  distribution over legal moves, what it was allowed to see, how long it took
  and what it cost. The audit exists at ply resolution.
- Competitors evolve between seasons, and every version is immutable with a
  parent, so a competitor's whole lineage is inspectable and each game names
  which version played it.

## Operating Context

Watched on a phone or a laptop, in a browser tab, usually alongside other
tabs. Sessions are short and repeated rather than long: a visitor checks what
is on, watches some of it, comes back the next day. There is no account, no
install and nothing to configure.

Settled 2026-09-18: one match a day, broadcast at an appointment time; a
knockout season that runs Monday to Saturday; Sunday for adaptation and the
next seeding. So the site has a daily rhythm the visitor is expected to learn.

## Capabilities and Constraints

Built and tested: recording pipeline, broadcast clock and server-side spoiler
gate, leaderboard and calibration computed on read, elimination matches and
brackets, rivalry traits, self-revision between seasons, gated read API,
per-ply decision log.

Hosted entirely on Cloudflare: Workers, Durable Objects, D1. Measured limits
that bind the design: 30s CPU per request on the paid plan, six simultaneous
outgoing connections per invocation, 15 minute maximum Durable Object alarm,
1 minute cron granularity. A season of six games records in about 40 seconds
and costs under a cent.

Measured facts about the engine, from eleven live experiments on 2026-09-18
(`Reference/Live Jev experiments.md` in the project vault):

- The playstyle prose is the only lever that measurably changes play. One
  rewritten sentence changed 58% of moves and flipped the declared strategy on
  every position tested.
- The personas are genuinely different players, agreeing with each other on
  13% to 79% of moves against a 92% to 100% repeat-agreement floor, and they
  differ in strength in the direction their brief promises.
- The declared feature vector changed nothing measurable, because the features
  are position-level scalars that never say which move is the trap. Decided
  2026-09-18: features move to per-candidate-move annotations.
- Stated confidence does not yet predict mistakes. The calibration curve is
  honest arithmetic over numbers that carry no signal, and must be presented as
  an open experiment, not a score.
- Games do not finish on their own: six of six recorded games drew by
  repetition or move limit. Decided 2026-09-18: a game ending by repetition or
  move limit is adjudicated on final material with a draw band.

Undecided: whether a public season index exists, or a season is only ever
reached by link. No route lists seasons today.

## Brand Commitments

The name is System One Chess Arena. Competitors are named personas with lower
case names (`architect`, `aggressor`, `economist`, `blitzen`, `ledger`,
`mason`) and a one sentence playstyle brief that is shown to the visitor,
because it is also the text the engine reads. The persona brief is product
truth, not copy, and may not be rewritten for tone.

Voice: plain and specific. The product's claim is that it measures things, so
the writing states numbers and refuses adjectives it cannot support.

## Evidence on Hand

Real, in the local database and reproducible: 585 recorded decisions across
four seasons, every one against the live endpoint, with strategy, confidence,
distribution, latency, cost and declared features per ply. Six recorded games
with full move lists. Two competitors with two-version lineages. Measured
costs: about $0.0009 per competitor per season in input tokens, 422ms mean
decision latency, six 24-ply games recorded in 16.1 seconds.

Absent, and not to be fabricated: any game with a decisive result, any
competitor rated other than 1500, any rivalry trait that has fired in a real
season, any generative LLM competitor (there is no key), and any production
deployment. Nothing has run on real Cloudflare infrastructure.

## Product Principles

1. **Never spoil.** The gate is the product. Anything the clock has not reached
   does not exist in the response, and the site may not imply otherwise.
2. **Show the reasoning, not a score.** A number without the decision behind it
   is a claim. Every aggregate must be walkable down to the plies that made it.
3. **State what is measured and what is not.** The calibration curve means
   nothing yet, so say so on the page.
4. **The brief is the competitor.** Personas are their prose. The site should
   make a visitor read the brief before the rating.
5. **Return tomorrow.** One match a day at a fixed time is the product's
   rhythm; the site should always answer "what is on now, and what is next".

## Accessibility & Inclusion

Boards must be readable without colour alone: a highlighted last move needs a
non-colour cue. Every control reachable and labelled by keyboard, since the
watch page is mostly buttons. No autoplaying motion that cannot be stopped, and
`prefers-reduced-motion` respected, which the existing board already does.
