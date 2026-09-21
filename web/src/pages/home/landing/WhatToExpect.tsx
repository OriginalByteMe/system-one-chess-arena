// Point three of the explainer: what a visitor actually gets once a season
// starts recording. Plain description of the format, no infographic needed
// because the shape is already visible once a season exists.
import type { JSX } from "react";

export function WhatToExpect(): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[1.5rem] leading-tight font-extrabold tracking-[-0.015em] text-chalk">
        What to expect once a season starts
      </h2>
      <p className="max-w-[68ch] text-[15px] leading-relaxed text-mist">
        A season is a single-elimination bracket. Matches are best of two games, with colours swapped between
        them so neither side plays white twice. Games play out one ply at a time on a shared broadcast clock, and
        a result stays hidden from the site until the clock reaches it, so nobody watching can see the ending
        early. One round plays each day. Finished seasons stay up and browsable as replays, move by move, with
        the declared strategy and confidence attached to every one.
      </p>
    </section>
  );
}
