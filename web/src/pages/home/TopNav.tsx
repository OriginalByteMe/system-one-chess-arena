// The masthead every page in the new design shares.
import type { JSX } from "react";

import { href } from "../../route.ts";
import { PrimaryLink } from "../../ui/chrome.tsx";
import { SITE } from "../../site.ts";
import { AuthorLink } from "../../ui/AuthorLink.tsx";
import knightMark from "../../assets/agentmate.svg";

export function BoardMark({ size = 30 }: { readonly size?: number }): JSX.Element {
  return <img src={knightMark} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />;
}

export function TopNav({
  seasonId,
  watchHref,
  bracketId,
  isLive = false,
}: {
  readonly seasonId?: string;
  readonly watchHref?: string;
  readonly bracketId?: string;
  readonly isLive?: boolean;
}): JSX.Element {
  return (
    <header className="site-nav sticky top-0 z-20 border-b border-rail bg-void px-4 sm:px-8">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-5 gap-y-1 py-3">
      <a href={href({ kind: "home" })} className="flex items-center gap-2">
        <BoardMark />
        <span className="text-xl leading-tight font-extrabold tracking-[-0.025em] text-chalk">{SITE.name}</span>
      </a>

      <nav
        aria-label="Primary"
        className="order-3 flex basis-full items-center gap-1 overflow-x-auto whitespace-nowrap pb-1 lg:order-2 lg:basis-auto lg:pb-0"
      >
        <a
          href={seasonId === undefined ? "/#standings" : href({ kind: "leaderboard", seasonId })}
          className="rounded px-2.5 py-1.5 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk"
        >
          Leaderboard
        </a>
        <a
          href="/#roster"
          className="rounded px-2.5 py-1.5 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk"
        >
          Agents
        </a>
        <a
          href="/#replays"
          className="rounded px-2.5 py-1.5 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk"
        >
          Replays
        </a>
        <a href="/#how-it-works" className="rounded-lg px-2.5 py-2 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk">About Jev</a>
        <a
          href={href({ kind: "local" })}
          className="rounded px-2.5 py-1.5 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk"
        >
          Run locally
        </a>
        {bracketId === undefined ? null : <a href={href({ kind: "bracket", bracketId })} className="rounded-lg px-2.5 py-2 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk">Bracket</a>}
        {seasonId === undefined ? null : (
          <a
            href={href({ kind: "season", seasonId })}
            className="rounded px-2.5 py-1.5 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk"
          >
            All games
          </a>
        )}
      </nav>

      <div className="order-2 flex items-center gap-4 lg:order-3">
        <AuthorLink />
        {watchHref === undefined ? null : <span className="hidden xl:inline-flex"><PrimaryLink href={watchHref}>{isLive ? "Watch live" : "Watch replay"}</PrimaryLink></span>}
      </div>
      </div>
    </header>
  );
}
