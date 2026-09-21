import { useEffect, useState } from "react";

/**
 * Reads the gated read API.
 *
 * Every response is a plain JSON projection the server already sliced through
 * the spoiler gate, so the browser never filters anything itself. Polling is
 * how a broadcast animates. The first read revalidates cached JSON so a new
 * frontend cannot receive an old response schema; later polls reuse the
 * server's cache lifetime until the next reveal boundary.
 */

export interface Loaded<T> {
  readonly data?: T;
  readonly error?: string;
  readonly loading: boolean;
  /**
   * True when the request answered 404, which for this API means "does not
   * exist yet" rather than "failed" — an empty database before the first
   * season, for instance. Callers that have an empty state to show should
   * check this before falling back to `error`.
   */
  readonly notFound?: boolean;
}

/** Thrown for a 404 response, so `useJson` can tell "absent" from "failed". */
export class NotFoundError extends Error {}

export function apiPath(...segments: readonly string[]): string {
  return `/api/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export async function getJson<T>(path: string, cache: RequestCache = "no-cache"): Promise<T> {
  const response = await fetch(path, { cache, headers: { accept: "application/json" } });
  if (response.status === 404) {
    throw new NotFoundError("Not found.");
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
 *
 * An undefined path means there is nothing to fetch yet — a page that has not
 * learned which game it is showing asks for nothing rather than asking for the
 * wrong thing.
 */
export function useJson<T>(path: string | undefined, pollMs?: number): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ loading: path !== undefined });

  useEffect(() => {
    if (path === undefined) {
      setLoaded({ loading: false });
      return;
    }
    let live = true;
    let timer: number | undefined;
    let cache: RequestCache = "no-cache";
    const read = async (): Promise<void> => {
      try {
        const data = await getJson<T>(path, cache);
        cache = "default";
        if (live) setLoaded({ data, loading: false });
      } catch (error) {
        if (live) {
          setLoaded((previous) => {
            if (previous.data !== undefined) return { ...previous, loading: false };
            if (error instanceof NotFoundError) return { loading: false, notFound: true };
            return { loading: false, error: String((error as Error).message) };
          });
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
