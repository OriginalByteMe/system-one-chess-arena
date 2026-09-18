import { Bracket } from "./pages/Bracket.tsx";
import { Competitor } from "./pages/Competitor.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Index } from "./pages/Index.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { Live } from "./pages/Live.tsx";
import { Rivalry } from "./pages/Rivalry.tsx";
import { Watch } from "./pages/Watch.tsx";
import { parseRoute } from "./route.ts";

export function App() {
  const route = parseRoute(window.location.search);

  switch (route.kind) {
    case "index":
      return <Index />;
    case "live":
      return <Live gameId={route.gameId} />;
    case "watch":
      return <Watch seasonId={route.seasonId} gameId={route.gameId} />;
    case "dashboard":
      return <Dashboard seasonId={route.seasonId} />;
    case "leaderboard":
      return <Leaderboard seasonId={route.seasonId} />;
    case "bracket":
      return <Bracket bracketId={route.bracketId} />;
    case "competitor":
      return <Competitor competitor={route.competitor} />;
    case "rivalry":
      return <Rivalry competitor={route.competitor} opponent={route.opponent} />;
  }
}
