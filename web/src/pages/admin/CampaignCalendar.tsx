// A day-by-day list of what the campaign plays. Actual and projected days
// carry the same shape so the list reads as one continuous schedule; the
// distinction between what already happened and what is forecast is spelled
// out in words on every row, not just by colour.
import type { JSX } from "react";

import type { CalendarDay, ScheduledMatch } from "../../admin-api.ts";

function matchStatusLabel(status: ScheduledMatch["status"]): string {
  if (status === "played") return "Played";
  if (status === "playing") return "Playing";
  return "Scheduled";
}

export function CampaignCalendar({ days }: { readonly days: readonly CalendarDay[] }): JSX.Element | null {
  if (days.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-rail pt-3">
      <p className="text-xs text-mist">
        Rows marked "Projected" are a forecast of what plays next, not something that has happened yet.
      </p>
      <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
        {days.map((day) => (
          <li key={day.day} className="rounded border border-rail bg-pit px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist uppercase">
              <span>
                {day.day} · season {day.seasonIndex + 1}
              </span>
              <span className={day.projected ? "font-semibold text-gold" : "text-mist"}>
                {day.projected ? "Projected" : "Played"}
              </span>
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {day.matches.map((match) => (
                <li key={match.matchId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-chalk">
                    {match.a} vs {match.b}
                  </span>
                  <span className="text-xs text-mist">{matchStatusLabel(match.status)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
