import { useMemo, useState } from "react";
import type { JSX } from "react";

import type { DecisionRecord } from "../../../../src/core/types.ts";
import { percent, seconds, titleCase } from "../../format.ts";
import { formatUci } from "../../ui/board/format.ts";

type InspectorMode = "stats" | "raw";

interface TurnInspectorProps {
  readonly decision: DecisionRecord | undefined;
  readonly accent: string | undefined;
}

function Fact({ label, children }: { readonly label: string; readonly children: string }): JSX.Element {
  return (
    <div className="min-w-0 border-b border-rail/60 pb-2.5">
      <dt className="text-[11px] font-semibold tracking-wide text-mist uppercase">{label}</dt>
      <dd className="tabular mt-1 break-words text-sm font-semibold text-chalk">{children}</dd>
    </div>
  );
}

export function TurnInspector({ decision, accent }: TurnInspectorProps): JSX.Element {
  const [mode, setMode] = useState<InspectorMode>("stats");
  const distribution = useMemo(
    () =>
      decision?.distribution === undefined
        ? undefined
        : Object.entries(decision.distribution).sort(([, left], [, right]) => right - left),
    [decision],
  );

  return (
    <section className="w-full rounded-xl border border-rail/70 bg-deck p-4 sm:p-5" aria-labelledby="turn-record-heading">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="turn-record-heading" className="font-display text-lg leading-tight font-bold text-chalk">
            Turn record
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-mist">
            {decision === undefined
              ? "No revealed decision is selected yet."
              : `Ply ${decision.ply} · ${titleCase(decision.competitor)} playing ${decision.colour}`}
          </p>
        </div>
        <div className="grid min-h-11 shrink-0 grid-cols-2 rounded-lg border border-rail bg-pit p-1" role="group" aria-label="Turn record view">
          <button
            type="button"
            aria-pressed={mode === "stats"}
            onClick={() => setMode("stats")}
            className={`min-h-9 rounded-md px-3 text-xs font-bold transition-colors ${
              mode === "stats" ? "bg-brand text-void" : "text-mist hover:bg-rail/60 hover:text-chalk"
            }`}
          >
            Stats
          </button>
          <button
            type="button"
            aria-pressed={mode === "raw"}
            onClick={() => setMode("raw")}
            className={`min-h-9 rounded-md px-3 text-xs font-bold transition-colors ${
              mode === "raw" ? "bg-brand text-void" : "text-mist hover:bg-rail/60 hover:text-chalk"
            }`}
          >
            Raw JSON
          </button>
        </div>
      </header>

      {mode === "raw" ? (
        <p className="mt-4 border-t border-rail/60 pt-3 text-xs leading-relaxed text-mist">
          The stored decision for this turn. The original provider HTTP response is not saved.
        </p>
      ) : null}

      <div className="mt-4">
        {decision === undefined ? (
          <div className="rounded-lg border border-dashed border-rail px-3 py-8 text-center text-sm text-mist">
            {mode === "raw"
              ? "There is no stored JSON to show."
              : "Stats will appear after the first move is revealed."}
          </div>
        ) : mode === "raw" ? (
          <pre
            tabIndex={0}
            aria-label={`Stored DecisionRecord for ply ${decision.ply}`}
            className="tabular max-h-[34rem] max-w-full overflow-auto rounded-lg border border-rail/60 bg-pit p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-chalk [overflow-wrap:anywhere] sm:text-xs"
          >
            {JSON.stringify(decision, null, 2)}
          </pre>
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              <Fact label="Played">{formatUci(decision.move)}</Fact>
              <Fact label="Strategy">{titleCase(decision.strategy)}</Fact>
              <Fact label="Confidence">
                {decision.confidence === undefined ? "Not stored" : percent(decision.confidence)}
              </Fact>
              <Fact label="Thought for">{seconds(decision.latencyMs)}</Fact>
              <Fact label="Legal moves">{String(decision.legalMoveCount)}</Fact>
              <Fact label="Tokens">
                {decision.tokens === undefined ? "Not stored" : `${decision.tokens.in} in · ${decision.tokens.out} out`}
              </Fact>
              <Fact label="Fallback">{decision.fallback === undefined ? "None" : titleCase(decision.fallback)}</Fact>
              <Fact label="Version (prefix)">{decision.version.slice(0, 10)}</Fact>
            </dl>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold text-chalk">Move distribution</h3>
                {distribution !== undefined && (
                  <span className="text-[11px] text-mist">
                    {distribution.length} stored candidate{distribution.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {distribution === undefined ? (
                <p className="mt-2 rounded-lg border border-rail/60 bg-pit px-3 py-2 text-xs text-mist">
                  No move distribution was stored.
                </p>
              ) : distribution.length === 0 ? (
                <p className="mt-2 rounded-lg border border-rail/60 bg-pit px-3 py-2 text-xs text-mist">
                  The stored distribution is empty.
                </p>
              ) : (
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {distribution.map(([move, probability]) => {
                    const played = move === decision.move;
                    return (
                      <li key={move} className="grid min-h-10 grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2 border-b border-rail/50 px-1">
                        <span className={`tabular text-xs ${played ? "font-bold text-chalk" : "text-mist"}`}>
                          {formatUci(move)}
                          {played && <span className="sr-only"> (played)</span>}
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-rail" aria-hidden="true">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(0, Math.min(probability * 100, 100))}%`,
                              backgroundColor: played ? (accent ?? "var(--color-brand)") : "var(--color-mist)",
                            }}
                          />
                        </span>
                        <span className="tabular text-right text-xs text-mist">{percent(probability)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-xs font-bold text-chalk">Features received</h3>
              {decision.featuresSeen.length === 0 ? (
                <p className="mt-2 text-xs text-mist">No features were recorded for this turn.</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {decision.featuresSeen.map((feature) => (
                    <li key={feature} className="rounded-md border border-rail px-2 py-1 text-[11px] text-mist">
                      {feature}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
