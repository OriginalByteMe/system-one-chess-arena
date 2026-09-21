import type { JSX } from "react";

import { Admin } from "./pages/Admin.tsx";
import { Bracket } from "./pages/Bracket.tsx";
import { Competitor } from "./pages/Competitor.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Home } from "./pages/Home.tsx";
import { Leaderboard } from "./pages/Leaderboard.tsx";
import { Live } from "./pages/Live.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Privacy } from "./pages/Privacy.tsx";
import { Rivalry } from "./pages/Rivalry.tsx";
import { Watch } from "./pages/Watch.tsx";
import { parseRoute } from "./route.ts";

export function App(): JSX.Element {
  const route = parseRoute(window.location.pathname, window.location.search);

  switch (route.kind) {
    case "home":
      return <Home />;
    case "live":
      return <Live gameId={route.gameId} />;
    case "watch":
      return <Watch seasonId={route.seasonId} gameId={route.gameId} />;
    case "season":
      return <Dashboard seasonId={route.seasonId} />;
    case "leaderboard":
      return <Leaderboard seasonId={route.seasonId} />;
    case "bracket":
      return <Bracket bracketId={route.bracketId} />;
    case "competitor":
      return <Competitor competitor={route.competitor} />;
    case "rivalry":
      return <Rivalry competitor={route.competitor} opponent={route.opponent} />;
    case "privacy":
      return <Privacy />;
    case "admin":
      return <Admin />;
    case "notFound":
      return <NotFound path={route.path} />;
  }
}
