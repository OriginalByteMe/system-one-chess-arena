import type { RivalrySummary } from "../../../src/core/types.ts";
import { Loading, Shell } from "../Shell.tsx";
import { apiPath, useJson } from "../api.ts";
import { titleCase } from "../format.ts";
import { href } from "../route.ts";
import { accentFor } from "../ui/accent.ts";
import { Sigil } from "../ui/Sigil.tsx";
import { rivalryBanner, rivalryTimeline } from "../rivalry-model.ts";

/**
 * A game id is `<seasonId>:<index>:<white>@<version>:<black>@<version>`, so
 * the season is everything before the first colon.
 */
function seasonOf(gameId: string): string {
  return gameId.slice(0, gameId.indexOf(":"));
}

const RESULT_LABEL: Record<string, string> = {
  win: "Win",
  loss: "Loss",
  draw: "Draw",
};

/** Phase 2: the head-to-head history between two competitors. */
export function Rivalry({
  competitor,
  opponent,
}: {
  readonly competitor: string;
  readonly opponent: string;
}) {
  const loaded = useJson<RivalrySummary>(
    apiPath("competitors", competitor, "rivals", opponent),
    5000,
  );

  return (
    <Shell title={`${competitor} vs ${opponent}`}>
      <Loading loaded={loaded}>
        {(summary) => {
          const banner = rivalryBanner(summary);
          const timeline = rivalryTimeline(summary);
          const h2h = summary.headToHead;

          return (
            <section aria-label="Rivalry history" className="py-8">
              <div className="grid items-center gap-6 border-b border-rail pb-8 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <a
                  href={href({ kind: "competitor", competitor })}
                  className="flex min-w-0 items-center gap-4 rounded-lg underline-offset-4 hover:text-brand-hi hover:underline"
                >
                  <Sigil name={competitor} accent={accentFor(competitor)} size={88} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-2xl font-extrabold tracking-[-0.025em] text-chalk sm:text-3xl">
                      {titleCase(competitor)}
                    </span>
                    <span className="mt-1 block text-xs font-semibold text-mist">View competitor</span>
                  </span>
                </a>

                <span className="hidden text-sm font-extrabold tracking-[0.12em] text-mist uppercase sm:block">
                  vs
                </span>

                <a
                  href={href({ kind: "competitor", competitor: opponent })}
                  className="flex min-w-0 items-center gap-4 rounded-lg underline-offset-4 hover:text-brand-hi hover:underline sm:flex-row-reverse sm:text-right"
                >
                  <Sigil name={opponent} accent={accentFor(opponent)} size={88} className="shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-2xl font-extrabold tracking-[-0.025em] text-chalk sm:text-3xl">
                      {titleCase(opponent)}
                    </span>
                    <span className="mt-1 block text-xs font-semibold text-mist">View competitor</span>
                  </span>
                </a>
              </div>

              <div className="grid gap-8 border-b border-rail py-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)] lg:items-center">
                <p className="max-w-[65ch] text-base leading-relaxed text-chalk">
                  {banner ?? "This pair has not met often enough for a rivalry yet."}
                </p>
                <dl className="grid grid-cols-2 divide-x divide-y divide-rail border-y border-rail sm:grid-cols-4 sm:divide-y-0">
                  <div className="px-3 py-4 first:pl-0">
                    <dt className="text-[10px] font-bold tracking-[0.08em] text-mist uppercase">Wins</dt>
                    <dd className="tabular mt-1 text-2xl font-extrabold text-brand-hi">{h2h.wins}</dd>
                  </div>
                  <div className="px-3 py-4">
                    <dt className="text-[10px] font-bold tracking-[0.08em] text-mist uppercase">Losses</dt>
                    <dd className="tabular mt-1 text-2xl font-extrabold text-chalk">{h2h.losses}</dd>
                  </div>
                  <div className="px-3 py-4">
                    <dt className="text-[10px] font-bold tracking-[0.08em] text-mist uppercase">Draws</dt>
                    <dd className="tabular mt-1 text-2xl font-extrabold text-chalk">{h2h.draws}</dd>
                  </div>
                  <div className="px-3 py-4 last:pr-0">
                    <dt className="text-[10px] font-bold tracking-[0.08em] text-mist uppercase">Streak</dt>
                    <dd className="tabular mt-1 text-sm font-bold text-chalk">
                      {h2h.streak > 0 ? `${h2h.streak} in a row` : "No current streak."}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="pt-8">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold tracking-[-0.025em] text-chalk">Timeline</h2>
                    <p className="mt-1 text-sm text-mist">Revealed meetings, oldest first.</p>
                  </div>
                  <span className="tabular text-xs font-semibold text-mist">
                    {timeline.length} {timeline.length === 1 ? "game" : "games"}
                  </span>
                </div>

                {timeline.length === 0 ? (
                  <p className="mt-5 rounded-xl border border-dashed border-rail p-5 text-sm text-mist">
                    No revealed games between this pair yet.
                  </p>
                ) : (
                  <ol className="mt-5 divide-y divide-rail border-y border-rail">
                    {timeline.map((event, index) => {
                      const seasonId = seasonOf(event.gameId);
                      const resultClass =
                        event.result === "win"
                          ? "bg-brand text-void"
                          : event.result === "loss"
                            ? "bg-live text-chalk"
                            : "bg-gold text-void";

                      return (
                        <li
                          key={event.gameId}
                          className="grid gap-4 py-5 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center"
                        >
                          <span className="tabular text-xs font-bold text-mist">Game {index + 1}</span>
                          <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <span
                              className={`rounded px-2 py-1 text-[10px] font-extrabold tracking-[0.08em] uppercase ${resultClass}`}
                            >
                              {RESULT_LABEL[event.result]}
                            </span>
                            {event.triggered.map((traitId) => (
                              <span
                                className="rounded bg-rail px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-chalk uppercase"
                                key={traitId}
                              >
                                {traitId}
                              </span>
                            ))}
                          </div>
                          <a
                            href={href({ kind: "watch", seasonId, gameId: event.gameId })}
                            className="w-fit text-sm font-bold text-brand-hi underline decoration-rail underline-offset-4 hover:underline"
                          >
                            Watch replay
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                )}

                <p className="mt-5 max-w-[70ch] text-xs leading-relaxed text-mist">
                  The timeline only shows games the broadcast has already revealed, so a rivalry is history as of what
                  is on air.
                </p>
              </div>
            </section>
          );
        }}
      </Loading>
    </Shell>
  );
}
