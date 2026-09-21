// A path that resolves to nothing. It says which path, because the most common
// way to land here is a mistyped or truncated share link.
import type { JSX } from "react";

import { href } from "../route.ts";
import { Footer } from "./home/Footer.tsx";
import { TopNav } from "./home/TopNav.tsx";
import { PrimaryLink } from "../ui/chrome.tsx";

export function NotFound({ path }: { readonly path: string }): JSX.Element {
  return (
    <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
      <TopNav />
      <main className="mx-auto flex w-full max-w-[60ch] flex-1 flex-col items-start gap-4 px-4 py-16 sm:px-6">
        <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-chalk">
          Nothing at this address
        </h1>
        <p className="text-[15px] leading-relaxed text-mist">
          <code className="text-chalk">{path}</code> is not a page here. A season lives at{" "}
          <code>/season/&lt;id&gt;</code>, a broadcast at <code>/watch/&lt;season&gt;/&lt;game&gt;</code>, and an
          agent at <code>/competitor/&lt;name&gt;</code>.
        </p>
        <PrimaryLink href={href({ kind: "home" })}>Back to the arena</PrimaryLink>
      </main>
      <Footer />
    </div>
  );
}
