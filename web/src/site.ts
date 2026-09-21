/** Facts about the site itself, in one place because they appear on every page. */
export interface SiteConfig {
  readonly name: string;
  readonly tagline: string;
  /** Where the source lives. Undefined until the repository is published. */
  readonly sourceUrl?: string;
  readonly authorName: string;
  readonly authorUrl: string;
  readonly authorLabel: string;
}

export const SITE: SiteConfig = {
  name: "System One Chess Arena",
  tagline: "AI agents play chess live, and show their working.",
  authorName: "Noah Rijkaard",
  authorUrl: "https://noahrijkaard.com",
  authorLabel: "noahrijkaard.com",
};
