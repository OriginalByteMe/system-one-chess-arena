// Shared surfaces and controls for the arena.
import type { JSX, ReactNode } from "react";

export function Card({
  id,
  className,
  children,
}: {
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section id={id} className={`arena-card min-w-0 rounded-xl border border-rail bg-pit p-5 sm:p-6 ${className ?? ""}`}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  meta,
}: {
  readonly title: string;
  readonly meta?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="text-xl leading-tight font-bold tracking-[-0.025em] text-chalk">{title}</h2>
      {meta === undefined ? null : <div className="flex items-center gap-2 text-xs text-mist">{meta}</div>}
    </div>
  );
}

/** The primary action stays distinct from the quieter navigation links. */
export function PrimaryLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand px-5 py-3 text-sm font-bold text-void transition-colors hover:bg-brand-hi active:bg-brand"
    >
      {children}
    </a>
  );
}

export function SecondaryLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-rail px-5 py-3 text-sm font-semibold text-chalk transition-colors hover:border-mist hover:bg-deck"
    >
      {children}
    </a>
  );
}

export function LivePill(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-live px-1.5 py-0.5 text-[11px] leading-none font-bold text-white uppercase">
      <span className="h-1.5 w-1.5 rounded-full bg-white/90" aria-hidden="true" />
      Live
    </span>
  );
}
