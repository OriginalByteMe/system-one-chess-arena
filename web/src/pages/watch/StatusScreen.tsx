// The three ways a broadcast can fail to open: still connecting, the game id
// does not exist, or the first fetch itself failed. All three share one
// centred, quiet screen — there is no board to anchor to yet.
import type { JSX } from "react";

import { href } from "../../route.ts";

export interface StatusScreenProps {
  readonly variant: "connecting" | "not-started" | "error";
  readonly message?: string;
  readonly seasonId: string | undefined;
}

export function StatusScreen({ variant, message, seasonId }: StatusScreenProps): JSX.Element {
  const heading =
    variant === "connecting"
      ? "Connecting to the broadcast"
      : variant === "not-started"
        ? "This game has not started yet"
        : "Broadcast unreachable";
  const body =
    variant === "connecting"
      ? "Waiting on the arena for this game."
      : variant === "not-started"
        ? "The season has not begun this game. Keep this window open - it will connect the moment the first move lands."
        : (message ?? "The arena did not answer.");

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-void px-4 py-8 text-chalk">
      <section
        className="flex w-full max-w-md flex-col items-center rounded-xl border border-rail/70 bg-deck px-5 py-8 text-center sm:px-8"
        aria-live="polite"
      >
        <p className="text-[10px] font-semibold tracking-[0.18em] text-mist uppercase">
          System One Chess Arena
        </p>
        <span className="my-5 h-px w-12 bg-brand" aria-hidden="true" />
        <h1 className="font-display text-xl leading-tight font-bold">{heading}</h1>
        <p className="mt-3 max-w-sm break-words text-sm leading-relaxed text-mist">{body}</p>
        <a
          href={href(seasonId === undefined ? { kind: "home" } : { kind: "season", seasonId })}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-rail px-4 py-2 text-sm font-semibold text-chalk transition-colors outline-none hover:bg-rail focus-visible:ring-2 focus-visible:ring-chalk"
        >
          {seasonId === undefined ? "Back to the arena" : "Back to the season"}
        </a>
      </section>
    </div>
  );
}
