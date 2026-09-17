import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { ContractViolation } from "../src/core/errors.ts";
import { createSystemClock } from "../src/core/clock.ts";
import { parseManifest } from "../src/core/manifest.ts";
import { createRng } from "../src/core/rng.ts";
import type { Clock, Competitor, CompetitorManifest, Rng, SeasonConfig } from "../src/core/types.ts";
import { createGreedyPlayer } from "../src/players/greedy.ts";
import { createRandomPlayer } from "../src/players/random.ts";
import { createScriptedPlayer } from "../src/players/scripted.ts";
import { OPENINGS } from "../src/season/openings.ts";
import { runSeason } from "../src/season/runner.ts";

interface CliOptions {
  readonly games: number;
  readonly seed: string;
  readonly seasonId: string;
  readonly recordGolden: boolean;
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ContractViolation("scripts/season.arguments", `${option} requires a value`);
  }
  return value;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ContractViolation("scripts/season.arguments", `${option} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  let games = 1;
  let seed = "arena";
  let seasonId = "local";
  let recordGolden = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;

    if (argument === "--games") {
      games = positiveInteger(optionValue(args, index, argument), argument);
      index += 1;
    } else if (argument === "--seed") {
      seed = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--season") {
      seasonId = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--record-golden") {
      recordGolden = true;
    } else {
      throw new ContractViolation("scripts/season.arguments", `unknown option: ${argument}`);
    }
  }

  return { games, seed, seasonId, recordGolden };
}

async function loadManifests(): Promise<readonly CompetitorManifest[]> {
  const directory = new URL("../competitors/", import.meta.url);
  const entries = await readdir(directory, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  const manifests: CompetitorManifest[] = [];
  for (const entry of jsonFiles) {
    const text = await readFile(new URL(entry.name, directory), "utf8");
    const raw: unknown = JSON.parse(text);
    manifests.push(parseManifest(raw));
  }

  if (manifests.length < 2) {
    throw new ContractViolation("scripts/season.competitors", "at least two competitor manifests are required");
  }
  return manifests;
}

function createPlayer(manifest: CompetitorManifest, rng: Rng, clock: Clock): Competitor {
  if (manifest.model === "random") return createRandomPlayer(manifest, rng, clock);
  if (manifest.model === "greedy") return createGreedyPlayer(manifest, rng, clock);
  if (manifest.model === "scripted") return createScriptedPlayer(manifest, rng, clock);
  throw new ContractViolation("scripts/season.competitors", `unsupported local model: ${manifest.model}`);
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);
  const manifests = await loadManifests();
  const clock = createSystemClock();
  const players = manifests.map((manifest) =>
    createPlayer(manifest, createRng(`${options.seed}:${manifest.version}`), clock),
  );
  const config: SeasonConfig = {
    seasonId: options.seasonId,
    seed: options.seed,
    competitors: manifests,
    openings: OPENINGS,
    roundsPerPair: options.games,
    maxPlies: 200,
  };
  const outcome = await runSeason(config, players, createRng(options.seed), clock);

  if (options.recordGolden) {
    const directory = new URL("../__tests__/fixtures/golden/", import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL("season.json", directory), `${JSON.stringify(outcome, null, 2)}\n`, "utf8");
  } else {
    console.log(JSON.stringify(outcome.standings, null, 2));
  }
}

await main(Bun.argv.slice(2));
