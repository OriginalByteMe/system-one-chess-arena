// Every season's game counts, and the control that pins which one the front
// page opens on. A row also selects the season the games panel below shows.
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { saveFeaturedSeason, seasons, settings, type AdminSeasonOverview } from "../../admin-api.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly rows: readonly AdminSeasonOverview[] };

type SaveState = { readonly kind: "idle" | "saving" | "saved" } | { readonly kind: "error"; readonly message: string };

function formatEpoch(epochMs: number | undefined): string {
  return epochMs === undefined ? "—" : new Date(epochMs).toLocaleString();
}

export function SeasonsPanel({
  selectedSeasonId,
  onSelectSeason,
}: {
  readonly selectedSeasonId?: string;
  readonly onSelectSeason: (seasonId: string) => void;
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [featuredSeason, setFeaturedSeason] = useState<string | undefined>(undefined);
  const [pick, setPick] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    let live = true;
    Promise.all([seasons(), settings()])
      .then(([rows, current]) => {
        if (!live) return;
        setLoad({ kind: "ready", rows });
        setFeaturedSeason(current.featuredSeason?.value);
        setPick(current.featuredSeason?.value ?? rows[0]?.seasonId ?? "");
      })
      .catch((error: unknown) => {
        if (live) setLoad({ kind: "error", message: String((error as Error).message) });
      });
    return () => {
      live = false;
    };
  }, []);

  const save = (): void => {
    if (pick.length === 0) return;
    setSaveState({ kind: "saving" });
    saveFeaturedSeason(pick)
      .then((result) => {
        setFeaturedSeason(result.featuredSeason?.value);
        setSaveState({ kind: "saved" });
      })
      .catch((error: unknown) => {
        setSaveState({ kind: "error", message: String((error as Error).message) });
      });
  };

  return (
    <Card>
      <CardHead
        title="Seasons"
        meta={featuredSeason === undefined ? undefined : <span>Featured: {featuredSeason}</span>}
      />

      {load.kind === "loading" && <p className="text-sm text-mist">Loading seasons…</p>}
      {load.kind === "error" && <p className="text-sm text-live">{load.message}</p>}

      {load.kind === "ready" && (
        <div className="flex flex-col gap-4">
          {load.rows.length === 0 ? (
            <p className="text-sm text-mist">No season has been recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rail text-left text-xs text-mist uppercase">
                  <th className="py-1.5 pr-3 font-semibold">Season</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Games</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Scheduled</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">On air</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Finished</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Unscheduled</th>
                  <th className="py-1.5 font-semibold">First broadcast</th>
                </tr>
              </thead>
              <tbody>
                {load.rows.map((row) => (
                  <tr
                    key={row.seasonId}
                    onClick={() => onSelectSeason(row.seasonId)}
                    className={`cursor-pointer border-b border-rail/60 last:border-0 hover:bg-rail/40 ${
                      row.seasonId === selectedSeasonId ? "bg-rail/30" : ""
                    }`}
                  >
                    <td className="py-1.5 pr-3 font-semibold text-chalk">{row.seasonId}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-chalk">{row.gameCount}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-mist">{row.scheduled}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-live">{row.onAir}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-mist">{row.finished}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-gold">{row.unscheduled}</td>
                    <td className="py-1.5 text-mist">{formatEpoch(row.firstBroadcastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-rail pt-3">
            <label className="text-sm text-mist" htmlFor="featured-season-pick">
              Front page opens on
            </label>
            <select
              id="featured-season-pick"
              value={pick}
              onChange={(event) => {
                setPick(event.target.value);
                setSaveState({ kind: "idle" });
              }}
              className="rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk"
            >
              {load.rows.map((row) => (
                <option key={row.seasonId} value={row.seasonId}>
                  {row.seasonId}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={save}
              disabled={saveState.kind === "saving" || pick.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-bold text-void shadow-[0_2px_0_var(--color-brand-lo)] transition-colors hover:bg-brand-hi active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
            {saveState.kind === "saved" && <span className="text-sm text-brand">Saved.</span>}
            {saveState.kind === "error" && <span className="text-sm text-live">{saveState.message}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
