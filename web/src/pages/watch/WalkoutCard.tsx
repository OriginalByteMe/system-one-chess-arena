// The two cards that bracket a broadcast: the walkout, where both minds
// slide in from their own side of the screen and meet over the VS, and the
// result card that names the winner (or the draw) once the outcome is
// revealed. Both sit over the live board rather than replacing it, so the
// board is already behind the glass when the card lifts. Both are dismissible
// by mouse or keyboard.
import { useEffect } from "react";
import type { JSX } from "react";
import { motion } from "motion/react";

import type { GameResult, TerminalReason } from "../../../../src/core/types.ts";
import { titleCase } from "../../format.ts";
import { Sigil } from "../../ui/Sigil.tsx";

export interface WalkoutPersona {
  readonly name: string;
  readonly accent: string;
  /** Absent until the competitor's profile has loaded, or if it never does. */
  readonly elo?: number;
  readonly playstyle?: string;
}

interface WalkoutProps {
  readonly kind: "walkout";
  readonly white: WalkoutPersona;
  readonly black: WalkoutPersona;
  readonly seasonId?: string;
  readonly gameId: string;
  readonly reduced: boolean;
  readonly onSkip: () => void;
}

interface ResultProps {
  readonly kind: "result";
  readonly white: WalkoutPersona;
  readonly black: WalkoutPersona;
  readonly result: GameResult;
  readonly reason: TerminalReason;
  readonly plies: number;
  readonly adjudicatedCp?: number;
  readonly reduced: boolean;
  readonly onSkip: () => void;
}

export type WalkoutCardProps = WalkoutProps | ResultProps;

function Corner({
  persona,
  side,
  reduced,
}: {
  readonly persona: WalkoutPersona;
  readonly side: "left" | "right";
  readonly reduced: boolean;
}): JSX.Element {
  const from = side === "left" ? -140 : 140;
  return (
    <motion.div
      className="flex min-w-0 flex-col items-center gap-2"
      initial={reduced ? { opacity: 1, x: 0 } : { opacity: 0, x: from }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? { duration: 0.05 } : { type: "spring", stiffness: 90, damping: 16 }}
    >
      <Sigil name={persona.name} accent={persona.accent} size={100} thinking />
      <span
        className="max-w-full break-words font-display text-[clamp(16px,4.2vw,34px)] leading-none font-black tracking-[-0.02em]"
        style={{ color: persona.accent }}
      >
        {titleCase(persona.name)}
      </span>
      <span className="tabular text-[11px] font-semibold text-mist">
        {persona.elo === undefined ? "Elo unrated yet" : `${persona.elo} elo`}
      </span>
      {persona.playstyle !== undefined && (
        <span className="max-w-[15rem] text-center text-[11px] leading-relaxed text-mist italic">
          &ldquo;{persona.playstyle}&rdquo;
        </span>
      )}
    </motion.div>
  );
}

export function WalkoutCard(props: WalkoutCardProps): JSX.Element {
  const { reduced, onSkip } = props;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSkip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip]);

  const winner =
    props.kind === "result" && props.result !== "draw" ? (props.result === "white" ? props.white : props.black) : undefined;
  const loser =
    props.kind === "result" && props.result !== "draw" ? (props.result === "white" ? props.black : props.white) : undefined;

  return (
    <motion.div
      className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-void/95 px-3 py-5 text-center sm:px-6"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.05 : 0.3 }}
    >
      <div className="my-auto flex w-full max-w-5xl flex-col items-center gap-5 rounded-xl border border-rail/70 bg-deck px-4 py-6 sm:px-8 sm:py-8">
        {props.kind === "walkout" ? (
          <>
            <div className="flex items-center gap-3 text-[11px] font-semibold tracking-wide text-mist uppercase">
              <span className="h-px w-8 bg-rail" aria-hidden="true" />
              <span>
                {props.seasonId === undefined
                  ? `Game ${props.gameId}`
                  : `Season ${props.seasonId} · game ${props.gameId}`}
              </span>
              <span className="h-px w-8 bg-rail" aria-hidden="true" />
            </div>
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-8">
              <Corner persona={props.white} side="left" reduced={reduced} />
              <motion.span
                className="font-display text-xl leading-none font-black text-mist sm:text-4xl"
                initial={reduced ? { scale: 1, opacity: 1 } : { scale: 1.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  reduced
                    ? { duration: 0.05 }
                    : { delay: 0.2, type: "spring", stiffness: 180, damping: 14 }
                }
              >
                Vs
              </motion.span>
              <Corner persona={props.black} side="right" reduced={reduced} />
            </div>
            <p className="text-xs leading-relaxed text-mist">
              White plays {titleCase(props.white.name)} · black plays {titleCase(props.black.name)}
            </p>
          </>
        ) : (
          <>
            {winner === undefined ? (
              <div className="flex items-center gap-5">
                <Sigil name={props.white.name} accent={props.white.accent} size={84} thinking />
                <Sigil name={props.black.name} accent={props.black.accent} size={84} thinking />
              </div>
            ) : (
              <motion.div
                initial={reduced ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={reduced ? { duration: 0.05 } : { type: "spring", stiffness: 200, damping: 16 }}
              >
                <Sigil name={winner.name} accent={winner.accent} size={112} thinking />
              </motion.div>
            )}
            <h2
              className="font-display text-[clamp(28px,7vw,64px)] leading-none font-extrabold tracking-[-0.03em]"
              style={{
                color: winner?.accent ?? "var(--color-gold)",
              }}
            >
              {props.result === "draw" ? "Draw" : titleCase(props.reason)}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-mist sm:text-base">
              {winner === undefined || loser === undefined
                ? `${titleCase(props.white.name)} and ${titleCase(props.black.name)} draw by ${titleCase(props.reason)} after ${props.plies} recorded decisions`
                : `${titleCase(winner.name)} beats ${titleCase(loser.name)} by ${titleCase(props.reason)} after ${props.plies} recorded decisions`}
              {props.adjudicatedCp === undefined
                ? ""
                : ` · adjudicated at ${(props.adjudicatedCp / 100).toFixed(2)} pawns`}
            </p>
          </>
        )}

        <button
          type="button"
          autoFocus
          onClick={onSkip}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 py-3 text-sm font-bold text-void transition-colors hover:bg-brand-hi"
        >
          {props.kind === "walkout" ? "Skip to the board" : "Back to the board"}
        </button>
      </div>
    </motion.div>
  );
}
