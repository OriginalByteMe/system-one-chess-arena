import type { ReactNode } from "react";

import type { Loaded } from "./api.ts";
import { TopNav } from "./pages/home/TopNav.tsx";
import { Footer } from "./pages/home/Footer.tsx";

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
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="arena-shell flex-1">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rail pb-6">
          <h1 className="break-words text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{title}</h1>
          {meta}
        </div>
        {children}
      </main>
      <Footer />
    </div>
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
