// The full persona catalog and the replay shelf.
import type { JSX } from "react";

import { replays, resultLabel } from "../../home-model.ts";
import { titleCase } from "../../format.ts";
import { href } from "../../route.ts";
import type { SiteView } from "../../../../src/api/site.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";
import { accentFor } from "../../ui/accent.ts";
import { Sigil } from "../../ui/Sigil.tsx";
import { PersonaRoster } from "./landing/RosterSample.tsx";

export function Roster({ view }: { readonly view: SiteView }): JSX.Element {
  const shelf = replays(view);

  return (
    <div className="flex flex-col gap-10">
      <PersonaRoster view={view} />

      <Card id="replays">
        <CardHead title="Replays" meta={<span className="tabular">{shelf.length} finished</span>} />
        {shelf.length === 0 ? (
          <p className="text-sm text-mist">No game has finished airing yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rail">
            {shelf.slice(0, 8).map((game) => (
              <li key={game.gameId}>
                <a
                  href={href({ kind: "watch", seasonId: game.seasonId, gameId: game.gameId })}
                  className="-mx-2 flex items-center gap-3 rounded px-2 py-2.5 transition-colors hover:bg-pit"
                >
                  <div className="flex shrink-0 gap-1">
                    <Sigil name={game.white.name} accent={accentFor(game.white.name)} size={26} />
                    <Sigil name={game.black.name} accent={accentFor(game.black.name)} size={26} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-chalk">
                      {titleCase(game.white.name)} vs {titleCase(game.black.name)}
                    </div>
                    <div className="truncate text-xs text-mist">{resultLabel(game)}</div>
                  </div>
                  <span className="tabular shrink-0 text-xs text-mist">{game.plies ?? "—"} plies</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
