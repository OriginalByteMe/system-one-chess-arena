// Starts and tracks a season campaign: an operator-chosen bracket size,
// pace, and daily schedule that a cron plays through on its own, one match a
// day until the plan's season count (or until stopped) is reached. Before a
// campaign exists this renders the start form; once one exists, running,
// paused, or finished, it renders the status and calendar the cron produces.
import { useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import {
  campaign,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
  stopCampaign,
  tickCampaign,
  type AdminCampaignState,
  type CampaignPhase,
} from "../../admin-api.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";
import { CampaignCalendar } from "./CampaignCalendar.tsx";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly campaignState: AdminCampaignState };

type ActionState = { readonly kind: "idle" | "busy" } | { readonly kind: "error"; readonly message: string };

const IDLE: ActionState = { kind: "idle" };
const POLL_INTERVAL_MS = 5000;
const ROUND_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];
const MATCHES_PER_DAY_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];
const HOUR_OPTIONS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);
/** Pace choices, keyed by ms per ply. Numeric keys iterate in ascending order. */
const PACE_LABELS: Record<number, string> = {
  250: "250 ms, four plies per second",
  500: "500 ms, two plies per second",
  1000: "1000 ms, one ply per second",
  2000: "2000 ms, one ply every two seconds",
  5000: "5000 ms, one ply every five seconds",
};
/** Best-of choices, keyed by games per match. */
const BEST_OF_LABELS: Record<number, string> = {
  1: "one game",
  2: "two games, colours swapped",
};

function entrantsFor(rounds: number): number {
  return Math.min(2 ** rounds, 20);
}

function describePhase(phase: CampaignPhase): string {
  if (phase === "running") return "Running";
  if (phase === "paused") return "Paused";
  return "Finished";
}

function phaseClass(phase: CampaignPhase): string {
  if (phase === "running") return "text-live";
  if (phase === "paused") return "text-gold";
  return "text-brand";
}

