// The column beside the featured game: what has just been decided, and the
// move list. Both read the gated game endpoint, so both stop exactly where the
// broadcast clock stops.
import type { JSX } from "react";

import { apiPath, useJson } from "../../api.ts";
import { percent, seconds, titleCase } from "../../format.ts";
import type { DecisionRecord, RevealedGame } from "../../../../src/core/types.ts";
import { accentFor } from "../../ui/accent.ts";
import { formatUci } from "../../ui/board/format.ts";
import { Card, CardHead, LivePill } from "../../ui/chrome.tsx";
import { Sigil } from "../../ui/Sigil.tsx";

/** One line of commentary, built only from fields the decision carries. */
function describe(decision: DecisionRecord): string {
  const move = formatUci(decision.move);
  const strategy = titleCase(decision.strategy).toLowerCase();
  if (decision.fallback !== undefined) {
    return `${titleCase(decision.competitor)} fell back to ${move} after a ${decision.fallback.replace(/-/g, " ")}.`;
  }
  if (decision.confidence === undefined) {
    return `${titleCase(decision.competitor)} plays ${move}, playing for ${strategy}.`;
  }
  return `${titleCase(decision.competitor)} plays ${move} — ${percent(decision.confidence)} sure, playing for ${strategy}.`;
}

export function SideRail({
  seasonId,
  gameId,
}: {
  readonly seasonId: string | undefined;
  readonly gameId: string | undefined;
}): JSX.Element {
  // The rail owns this request rather than taking the result as a prop: it is
  // the only part of the page that needs ply-level detail, and keeping the
  // fetch next to the render means there is one place where it can go wrong.
  const path =
    seasonId === undefined || gameId === undefined
      ? undefined
      : apiPath("seasons", seasonId, "games", gameId);
  const loaded = useJson<RevealedGame>(path);
  const game = loaded.data;
  const decisions = game?.decisions ?? [];
  const recent = decisions.slice(-5).reverse();
  const onAir = game?.window.status === "on-air";

  const note =
    loaded.error !== undefined
      ? loaded.error
      : path === undefined || loaded.loading
        ? "Loading…"
        : decisions.length === 0
          ? "Nothing has aired yet."
          : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHead title="Commentary" meta={onAir ? <LivePill /> : undefined} />
        {note !== undefined ? (
          <p className="text-sm text-mist">{note}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rail">
            {recent.map((decision) => (
              <li key={decision.ply} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <Sigil name={decision.competitor} accent={accentFor(decision.competitor)} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-chalk">{describe(decision)}</p>
                  <span className="tabular text-xs text-mist">
                    Ply {decision.ply} · {seconds(decision.latencyMs)} to decide
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          title="Moves"
          meta={<span className="tabular">{decisions.length} aired</span>}
        />
        {decisions.length === 0 ? (
          <p className="text-sm text-mist">No moves have aired yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-mist">
                <th className="pb-1.5 pr-2 font-semibold">Ply</th>
                <th className="pb-1.5 pr-2 font-semibold">Agent</th>
                <th className="pb-1.5 pr-2 font-semibold">Move</th>
                <th className="pb-1.5 text-right font-semibold">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {decisions.slice(-8).map((decision) => (
                <tr key={decision.ply} className="border-t border-rail">
                  <td className="tabular py-1.5 pr-2 text-mist">{decision.ply}</td>
                  <td className="py-1.5 pr-2 text-mist">{titleCase(decision.competitor)}</td>
                  <td className="tabular py-1.5 pr-2 font-semibold text-chalk">
                    {formatUci(decision.move)}
                  </td>
                  <td className="tabular py-1.5 text-right text-mist">
                    {decision.confidence === undefined ? "—" : percent(decision.confidence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
