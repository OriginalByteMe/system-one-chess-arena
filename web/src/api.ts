import { useEffect, useState } from "react";

/**
 * Reads the gated read API.
 *
 * Every response is a plain JSON projection the server already sliced through
 * the spoiler gate, so the browser never filters anything itself. Polling is
 * how a broadcast animates: the server sets `Cache-Control: max-age` to the
 * next ply boundary, so a poll faster than that is served from cache.
 */

export interface Loaded<T> {
  readonly data?: T;
  readonly error?: string;
  readonly loading: boolean;
}

export function apiPath(...segments: readonly string[]): string {
  return `/api/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (response.status === 404) {
    throw new Error("Not found.");
  }
  if (!response.ok) {
    throw new Error(`The arena answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

/**
 * Fetches once, then again every `pollMs`. A poll that fails leaves the last
 * good data on screen, because a broadcast that flickers to an error page on
 * one dropped request is worse than a board that is two seconds stale.
 */
export function useJson<T>(path: string, pollMs?: number): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ loading: true });

  useEffect(() => {
    let live = true;
    let timer: number | undefined;

    const read = async (): Promise<void> => {
      try {
        const data = await getJson<T>(path);
        if (live) setLoaded({ data, loading: false });
      } catch (error) {
        if (live) {
          setLoaded((previous) =>
            previous.data === undefined
              ? { loading: false, error: String((error as Error).message) }
              : { ...previous, loading: false },
          );
        }
      }
      if (live && pollMs !== undefined) {
        timer = window.setTimeout(read, pollMs);
      }
    };

    setLoaded({ loading: true });
    void read();
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [path, pollMs]);

  return loaded;
}
