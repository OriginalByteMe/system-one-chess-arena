// One competitor's whole side of the broadcast: who it is, the strategy it
// named for the decision under examination, how sure it said it was, the
// candidates it weighed, what that decision cost in time and tokens, and the
// run of moves it has already played. Left and right are mirror images so a
// spectator reads both minds without moving their eyes off the board.
import type { JSX } from "react";
import { motion } from "motion/react";

import type { Colour, CompetitorManifest, DecisionRecord } from "../../../../src/core/types.ts";
import { percent, seconds, titleCase } from "../../format.ts";
import { candidatesOf } from "../../ui/board/arrows.ts";
import { formatUci } from "../../ui/board/format.ts";
import { Sigil } from "../../ui/Sigil.tsx";

export interface PlayedMove {
  readonly ply: number;
  readonly san: string;
  /** Index into the game's decisions array, for jumping the board here. */
  readonly index: number;
  readonly confidence?: number;
}

export interface MindPanelRecord {
  readonly games: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
}

export interface MindPanelProps {
  readonly name: string;
  readonly accent: string;
  readonly colour: Colour;
  readonly side: "left" | "right";
  /** Absent until the competitor's profile has loaded, or if it never does. */
  readonly elo?: number;
  readonly record?: MindPanelRecord;
  readonly meanLatencyMs?: number;
  readonly manifest?: CompetitorManifest;
  readonly decision: DecisionRecord | undefined;
  /** This mind's decision is the one drawn on the board right now. */
  readonly live: boolean;
  readonly thinking: boolean;
  readonly played: readonly PlayedMove[];
  readonly hoveredMove: string | null;
  readonly onHoverMove: (move: string | null) => void;
  readonly onJumpToIndex: (index: number) => void;
  readonly reduced: boolean;
}

const METER_BLOCKS = 10;

