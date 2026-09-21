// The operator console, behind Cloudflare Access. A tool, not a broadcast: it
// favours dense tables over hero treatment, and every number comes straight
// from /api/admin/* through web/src/admin-api.ts.
import { useState } from "react";
import type { JSX } from "react";

import { SITE } from "../site.ts";
import { BoardMark } from "./home/TopNav.tsx";
import { AnalyticsPanel } from "./admin/AnalyticsPanel.tsx";
import { CampaignPanel } from "./admin/CampaignPanel.tsx";
import { SeasonGamesPanel } from "./admin/SeasonGamesPanel.tsx";
import { SeasonsPanel } from "./admin/SeasonsPanel.tsx";
import { WhoAmIPanel } from "./admin/WhoAmIPanel.tsx";

export function Admin(): JSX.Element {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | undefined>(undefined);

  return (
    <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
      <header className="flex items-center gap-2 bg-pit px-4 py-2.5 sm:px-6">
        <BoardMark />
        <span className="text-[15px] leading-tight font-extrabold text-chalk">
          {SITE.name} <span className="text-mist">Operator Console</span>
        </span>
        <a href="/" className="ml-auto text-sm font-semibold text-mist hover:text-chalk">
          Back to site
        </a>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <WhoAmIPanel />
        <CampaignPanel />
        <SeasonsPanel selectedSeasonId={selectedSeasonId} onSelectSeason={setSelectedSeasonId} />
        <SeasonGamesPanel seasonId={selectedSeasonId} />
        <AnalyticsPanel />
      </main>
    </div>
  );
}
