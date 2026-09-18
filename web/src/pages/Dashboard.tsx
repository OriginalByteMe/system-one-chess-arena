import { Board } from "../Board.tsx";
import { Loading, Shell } from "../Shell.tsx";
import { apiPath, useJson } from "../api.ts";
import { dashboardCards } from "../dashboard-model.ts";
import { href } from "../route.ts";
import type { DashboardEntry } from "../../../src/core/types.ts";

/** Every game in a season at once, in the server's interest order. */
export function Dashboard({ seasonId }: { readonly seasonId: string }) {
  const loaded = useJson<readonly DashboardEntry[]>(
    apiPath("seasons", seasonId, "dashboard"),
    2_000,
  );

  return (
    <Shell title={`Season / ${seasonId}`}>
      <p className="page-intro">
        Every board in the season, ordered by how interesting the server thinks
        it is right now. The order is the server's, so everyone watching sees
        the same dashboard.{" "}
        <a href={href({ kind: "leaderboard", seasonId })}>Leaderboard</a>
      </p>
      <Loading loaded={loaded}>
        {(entries) => {
          const cards = dashboardCards(entries);
          if (cards.length === 0) {
            return <p className="page-note">This season has no games.</p>;
          }
          return (
            <section className="dashboard-grid">
              {cards.map((card) => (
                <a
                  key={card.entry.gameId}
                  className="dashboard-card"
                  href={href({
                    kind: "watch",
                    seasonId,
                    gameId: card.entry.gameId,
                  })}
                >
                  <h2>
                    {card.entry.white.name} vs {card.entry.black.name}
                  </h2>
                  <Board fen={card.entry.fen} orientation="white" lastMove={card.entry.lastMove} />
                  <p className="dashboard-status">
                    {card.entry.status === "scheduled"
                      ? "Scheduled"
                      : card.entry.status === "on-air"
                        ? `On air, ply ${card.entry.ply}`
                        : `Finished after ${card.entry.ply} plies`}
                  </p>
                  <p className="dashboard-subtitle">{card.subtitle}</p>
                  {card.rivalryLabels.length === 0 ? null : (
                    <p className="dashboard-traits">
                      {card.rivalryLabels.map((label) => (
                        <span key={label} className="chip">
                          {label}
                        </span>
                      ))}
                    </p>
                  )}
                </a>
              ))}
            </section>
          );
        }}
      </Loading>
    </Shell>
  );
}
