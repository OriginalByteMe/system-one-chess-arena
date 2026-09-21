// Traffic over a window of days, queried live from Analytics Engine. Bars are
// plain divs sized by share of the top row — no chart library, no sparkline.
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { analytics, type AnalyticsCount, type AnalyticsSummary } from "../../admin-api.ts";
import { percent } from "../../format.ts";
import { Card, CardHead } from "../../ui/chrome.tsx";

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly summary: AnalyticsSummary };

const DAY_OPTIONS: readonly number[] = [1, 7, 30, 90];

function CountBars({ title, rows }: { readonly title: string; readonly rows: readonly AnalyticsCount[] }): JSX.Element {
  const max = rows.reduce((highest, row) => Math.max(highest, row.requests), 0);
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-mist uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-mist">No events recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0 truncate text-mist">{row.label.length === 0 ? "(none)" : row.label}</span>
              <div className="h-3 flex-1 rounded bg-rail">
                <div
                  className="h-3 rounded bg-brand"
                  style={{ width: max === 0 ? "0%" : `${(row.requests / max) * 100}%` }}
                />
              </div>
              <span className="tabular w-14 shrink-0 text-right text-chalk">{row.requests}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AnalyticsPanel(): JSX.Element {
  const [days, setDays] = useState(7);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setLoad({ kind: "loading" });
    analytics(days)
      .then((summary) => {
        if (live) setLoad({ kind: "ready", summary });
      })
      .catch((error: unknown) => {
        if (live) setLoad({ kind: "error", message: String((error as Error).message) });
      });
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <Card>
      <CardHead
        title="Traffic"
        meta={
          <div className="flex items-center gap-1">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  option === days ? "bg-brand text-void" : "bg-rail text-mist hover:text-chalk"
                }`}
              >
                {option}d
              </button>
            ))}
          </div>
        }
      />

      {load.kind === "loading" && <p className="text-sm text-mist">Loading traffic…</p>}
      {load.kind === "error" && <p className="text-sm text-live">{load.message}</p>}

      {load.kind === "ready" && !load.summary.configured && (
        <p className="text-sm text-mist">Analytics is not configured.</p>
      )}

      {load.kind === "ready" && load.summary.configured && (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-mist uppercase">Requests</dt>
              <dd className="tabular text-lg font-bold text-chalk">{load.summary.totalRequests}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist uppercase">Error rate</dt>
              <dd className="tabular text-lg font-bold text-chalk">{percent(load.summary.errorRate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mist uppercase">p50 duration</dt>
              <dd className="tabular text-lg font-bold text-chalk">{Math.round(load.summary.durationP50Ms)} ms</dd>
            </div>
            <div>
              <dt className="text-xs text-mist uppercase">p95 duration</dt>
              <dd className="tabular text-lg font-bold text-chalk">{Math.round(load.summary.durationP95Ms)} ms</dd>
            </div>
          </dl>

          {load.summary.totalRequests === 0 ? (
            <p className="text-sm text-mist">No events recorded yet.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-mist uppercase">Per day</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rail text-left text-xs text-mist uppercase">
                      <th className="py-1 pr-3 font-semibold">Day</th>
                      <th className="py-1 pr-3 text-right font-semibold">Requests</th>
                      <th className="py-1 text-right font-semibold">Country/device combos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {load.summary.daily.map((point) => (
                      <tr key={point.date} className="border-b border-rail/60 last:border-0">
                        <td className="py-1 pr-3 text-mist">{point.date}</td>
                        <td className="tabular py-1 pr-3 text-right text-chalk">{point.requests}</td>
                        <td className="tabular py-1 text-right text-mist">{point.distinctContexts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CountBars title="Top routes" rows={load.summary.topRoutes} />
                <CountBars title="Top countries" rows={load.summary.topCountries} />
                <CountBars title="Device split" rows={load.summary.deviceSplit} />
                <CountBars title="Referrers" rows={load.summary.referrers} />
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
