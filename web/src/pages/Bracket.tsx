import type { CSSProperties } from "react";

import { apiPath, useJson } from "../api.ts";
import type { BracketCell, BracketColumn } from "../bracket-model.ts";
import { bracketColumns } from "../bracket-model.ts";
import { href } from "../route.ts";
import { Loading, Shell } from "../Shell.tsx";
import type { Bracket as BracketRecord } from "../../../src/core/types.ts";

const columnsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: "1.5rem",
  alignItems: "flex-start",
};

const columnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  minWidth: "14rem",
};

/** One side of a match: a real competitor links out, a placeholder or bye does not. */
function Side({ match, label, side }: { readonly match: BracketCell["match"]; readonly label: string; readonly side: "a" | "b" }) {
  const slot = side === "a" ? match.a : match.b;
  if (slot.kind === "competitor") {
    return <a href={href({ kind: "competitor", competitor: slot.competitor })}>{label}</a>;
  }
  return <span>{label}</span>;
}

function Cell({ seasonId, cell }: { readonly seasonId: string; readonly cell: BracketCell }) {
  return (
    <li className="bracket-cell">
      <p>
        <Side match={cell.match} label={cell.a} side="a" /> vs <Side match={cell.match} label={cell.b} side="b" />
      </p>
      <p>Best of {cell.match.bestOf}</p>
      <p>{cell.decided ? cell.winner : "Undecided"}</p>
      {cell.match.gameIds.length > 0 && (
        <ol className="bracket-games">
          {cell.match.gameIds.map((gameId, index) => (
            <li key={gameId}>
              <a href={href({ kind: "watch", seasonId, gameId })}>Game {index + 1}</a>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Column({ seasonId, column }: { readonly seasonId: string; readonly column: BracketColumn }) {
  return (
    <section style={columnStyle}>
      <h2>{column.title}</h2>
      <ul>
        {column.cells.map((cell) => (
          <Cell key={cell.match.matchId} seasonId={seasonId} cell={cell} />
        ))}
      </ul>
    </section>
  );
}

export function Bracket({ bracketId }: { readonly bracketId: string }) {
  const loaded = useJson<BracketRecord>(apiPath("brackets", bracketId), 5000);

  return (
    <Shell title={`Bracket / ${bracketId}`}>
      <Loading loaded={loaded}>
        {(bracket) => {
          const columns = bracketColumns(bracket);
          return (
            <section aria-label="Bracket">
              <div style={columnsStyle}>
                {columns.map((column) => (
                  <Column key={column.round} seasonId={bracket.seasonId} column={column} />
                ))}
              </div>
              <p className="page-note">
                A match is undecided until every one of its games has been broadcast.
              </p>
            </section>
          );
        }}
      </Loading>
    </Shell>
  );
}
