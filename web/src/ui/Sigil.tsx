// Eight-frame vector strips traced from the supplied character sheet.
// Keep the shared avatar contract so every roster, match and profile uses them.
import { useState, type JSX } from "react";
import { motion, useReducedMotion } from "motion/react";

import aggressor from "../assets/personas/aggressor.svg";
import architect from "../assets/personas/architect.svg";
import mason from "../assets/personas/mason.svg";
import ledger from "../assets/personas/ledger.svg";
import economist from "../assets/personas/economist.svg";
import blitzen from "../assets/personas/blitzen.svg";
import gambit from "../assets/personas/gambit.svg";
import fortress from "../assets/personas/fortress.svg";
import vulture from "../assets/personas/vulture.svg";
import metronome from "../assets/personas/metronome.svg";
import swindler from "../assets/personas/swindler.svg";
import hermit from "../assets/personas/hermit.svg";
import scholar from "../assets/personas/scholar.svg";
import surgeon from "../assets/personas/surgeon.svg";
import anvil from "../assets/personas/anvil.svg";
import tinker from "../assets/personas/tinker.svg";
import mirror from "../assets/personas/mirror.svg";
import compass from "../assets/personas/compass.svg";
import hourglass from "../assets/personas/hourglass.svg";
import sentry from "../assets/personas/sentry.svg";
import "./Sigil.css";

export interface SigilProps {
  readonly name: string;
  readonly accent: string;
  readonly size?: number;
  /** Gives the persona two quicker cycles of its decision gesture. */
  readonly thinking?: boolean;
  /** 0..1, fills the confidence meter when supplied while thinking. */
  readonly charge?: number;
  readonly className?: string;
}

const SPRITES: Readonly<Record<string, string>> = {
  aggressor, architect, mason, ledger, economist, blitzen,
  blitzkrieg: blitzen,
  gambit, fortress, vulture, metronome, swindler, hermit, scholar,
  surgeon, anvil, tinker, mirror, compass, hourglass, sentry,
};

export function Sigil({ name, accent, size = 64, thinking = false, charge, className }: SigilProps): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const [inView, setInView] = useState(false);
  const sprite = Object.hasOwn(SPRITES, name) ? SPRITES[name] : undefined;
  const meter = typeof charge === "number" && Number.isFinite(charge) ? Math.min(Math.max(charge, 0), 1) : undefined;
  const activeGesture = thinking ? "thinking" : "gesture";

  return (
    <motion.svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`sigil ${className ?? ""}`}
      role="img"
      aria-label={`${name || "agent"} avatar`}
      focusable="false"
      data-in-view={inView && !reduced}
      data-thinking={thinking}
      initial={reduced ? false : "rest"}
      animate="rest"
      whileInView={reduced ? undefined : activeGesture}
      whileHover={reduced ? undefined : "thinking"}
      onViewportEnter={() => setInView(true)}
      onViewportLeave={() => setInView(false)}
      viewport={{ once: false, amount: 0.45 }}
    >
      <rect
        x={1}
        y={1}
        width={46}
        height={46}
        rx={11}
        fill="#f3f3ed"
        stroke={accent}
        strokeWidth={thinking ? 2 : 1.3}
      />
      {sprite === undefined ? (
        <g stroke="#1a221f" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <circle cx={24} cy={15} r={5} />
          <path d="M24 20v9m0-6-7-3m7 3 7-3m-7 9-5 9m5-9 5 9" />
          <path d="M22 16q2 2 4 0" strokeWidth={1} />
        </g>
      ) : (
        <svg x={6} y={3} width={36} height={39} viewBox="0 0 96 112" overflow="hidden" aria-hidden="true">
          <image className="sigil-strip" key={sprite} href={sprite} width={768} height={112} />
        </svg>
      )}
      {thinking ? (
        <motion.g
          fill={accent}
          stroke="none"
          opacity={reduced ? 0.72 : undefined}
          variants={
            reduced
              ? undefined
              : {
                  rest: { opacity: 0.72, scale: 1 },
                  gesture: { opacity: [0.35, 1, 0.35], scale: [0.92, 1.08, 0.92], transition: { duration: 1.25 } },
                  thinking: {
                    opacity: [0.35, 1, 0.35],
                    scale: [0.92, 1.08, 0.92],
                    transition: { duration: 1.25, repeat: 1, ease: "easeInOut" },
                  },
                }
          }
          style={{ transformOrigin: "39px 8px" }}
          aria-hidden="true"
        >
          <circle cx={37.2} cy={10.2} r={1.25} />
          <circle cx={40.2} cy={7} r={1.7} />
        </motion.g>
      ) : null}
      {thinking && meter !== undefined ? (
        <>
          <path d="M9 43.2 L39 43.2" stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.2} />
          <motion.path
            d="M9 43.2 L39 43.2"
            stroke={accent}
            strokeWidth={2}
            strokeLinecap="round"
            pathLength={1}
            initial={false}
            animate={{ pathLength: meter }}
            transition={reduced ? { duration: 0 } : { duration: 0.28, ease: "easeOut" }}
          />
        </>
      ) : null}
    </motion.svg>
  );
}
