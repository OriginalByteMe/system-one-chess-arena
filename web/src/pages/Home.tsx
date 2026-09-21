// The front page uses the broadcast-gated site and bracket views.
import type { JSX } from "react";

import { apiPath, useJson } from "../api.ts";
import { featuredCard, liveGamesOf } from "../home-model.ts";
import { href } from "../route.ts";
import type { SiteView } from "../../../src/api/site.ts";
import type { Bracket as BracketRecord } from "../../../src/core/types.ts";
import { BracketTree } from "./Bracket.tsx";
import { DecisionShape } from "./home/landing/DecisionShape.tsx";
import { Footer } from "./home/Footer.tsx";
import { Highlights } from "./home/Highlights.tsx";
import { Hero } from "./home/Hero.tsx";
import { LatestGames } from "./home/LatestGames.tsx";
import { LiveMatch } from "./home/LiveMatch.tsx";
import { NowPlaying } from "./home/NowPlaying.tsx";
import { Roster } from "./home/Roster.tsx";
import { Standings } from "./home/Standings.tsx";
import { TopNav } from "./home/TopNav.tsx";
import { Landing } from "./home/landing/Landing.tsx";

/**
 * Poll intervals. A live season changes every second and its response is
 * uncached, so the front page asks often while something is playing and backs
 * off to the cached path when nothing is.
 */
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 30_000;

export function Home(): JSX.Element {
  const site = useJson<SiteView>("/api/site", IDLE_POLL_MS);
  const view = site.data;
  const anyLive = view !== undefined && liveGamesOf(view).some((game) => game.finished === undefined);
  // A second subscription at the faster interval, mounted only while a game is
  // being decided. React keeps the slower one warm for everything else.
  const liveSite = useJson<SiteView>(anyLive ? "/api/site" : undefined, LIVE_POLL_MS);
  const current = anyLive && liveSite.data !== undefined ? liveSite.data : view;
  const card = current === undefined ? undefined : featuredCard(current);
  const bracket = useJson<BracketRecord>(
    current?.bracketId === undefined ? undefined : apiPath("brackets", current.bracketId),
    5000,
  );

  if (current === undefined) {
    if (!site.loading && site.error === undefined && site.notFound === true) {
      return <Landing />;
    }
    return (
      <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
        <TopNav />
        <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 px-4 py-10 sm:px-8" aria-busy={site.loading}>
          <p role="status" className="text-sm text-mist">{site.error ?? "Loading the season…"}</p>
          {site.error === undefined ? (
            <div aria-hidden="true" className="grid items-center gap-8 lg:grid-cols-2">
              <div className="aspect-square w-full max-w-[500px] rounded-xl border border-rail bg-pit" />
              <div className="space-y-5"><div className="h-8 w-2/3 rounded bg-deck" /><div className="h-20 rounded bg-pit" /><div className="h-11 w-36 rounded-lg bg-deck" /></div>
            </div>
          ) : <button type="button" onClick={() => window.location.reload()} className="w-fit rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-void hover:bg-brand-hi">Try again</button>}
        </main>
        <Footer />
      </div>
    );
  }

  const watchHref =
    card === undefined
      ? undefined
      : card.isLive
        ? href({ kind: "live", gameId: card.gameId })
        : href({ kind: "watch", seasonId: card.seasonId, gameId: card.gameId });

  return (
    <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
      <TopNav seasonId={current.seasonId} {...(current.bracketId === undefined ? {} : { bracketId: current.bracketId })} {...(watchHref === undefined ? {} : { watchHref, isLive: card?.isLive === true })} />

      <main className="dashboard-main mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-12 px-4 py-6 sm:gap-16 sm:px-8 sm:py-8">
        <section aria-labelledby="arena-title">
          <div className="mb-8">
            <h1 id="arena-title" className="font-display text-[clamp(2rem,3.4vw,3rem)] leading-[1.12] font-extrabold tracking-[-0.035em] text-balance">
              Same mind. <span className="text-brand-hi">Different instincts.</span>
            </h1>
            <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-mist">AI personalities compete at chess. Watch the match, then see the choices behind every move.</p>
            {watchHref === undefined ? null : <a href={watchHref} className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-bold text-void hover:bg-brand-hi lg:hidden">{card?.isLive ? "Watch live" : card?.status === "finished" ? "Watch replay" : "Open broadcast"}</a>}
          </div>
          {current.bracketId === undefined ? null : (
            <div className="mb-12 border-t border-rail pt-6">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="elimination-title" className="text-2xl font-bold tracking-[-0.03em] text-chalk">Elimination bracket</h2>
                  <p className="mt-2 text-sm text-mist">Follow every match to the final.</p>
                </div>
                <a href={href({ kind: "bracket", bracketId: current.bracketId })} className="inline-flex min-h-11 items-center rounded-lg border border-rail px-4 text-sm font-semibold text-brand-hi hover:bg-rail">Open full bracket</a>
              </div>
              {bracket.data !== undefined ? <BracketTree bracket={bracket.data} compact /> : <p role="status" className="rounded-xl border border-rail bg-pit p-5 text-sm text-mist">{bracket.notFound ? "This bracket is not available yet." : bracket.error ?? "Loading the bracket…"}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            {card === undefined ? null : <LiveMatch view={current} card={card} />}
            <Hero view={current} card={card} watchHref={watchHref} />
          </div>
        </section>
        {anyLive ? <NowPlaying games={liveGamesOf(current)} /> : null}

        <section className="flex flex-col gap-6" aria-labelledby="competition-title">
          <div>
            <h2 id="competition-title" className="text-3xl font-bold tracking-[-0.03em]">The competition</h2>
            <p className="mt-2 text-sm text-mist">Different briefs. Shared rules. Results you can replay.</p>
          </div>
          <Standings view={current} />
          {current.bracketId === undefined ? <p className="rounded-xl border border-dashed border-rail p-5 text-sm text-mist">This season has no elimination bracket. Finished games still count toward the leaderboard.</p> : null}
        </section>
        <LatestGames view={current} />
        <Highlights view={current} />
        <Roster view={current} />
        <DecisionShape />
      </main>

      <Footer />
    </div>
  );
}
