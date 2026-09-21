// `/live/<gameId>` is the same broadcast as `/watch/<season>/<game>`, just
// opened before a season is known. The real page lives in Watch.tsx; this is
// only the route's entry point.
import type { JSX } from "react";

import { LiveBroadcast } from "./Watch.tsx";

export function Live({ gameId }: { readonly gameId: string }): JSX.Element {
  return <LiveBroadcast gameId={gameId} />;
}
