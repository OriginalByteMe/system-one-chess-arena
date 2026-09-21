// The empty-season broadcast desk introduces real personas, never fake results.
import type { JSX } from "react";

import { SITE } from "../../../site.ts";
import { Footer } from "../Footer.tsx";
import { TopNav } from "../TopNav.tsx";
import { AgreementSpread } from "./AgreementSpread.tsx";
import { CalibrationCurve } from "./CalibrationCurve.tsx";
import { DecisionShape } from "./DecisionShape.tsx";
import { PlaystyleLever } from "./PlaystyleLever.tsx";
import { PersonaRoster } from "./RosterSample.tsx";
import { WhatToExpect } from "./WhatToExpect.tsx";
import { ROSTER } from "../../../../../src/players/roster.ts";
import { titleCase } from "../../../format.ts";
import { accentFor } from "../../../ui/accent.ts";
import { Sigil } from "../../../ui/Sigil.tsx";
import { PrimaryLink, SecondaryLink } from "../../../ui/chrome.tsx";

export function Landing(): JSX.Element {
  // An empty database still introduces the product, without fabricated results.

  return (
    <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
      <TopNav />

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-14 px-4 py-8 sm:gap-20 sm:px-8 sm:py-12">
        <section className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <div className="dashboard-intro flex flex-col items-start gap-6">
            <h1 className="font-display text-[clamp(2rem,3.4vw,3rem)] leading-[1.12] font-extrabold tracking-[-0.035em] text-balance">
              Same mind.<br /><span className="text-brand-hi">Different instincts.</span>
            </h1>
            <p className="max-w-[39ch] text-base leading-relaxed text-mist">
              AI personalities compete at chess. Watch the match, then see the choices behind every move.
            </p>
            <div className="flex flex-wrap gap-3">
              <PrimaryLink href="#roster">Meet the agents</PrimaryLink>
              <SecondaryLink href="#how-it-works">About Jev</SecondaryLink>
            </div>
            <p className="max-w-[42ch] border-t border-rail pt-5 text-sm leading-relaxed text-mist">
              The first season has not been published yet. Explore the personalities while the board is quiet.
            </p>
          </div>
          <div className="featured-board rounded-xl border border-rail bg-pit">
            <div className="flex items-center justify-between gap-3 border-b border-rail px-6 py-5">
              <h2 className="text-sm font-semibold">Meet the contenders</h2>
              <span className="text-xs text-mist">{ROSTER.length} personalities</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-rail">
              {ROSTER.filter((agent) => agent.name === "aggressor" || agent.name === "fortress").map((agent) => (
                <div key={agent.name} className="flex min-w-0 flex-col items-center px-4 py-8 text-center sm:px-6">
                  <Sigil name={agent.name} accent={accentFor(agent.name)} size={128} className="mb-5" />
                  <h3 className="text-lg font-bold tracking-[-0.025em]">{titleCase(agent.name)}</h3>
                  <p className="mt-3 text-xs leading-relaxed text-mist">{agent.playstyle}</p>
                </div>
              ))}
            </div>
            <p className="border-t border-rail px-6 py-4 text-xs leading-relaxed text-mist">
              One model. Different playstyle briefs. This is the cast, not a scheduled matchup.
            </p>
          </div>
        </section>

        <section id="standings" className="grid gap-6 border-y border-rail py-8 sm:grid-cols-2 sm:gap-12">
          <div>
            <h2 className="text-xl font-bold tracking-[-0.025em]">The competition starts here</h2>
            <p className="mt-3 max-w-[55ch] text-sm leading-relaxed text-mist">The leaderboard and elimination board will appear when a season is published. No standings are invented before a game is played.</p>
          </div>
          <div id="replays">
            <h2 className="text-xl font-bold tracking-[-0.025em]">Every match, worth another look</h2>
            <p className="mt-3 max-w-[55ch] text-sm leading-relaxed text-mist">No replays yet. Finished broadcasts will be available here, with the decisions behind each move.</p>
          </div>
        </section>

        <PersonaRoster />
        <DecisionShape />
        <details className="tournament-disclosure rounded-xl border border-rail bg-pit">
          <summary className="px-5 py-5 text-lg font-bold sm:px-6">Inside the {SITE.name} experiment</summary>
          <div className="flex flex-col gap-8 px-5 pb-6 sm:px-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <PlaystyleLever />
              <AgreementSpread />
            </div>
            <WhatToExpect />
            <section>
              <h2 className="text-xl font-bold">What is still open</h2>
              <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-mist">
                Not everything measured so far is a clean result. The declared board features did not change anything
                measurable, because a position-level number cannot say which move is the trap; per-move annotations
                are the fix, not yet built. Stated confidence is the other open question, below.
              </p>
            </section>
            <CalibrationCurve />
          </div>
        </details>
      </main>

      <Footer />
    </div>
  );
}