export function CampaignPanel(): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const [rounds, setRounds] = useState(4);
  const [seasonsMode, setSeasonsMode] = useState<"count" | "unbounded">("count");
  const [seasonsInput, setSeasonsInput] = useState("1");
  const [bestOf, setBestOf] = useState(1);
  const [matchesPerDay, setMatchesPerDay] = useState(1);
  const [hourUtc, setHourUtc] = useState(17);
  const [msPerPly, setMsPerPly] = useState(1000);
  const [startState, setStartState] = useState<ActionState>(IDLE);

  const [tickState, setTickState] = useState<ActionState>(IDLE);
  const [pauseState, setPauseState] = useState<ActionState>(IDLE);
  const [resumeState, setResumeState] = useState<ActionState>(IDLE);
  const [stopState, setStopState] = useState<ActionState>(IDLE);

  useEffect(() => {
    let live = true;
    campaign()
      .then((campaignState) => {
        if (live) setLoad({ kind: "ready", campaignState });
      })
      .catch((error: unknown) => {
        if (live) setLoad({ kind: "error", message: String((error as Error).message) });
      });
    return () => {
      live = false;
    };
  }, []);

  const runningPhase =
    load.kind === "ready" && load.campaignState.running ? load.campaignState.campaign.phase : undefined;

  useEffect(() => {
    if (runningPhase !== "running") return;
    let live = true;
    const timer = setInterval(() => {
      campaign()
        .then((campaignState) => {
          if (live) setLoad({ kind: "ready", campaignState });
        })
        .catch((error: unknown) => {
          if (live) setLoad({ kind: "error", message: String((error as Error).message) });
        });
    }, POLL_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [runningPhase]);

  const submitStart = (event: FormEvent): void => {
    event.preventDefault();
    let seasons = 0;
    if (seasonsMode === "count") {
      const parsedSeasons = Number(seasonsInput);
      if (!Number.isInteger(parsedSeasons) || parsedSeasons < 1 || parsedSeasons > 20) {
        setStartState({ kind: "error", message: "Seasons must be a whole number from 1 to 20." });
        return;
      }
      seasons = parsedSeasons;
    }
    setStartState({ kind: "busy" });
    startCampaign({ rounds, seasons, msPerPly, bestOf, matchesPerDay, hourUtc })
      .then((campaignState) => {
        setStartState(IDLE);
        setLoad({ kind: "ready", campaignState });
      })
      .catch((error: unknown) => {
        setStartState({ kind: "error", message: String((error as Error).message) });
      });
  };

  const advance = (): void => {
    setTickState({ kind: "busy" });
    tickCampaign()
      .then((campaignState) => {
        setTickState(IDLE);
        setLoad({ kind: "ready", campaignState });
      })
      .catch((error: unknown) => {
        setTickState({ kind: "error", message: String((error as Error).message) });
      });
  };

  const pause = (): void => {
    setPauseState({ kind: "busy" });
    pauseCampaign()
      .then((campaignState) => {
        setPauseState(IDLE);
        setLoad({ kind: "ready", campaignState });
      })
      .catch((error: unknown) => {
        setPauseState({ kind: "error", message: String((error as Error).message) });
      });
  };

  const resume = (): void => {
    setResumeState({ kind: "busy" });
    resumeCampaign()
      .then((campaignState) => {
        setResumeState(IDLE);
        setLoad({ kind: "ready", campaignState });
      })
      .catch((error: unknown) => {
        setResumeState({ kind: "error", message: String((error as Error).message) });
      });
  };

  const stop = (): void => {
    if (!window.confirm("Stop the campaign? Any days not yet played will not be played.")) return;
    setStopState({ kind: "busy" });
    stopCampaign()
      .then((campaignState) => {
        setStopState(IDLE);
        setLoad({ kind: "ready", campaignState });
      })
      .catch((error: unknown) => {
        setStopState({ kind: "error", message: String((error as Error).message) });
      });
  };

  const entrants = entrantsFor(rounds);
  const seasonMatches = entrants - 1;
  const seasonGames = seasonMatches * bestOf;
  const seasonDays = Math.ceil(seasonMatches / matchesPerDay);
  const perDayPhrase = matchesPerDay === 1 ? "one a day" : `${matchesPerDay} a day`;
  const summarySentence =
    `${entrants} entrant${entrants === 1 ? "" : "s"}, ` +
    `${seasonMatches} match${seasonMatches === 1 ? "" : "es"}, ` +
    `${seasonGames} game${seasonGames === 1 ? "" : "s"}, ${perDayPhrase}, ` +
    `so a season takes ${seasonDays} day${seasonDays === 1 ? "" : "s"}.`;

  return (
    <Card>
      <CardHead
        title="Campaign"
        meta={
          load.kind === "ready" && load.campaignState.running ? (
            <span className={phaseClass(load.campaignState.campaign.phase)}>
              {describePhase(load.campaignState.campaign.phase)}
            </span>
          ) : undefined
        }
      />

      {load.kind === "loading" && <p className="text-sm text-mist">Loading campaign…</p>}
      {load.kind === "error" && <p className="text-sm text-live">{load.message}</p>}

      {load.kind === "ready" && !load.campaignState.running && (
        <form onSubmit={submitStart} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-mist" htmlFor="campaign-rounds">
              Rounds
            </label>
            <select
              id="campaign-rounds"
              value={rounds}
              onChange={(event) => setRounds(Number(event.target.value))}
              className="rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk"
            >
              {ROUND_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <label className="text-sm text-mist" htmlFor="campaign-best-of">
              Games per match
            </label>
            <select
              id="campaign-best-of"
              value={bestOf}
              onChange={(event) => setBestOf(Number(event.target.value))}
              className="rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk"
            >
              {Object.entries(BEST_OF_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="text-sm text-mist" htmlFor="campaign-matches-per-day">
              Matches per day
            </label>
            <select
              id="campaign-matches-per-day"
              value={matchesPerDay}
              onChange={(event) => setMatchesPerDay(Number(event.target.value))}
              className="rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk"
            >
              {MATCHES_PER_DAY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <p className="text-sm text-mist">{summarySentence}</p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-mist" htmlFor="campaign-seasons">
              Seasons
            </label>
            <input
              id="campaign-seasons"
              type="number"
              min={1}
              max={20}
              value={seasonsInput}
              disabled={seasonsMode === "unbounded"}
              onChange={(event) => setSeasonsInput(event.target.value)}
              className="tabular w-20 rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk disabled:opacity-50"
            />
            <label className="flex items-center gap-1.5 text-sm text-mist" htmlFor="campaign-seasons-unbounded">
              <input
                id="campaign-seasons-unbounded"
                type="checkbox"
                checked={seasonsMode === "unbounded"}
                onChange={(event) => setSeasonsMode(event.target.checked ? "unbounded" : "count")}
              />
              Until I stop it
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-mist" htmlFor="campaign-hour-utc">
              Start time
            </label>
            <select
              id="campaign-hour-utc"
              value={hourUtc}
              onChange={(event) => setHourUtc(Number(event.target.value))}
              className="rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk"
            >
              {HOUR_OPTIONS.map((hour) => (
                <option key={hour} value={hour}>
                  {hour.toString().padStart(2, "0")}:00 UTC
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-mist" htmlFor="campaign-pace">
              Pace
            </label>
            <select
              id="campaign-pace"
              value={msPerPly}
              onChange={(event) => setMsPerPly(Number(event.target.value))}
              className="rounded border border-rail bg-pit px-2 py-1 text-sm text-chalk"
            >
              {Object.entries(PACE_LABELS).map(([ms, label]) => (
                <option key={ms} value={ms}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-rail pt-3">
            <button
              type="submit"
              disabled={startState.kind === "busy"}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-bold text-void shadow-[0_2px_0_var(--color-brand-lo)] transition-colors hover:bg-brand-hi active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start campaign
            </button>
            {startState.kind === "error" && <span className="text-sm text-live">{startState.message}</span>}
          </div>
        </form>
      )}

      {load.kind === "ready" && load.campaignState.running && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-mist uppercase">Season</dt>
              <dd className="tabular text-lg font-bold text-chalk">
                {load.campaignState.campaign.plan.seasons === 0
                  ? `${load.campaignState.campaign.seasonIndex + 1}, running until stopped`
                  : `${load.campaignState.campaign.seasonIndex + 1} of ${load.campaignState.campaign.plan.seasons}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist uppercase">Matches</dt>
              <dd className="tabular text-lg font-bold text-chalk">
                {load.campaignState.campaign.matchesPlayed} of {load.campaignState.campaign.matchesTotal}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist uppercase">Phase</dt>
              <dd className={`text-lg font-bold ${phaseClass(load.campaignState.campaign.phase)}`}>
                {describePhase(load.campaignState.campaign.phase)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-mist uppercase">Pace</dt>
              <dd className="text-sm text-chalk">
                {PACE_LABELS[load.campaignState.campaign.plan.msPerPly] ??
                  `${load.campaignState.campaign.plan.msPerPly} ms per ply`}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-mist">
            <span>
              Season id: <span className="text-chalk">{load.campaignState.campaign.seasonId}</span>
            </span>
            <span>
              Entrants: <span className="text-chalk">{load.campaignState.campaign.entrants}</span>
            </span>
            {load.campaignState.campaign.champion !== undefined && (
              <span>
                Champion: <span className="font-semibold text-brand">{load.campaignState.campaign.champion}</span>
              </span>
            )}
            <span>
              Started:{" "}
              <span className="text-chalk">{new Date(load.campaignState.campaign.startedAt).toLocaleString()}</span>
            </span>
            <span>
              Last tick:{" "}
              <span className="text-chalk">{new Date(load.campaignState.campaign.lastTickAt).toLocaleString()}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-rail pt-3">
            {load.campaignState.campaign.phase === "running" && (
              <button
                type="button"
                onClick={pause}
                disabled={pauseState.kind === "busy"}
                className="rounded bg-rail px-3 py-1.5 text-sm font-bold text-chalk transition-colors hover:bg-[#4b4744] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Pause
              </button>
            )}
            {load.campaignState.campaign.phase === "paused" && (
              <button
                type="button"
                onClick={resume}
                disabled={resumeState.kind === "busy"}
                className="rounded bg-rail px-3 py-1.5 text-sm font-bold text-chalk transition-colors hover:bg-[#4b4744] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Resume
              </button>
            )}
            {load.campaignState.campaign.phase !== "finished" && (
              <button
                type="button"
                onClick={advance}
                disabled={tickState.kind === "busy"}
                className="rounded bg-rail px-3 py-1.5 text-sm font-bold text-chalk transition-colors hover:bg-[#4b4744] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Advance now
              </button>
            )}
            <button
              type="button"
              onClick={stop}
              disabled={stopState.kind === "busy"}
              className="rounded bg-rail px-3 py-1.5 text-sm font-bold text-live transition-colors hover:bg-[#4b4744] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Stop campaign
            </button>
            {pauseState.kind === "error" && <span className="text-sm text-live">{pauseState.message}</span>}
            {resumeState.kind === "error" && <span className="text-sm text-live">{resumeState.message}</span>}
            {tickState.kind === "error" && <span className="text-sm text-live">{tickState.message}</span>}
            {stopState.kind === "error" && <span className="text-sm text-live">{stopState.message}</span>}
          </div>

          <CampaignCalendar days={load.campaignState.campaign.calendar} />
        </div>
      )}
    </Card>
  );
}
