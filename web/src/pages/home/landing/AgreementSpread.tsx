// Shows why the personas are not the same player in different costumes: the
// gap between how much they disagree with each other and how much a single
// persona agrees with itself is the measurement, not noise.
import type { JSX } from "react";
import { motion, useReducedMotion } from "motion/react";

import { Card, CardHead } from "../../../ui/chrome.tsx";

function Track({
  label,
  from,
  to,
  accent,
  delay,
  reduced,
}: {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly accent: string;
  readonly delay: number;
  readonly reduced: boolean;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-mist">
        <span>{label}</span>
        <span className="tabular font-semibold text-chalk">
          {from}%–{to}%
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-rail">
        <motion.div
          className="absolute top-0 h-3 rounded-full"
          style={{ background: accent, left: `${from}%` }}
          initial={reduced ? false : { width: "0%" }}
          animate={{ width: `${to - from}%` }}
          transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

export function AgreementSpread(): JSX.Element {
  const reduced = useReducedMotion() ?? false;

  return (
    <Card>
      <CardHead title="Twenty different players, not one player in costumes" meta={<span>share of moves matched</span>} />
      <p className="mb-4 text-[13px] leading-relaxed text-mist">
        Ask the same persona the same position twice and it agrees with itself 92% to 100% of the time. Ask two
        different personas the same position and they agree 13% to 79% of the time. That gap is the whole point:
        the spread between personas is real, not sampling noise.
      </p>
      <div className="flex flex-col gap-4">
        <Track label="Different personas, same position" from={13} to={79} accent="var(--color-architect)" delay={0} reduced={reduced} />
        <Track label="Same persona, asked twice" from={92} to={100} accent="var(--color-brand)" delay={0.25} reduced={reduced} />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-mist">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </Card>
  );
}
