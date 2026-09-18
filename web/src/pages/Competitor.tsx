import { apiPath, useJson } from "../api.ts";
import { Loading, Shell } from "../Shell.tsx";
import { calibrationPoints, lineageSteps, strategyMix } from "../competitor-model.ts";
import { href } from "../route.ts";
import type { CompetitorProfile } from "../../../src/core/types.ts";

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

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

          return (
            <div className="competitor-page">
              <section aria-label="Record">
                <h2>Record</h2>
                <table>
                  <tbody>
                    <tr>
                      <th scope="row">Games</th>
                      <td>{row.games}</td>
                    </tr>
                    <tr>
                      <th scope="row">W/D/L</th>
                      <td>
                        {row.wins}/{row.draws}/{row.losses}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Score</th>
                      <td>{row.score.toFixed(1)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Elo</th>
                      <td>{Math.round(row.elo)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Mean confidence</th>
                      <td>{formatPercent(row.meanConfidence)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Calibration error</th>
                      <td>{row.calibrationError.toFixed(3)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Fallback rate</th>
                      <td>{formatPercent(row.fallbackRate)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Mean latency</th>
                      <td>{(row.meanLatencyMs / 1000).toFixed(2)} s</td>
                    </tr>
                    <tr>
                      <th scope="row">Cost</th>
                      <td>${row.costUsd.toFixed(4)}</td>
                    </tr>
                  </tbody>
                </table>

                {mix.length > 0 ? (
                  <>
                    <h3>Strategy mix</h3>
                    <ol className="strategy-mix">
                      {mix.map((entry) => (
                        <li key={entry.strategy}>
                          {entry.strategy}: {formatPercent(entry.share)}
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="page-note">No strategy picks recorded yet.</p>
                )}
              </section>

              <section aria-label="Calibration">
                <h2>Calibration</h2>
                <p className="page-note">
                  A well calibrated competitor has actual close to stated;
                  empty buckets are dropped rather than drawn as zero.
                </p>
                {points.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Stated</th>
                        <th scope="col">Actual</th>
                        <th scope="col">Decisions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((point) => (
                        <tr key={point.stated}>
                          <td>{formatPercent(point.stated)}</td>
                          <td>{formatPercent(point.actual)}</td>
                          <td>{point.decisions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="page-note">No calibration data yet.</p>
                )}
              </section>

              <section aria-label="Lineage">
                <h2>Lineage</h2>
                {steps.length > 0 ? (
                  <ol className="lineage-steps">
                    {steps.map((step) => (
                      <li key={step.version}>
                        <p>
                          <strong>{step.version.slice(0, 8)}</strong>{" "}
                          &middot; season {step.seasonId}
                        </p>
                        <p>{step.summary}</p>
                        {step.added.length > 0 ? (
                          <p>Added: {step.added.join(", ")}</p>
                        ) : null}
                        {step.removed.length > 0 ? (
                          <p>Removed: {step.removed.join(", ")}</p>
                        ) : null}
                        <p>
                          {step.playstyleChanged
                            ? "Playstyle changed."
                            : "Playstyle unchanged."}
                        </p>
                        {step.rationale !== undefined ? (
                          <p>Rationale: {step.rationale}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="page-note">No lineage recorded yet.</p>
                )}
              </section>

              <section aria-label="Rivals">
                <h2>Rivals</h2>
                {profile.rivals.length > 0 ? (
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Opponent</th>
                        <th scope="col">W-L-D</th>
                        <th scope="col">Trait rules</th>
                        <th scope="col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.rivals.map((rival) => (
                        <tr key={rival.headToHead.opponent}>
                          <td>{rival.headToHead.opponent}</td>
                          <td>
                            {rival.headToHead.wins}-{rival.headToHead.losses}-
                            {rival.headToHead.draws}
                          </td>
                          <td>
                            {rival.traits.length > 0
                              ? rival.traits.map((trait) => trait.rule).join(", ")
                              : "None"}
                          </td>
                          <td>
                            <a
                              href={href({
                                kind: "rivalry",
                                competitor,
                                opponent: rival.headToHead.opponent,
                              })}
                            >
                              Head to head
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="page-note">No rivals yet.</p>
                )}
              </section>
            </div>
          );
        }}
      </Loading>
    </Shell>
  );
}
