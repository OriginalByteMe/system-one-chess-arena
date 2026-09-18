import { apiPath, useJson } from "../api.ts";
import { href } from "../route.ts";
import { Loading, Shell } from "../Shell.tsx";
import type { Leaderboard as LeaderboardResponse, LeaderboardRow } from "../../../src/core/types.ts";

function LeaderboardTable({ rows }: { readonly rows: readonly LeaderboardRow[] }) {
  if (rows.length === 0) {
    return <p className="page-note">No competitor has finished a game yet.</p>;
  }

  return (
    <table className="leaderboard-table">
      <caption>
        Counts only games whose broadcast has finished, which is why this can
        read all zeros while a season is on air.
      </caption>
      <thead>
        <tr>
          <th>Competitor</th>
          <th>Games</th>
          <th>W-D-L</th>
          <th>Score</th>
          <th>Elo</th>
          <th>Mean confidence</th>
          <th>Calibration error</th>
          <th>Fallback rate</th>
          <th>Mean latency</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.competitor}>
            <td>
              <a href={href({ kind: "competitor", competitor: row.competitor })}>
                {row.competitor}
              </a>
              {row.versions.length > 1 ? ` (${row.versions.length} versions)` : null}
            </td>
            <td>{row.games}</td>
            <td>{`${row.wins}-${row.draws}-${row.losses}`}</td>
            <td>{row.score}</td>
            <td>{Math.round(row.elo)}</td>
            <td>{`${Math.round(row.meanConfidence * 100)}%`}</td>
            <td>{row.calibrationError.toFixed(3)}</td>
            <td>{`${Math.round(row.fallbackRate * 100)}%`}</td>
            <td>{`${(row.meanLatencyMs / 1000).toFixed(2)} s`}</td>
            <td>{`$${row.costUsd.toFixed(4)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Phase 2: the cross-season leaderboard, one row per competitor. */
export function Leaderboard({ seasonId }: { readonly seasonId: string }) {
  const loaded = useJson<LeaderboardResponse>(
    apiPath("seasons", seasonId, "leaderboard"),
    5000,
  );

  return (
    <Shell title={`Leaderboard / ${seasonId}`}>
      <section aria-label="Season leaderboard">
        <p>
          <a href={href({ kind: "dashboard", seasonId })}>Back to dashboard</a>
        </p>
        <Loading loaded={loaded}>
          {(data) => <LeaderboardTable rows={data.rows} />}
        </Loading>
      </section>
    </Shell>
  );
}