function Meter({ value, accent }: { readonly value: number | undefined; readonly accent: string }): JSX.Element {
  const lit = Math.round((value ?? 0) * METER_BLOCKS);
  return (
    <div
      className="flex flex-1 gap-[3px]"
      role="meter"
      aria-label="Stated confidence"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((value ?? 0) * 100)}
    >
      {Array.from({ length: METER_BLOCKS }, (_, i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-[2px]"
          style={{ backgroundColor: i < lit ? accent : "var(--color-rail)" }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col border-t border-rail/60 px-1 pt-2">
      <span className="text-[10px] leading-tight font-semibold tracking-wide text-mist uppercase">{label}</span>
      <span className="tabular mt-1 truncate text-xs font-semibold text-chalk">{value}</span>
    </div>
  );
}

/** "hangingOwnPieces" -> "Hanging own pieces". */
function formatFeatureKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function MindPanel({
  name,
  accent,
  colour,
  side,
  elo,
  record,
  meanLatencyMs,
  manifest,
  decision,
  live,
  thinking,
  played,
  hoveredMove,
  onHoverMove,
  onJumpToIndex,
  reduced,
}: MindPanelProps): JSX.Element {
  const mirrored = side === "right";
  const recent = played.slice(-6);
  const candidates = decision === undefined ? [] : candidatesOf(decision).slice(0, 6);

  return (
    <section
      className={`flex w-full min-w-0 flex-col gap-4 rounded-xl border border-rail/70 bg-deck p-4 ${
        mirrored ? "lg:items-end lg:text-right" : "items-start text-left"
      }`}
      style={{
        borderColor: live ? accent : undefined,
      }}
      aria-label={`${titleCase(name)} playing ${colour}`}
    >
      <div className={`flex w-full items-center gap-3 ${mirrored ? "lg:flex-row-reverse" : ""}`}>
        <Sigil name={name} accent={accent} size={52} thinking={thinking} {...(decision?.confidence === undefined ? {} : { charge: decision.confidence })} className="shrink-0" />
        <div className={`flex min-w-0 flex-col gap-1 ${mirrored ? "lg:items-end" : "items-start"}`}>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-mist uppercase">
            <span
              className="inline-block h-2 w-2 rounded-full border"
              style={{
                backgroundColor: colour === "white" ? "var(--color-board-light)" : "var(--color-void)",
                borderColor: "var(--color-mist)",
              }}
              aria-hidden="true"
            />
            {titleCase(colour)}
            {elo === undefined ? "" : ` · ${Math.round(elo)} Elo`}
          </span>
          <span className="truncate font-display text-xl leading-tight font-bold text-chalk">
            {titleCase(name)}
          </span>
        </div>
      </div>

      {manifest !== undefined && (
        <p className="w-full text-sm leading-relaxed text-mist italic">&ldquo;{manifest.playstyle}&rdquo;</p>
      )}

      {decision === undefined ? (
        <div className="flex w-full flex-col gap-2">
          <p className="w-full rounded-lg border border-dashed border-rail px-3 py-3 text-left text-xs text-mist lg:text-center">
            Yet to move in this window
          </p>
          {record !== undefined && (
            <div className="flex w-full gap-1.5">
              <Stat label="Season" value={`${record.wins}w ${record.draws}d ${record.losses}l`} />
              <Stat label="Typical think" value={meanLatencyMs === undefined ? "—" : seconds(meanLatencyMs)} />
            </div>
          )}
          {manifest !== undefined && (
            <div className={`flex w-full flex-wrap gap-1.5 ${mirrored ? "lg:justify-end" : ""}`}>
              {manifest.strategies.map((strategy) => (
                <span
                  key={strategy}
                  className="rounded-md border border-rail px-2 py-1 text-[11px] text-mist"
                >
                  {titleCase(strategy)}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <motion.div
            key={decision.ply}
            className="w-full border-y border-rail/60 px-1 py-3"
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0.05 : 0.25 }}
          >
            <span className="text-[10px] font-semibold tracking-wide text-mist uppercase">
              Strategy · ply {decision.ply}
            </span>
            <span
              className="mt-1 block break-words font-display text-base font-bold"
              style={{ color: accent }}
            >
              {titleCase(decision.strategy)}
            </span>
            {decision.fallback !== undefined && (
              <span className="text-[11px] text-mist">Fell back · {titleCase(decision.fallback)}</span>
            )}
          </motion.div>

          <div className={`flex w-full items-center gap-2 ${mirrored ? "lg:flex-row-reverse" : ""}`}>
            <span className="shrink-0 text-[11px] text-mist">Sure</span>
            <Meter value={decision.confidence} accent={accent} />
            <span className="tabular w-9 shrink-0 text-right text-[11px] text-chalk">
              {decision.confidence === undefined ? "—" : percent(decision.confidence)}
            </span>
          </div>

          <div className="grid w-full grid-cols-3 gap-2">
            <Stat
              label="Thought for"
              value={`${seconds(decision.latencyMs)}${
                meanLatencyMs === undefined ? "" : decision.latencyMs <= meanLatencyMs ? " ↓" : " ↑"
              }`}
            />
            <Stat label="Tokens in" value={decision.tokens === undefined ? "—" : `${decision.tokens.in}`} />
            <Stat label="Legal moves" value={`${decision.legalMoveCount}`} />
          </div>

          <div className="flex w-full flex-col gap-1.5">
            <span className="text-[10px] font-semibold tracking-wide text-mist uppercase">
              {live ? "Weighing now" : "Weighed then"}
            </span>
            <ul className="flex w-full flex-col gap-[3px]">
              {candidates.map((candidate) => {
                const isPlayed = candidate.move === decision.move;
                const isHovered = hoveredMove === candidate.move;
                return (
                  <li key={candidate.move}>
                    <button
                      type="button"
                      onMouseEnter={() => live && onHoverMove(candidate.move)}
                      onMouseLeave={() => live && onHoverMove(null)}
                      onFocus={() => live && onHoverMove(candidate.move)}
                      onBlur={() => live && onHoverMove(null)}
                      className={`grid min-h-11 w-full grid-cols-[4rem_minmax(0,1fr)_2.25rem] items-center gap-2 border-b border-rail/50 px-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-chalk ${
                        isHovered ? "bg-rail/70" : "hover:bg-rail/40"
                      }`}
                      aria-label={`${formatUci(candidate.move)}, ${Math.round(candidate.p * 100)} percent${
                        isPlayed ? ", played" : ""
                      }`}
                    >
                      <span className={`tabular text-xs ${isPlayed ? "font-semibold text-chalk" : "text-mist"}`}>
                        {formatUci(candidate.move)}
                      </span>
                      <span className="relative h-1.5 overflow-hidden rounded-full bg-rail/60">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.max(candidate.p * 100, 2)}%`,
                            backgroundColor: isPlayed ? accent : "var(--color-mist)",
                          }}
                        />
                      </span>
                      <span className="tabular text-right text-[11px] text-mist">
                        {Math.round(candidate.p * 100)}%
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <div className="flex w-full flex-col gap-1">
        <span className="text-[10px] font-semibold tracking-wide text-mist uppercase">Moves played</span>
        <div className={`flex flex-wrap gap-1.5 ${mirrored ? "lg:justify-end" : ""}`}>
          {recent.length === 0 ? (
            <span className="text-xs text-mist">—</span>
          ) : (
            recent.map((move) => (
              <button
                key={move.ply}
                type="button"
                onClick={() => onJumpToIndex(move.index)}
                className="tabular min-h-11 rounded-lg border border-rail px-3 py-2 text-xs text-mist transition-colors outline-none hover:bg-rail hover:text-chalk focus-visible:ring-1 focus-visible:ring-chalk"
                title={`Ply ${move.ply} · ${move.confidence === undefined ? "—" : percent(move.confidence)} sure`}
              >
                {move.san}
              </button>
            ))
          )}
        </div>
      </div>

      {manifest !== undefined && (
        <div className={`flex w-full flex-wrap gap-1.5 ${mirrored ? "lg:justify-end" : ""}`}>
          {manifest.features.map((feature) => {
            const seen = decision?.featuresSeen.includes(feature) ?? false;
            return (
              <span
                key={feature}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  seen ? "border-chalk/50 text-chalk" : "border-rail text-mist/50"
                }`}
                title={seen ? `${feature} was in this position's input` : `${feature} was not read here`}
              >
                {formatFeatureKey(feature)}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
