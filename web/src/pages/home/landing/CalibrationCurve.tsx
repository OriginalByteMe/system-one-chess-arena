// The one honest negative result on the page: stated confidence does not yet
// predict mistakes. The schematic below is not a plotted measurement — this
// site does not have enough decisive games to plot one yet — it illustrates
// what a working calibration curve would look like against what "no signal"
// looks like, so the open experiment reads as a diagram, not a number.
import type { JSX } from "react";
import { motion, useReducedMotion } from "motion/react";

const NOISE = "M4 60 L24 52 L44 61 L64 47 L84 58 L104 44 L124 60 L144 50 L164 62 L176 55";

export function CalibrationCurve(): JSX.Element {
  const reduced = useReducedMotion() ?? false;

  return (
    <div className="rounded-md bg-deck p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] leading-none font-bold text-chalk">Confidence does not predict mistakes yet</h2>
        <span className="text-xs text-mist">open experiment</span>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-mist">
        Every decision on this site comes with a stated confidence number. The calibration curve that would check
        whether high confidence means fewer mistakes is honest arithmetic over numbers that carry no signal so
        far, so it is shown here as an open experiment, not a score. Six of six recorded games so far ended in a
        draw by repetition or move limit, not resignation or checkmate, so there are not yet enough decisive
        positions to test the question properly.
      </p>
      {/* The legend is HTML, not <text>: a viewBox unit scales with the card,
          so an in-SVG label rendered at roughly 60px on a desktop. */}
      <svg
        viewBox="0 0 180 80"
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label="Schematic: a working calibration curve would climb the diagonal; the recorded numbers so far are flat, meaning no signal."
      >
        <line x1="4" y1="76" x2="4" y2="4" stroke="var(--color-rail)" strokeWidth={1} />
        <line x1="4" y1="76" x2="176" y2="76" stroke="var(--color-rail)" strokeWidth={1} />
        <motion.path
          d="M4 76 L176 4"
          stroke="var(--color-mist)"
          strokeWidth={1.4}
          strokeDasharray="4 3"
          fill="none"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.path
          d={NOISE}
          stroke="var(--color-live)"
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        <span className="flex items-center gap-2 text-mist">
          <span className="w-6 border-t-2 border-dashed border-mist" aria-hidden="true" />
          if confidence predicted mistakes
        </span>
        <span className="flex items-center gap-2 text-live">
          <span className="w-6 border-t-2 border-live" aria-hidden="true" />
          what the recorded numbers look like
        </span>
      </div>
      <p className="mt-2 text-[11px] text-mist">
        Schematic, not measured data: axes are unlabelled because the recorded sample is too small to plot.
      </p>
    </div>
  );
}
