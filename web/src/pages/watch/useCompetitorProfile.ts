import { useEffect, useState } from "react";

import { apiPath, getJson, type Loaded } from "../../api.ts";
import type { CompetitorProfile } from "../../../../src/core/types.ts";

/**
 * Fetches a competitor's profile once, for the walkout card and mind panel.
 *
 * Contract: unlike the game itself, this never polls — a competitor's
 * lineage and season record do not change while a single broadcast plays.
 * A failed or missing fetch resolves to no data rather than throwing, so a
 * profile outage degrades the page instead of blocking the board.
 */
export function useCompetitorProfile(name: string | undefined): Loaded<CompetitorProfile> {
  const [loaded, setLoaded] = useState<Loaded<CompetitorProfile>>({ loading: name !== undefined });

  useEffect(() => {
    if (name === undefined) {
      setLoaded({ loading: false });
      return undefined;
    }
    let live = true;
    setLoaded({ loading: true });
    getJson<CompetitorProfile>(apiPath("competitors", name))
      .then((data) => {
        if (live) setLoaded({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (live) setLoaded({ loading: false, error: String((error as Error).message) });
      });
    return () => {
      live = false;
    };
  }, [name]);

  return loaded;
}
