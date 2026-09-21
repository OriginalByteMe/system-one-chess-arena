// The latest games across every season, not just the one that is featured
// right now. A rotating campaign spends most of its time between rounds, so
// this is what keeps the front page live even when nothing is on air.
import type { JSX } from "react";

import { titleCase } from "../../format.ts";
import { href } from "../../route.ts";
import type { GameResult } from "../../../../src/core/types.ts";
import type { SiteRecentGame, SiteView } from "../../../../src/api/site.ts";
import { accentFor } from "../../ui/accent.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";
import { Sigil } from "../../ui/Sigil.tsx";

/** Result from the winner's point of view: "Vex won", "Cinder won", "Drawn". */
function resultWords(result: GameResult, game: Pick<SiteRecentGame, "white" | "black">): string {
  if (result === "draw") return "Drawn";
  return `${titleCase(result === "white" ? game.white : game.black)} won`;
}

export function LatestGames({ view }: { readonly view: SiteView }): JSX.Element | null {
  if (view.recent.length === 0) return null;

  return (
    <Card id="latest-games">
      <CardHead title="Latest games" meta={<span>Every season, newest first</span>} />
      <ul className="flex flex-col divide-y divide-rail">
        {view.recent.slice(0, 8).map((game) => (
          <li key={game.gameId}>
            <a
              href={href({ kind: "watch", seasonId: game.seasonId, gameId: game.gameId })}
              className="-mx-2 flex items-center gap-3 rounded px-2 py-2.5 transition-colors hover:bg-pit"
            >
              <div className="flex shrink-0 gap-1">
                <Sigil name={game.white} accent={accentFor(game.white)} size={26} />
                <Sigil name={game.black} accent={accentFor(game.black)} size={26} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-semibold text-chalk">
                    {titleCase(game.white)} vs {titleCase(game.black)}
                  </span>
                  {game.seasonId === view.seasonId ? null : (
                    <span className="text-xs text-mist">{game.seasonId}</span>
                  )}
                </div>
                <div className="truncate text-xs text-mist">
                  {resultWords(game.result, game)} · {titleCase(game.reason)}
                </div>
              </div>
              <span className="tabular shrink-0 text-xs text-mist">{game.plies} plies</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
