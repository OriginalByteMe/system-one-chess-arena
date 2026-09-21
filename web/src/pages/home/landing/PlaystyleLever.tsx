// The one measured fact that justifies the whole product: the playstyle
// sentence, not the model underneath it, is what changes play. From eleven
// live experiments run against the engine on 2026-09-18.
import type { JSX } from "react";
import { motion, useReducedMotion } from "motion/react";

import { percent } from "../../../format.ts";
import { Card, CardHead } from "../../../ui/chrome.tsx";

function Bar({
  label,
  value,
  accent,
  delay,
  reduced,
}: {
  readonly label: string;
  readonly value: number;
  readonly accent: string;
  readonly delay: number;
  readonly reduced: boolean;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-mist">
        <span>{label}</span>
        <span className="tabular font-semibold text-chalk">{percent(value)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-rail">
        <motion.div
          className="h-full rounded-full"
          style={{ background: accent }}
          initial={reduced ? false : { width: "0%" }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

export function PlaystyleLever(): JSX.Element {
  const reduced = useReducedMotion() ?? false;

  return (
    <Card>
      <CardHead title="One sentence moves most of the board" meta={<span>eleven live experiments, 2026-09-18</span>} />
      <p className="mb-4 text-[13px] leading-relaxed text-mist">
        Every persona runs the same engine. The playstyle sentence is the only lever that measurably changes how
        it plays: rewriting one sentence changed the move Jev picked on 58% of positions tested, and changed the
        declared strategy on every position tested.
      </p>
      <div className="flex flex-col gap-3">
        <Bar label="Moves that changed" value={0.58} accent="var(--color-brand)" delay={0} reduced={reduced} />
        <Bar
          label="Positions where the declared strategy flipped"
          value={1}
          accent="var(--color-gold)"
          delay={0.15}
          reduced={reduced}
        />
      </div>
    </Card>
  );
}
