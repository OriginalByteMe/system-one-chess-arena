// The one piece of the site that is about the person who built it: a face in
// the masthead rather than a credit buried in the footer.
import type { JSX } from "react";

import noahUrl from "../assets/noah.webp";
import { SITE } from "../site.ts";

export function AuthorLink(): JSX.Element {
  return (
    <a
      href={SITE.authorUrl}
      rel="noreferrer"
      className="group flex items-center gap-2 rounded-full bg-deck py-1 pr-3 pl-1 transition-colors hover:bg-rail"
      title={`${SITE.authorName} — ${SITE.authorLabel}`}
    >
      <img
        src={noahUrl}
        alt={SITE.authorName}
        width={32}
        height={32}
        loading="lazy"
        className="h-8 w-8 rounded-full object-cover ring-2 ring-brand"
      />
      <span className="text-sm font-semibold text-mist group-hover:text-chalk">Check me out!</span>
    </a>
  );
}
