import { useState } from "react";

import { Shell } from "../Shell.tsx";
import { href } from "../route.ts";

/**
 * There is no route that lists seasons, so the front door asks for an id
 * rather than pretending to know one. A season index is a product decision
 * that has not been made yet.
 */
export function Index() {
  const [seasonId, setSeasonId] = useState("");
  const [competitor, setCompetitor] = useState("");

  return (
    <Shell title="Front door">
      <section className="index-page">
        <p className="page-intro">
          Two things happen here. A season is recorded up front, then revealed
          on a shared clock: everyone watching sees the same position at the
          same moment, and the server refuses to serve a move the clock has not
          reached. Older seasons sit finished and browsable.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (seasonId.trim() !== "") {
              window.location.href = href({ kind: "dashboard", seasonId: seasonId.trim() });
            }
          }}
        >
          <label htmlFor="season">Season</label>
          <input
            id="season"
            value={seasonId}
            placeholder="showcase"
            onChange={(event) => setSeasonId(event.target.value)}
          />
          <button type="submit">Watch</button>
        </form>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (competitor.trim() !== "") {
              window.location.href = href({
                kind: "competitor",
                competitor: competitor.trim(),
              });
            }
          }}
        >
          <label htmlFor="competitor">Competitor</label>
          <input
            id="competitor"
            value={competitor}
            placeholder="blitzen"
            onChange={(event) => setCompetitor(event.target.value)}
          />
          <button type="submit">Profile</button>
        </form>

        <p className="stream-note">
          A game played live rather than recorded is at{" "}
          <code>/?game=&lt;id&gt;</code>, which streams over a WebSocket instead
          of polling the clock.
        </p>
      </section>
    </Shell>
  );
}
