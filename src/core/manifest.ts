import { NotImplemented } from "./errors.ts";
import type { CompetitorManifest, ManifestFields } from "./types.ts";

export function manifestVersion(fields: ManifestFields): string {
  throw new NotImplemented("manifest.manifestVersion");
}

export function buildManifest(fields: ManifestFields): CompetitorManifest {
  throw new NotImplemented("manifest.buildManifest");
}

export function parseManifest(raw: unknown): CompetitorManifest {
  throw new NotImplemented("manifest.parseManifest");
}
