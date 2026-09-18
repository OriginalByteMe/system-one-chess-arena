import type { RivalrySummary } from "../../../src/core/types.ts";
import { Loading, Shell } from "../Shell.tsx";
import { apiPath, useJson } from "../api.ts";
import { href } from "../route.ts";
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
            <section aria-label="Rivalry history">
              {banner !== undefined ? (
                <p className="page-note">{banner}</p>
              ) : (
                <p className="page-note">
                  This pair has not met often enough for a rivalry yet.
                </p>
              )}

              <p>
                <a href={href({ kind: "competitor", competitor })}>{competitor}</a>
                {" vs "}
                <a href={href({ kind: "competitor", competitor: opponent })}>
                  {opponent}
                </a>
              </p>

              <table>
                <thead>
                  <tr>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Draws</th>
                    <th>Streak</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{h2h.wins}</td>
                    <td>{h2h.losses}</td>
                    <td>{h2h.draws}</td>
                    <td>{h2h.streak > 0 ? `${h2h.streak} in a row` : "No current streak."}</td>
                  </tr>
                </tbody>
              </table>

              <h2>Timeline</h2>
              {timeline.length === 0 ? (
                <p className="page-note">No revealed games between this pair yet.</p>
              ) : (
                <ol className="rivalry-timeline">
                  {timeline.map((event, index) => {
                    const seasonId = seasonOf(event.gameId);
                    return (
                      <li key={event.gameId}>
                        <span>{RESULT_LABEL[event.result]}</span>{" "}
                        <a href={href({ kind: "watch", seasonId, gameId: event.gameId })}>
                          Game {index + 1}
                        </a>
                        {event.triggered.map((traitId) => (
                          <span className="trait-chip" key={traitId}>
                            {traitId}
                          </span>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              )}

              <p className="page-note">
                The timeline only shows games the broadcast has already
                revealed, so a rivalry is history as of what is on air.
              </p>
            </section>
          );
        }}
      </Loading>
    </Shell>
  );
}
