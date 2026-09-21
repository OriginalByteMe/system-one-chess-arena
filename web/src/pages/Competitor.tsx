import { apiPath, useJson } from "../api.ts";
import { Loading, Shell } from "../Shell.tsx";
import { calibrationPoints, lineageSteps, strategyMix } from "../competitor-model.ts";
import { dollars, percent, seconds, titleCase } from "../format.ts";
import { href } from "../route.ts";
import { accentFor } from "../ui/accent.ts";
import { Sigil } from "../ui/Sigil.tsx";
import type { CompetitorProfile } from "../../../src/core/types.ts";

/** Phase 2: one competitor's record, calibration, lineage and rivals. */
export function Competitor({ competitor }: { readonly competitor: string }) {
  const loaded = useJson<CompetitorProfile>(apiPath("competitors", competitor), 5000);

  return (
    <Shell title={`Competitor / ${competitor}`}>
      <Loading loaded={loaded}>
        {(profile) => {
          const row = profile.row;
          const points = calibrationPoints(profile.calibration);
          const steps = lineageSteps(profile.lineage);
          const mix = strategyMix(profile);
          const playstyle = profile.lineage.at(-1)?.manifest.playstyle;

          return (
            <div className="py-8">
              <section
                aria-label="Competitor profile"
                className="grid gap-6 border-b border-rail pb-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-center"
              >
                <Sigil
                  name={competitor}
                  accent={accentFor(competitor)}
                  size={112}
                  className="shrink-0"
                />
                <div className="min-w-0">
                  <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-chalk sm:text-5xl">
                    {titleCase(competitor)}
                  </h2>
                  {playstyle === undefined ? (
                    <p className="mt-3 text-sm text-mist">No playstyle brief recorded yet.</p>
                  ) : (
                    <blockquote className="mt-3 max-w-[70ch] text-base leading-relaxed text-mist sm:text-lg">
                      &ldquo;{playstyle}&rdquo;
                    </blockquote>
                  )}
                </div>
              </section>

              <section aria-labelledby="record-title" className="border-b border-rail py-8">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 id="record-title" className="text-2xl font-bold tracking-[-0.025em] text-chalk">
                      Competition record
                    </h2>
                    <p className="mt-1 text-sm text-mist">Revealed, finished games across every version.</p>
                  </div>
                  <p className="tabular text-sm font-semibold text-mist">
                    {row.versions.length} {row.versions.length === 1 ? "version" : "versions"}
                  </p>
                </div>
                <dl className="grid grid-cols-2 divide-x divide-y divide-rail border-y border-rail sm:grid-cols-4 sm:divide-y-0">
                  <div className="px-4 py-5 first:pl-0">
                    <dt className="text-[11px] font-bold tracking-[0.08em] text-mist uppercase">Elo</dt>
                    <dd className="tabular mt-1 text-3xl font-extrabold text-brand-hi">{Math.round(row.elo)}</dd>
                  </div>
                  <div className="px-4 py-5">
                    <dt className="text-[11px] font-bold tracking-[0.08em] text-mist uppercase">W–D–L</dt>
                    <dd className="tabular mt-1 text-2xl font-bold text-chalk">
                      {row.wins}–{row.draws}–{row.losses}
                    </dd>
                  </div>
                  <div className="px-4 py-5">
                    <dt className="text-[11px] font-bold tracking-[0.08em] text-mist uppercase">Score</dt>
                    <dd className="tabular mt-1 text-2xl font-bold text-chalk">{row.score.toFixed(1)}</dd>
                  </div>
                  <div className="px-4 py-5 last:pr-0">
                    <dt className="text-[11px] font-bold tracking-[0.08em] text-mist uppercase">Games</dt>
                    <dd className="tabular mt-1 text-2xl font-bold text-chalk">{row.games}</dd>
                  </div>
                </dl>
              </section>

              <div className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:gap-14">
                <div className="min-w-0">
                  <section aria-labelledby="calibration-title">
                    <h2 id="calibration-title" className="text-2xl font-bold tracking-[-0.025em] text-chalk">
                      Calibration
                    </h2>
                    <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-mist">
                      A well calibrated competitor has actual close to stated; empty buckets are dropped rather than
                      drawn as zero.
                    </p>
                    {points.length > 0 ? (
                      <div
                        role="region"
                        aria-label="Calibration buckets"
                        tabIndex={0}
                        className="mt-5 overflow-x-auto rounded-xl border border-rail bg-deck focus-visible:outline-offset-4"
                      >
                        <table className="w-full min-w-[30rem] border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-rail bg-pit text-left text-[11px] font-bold tracking-[0.08em] text-mist uppercase">
                              <th scope="col" className="px-4 py-3">Stated</th>
                              <th scope="col" className="px-4 py-3">Actual</th>
                              <th scope="col" className="px-4 py-3 text-right">Decisions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {points.map((point) => (
                              <tr key={point.stated} className="border-b border-rail/70 last:border-b-0">
                                <td className="tabular px-4 py-3 font-semibold text-chalk">{percent(point.stated)}</td>
                                <td className="tabular px-4 py-3 font-semibold text-chalk">{percent(point.actual)}</td>
                                <td className="tabular px-4 py-3 text-right text-mist">{point.decisions}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-5 rounded-xl border border-dashed border-rail p-4 text-sm text-mist">
                        No calibration data yet.
                      </p>
                    )}
                  </section>

                  <section aria-labelledby="lineage-title" className="mt-10 border-t border-rail pt-8">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <h2 id="lineage-title" className="text-2xl font-bold tracking-[-0.025em] text-chalk">
                        Lineage
                      </h2>
                      <span className="text-xs font-semibold text-mist">Oldest to newest</span>
                    </div>
                    {steps.length > 0 ? (
                      <ol className="mt-5 divide-y divide-rail border-y border-rail">
                        {steps.map((step, index) => (
                          <li key={step.version} className="grid gap-3 py-5 sm:grid-cols-[5rem_minmax(0,1fr)]">
                            <div className="tabular text-xs font-bold text-mist">Version {index + 1}</div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <strong className="tabular text-base text-chalk">{step.version.slice(0, 8)}</strong>
                                <span className="text-xs text-mist">season {step.seasonId}</span>
                              </div>
                              <p className="mt-2 text-sm font-semibold text-chalk">{step.summary}</p>
                              {step.added.length > 0 ? (
                                <p className="mt-1 text-sm text-mist">Added: {step.added.join(", ")}</p>
                              ) : null}
                              {step.removed.length > 0 ? (
                                <p className="mt-1 text-sm text-mist">Removed: {step.removed.join(", ")}</p>
                              ) : null}
                              <p className="mt-1 text-sm text-mist">
                                {step.playstyleChanged ? "Playstyle changed." : "Playstyle unchanged."}
                              </p>
                              {step.rationale !== undefined ? (
                                <p className="mt-3 text-sm leading-relaxed text-mist">Rationale: {step.rationale}</p>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-5 rounded-xl border border-dashed border-rail p-4 text-sm text-mist">
                        No lineage recorded yet.
                      </p>
                    )}
                  </section>
                </div>

                <aside className="min-w-0 space-y-10">
                  <section aria-labelledby="decision-title">
                    <h2 id="decision-title" className="text-lg font-bold text-chalk">Decision profile</h2>
                    <dl className="mt-4 block divide-y divide-rail text-sm">
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-mist">Mean confidence</dt>
                        <dd className="tabular font-semibold text-chalk">{percent(row.meanConfidence)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-mist">Calibration error</dt>
                        <dd className="tabular font-semibold text-chalk">{row.calibrationError.toFixed(3)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-mist">Fallback rate</dt>
                        <dd className="tabular font-semibold text-chalk">{percent(row.fallbackRate)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-mist">Mean latency</dt>
                        <dd className="tabular font-semibold text-chalk">{seconds(row.meanLatencyMs)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-3">
                        <dt className="text-mist">Cost</dt>
                        <dd className="tabular font-semibold text-chalk">{dollars(row.costUsd)}</dd>
                      </div>
                    </dl>
                  </section>

                  <section aria-labelledby="strategy-title">
                    <h2 id="strategy-title" className="text-lg font-bold text-chalk">Strategy mix</h2>
                    {mix.length > 0 ? (
                      <ol className="mt-4 divide-y divide-rail border-y border-rail">
                        {mix.map((entry) => (
                          <li key={entry.strategy} className="flex items-center justify-between gap-4 py-3 text-sm">
                            <span className="font-semibold text-chalk">{entry.strategy}</span>
                            <span className="tabular text-mist">{percent(entry.share)}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-4 text-sm text-mist">No strategy picks recorded yet.</p>
                    )}
                  </section>
                </aside>
              </div>

              <section aria-labelledby="rivals-title" className="border-t border-rail pt-8">
                <h2 id="rivals-title" className="text-2xl font-bold tracking-[-0.025em] text-chalk">
                  Rivals
                </h2>
                {profile.rivals.length > 0 ? (
                  <div
                    role="region"
                    aria-label="Rival records"
                    tabIndex={0}
                    className="mt-5 overflow-x-auto rounded-xl border border-rail bg-deck focus-visible:outline-offset-4"
                  >
                    <table className="w-full min-w-[44rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-rail bg-pit text-left text-[11px] font-bold tracking-[0.08em] text-mist uppercase">
                          <th scope="col" className="px-4 py-3">Opponent</th>
                          <th scope="col" className="px-4 py-3">W–L–D</th>
                          <th scope="col" className="px-4 py-3">Trait rules</th>
                          <th scope="col" className="px-4 py-3 text-right">History</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.rivals.map((rival) => (
                          <tr key={rival.headToHead.opponent} className="border-b border-rail/70 last:border-b-0">
                            <th scope="row" className="px-4 py-3 text-left font-bold text-chalk">
                              {titleCase(rival.headToHead.opponent)}
                            </th>
                            <td className="tabular px-4 py-3 text-mist">
                              {rival.headToHead.wins}–{rival.headToHead.losses}–{rival.headToHead.draws}
                            </td>
                            <td className="px-4 py-3 text-mist">
                              {rival.traits.length > 0
                                ? rival.traits.map((trait) => trait.rule).join(", ")
                                : "None"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <a
                                href={href({
                                  kind: "rivalry",
                                  competitor,
                                  opponent: rival.headToHead.opponent,
                                })}
                                className="font-bold text-brand-hi underline-offset-4 hover:underline"
                              >
                                Head to head
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-5 rounded-xl border border-dashed border-rail p-4 text-sm text-mist">
                    No rivals yet.
                  </p>
                )}
              </section>
            </div>
          );
        }}
      </Loading>
    </Shell>
  );
}
