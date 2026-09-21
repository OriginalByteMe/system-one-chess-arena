// The complete persona catalog. When a season is available, its registered
// manifest wins so historical briefs remain the briefs that actually played.
import { useState, type JSX } from "react";
import { useReducedMotion } from "motion/react";

import { ROSTER } from "../../../../../src/players/roster.ts";
import type { SiteCompetitor, SiteView } from "../../../../../src/api/site.ts";
import { MAX_ACTIVE_TRAITS, TRAIT_RULES } from "../../../../../src/rivalry/traits.ts";
import { titleCase } from "../../../format.ts";
import { href } from "../../../route.ts";
import { accentFor } from "../../../ui/accent.ts";
import { Sigil } from "../../../ui/Sigil.tsx";

interface PersonaRosterProps {
  readonly view?: SiteView;
}

interface PersonaEntry extends Pick<SiteCompetitor, "name" | "playstyle" | "strategies" | "budgetMs"> {
  readonly registered: boolean;
  readonly catalogPersona: boolean;
  readonly rank?: number;
  readonly elo?: number;
}

function seasonEntry(
  competitor: SiteCompetitor,
  view: SiteView,
  catalogPersona: boolean,
): PersonaEntry {
  const rankIndex = view.leaderboard.rows.findIndex((row) => row.competitor === competitor.name);
  const row = rankIndex < 0 ? undefined : view.leaderboard.rows[rankIndex];

  return {
    name: competitor.name,
    playstyle: competitor.playstyle,
    strategies: competitor.strategies,
    budgetMs: competitor.budgetMs,
    registered: true,
    catalogPersona,
    ...(row === undefined ? {} : { rank: rankIndex + 1, elo: row.elo }),
  };
}

function entriesFor(view: SiteView | undefined): readonly PersonaEntry[] {
  const registered = new Map(view?.competitors.map((competitor) => [competitor.name, competitor] as const));
  const catalog = ROSTER.map((competitor): PersonaEntry => {
    const entrant = registered.get(competitor.name);
    return entrant !== undefined && view !== undefined
      ? seasonEntry(entrant, view, true)
      : {
          name: competitor.name,
          playstyle: competitor.playstyle,
          strategies: competitor.strategies,
          budgetMs: competitor.budget.maxMs,
          registered: false,
          catalogPersona: true,
        };
  });
  const additional = view?.competitors
    .filter((competitor) => !ROSTER.some((persona) => persona.name === competitor.name))
    .map((competitor) => seasonEntry(competitor, view, false)) ?? [];

  return [...catalog, ...additional];
}

