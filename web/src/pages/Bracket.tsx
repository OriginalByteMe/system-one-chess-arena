import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { apiPath, useJson } from "../api.ts";
import type { BracketCell, BracketColumn } from "../bracket-model.ts";
import { bracketColumns } from "../bracket-model.ts";
import { titleCase } from "../format.ts";
import { href } from "../route.ts";
import { Loading, Shell } from "../Shell.tsx";
import { accentFor } from "../ui/accent.ts";
import { Sigil } from "../ui/Sigil.tsx";
import type {
  Bracket as BracketRecord,
  CompetitorProfile,
  MatchSlot,
} from "../../../src/core/types.ts";

type ProfileState = CompetitorProfile | null;

function ProfileLoader({
  name,
  onSettled,
}: {
  readonly name: string;
  readonly onSettled: (name: string, profile: ProfileState) => void;
}): null {
  const loaded = useJson<CompetitorProfile>(apiPath("competitors", name));

  useEffect(() => {
    if (loaded.data !== undefined) {
      onSettled(name, loaded.data);
    } else if (!loaded.loading && (loaded.error !== undefined || loaded.notFound === true)) {
      onSettled(name, null);
    }
  }, [loaded.data, loaded.error, loaded.loading, loaded.notFound, name, onSettled]);

  return null;
}

function slotCompetitor(slot: MatchSlot): string | undefined {
  return slot.kind === "competitor" ? slot.competitor : undefined;
}

