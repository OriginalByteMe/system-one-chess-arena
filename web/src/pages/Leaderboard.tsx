import type { JSX } from "react";

import { apiPath, useJson } from "../api.ts";
import { dollars, percent, seconds, titleCase } from "../format.ts";
import { href } from "../route.ts";
import { Loading, Shell } from "../Shell.tsx";
import { accentFor } from "../ui/accent.ts";
import { Sigil } from "../ui/Sigil.tsx";
import type { Leaderboard as LeaderboardResponse, LeaderboardRow } from "../../../src/core/types.ts";

function LeaderboardTable({ rows }: { readonly rows: readonly LeaderboardRow[] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-rail p-5">
        <p className="text-sm font-semibold text-chalk">No standings yet.</p>
        <p className="mt-1 text-sm text-mist">A competitor appears here after a broadcast finishes.</p>
      </div>
    );
  }

  return (
    <>
      <p id="leaderboard-scroll-hint" className="mb-2 text-xs font-semibold text-mist sm:hidden">
        Scroll sideways to compare every score.
      </p>
      <div
        role="region"
        aria-label="Ranked season standings"
        aria-describedby="leaderboard-scroll-hint leaderboard-order-note"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-rail bg-deck focus-visible:outline-offset-4"
      >
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">
            Season standings ranked in the order returned by the arena.
          </caption>
          <thead>
            <tr className="border-b border-rail bg-pit text-left text-[11px] font-bold tracking-[0.08em] text-mist uppercase">
              <th scope="col" className="w-14 px-4 py-3 text-center">Rank</th>
              <th scope="col" className="px-3 py-3">Competitor</th>
              <th scope="col" className="px-3 py-3 text-right">Games</th>
              <th scope="col" className="px-3 py-3 text-right">W–D–L</th>
              <th scope="col" className="px-3 py-3 text-right">Score</th>
              <th scope="col" className="px-4 py-3 text-right">Elo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.competitor}
                className={`border-b border-rail/70 last:border-b-0 hover:bg-pit/60 ${
                  index === 0 ? "bg-brand/5" : ""
                }`}
              >
                <td
                  className={`tabular px-4 py-4 text-center text-lg font-extrabold ${
                    index === 0 ? "text-brand-hi" : "text-mist"
                  }`}
                >
                  {index + 1}
                </td>
                <th scope="row" className="px-3 py-3 text-left">
                  <a
                    href={href({ kind: "competitor", competitor: row.competitor })}
                    className="flex min-w-52 items-center gap-3 rounded-lg underline-offset-4 hover:text-brand-hi hover:underline"
                  >
                    <Sigil name={row.competitor} accent={accentFor(row.competitor)} size={44} />
                    <span>
                      <span className="block font-extrabold text-chalk">{titleCase(row.competitor)}</span>
                      <span className="mt-0.5 block text-[11px] font-medium text-mist">
                        {row.versions.length} {row.versions.length === 1 ? "version" : "versions"}
                      </span>
                    </span>
                  </a>
                </th>
                <td className="tabular px-3 py-3 text-right text-mist">{row.games}</td>
                <td className="tabular px-3 py-3 text-right font-semibold text-chalk">
                  {row.wins}–{row.draws}–{row.losses}
                </td>
                <td className="tabular px-3 py-3 text-right font-semibold text-chalk">
                  {row.score.toFixed(1)}
                </td>
                <td className="tabular px-4 py-3 text-right text-base font-extrabold text-brand-hi">
                  {Math.round(row.elo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p id="leaderboard-order-note" className="mt-3 max-w-[70ch] text-xs leading-relaxed text-mist">
        Revealed, finished games only. The arena ranks by Elo, then score, then competitor name.
      </p>

      <details className="mt-6 rounded-xl border border-rail bg-deck">
        <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-bold text-chalk hover:bg-rail">
          Decision diagnostics
        </summary>
        <p className="px-4 pb-3 text-xs leading-relaxed text-mist">
          Confidence is self-reported. Calibration, fallbacks, latency and cost describe the decisions behind the
          standings; they do not change rank.
        </p>
        <div role="region" aria-label="Leaderboard decision diagnostics" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-xs">
            <caption className="sr-only">Decision diagnostics by competitor</caption>
            <thead>
              <tr className="border-y border-rail bg-pit text-left text-[10px] font-bold tracking-[0.08em] text-mist uppercase">
                <th scope="col" className="px-4 py-2.5">Competitor</th>
                <th scope="col" className="px-3 py-2.5 text-right">Mean confidence</th>
                <th scope="col" className="px-3 py-2.5 text-right">Calibration error</th>
                <th scope="col" className="px-3 py-2.5 text-right">Fallback rate</th>
                <th scope="col" className="px-3 py-2.5 text-right">Mean latency</th>
                <th scope="col" className="px-4 py-2.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.competitor} className="border-b border-rail/70 last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-bold text-chalk">
                    {titleCase(row.competitor)}
                  </th>
                  <td className="tabular px-3 py-2.5 text-right text-mist">{percent(row.meanConfidence)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-mist">{row.calibrationError.toFixed(3)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-mist">{percent(row.fallbackRate)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-mist">{seconds(row.meanLatencyMs)}</td>
                  <td className="tabular px-4 py-2.5 text-right text-mist">{dollars(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** Season standings in the server's Elo, score, then name order. */
export function Leaderboard({ seasonId }: { readonly seasonId: string }): JSX.Element {
  const loaded = useJson<LeaderboardResponse>(
    apiPath("seasons", seasonId, "leaderboard"),
    5000,
  );

  return (
    <Shell title="Leaderboard">
      <section aria-labelledby="leaderboard-title" className="py-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-rail pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p id="leaderboard-title" className="mt-1 max-w-[65ch] text-sm leading-relaxed text-mist">
              Results, rating and the decision evidence behind every rank.
            </p>
          </div>
          <a
            href={href({ kind: "season", seasonId })}
            className="w-fit rounded-lg bg-rail px-3 py-2 text-sm font-bold text-chalk underline-offset-4 hover:bg-brand hover:text-void"
          >
            Season schedule
          </a>
        </div>
        {loaded.notFound === true ? (
          <div className="rounded-xl border border-dashed border-rail p-5">
            <p className="text-sm font-semibold text-chalk">No leaderboard is available for this season.</p>
          </div>
        ) : (
          <Loading loaded={loaded}>{(data) => <LeaderboardTable rows={data.rows} />}</Loading>
        )}
      </section>
    </Shell>
  );
}
