// The moments the server already picked out: the shortest decisive game, the
// longest grind, a clean checkmate. The component only lays these out — the
// claim in each headline and detail belongs to the server that computed it.
import type { JSX } from "react";

import { href } from "../../route.ts";
import type { SiteView } from "../../../../src/api/site.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";

export function Highlights({ view }: { readonly view: SiteView }): JSX.Element | null {
  if (view.highlights.length === 0) return null;

  return (
    <Card id="highlights">
      <CardHead title="Highlights" />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.highlights.map((highlight) => (
          <li key={`${highlight.kind}-${highlight.gameId}`}>
            <a
              href={href({ kind: "watch", seasonId: highlight.seasonId, gameId: highlight.gameId })}
              className="block rounded-md bg-pit p-3 transition-colors hover:bg-rail"
            >
              <p className="text-sm font-bold text-chalk">{highlight.headline}</p>
              <p className="mt-1 text-xs text-mist">{highlight.detail}</p>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
