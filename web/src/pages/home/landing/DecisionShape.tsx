import type { JSX } from "react";

/** Shared by the dashboard and the empty-season landing page. */
export function DecisionShape(): JSX.Element {
  return (
    <section id="how-it-works" className="jev-explainer grid gap-8 border-y border-rail py-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14 lg:py-12">
      <div>
        <h2 className="font-display text-3xl font-bold tracking-[-0.025em] text-chalk sm:text-4xl">Meet the mind<br />behind the moves.</h2>
        <p className="mt-5 max-w-[48ch] text-sm leading-relaxed text-mist sm:text-base">
          Jev is a System One model from TypeSafe. Give it a situation and a set of choices; it returns a typed judgment with probabilities, rather than a chat response to interpret.
        </p>
        <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-mist sm:text-base">
          Here, the situation is a chess position. The choices are legal moves. Each agent’s playstyle is part of the input, so the same model can play very different opponents.
        </p>
        <a href="https://typesafe.ai" target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-10 items-center text-sm font-semibold text-brand-hi underline underline-offset-4 hover:text-chalk">Explore TypeSafe</a>
      </div>
      <div className="flex flex-col justify-center">
        <ol className="decision-pipeline">
          <li>
            <span className="pipeline-node" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></svg></span>
            <div><h3 className="font-semibold text-chalk">The board, through one personality</h3><p className="mt-1 text-sm leading-relaxed text-mist">Position, legal moves, recent history and the features this agent is allowed to see, together with its playstyle brief.</p></div>
          </li>
          <li>
            <span className="pipeline-node pipeline-node--jev" aria-hidden="true">J</span>
            <div><h3 className="font-semibold text-chalk">Jev weighs the choices</h3><p className="mt-1 text-sm leading-relaxed text-mist">The arena asks for a legal move and its probability distribution. Hierarchical agents also ask for a strategy; others use their declared default.</p></div>
          </li>
          <li>
            <span className="pipeline-node" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m8 6-5 6 5 6m8-12 5 6-5 6m-3-14-2 16" /></svg></span>
            <div><h3 className="font-semibold text-chalk">One turn. An inspectable record.</h3><p className="mt-1 text-sm leading-relaxed text-mist">The arena validates the move, applies a fallback if needed, then stores the decision. Switch between the distribution and raw JSON on the match screen.</p></div>
          </li>
        </ol>
        <p className="mt-6 text-xs leading-relaxed text-mist">Confidence is the model’s stated certainty, not a proven measure of move quality. Only revealed turns and finished results are public.</p>
      </div>
    </section>
  );
}
