// One season's games, with a reschedule form per game. Results and ply counts
// are shown as recorded — this console runs the broadcast, so unlike the
// public site it never gates on the reveal window.
import { useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import {
  rescheduleGame,
  seasonDetail,
  type AdminGame,
  type AdminSeasonDetail,
} from "../../admin-api.ts";
import { titleCase } from "../../format.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly detail: AdminSeasonDetail };

function statusClass(status: AdminGame["status"]): string {
  if (status === "on-air") return "text-live";
  if (status === "unscheduled") return "text-gold";
  if (status === "finished") return "text-mist";
  return "text-chalk";
}

function localInputValue(epochMs: number | undefined): string {
  if (epochMs === undefined) return "";
  const date = new Date(epochMs);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(epochMs - offsetMs).toISOString().slice(0, 16);
}

interface ScheduleFormProps {
  readonly seasonId: string;
  readonly game: AdminGame;
  readonly onScheduled: (game: AdminGame) => void;
}

function ScheduleForm({ seasonId, game, onScheduled }: ScheduleFormProps): JSX.Element {
  const [startAt, setStartAt] = useState(localInputValue(game.schedule?.startAt));
  const [msPerPly, setMsPerPly] = useState(String(game.schedule?.msPerPly ?? 1000));
  const [state, setState] = useState<{ readonly kind: "idle" | "saving" } | { readonly kind: "error"; readonly message: string }>({
    kind: "idle",
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const parsedStart = new Date(startAt).getTime();
    const parsedMsPerPly = Number(msPerPly);
    if (!Number.isFinite(parsedStart) || startAt.length === 0) {
      setState({ kind: "error", message: "Pick a start time." });
      return;
    }
    if (!Number.isInteger(parsedMsPerPly) || parsedMsPerPly <= 0) {
      setState({ kind: "error", message: "Ms per ply must be a positive integer." });
      return;
    }
    setState({ kind: "saving" });
    rescheduleGame(seasonId, game.gameId, parsedStart, parsedMsPerPly)
      .then((updated) => {
        setState({ kind: "idle" });
        onScheduled(updated);
      })
      .catch((error: unknown) => {
        setState({ kind: "error", message: String((error as Error).message) });
      });
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        value={startAt}
        onChange={(event) => setStartAt(event.target.value)}
        className="rounded border border-rail bg-pit px-2 py-1 text-xs text-chalk"
        aria-label={`Start time for ${game.gameId}`}
      />
      <input
        type="number"
        min={1}
        value={msPerPly}
        onChange={(event) => setMsPerPly(event.target.value)}
        className="tabular w-20 rounded border border-rail bg-pit px-2 py-1 text-xs text-chalk"
        aria-label={`Milliseconds per ply for ${game.gameId}`}
      />
      <button
        type="submit"
        disabled={state.kind === "saving"}
        className="rounded bg-rail px-2 py-1 text-xs font-bold text-chalk transition-colors hover:bg-[#4b4744] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Move
      </button>
      {state.kind === "error" && <span className="text-xs text-live">{state.message}</span>}
    </form>
  );
}

export function SeasonGamesPanel({ seasonId }: { readonly seasonId?: string }): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    if (seasonId === undefined) return;
    let live = true;
    setLoad({ kind: "loading" });
    seasonDetail(seasonId)
      .then((detail) => {
        if (live) setLoad({ kind: "ready", detail });
      })
      .catch((error: unknown) => {
        if (live) setLoad({ kind: "error", message: String((error as Error).message) });
      });
    return () => {
      live = false;
    };
  }, [seasonId]);

  const applyUpdate = (updated: AdminGame): void => {
    setLoad((previous) => {
      if (previous.kind !== "ready") return previous;
      return {
        kind: "ready",
        detail: {
          ...previous.detail,
          games: previous.detail.games.map((game) => (game.gameId === updated.gameId ? updated : game)),
        },
      };
    });
  };

  return (
    <Card>
      <CardHead title="Games" meta={seasonId === undefined ? undefined : <span>{seasonId}</span>} />

      {seasonId === undefined && <p className="text-sm text-mist">Pick a season above to see its games.</p>}
      {seasonId !== undefined && load.kind === "loading" && <p className="text-sm text-mist">Loading games…</p>}
      {seasonId !== undefined && load.kind === "error" && <p className="text-sm text-live">{load.message}</p>}

      {seasonId !== undefined && load.kind === "ready" && (
        <div className="flex flex-col gap-4">
          {load.detail.games.length === 0 ? (
            <p className="text-sm text-mist">This season has no recorded games yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rail text-left text-xs text-mist uppercase">
                  <th className="py-1.5 pr-3 font-semibold">Game</th>
                  <th className="py-1.5 pr-3 font-semibold">White</th>
                  <th className="py-1.5 pr-3 font-semibold">Black</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Plies</th>
                  <th className="py-1.5 pr-3 font-semibold">Result</th>
                  <th className="py-1.5 pr-3 font-semibold">Status</th>
                  <th className="py-1.5 font-semibold">Broadcast</th>
                </tr>
              </thead>
              <tbody>
                {load.detail.games.map((game) => (
                  <tr key={game.gameId} className="border-b border-rail/60 align-top last:border-0">
                    <td className="py-1.5 pr-3 font-semibold text-chalk">{game.gameId}</td>
                    <td className="py-1.5 pr-3 text-mist">{game.white.name}</td>
                    <td className="py-1.5 pr-3 text-mist">{game.black.name}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-chalk">{game.plies}</td>
                    <td className="py-1.5 pr-3 text-mist">
                      {game.result} / {titleCase(game.reason)}
                    </td>
                    <td className={`py-1.5 pr-3 font-semibold ${statusClass(game.status)}`}>
                      {titleCase(game.status)}
                    </td>
                    <td className="py-1.5">
                      <ScheduleForm seasonId={seasonId} game={game} onScheduled={applyUpdate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
