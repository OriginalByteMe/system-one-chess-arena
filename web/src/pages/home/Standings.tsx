// The compact standings and six next or recently finished games.
import type { JSX } from "react";

import { clockTime, dayLabel, standings, statusLabel } from "../../home-model.ts";
import { seconds, titleCase } from "../../format.ts";
import { href } from "../../route.ts";
import type { SiteView } from "../../../../src/api/site.ts";
import { accentFor } from "../../ui/accent.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";
import { Sigil } from "../../ui/Sigil.tsx";

export function Standings({ view }: { readonly view: SiteView }): JSX.Element {
  const rows = standings(view);
  const leaders = rows.slice(0, 5);
  const pending = view.games.filter((game) => game.status !== "finished").sort((a, b) => a.startAt - b.startAt);
  const schedule = (pending.length > 0 ? pending : view.games.slice().sort((a, b) => b.startAt - a.startAt)).slice(0, 6);

  return (
    <div id="standings" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="min-w-0 lg:col-span-7">
        <CardHead
          title="Standings"
          meta={<span>{rows.length > leaders.length ? `Leading ${leaders.length}` : "Revealed games"}</span>}
        />
        {leaders.length === 0 ? (
          <p className="text-sm text-mist">No games have finished yet, so there is nothing to rank.</p>
        ) : (
          <>
            <p id="home-standings-scroll-hint" className="mb-2 text-[11px] font-semibold text-mist sm:hidden">
              Scroll sideways for every score.
            </p>
            <div
              role="region"
              aria-label="Leading season standings"
              aria-describedby="home-standings-scroll-hint"
              tabIndex={0}
              className="-mx-1 overflow-x-auto rounded-lg focus-visible:outline-offset-2"
            >
              <table className="w-full min-w-[34rem] border-collapse text-sm">
                <caption className="sr-only">The first five competitors in the server-ranked leaderboard</caption>
                <thead>
                  <tr className="text-left text-[11px] font-bold tracking-[0.06em] text-mist uppercase">
                    <th scope="col" className="pb-2 pl-2 pr-2">Rank</th>
                    <th scope="col" className="pb-2 pr-2">Competitor</th>
                    <th scope="col" className="pb-2 pr-2 text-right">W–D–L</th>
                    <th scope="col" className="pb-2 pr-2 text-right">Score</th>
                    <th scope="col" className="pb-2 pr-2 text-right">Elo</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((standing) => (
                    <tr key={standing.row.competitor} className="border-t border-rail hover:bg-pit/60">
                      <td className="tabular py-2.5 pl-2 pr-2 text-base font-extrabold text-mist">
                        {standing.rank}
                      </td>
                      <th scope="row" className="py-2.5 pr-2 text-left">
                        <a
                          href={href({ kind: "competitor", competitor: standing.row.competitor })}
                          className="flex min-w-44 items-center gap-2.5 rounded font-semibold text-chalk underline-offset-4 hover:text-brand-hi hover:underline"
                        >
                          <Sigil
                            name={standing.row.competitor}
                            accent={accentFor(standing.row.competitor)}
                            size={32}
                          />
                          {titleCase(standing.row.competitor)}
                        </a>
                      </th>
                      <td className="tabular py-2.5 pr-2 text-right text-mist">
                        {standing.row.wins}–{standing.row.draws}–{standing.row.losses}
                      </td>
                      <td className="tabular py-2.5 pr-2 text-right font-semibold text-chalk">
                        {standing.row.score.toFixed(1)}
                      </td>
                      <td className="tabular py-2.5 pr-2 text-right font-extrabold text-brand-hi">
                        {Math.round(standing.row.elo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rail pt-3 text-xs font-bold">
          <a
            href={href({ kind: "leaderboard", seasonId: view.seasonId })}
            className="rounded text-chalk underline decoration-rail underline-offset-4 hover:text-brand-hi"
          >
            Full leaderboard
          </a>
          {view.bracketId === undefined ? null : (
            <a
              href={href({ kind: "bracket", bracketId: view.bracketId })}
              className="rounded text-chalk underline decoration-rail underline-offset-4 hover:text-brand-hi"
            >
              View elimination bracket
            </a>
          )}
          <span className="font-medium text-mist">Finished broadcasts only</span>
        </div>
      </Card>

      <Card className="min-w-0 lg:col-span-5">
        <CardHead
          title={pending.length > 0 ? "Coming up" : "Season results"}
          meta={<a href={href({ kind: "season", seasonId: view.seasonId })} className="font-semibold text-brand-hi hover:underline">All {view.games.length} games</a>}
        />
        {schedule.length === 0 ? (
          <p className="text-sm text-mist">This season has no games yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rail">
            {schedule.map((game) => (
              <li key={game.gameId}>
                <a
                  href={href({ kind: "watch", seasonId: game.seasonId, gameId: game.gameId })}
                  className="-mx-2 flex flex-col gap-2 rounded-lg px-2 py-3 transition-colors hover:bg-pit sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex shrink-0 items-baseline justify-between gap-3 sm:block sm:w-20">
                    <div className="tabular text-sm font-bold text-chalk">
                      {game.startAt === 0 ? "Recorded" : clockTime(game.startAt)}
                    </div>
                    {game.startAt === 0 ? null : <div className="text-[11px] text-mist">{dayLabel(game.startAt)}</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-chalk">
                      {titleCase(game.white.name)} vs {titleCase(game.black.name)}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-mist">
                      <span>{statusLabel(game, view.now)}</span>
                      {game.startAt === 0 ? null : <span className="tabular shrink-0">{seconds(game.msPerPly)}/ply</span>}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
