import type { ReactNode } from "react";

import type { Loaded } from "./api.ts";

/** The masthead and page frame every page shares. */
export function Shell({
  title,
  meta,
  children,
}: {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <main className="arena-shell">
      <header className="masthead">
        <a className="wordmark" href="/">
          <span>System One</span>
          <strong>Chess Arena</strong>
        </a>
        <div className="broadcast-meta">
          {meta}
          <span className="game-id">{title}</span>
        </div>
      </header>
      {children}
    </main>
  );
}

/**
 * Renders loading and error states so no page has to. Data arrives non-null,
 * which is what keeps the pages themselves free of undefined checks.
 */
export function Loading<T>({
  loaded,
  children,
}: {
  readonly loaded: Loaded<T>;
  readonly children: (data: T) => ReactNode;
}) {
  if (loaded.data !== undefined) return <>{children(loaded.data)}</>;
  if (loaded.error !== undefined) {
    return <p className="page-note page-note--error">{loaded.error}</p>;
  }
  return <p className="page-note">Loading…</p>;
}
