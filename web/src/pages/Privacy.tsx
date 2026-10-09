// What the site collects, in the same plain voice as the rest of it. This page
// is the disclosure, so it has to stay true to the code: if the analytics in
// src/api/analytics.ts or the beacon in index.html change, this changes.
import type { JSX } from "react";

import { SITE } from "../site.ts";
import { Footer } from "./home/Footer.tsx";
import { TopNav } from "./home/TopNav.tsx";

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: JSX.Element | readonly JSX.Element[];
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold text-chalk">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy(): JSX.Element {
  return (
    <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
      <TopNav />

      <main className="mx-auto flex w-full max-w-[72ch] flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-tight font-extrabold tracking-[-0.02em] text-chalk">
            Privacy and cookies
          </h1>
          <p className="text-[15px] leading-relaxed text-mist">
            {SITE.name} sets no cookies on visitors, has no accounts, no sign-in and no advertising, and sells
            nothing to anyone. What follows is the whole of what is measured.
          </p>
        </header>

        <Section title="Cookies">
          <p className="text-[15px] leading-relaxed text-mist">
            None for visitors. There is no consent banner here because there is nothing to consent to: no
            tracking cookie, no local storage of anything about you, no third-party embed. The one thing that
            ever touches your browser's storage is a model you choose to download on the{" "}
            <a href="/local" className="font-semibold text-brand-hi hover:underline">
              run-locally page
            </a>
            , described below.
          </p>
          <p className="text-[15px] leading-relaxed text-mist">
            One exception, and it is not yours: the operator console at <code>/admin</code> sits behind
            Cloudflare Access, which sets a <code>CF_Authorization</code> cookie for the one account allowed to
            sign in. It is strictly necessary for that login and is never set on any public page.
          </p>
        </Section>

        <Section title="What is recorded about a visit">
          <p className="text-[15px] leading-relaxed text-mist">
            Two cookieless measurements, both aggregate:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-mist">
            <li>
              Cloudflare Web Analytics counts page views and page-load timings. It is cookieless by design and
              does not fingerprint the browser.
            </li>
            <li>
              The Worker records one row per API request: which route was asked for, which season and game, the
              two-letter country Cloudflare reports, a coarse device class (mobile, tablet, desktop or bot), the
              referring site's hostname, the HTTP status, and how many milliseconds the answer took.
            </li>
          </ul>
        </Section>

        <Section title="What is never recorded">
          <p className="text-[15px] leading-relaxed text-mist">
            No IP address, no cookie or device identifier, no full user-agent string, no query strings, no
            account, no email, no cross-site profile and nothing that identifies a person. The request log
            cannot be resolved back to an individual, by us or by anyone reading it.
          </p>
        </Section>

        <Section title="Where it lives and for how long">
          <p className="text-[15px] leading-relaxed text-mist">
            Both measurements stay inside Cloudflare — Web Analytics and Workers Analytics Engine — under the
            site operator's account, and neither is shared with a third party. Analytics Engine keeps events for
            three months and then drops them; Web Analytics retains its aggregates on Cloudflare's own schedule.
          </p>
        </Section>

        <Section title="Running a model on your device">
          <p className="text-[15px] leading-relaxed text-mist">
            The <code>/local</code> page runs a small open language model inside your browser tab, on your own
            graphics chip. It does nothing until you press its download button. Then:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-mist">
            <li>
              Your browser downloads the model's weights from Hugging Face and its runtime from GitHub. Those
              hosts see your IP address and the request, as they would for any download; this site does not
              proxy or log it.
            </li>
            <li>
              The files are kept in your browser's own cache so the next visit is quick. The page has a button
              to remove them, and clearing site data does the same. They are not an identifier and are never
              read by this site's server.
            </li>
            <li>
              To pick a model that suits your machine, the page reads what the browser reports about your GPU
              (vendor, largest buffer, half-precision support) and times a half-second test on it. That
              reading stays on the page. It is not sent to this site or recorded.
            </li>
            <li>
              Games played there, the model's answers and every probability it produces never leave your
              device. None of it enters the league or its ratings.
            </li>
          </ul>
        </Section>

        <Section title="Game data">
          <p className="text-[15px] leading-relaxed text-mist">
            The chess data on this site is about the competitors, not about you: recorded games, the decisions
            behind each move, and the ratings computed from them. It is published deliberately, and a game still
            on air is withheld until the broadcast clock reaches it.
          </p>
        </Section>

        <Section title="Contact">
          <p className="text-[15px] leading-relaxed text-mist">
            Questions about any of the above go to the operator, via{" "}
            <a href={SITE.authorUrl} rel="noreferrer" className="font-semibold text-brand-hi hover:underline">
              {SITE.authorLabel}
            </a>
            .
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}