export function PersonaRoster({ view }: PersonaRosterProps): JSX.Element {
  const reducedMotion = useReducedMotion() ?? false;
  const [replayKeys, setReplayKeys] = useState<Readonly<Record<string, number>>>({});
  const [traitId, setTraitId] = useState(TRAIT_RULES[0]?.id ?? "");
  const trait = TRAIT_RULES.find((rule) => rule.id === traitId);
  const example = ROSTER[0];
  const entries = entriesFor(view);
  const registeredCount = view?.competitors.length ?? 0;

  return (
    <section id="roster" className="min-w-0">
      <div className="mb-7">
        <h2 className="text-3xl font-bold tracking-[-0.03em]">Meet the {ROSTER.length} personalities</h2>
        <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-mist">
          One engine, a different instinct in every corner.
          {view === undefined ? " Explore the complete cast." : ` ${registeredCount} agents are registered this season.`}
          {" "}Season entrants show the briefs they actually played with.
        </p>
      </div>
      {trait === undefined || example === undefined ? null : (
        <details className="mb-7 rounded-xl border border-rail bg-pit px-5">
          <summary className="py-4 text-sm font-semibold">How personalities, strategies and rivalry traits work</summary>
          <div className="border-t border-rail py-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-[65ch]">
              <h3 id="trait-guide-title" className="text-lg font-bold text-chalk">Personality is the starting point. Traits come from rivalries.</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist">A personality is its fixed playstyle. Strategy options are the directions it can choose, such as attacking or defending. Traits are opponent-specific instructions triggered by recorded results, not skill points.</p>
            </div>
            <label className="flex flex-col gap-2 text-sm font-semibold text-chalk">
              Explore a trait
              <select value={traitId} onChange={(event) => setTraitId(event.currentTarget.value)} className="min-h-11 rounded-lg border border-rail bg-pit px-3 py-2 text-chalk focus-visible:outline-2 focus-visible:outline-brand-hi">
                {TRAIT_RULES.map((rule) => <option key={rule.id} value={rule.id}>{rule.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1.2fr] lg:items-center">
            <div>
              <p className="font-semibold text-chalk">{titleCase(example.name)}&apos;s personality</p>
              <p className="mt-2 text-sm leading-relaxed text-mist">{example.playstyle}</p>
            </div>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 justify-self-center text-mist" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14" /></svg>
            <div>
              <p className="font-semibold text-brand-hi">{trait.label}</p>
              <p className="mt-2 text-sm leading-relaxed text-mist">{trait.description}</p>
            </div>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 rotate-90 justify-self-center text-mist lg:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>
            <div className="border-t border-rail pt-4 lg:border-t-0 lg:pt-0">
              <p className="font-semibold text-chalk">Added instructions for this opponent</p>
              <p className="mt-2 text-sm leading-relaxed text-mist">&ldquo;{trait.playstyleSuffix.trim()}&rdquo;</p>
            </div>
          </div>
          <p className="mt-6 max-w-[78ch] text-xs leading-relaxed text-mist">
            This is an example, not a claim that {titleCase(example.name)} currently has this trait. Jev receives the updated brief when choosing a legal move. Up to {MAX_ACTIVE_TRAITS} traits can apply in a matchup; they also prioritize strategy options the agent already has. They do not change its time allowance or guarantee a win.
          </p>
          </div>
        </details>
      )}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {entries.map((competitor) => {
          const replayKey = replayKeys[competitor.name] ?? 0;
          const portrait = (
            <Sigil
              key={`${competitor.name}-${replayKey}`}
              name={competitor.name}
              accent={accentFor(competitor.name)}
              size={112}
              className="shrink-0"
            />
          );

          return (
            <li key={competitor.name} className="flex min-w-0 flex-col gap-4 rounded-xl border border-rail bg-pit p-5">
              {reducedMotion ? (
                <div className="flex flex-col items-center gap-2">
                  {portrait}
                  <span className="text-xs font-semibold text-mist">Static portrait</span>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Replay ${titleCase(competitor.name)} animation`}
                  onClick={() => {
                    setReplayKeys((current) => ({
                      ...current,
                      [competitor.name]: (current[competitor.name] ?? 0) + 1,
                    }));
                  }}
                  className="group flex min-h-11 flex-col items-center gap-2 rounded-lg text-xs font-semibold text-mist outline-none transition-colors hover:text-chalk focus-visible:ring-2 focus-visible:ring-brand-hi focus-visible:ring-offset-2 focus-visible:ring-offset-deck"
                >
                  {portrait}
                  <span className="underline decoration-rail underline-offset-4 group-hover:decoration-current">
                    Replay animation
                  </span>
                </button>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {competitor.registered && view !== undefined ? (
                    <a
                      href={href({ kind: "competitor", competitor: competitor.name })}
                      className="text-[15px] font-bold text-chalk hover:text-brand-hi"
                    >
                      {titleCase(competitor.name)}
                    </a>
                  ) : (
                    <span className="text-[15px] font-bold text-chalk">{titleCase(competitor.name)}</span>
                  )}
                  <span className="text-xs font-semibold text-mist">
                    {competitor.registered
                      ? competitor.catalogPersona ? "Registered this season" : "Additional season entrant"
                      : view === undefined ? "Catalog persona" : "Catalog persona · not entered this season"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-mist">&ldquo;{competitor.playstyle}&rdquo;</p>
                <p className="mt-3 text-xs leading-relaxed text-mist">
                  <span className="font-semibold text-chalk">Strategy options: </span>
                  {competitor.strategies.map(titleCase).join(" · ")}
                </p>
                <details className="mt-3 text-xs leading-relaxed text-mist">
                  <summary className="w-fit cursor-pointer py-2 font-semibold text-chalk">Settings &amp; record</summary>
                  <p className="mt-2"><span className="font-semibold text-chalk">Response allowance: </span>{competitor.budgetMs / 1000} seconds per move.</p>
                  <p className="mt-1">If the model takes longer, the arena replaces its answer with a legal fallback move. This is not the match clock or its usual thinking time.</p>
                  {competitor.rank === undefined ? null : (
                    <p className="mt-3">Season rank: {competitor.rank}{competitor.elo === undefined ? "" : ` · Elo rating: ${Math.round(competitor.elo)}`}. These measure recorded results, not personality.</p>
                  )}
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
