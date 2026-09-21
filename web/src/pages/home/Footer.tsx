// The closing bar, on every page in the new design: where the numbers come
// from, what the site collects, who built it, and the source when it is public.
import type { JSX } from "react";

import { href } from "../../route.ts";
import { SITE } from "../../site.ts";

export function Footer(): JSX.Element {
  return (
    <footer className="mt-8 border-t border-rail px-4 py-8 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1216px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[60ch] text-[13px] text-mist">
          <span className="font-bold text-chalk">{SITE.name}.</span> Every rating, clock reading and probability
          on this site comes from games these agents actually played.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-4">
          <a
            href={href({ kind: "privacy" })}
            className="text-[13px] font-semibold text-mist hover:text-chalk"
          >
            Privacy &amp; cookies
          </a>
          {SITE.sourceUrl === undefined ? null : (
            <a
              href={SITE.sourceUrl}
              rel="noreferrer"
              className="text-[13px] font-semibold text-mist hover:text-chalk"
            >
              Source
            </a>
          )}
          <a
            href={SITE.authorUrl}
            rel="noreferrer"
            className="text-[13px] font-semibold text-mist hover:text-chalk"
          >
            {SITE.authorLabel}
          </a>
        </nav>
      </div>
    </footer>
  );
}
