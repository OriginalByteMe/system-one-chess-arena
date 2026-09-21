import { MiniBoard } from "../ui/board/MiniBoard.tsx";
import { Loading, Shell } from "../Shell.tsx";
import { apiPath, useJson } from "../api.ts";
import { dashboardCards } from "../dashboard-model.ts";
import { titleCase } from "../format.ts";
import { href } from "../route.ts";
import { accentFor } from "../ui/accent.ts";
import { Sigil } from "../ui/Sigil.tsx";
import type { DashboardEntry } from "../../../src/core/types.ts";

/** Every game in a season at once, in the server's interest order. */
export function Dashboard({ seasonId }: { readonly seasonId: string }) {
  const loaded = useJson<readonly DashboardEntry[]>(
    apiPath("seasons", seasonId, "dashboard"),
    2_000,
  );

  return (
    <Shell title={`Season / ${seasonId}`}>
      <section aria-labelledby="season-games-title" className="py-8">
        <div className="mb-8 flex flex-col gap-4 border-b border-rail pb-6 sm:flex-row sm:items-end sm:justify-between">
          <p id="season-games-title" className="max-w-[72ch] text-sm leading-relaxed text-mist">
            Every board in the season, ordered by how interesting the server thinks it is right now. The order is the
            server&apos;s, so everyone watching sees the same dashboard.
          </p>
          <a
            href={href({ kind: "leaderboard", seasonId })}
            className="w-fit shrink-0 rounded-lg bg-rail px-3 py-2 text-sm font-bold text-chalk underline-offset-4 hover:bg-brand hover:text-void"
          >
            Leaderboard
          </a>
        </div>

        <Loading loaded={loaded}>
          {(entries) => {
            const cards = dashboardCards(entries);
            if (cards.length === 0) {
              return (
                <p className="rounded-xl border border-dashed border-rail p-5 text-sm text-mist">
                  This season has no games.
                </p>
              );
            }

            return (
              <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
                {cards.map((card, index) => {
                  const live = card.entry.status === "on-air";
                  const status =
                    card.entry.status === "scheduled"
                      ? "Scheduled"
                      : live
                        ? `On air, ply ${card.entry.ply}`
                        : `Finished after ${card.entry.ply} plies`;

                  return (
                    <article key={card.entry.gameId} className="min-w-0">
                      <a
                        href={href({
                          kind: "watch",
                          seasonId,
                          gameId: card.entry.gameId,
                        })}
                        className="block rounded-xl border border-rail bg-deck p-3 transition-colors hover:border-brand/70 focus-visible:outline-offset-4 sm:p-5"
                      >
                        <div className="mb-4 flex items-center justify-between gap-4">
                          <span className="tabular text-[11px] font-bold tracking-[0.1em] text-mist uppercase">
                            Board {index + 1}
                          </span>
                          <span
                            className={`inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] uppercase ${
                              live ? "text-live" : "text-mist"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`h-2 w-2 rounded-full ${live ? "bg-live" : "bg-rail"}`}
                            />
                            {status}
                          </span>
                        </div>

                        <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Sigil
                              name={card.entry.white.name}
                              accent={accentFor(card.entry.white.name)}
                              size={42}
                              className="shrink-0"
                            />
                            <span className="truncate text-sm font-extrabold text-chalk sm:text-base">
                              {titleCase(card.entry.white.name)}
                            </span>
                          </div>
                          <span className="text-xs font-bold text-mist">vs</span>
                          <div className="flex min-w-0 flex-row-reverse items-center gap-2.5 text-right">
                            <Sigil
                              name={card.entry.black.name}
                              accent={accentFor(card.entry.black.name)}
                              size={42}
                              className="shrink-0"
                            />
                            <span className="truncate text-sm font-extrabold text-chalk sm:text-base">
                              {titleCase(card.entry.black.name)}
                            </span>
                          </div>
                        </div>

                        <div className="mx-auto w-full max-w-[420px]">
                          <MiniBoard
                            fen={card.entry.fen}
                            orientation="white"
                            {...(card.entry.lastMove === undefined ? {} : { lastMove: card.entry.lastMove })}
                            moverAccent={accentFor(card.entry.white.name)}
                          />
                        </div>

                        <div className="mt-4 flex flex-col gap-3 border-t border-rail pt-4 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm font-semibold text-chalk">{card.subtitle}</p>
                          {card.rivalryLabels.length === 0 ? null : (
                            <p className="flex flex-wrap gap-1.5 sm:justify-end">
                              {card.rivalryLabels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded bg-rail px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-chalk uppercase"
                                >
                                  {label}
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      </a>
                    </article>
                  );
                })}
              </div>
            );
          }}
        </Loading>
      </section>
    </Shell>
  );
}
