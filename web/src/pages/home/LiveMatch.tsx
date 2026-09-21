// The game the page opens on, laid out the way a live game is: one competitor
// above the board, one below. There is no clock in this league, so the slot a
// chess site puts a clock in carries the honest equivalent — how long that
// competitor typically takes to decide, against the budget its brief gives it.
import type { JSX } from "react";

import { cardStatusLabel, competitorFor, rowFor } from "../../home-model.ts";
import type { FeaturedCard } from "../../home-model.ts";
import { percent, seconds, titleCase } from "../../format.ts";
import { href } from "../../route.ts";
import type { SiteView } from "../../../../src/api/site.ts";
import { MiniBoard } from "../../ui/board/MiniBoard.tsx";
import { accentFor } from "../../ui/accent.ts";
import { Card, LivePill, PrimaryLink } from "../../ui/chrome.tsx";
import { Sigil } from "../../ui/Sigil.tsx";

function PlayerRow({
  view,
  name,
  side,
  toMove,
}: {
  readonly view: SiteView;
  readonly name: string;
  readonly side: "white" | "black";
  readonly toMove: boolean;
}): JSX.Element {
  const row = rowFor(view, name);
  const brief = competitorFor(view, name);
  const accent = accentFor(name);
  const typical = row === undefined || row.meanLatencyMs === 0 ? undefined : row.meanLatencyMs;

  return (
    <div className="flex items-center gap-3">
      <Sigil
        name={name}
        accent={accent}
        size={48}
        thinking={toMove}
        {...(row?.meanConfidence === undefined ? {} : { charge: row.meanConfidence })}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <a
            href={href({ kind: "competitor", competitor: name })}
            className="truncate text-[15px] font-bold text-chalk hover:text-brand-hi"
          >
            {titleCase(name)}
          </a>
          {row === undefined ? null : (
            <span className="tabular text-xs font-semibold text-mist">{Math.round(row.elo)}</span>
          )}
        </div>
        <div className="truncate text-xs text-mist">
          {side === "white" ? "White" : "Black"}
          {brief === undefined ? "" : ` · ${brief.strategies.map(titleCase).join(", ")}`}
        </div>
      </div>
      {typical === undefined ? null : (
        <div
          className={`shrink-0 rounded px-2.5 py-1 text-right ${toMove ? "bg-brand text-void" : "bg-pit text-mist"}`}
          title={
            brief === undefined
              ? `Mean decision ${seconds(typical)}`
              : `Mean decision ${seconds(typical)} of a ${seconds(brief.budgetMs)} budget`
          }
        >
          <div className="tabular text-sm leading-tight font-bold">{seconds(typical)}</div>
          <div className={`text-[10px] leading-tight ${toMove ? "text-void/70" : "text-mist"}`}>
            {brief === undefined ? "mean decision" : `of ${seconds(brief.budgetMs)}`}
          </div>
        </div>
      )}
    </div>
  );
}

export function LiveMatch({
  view,
  card,
}: {
  readonly view: SiteView;
  readonly card: FeaturedCard;
}): JSX.Element {
  // Whoever did not just move is next, and before the first move white starts.
  const nextColour = card.mover === undefined ? "white" : card.mover === card.white ? "black" : "white";
  const toMove = nextColour === "white" ? card.white : card.black;
  const moverAccent = accentFor(card.mover ?? card.white);
  const watch = card.isLive
    ? href({ kind: "live", gameId: card.gameId })
    : href({ kind: "watch", seasonId: card.seasonId, gameId: card.gameId });

  return (
    <Card className="featured-board mx-auto flex w-full max-w-[500px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {card.isLive ? <LivePill /> : null}
          <h2 className="text-[15px] leading-none font-bold text-chalk">
            {card.isLive ? "On air" : card.status === "finished" ? "The latest match" : "Up next"}
          </h2>
        </div>
        <span className="tabular text-xs text-mist">{cardStatusLabel(card)}</span>
      </div>

      <PlayerRow view={view} name={card.black} side="black" toMove={card.status === "on-air" && nextColour === "black"} />

      <div className="mx-auto w-full max-w-[420px]">
        <MiniBoard
          fen={card.fen}
          orientation="white"
          {...(card.lastMove === undefined ? {} : { lastMove: card.lastMove })}
          moverAccent={moverAccent}
        />
      </div>

      <PlayerRow view={view} name={card.white} side="white" toMove={card.status === "on-air" && nextColour === "white"} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rail pt-3">
        <p className="text-sm text-mist">
          {card.status === "finished" ? (
            card.plies === undefined ? null : (
              <>
                <span className="font-semibold text-chalk">{card.plies}</span> plies played
              </>
            )
          ) : card.status === "scheduled" ? "Waiting for the broadcast" : (
            <>
              <span className="font-semibold text-chalk">{titleCase(toMove)}</span> is deciding
              {card.confidence === undefined
                ? null
                : ` · last call ${percent(card.confidence)} confident`}
            </>
          )}
        </p>
        <PrimaryLink href={watch}>
          {card.isLive ? "Watch live" : card.status === "finished" ? "Watch replay" : "Open broadcast"}
        </PrimaryLink>
      </div>
    </Card>
  );
}
