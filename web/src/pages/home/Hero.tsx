import type { JSX } from "react";

import { cardStatusLabel, competitorFor, heroStats } from "../../home-model.ts";
import type { FeaturedCard } from "../../home-model.ts";
import { titleCase } from "../../format.ts";
import type { SiteView } from "../../../../src/api/site.ts";
import { LivePill, PrimaryLink, SecondaryLink } from "../../ui/chrome.tsx";
import { href } from "../../route.ts";
import { accentFor } from "../../ui/accent.ts";
import { Sigil } from "../../ui/Sigil.tsx";

export function Hero({ view, card, watchHref }: {
  readonly view: SiteView;
  readonly card: FeaturedCard | undefined;
  readonly watchHref: string | undefined;
}): JSX.Element {
  return (
    <section className="dashboard-intro flex flex-col gap-6 py-2 lg:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-[-0.025em]">{card === undefined ? "The season desk" : "The matchup"}</h2>
        {card?.isLive ? <LivePill /> : <span className="text-xs font-semibold text-mist">{card === undefined ? "Waiting for the first game" : cardStatusLabel(card)}</span>}
      </div>
      {card === undefined ? (
        <p className="text-sm leading-relaxed text-mist">The season is ready. The first broadcast will appear here when a game is available.</p>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {[card.white, card.black].map((name) => (
            <div key={name} className="min-w-0">
              <Sigil name={name} accent={accentFor(name)} size={96} className="mb-4" />
              <a href={href({ kind: "competitor", competitor: name })} className="text-lg font-bold hover:text-brand-hi">{titleCase(name)}</a>
              <p className="mt-2 text-sm leading-relaxed text-mist">{competitorFor(view, name)?.playstyle}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {watchHref === undefined ? null : (
          <PrimaryLink href={watchHref}>{card?.isLive === true ? "Watch live" : card?.status === "finished" ? "Watch replay" : "Open broadcast"}</PrimaryLink>
        )}
        <SecondaryLink href="#roster">Meet the agents</SecondaryLink>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {heroStats(view).filter((stat) => stat.label !== "Agents").map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs text-mist">{stat.label}</dt>
            <dd className="tabular mt-1 text-lg font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <a href={href({ kind: "season", seasonId: view.seasonId })} className="w-fit text-sm font-semibold text-brand-hi hover:underline">
        Browse this season
      </a>
    </section>
  );
}