function Side({
  cell,
  label,
  side,
  seasonId,
  profile,
}: {
  readonly cell: BracketCell;
  readonly label: string;
  readonly side: "a" | "b";
  readonly seasonId: string;
  readonly profile: ProfileState | undefined;
}): JSX.Element {
  const slot = side === "a" ? cell.match.a : cell.match.b;
  const competitor = slotCompetitor(slot);

  if (competitor === undefined) {
    const pending = slot.kind === "winner-of";
    return (
      <div className="bracket-entrant flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-rail bg-pit/60 px-3 py-2.5">
        <span
          aria-hidden="true"
          className={`h-8 w-8 shrink-0 rounded-full border ${pending ? "border-brand/50 bg-brand/10" : "border-rail bg-deck"}`}
        />
        <div>
          <p className="text-[10px] font-bold tracking-[0.12em] text-mist uppercase">
            {pending ? "Pending entrant" : "No opponent"}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-chalk">{label}</p>
        </div>
      </div>
    );
  }

  const won = cell.decided && cell.winner === competitor;
  const lost = cell.decided && cell.winner !== competitor;
  const seasonVersion = profile?.lineage.find((entry) => entry.seasonId === seasonId);
  const playstyle = seasonVersion?.manifest.playstyle;

  return (
    <div
      className={`bracket-entrant rounded-lg border px-3 py-2.5 ${
        won
          ? "border-brand/70 bg-brand/10"
          : lost
            ? "border-rail bg-pit/60"
            : "border-rail bg-pit"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Sigil name={competitor} accent={accentFor(competitor)} size={36} />
        <a
          href={href({ kind: "competitor", competitor })}
          className="min-w-0 flex-1 truncate text-sm font-bold text-chalk underline-offset-4 hover:text-brand-hi hover:underline"
        >
          {titleCase(competitor)}
        </a>
        {won ? (
          <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-void uppercase">
            Winner
          </span>
        ) : lost ? (
          <span className="text-[10px] font-bold tracking-wide text-mist uppercase">Eliminated</span>
        ) : null}
      </div>
      <p className="bracket-playstyle mt-2 text-[11px] leading-snug text-mist">
        {profile === undefined
          ? "Loading this season’s playstyle…"
          : playstyle === undefined
            ? "This season’s playstyle is unavailable."
            : `“${playstyle}”`}
      </p>
    </div>
  );
}

function Cell({
  seasonId,
  cell,
  profiles,
}: {
  readonly seasonId: string;
  readonly cell: BracketCell;
  readonly profiles: Readonly<Record<string, ProfileState | undefined>>;
}): JSX.Element {
  const a = slotCompetitor(cell.match.a);
  const b = slotCompetitor(cell.match.b);

  return (
    <li className="bracket-match flex min-h-0 w-80 flex-1 items-center">
      <article
        aria-label={`Match ${cell.match.slot + 1}`}
        className="w-full rounded-xl border border-rail bg-deck p-3"
      >
        <div className="mb-2.5 flex items-center justify-between gap-3 text-[10px] font-bold tracking-[0.1em] text-mist uppercase">
          <span>Match {cell.match.slot + 1}</span>
          <span>Best of {cell.match.bestOf}</span>
        </div>
        <div className="flex flex-col gap-2">
          <Side
            cell={cell}
            label={cell.a}
            side="a"
            seasonId={seasonId}
            profile={a === undefined ? null : profiles[a]}
          />
          <Side
            cell={cell}
            label={cell.b}
            side="b"
            seasonId={seasonId}
            profile={b === undefined ? null : profiles[b]}
          />
        </div>
        <div className="mt-3 flex min-h-7 flex-wrap items-center justify-between gap-2 border-t border-rail pt-2.5">
          <p className={`text-xs font-semibold ${cell.decided ? "text-brand-hi" : "text-mist"}`}>
            {cell.decided ? `${titleCase(cell.winner ?? "")} advances` : "Result pending"}
          </p>
          {cell.match.gameIds.length > 0 ? (
            <ol aria-label="Game replays" className="flex flex-wrap gap-1.5">
              {cell.match.gameIds.map((gameId, index) => (
                <li key={gameId}>
                  <a
                    href={href({ kind: "watch", seasonId, gameId })}
                    className="inline-flex min-h-7 items-center rounded bg-rail px-2 text-[11px] font-bold text-chalk underline-offset-2 hover:bg-brand hover:text-void focus-visible:outline-offset-2"
                  >
                    Replay {index + 1}
                  </a>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function Column({
  seasonId,
  column,
  bodyHeight,
  profiles,
}: {
  readonly seasonId: string;
  readonly column: BracketColumn;
  readonly bodyHeight: string;
  readonly profiles: Readonly<Record<string, ProfileState | undefined>>;
}): JSX.Element {
  return (
    <section className="bracket-round w-80 shrink-0" aria-labelledby={`round-${column.round}`}>
      <header className="sticky top-0 z-10 flex h-12 items-start justify-between gap-3 bg-pit px-1 pt-2">
        <h2 id={`round-${column.round}`} className="m-0 text-base font-extrabold text-chalk">
          {column.title}
        </h2>
        <span className="text-[10px] font-bold tracking-[0.1em] text-mist uppercase">
          Round {column.round + 1}
        </span>
      </header>
      <ol className="flex flex-col" style={{ height: bodyHeight }}>
        {column.cells.map((cell) => (
          <Cell
            key={cell.match.matchId}
            seasonId={seasonId}
            cell={cell}
            profiles={profiles}
          />
        ))}
      </ol>
    </section>
  );
}

function Connector({
  fromCount,
  toCount,
  bodyHeight,
}: {
  readonly fromCount: number;
  readonly toCount: number;
  readonly bodyHeight: string;
}): JSX.Element {
  return (
    <div aria-hidden="true" className="w-12 shrink-0">
      <div className="h-12" />
      <div className="relative w-full" style={{ height: bodyHeight }}>
        {Array.from({ length: toCount }, (_, index) => {
          const upper = ((index * 2 + 0.5) / fromCount) * 100;
          const lower = ((index * 2 + 1.5) / fromCount) * 100;
          const middle = (upper + lower) / 2;
          return (
            <div key={index}>
              <span
                className="absolute left-0 w-1/2 border-t border-rail"
                style={{ top: `${upper}%` }}
              />
              <span
                className="absolute left-0 w-1/2 border-t border-rail"
                style={{ top: `${lower}%` }}
              />
              <span
                className="absolute left-1/2 border-l border-rail"
                style={{ top: `${upper}%`, height: `${lower - upper}%` }}
              />
              <span
                className="absolute left-1/2 w-1/2 border-t border-rail"
                style={{ top: `${middle}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Connected elimination rounds with one profile fetch per unique revealed competitor. */
export function BracketTree({ bracket, compact = false }: { readonly bracket: BracketRecord; readonly compact?: boolean }): JSX.Element {
  const columns = useMemo(() => bracketColumns(bracket), [bracket]);
  const competitors = useMemo(() => {
    const names = new Set<string>();
    for (const column of columns) {
      for (const cell of column.cells) {
        const a = slotCompetitor(cell.match.a);
        const b = slotCompetitor(cell.match.b);
        if (a !== undefined) names.add(a);
        if (b !== undefined) names.add(b);
        if (cell.winner !== undefined) names.add(cell.winner);
      }
    }
    return [...names];
  }, [columns]);
  const [profiles, setProfiles] = useState<Record<string, ProfileState>>({});
  const settleProfile = useCallback((name: string, profile: ProfileState) => {
    setProfiles((current) => (current[name] === profile ? current : { ...current, [name]: profile }));
  }, []);

  const openingMatches = columns[0]?.cells.length ?? 1;
  const bodyHeight = `${Math.max(1, openingMatches) * (compact ? 12.5 : 24)}rem`;

  if (columns.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-rail p-4 text-sm text-mist">
        This bracket has no rounds yet.
      </p>
    );
  }

  return (
    <div className={compact ? "bracket-overview" : undefined}>
      {compact ? null : competitors.map((name) => (
        <ProfileLoader key={name} name={name} onSettled={settleProfile} />
      ))}
      <p id="bracket-scroll-hint" className="mb-2 text-xs font-semibold text-mist">
        Scroll across the rounds and down for every matchup.
      </p>
      <div
        role="region"
        aria-label="Elimination bracket"
        aria-describedby="bracket-scroll-hint"
        tabIndex={0}
        className="max-h-[72vh] overflow-auto rounded-xl border border-rail bg-pit p-3 pb-5 focus-visible:outline-offset-4 sm:p-5"
      >
        <div className="flex min-w-max items-stretch">
          {columns.map((column, index) => {
            const next = columns[index + 1];
            return (
              <div key={column.round} className="flex items-stretch">
                <Column
                  seasonId={bracket.seasonId}
                  column={column}
                  bodyHeight={bodyHeight}
                  profiles={profiles}
                />
                {next === undefined ? null : (
                  <Connector
                    fromCount={column.cells.length}
                    toCount={next.cells.length}
                    bodyHeight={bodyHeight}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-mist">
        Entrants and results appear only after the broadcast gate releases them. A match remains pending until its
        games have aired.
      </p>
    </div>
  );
}

export function Bracket({ bracketId }: { readonly bracketId: string }): JSX.Element {
  const loaded = useJson<BracketRecord>(apiPath("brackets", bracketId), 5000);

  return (
    <Shell title="Elimination bracket">
      <section aria-labelledby="bracket-title" className="py-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-rail pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p id="bracket-title" className="mt-1 max-w-[65ch] text-sm leading-relaxed text-mist">
              Follow each revealed series from opening round to final.
            </p>
          </div>
          {loaded.data === undefined ? null : (
            <a
              href={href({ kind: "season", seasonId: loaded.data.seasonId })}
              className="w-fit rounded-lg bg-rail px-3 py-2 text-sm font-bold text-chalk underline-offset-4 hover:bg-brand hover:text-void"
            >
              Season schedule
            </a>
          )}
        </div>
        {loaded.notFound === true ? (
          <p className="rounded-xl border border-dashed border-rail p-5 text-sm text-mist">
            No bracket is available.
          </p>
        ) : (
          <Loading loaded={loaded}>{(bracket) => <BracketTree bracket={bracket} />}</Loading>
        )}
      </section>
    </Shell>
  );
}
