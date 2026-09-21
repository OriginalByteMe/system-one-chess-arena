// Every board the season has going right now. This is the one card on the
// front page that is not history: each row is a Durable Object mid-decision,
// so the ply counts move while you read them.
import type { JSX } from "react";

import { percent, seconds, titleCase } from "../../format.ts";
import { href } from "../../route.ts";
import type { LiveGameSnapshot } from "../../../../src/core/types.ts";
import { accentFor } from "../../ui/accent.ts";
import { Card, CardHead, LivePill } from "../../ui/chrome.tsx";
import { Sigil } from "../../ui/Sigil.tsx";

function Row({ game }: { readonly game: LiveGameSnapshot }): JSX.Element {
  const decision = game.lastDecision;
  const done = game.finished !== undefined;
  const target = done
    ? href({ kind: "watch", seasonId: game.seasonId, gameId: game.gameId })
    : href({ kind: "live", gameId: game.gameId });

  return (
    <li>
      <a
        href={target}
        className="-mx-2 flex items-start gap-2.5 rounded px-2 py-2.5 transition-colors hover:bg-pit"
      >
        <div className="flex shrink-0 gap-1">
          <Sigil name={game.white.name} accent={accentFor(game.white.name)} size={26} />
          <Sigil name={game.black.name} accent={accentFor(game.black.name)} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-chalk">
            {titleCase(game.white.name)} vs {titleCase(game.black.name)}
          </div>
          <div className="tabular truncate text-xs text-mist">
            {done
              ? `Finished · ${game.finished?.reason.replace(/-/g, " ") ?? ""}`
              : decision === undefined
                ? "Waiting for the first move"
                : `Ply ${game.ply} · ${titleCase(decision.strategy)}${
                    decision.confidence === undefined
                      ? ""
                      : `, ${percent(decision.confidence)} sure`
                  } · ${seconds(decision.latencyMs)}`}
          </div>
        </div>
      </a>
    </li>
  );
}

export function NowPlaying({ games }: { readonly games: readonly LiveGameSnapshot[] }): JSX.Element {
  const playing = games.filter((game) => game.finished === undefined);
  const done = games.filter((game) => game.finished !== undefined);

  return (
    <Card>
      <CardHead
        title="Now playing"
        meta={
          playing.length > 0 ? (
            <LivePill />
          ) : (
            <span className="tabular">{done.length} finished</span>
          )
        }
      />
      {games.length === 0 ? (
        <p className="text-sm text-mist">Nothing is playing right now.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rail">
          {[...playing, ...done].slice(0, 8).map((game) => (
            <Row key={game.gameId} game={game} />
          ))}
        </ul>
      )}
    </Card>
  );
}
