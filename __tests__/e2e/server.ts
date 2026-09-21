import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SEASON_ID } from "./fixture.ts";
import { e2eSeedSql } from "./seed.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");
const WRANGLER_CONFIG = join(ROOT, "wrangler.jsonc");
const PORT = "4174";

let runtimeDirectory: string | undefined;
let worker: ChildProcess | undefined;
let stopping = false;

function requiredRuntimeDirectory(): string {
  if (runtimeDirectory === undefined) {
    throw new Error("E2E runtime directory has not been created");
  }
  return runtimeDirectory;
}

function startWrangler(arguments_: readonly string[]): ChildProcess {
  return spawn(WRANGLER, [...arguments_, "--config", WRANGLER_CONFIG], {
    cwd: requiredRuntimeDirectory(),
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      XDG_CONFIG_HOME: join(requiredRuntimeDirectory(), "config"),
    },
    stdio: "inherit",
  });
}

function waitForSuccess(child: ChildProcess, description: string): Promise<void> {
  const { promise, resolve: resolvePromise, reject: rejectPromise } =
    Promise.withResolvers<void>();
  child.once("error", rejectPromise);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolvePromise();
      return;
    }
    rejectPromise(
      new Error(
        `${description} failed${code === null ? ` with signal ${signal ?? "unknown"}` : ` with exit code ${code}`}`,
      ),
    );
  });
  return promise;
}

async function runWrangler(
  arguments_: readonly string[],
  description: string,
): Promise<void> {
  const child = startWrangler(arguments_);
  worker = child;
  try {
    await waitForSuccess(child, description);
  } finally {
    if (worker === child) worker = undefined;
  }
}

async function cleanup(): Promise<void> {
  const directory = runtimeDirectory;
  runtimeDirectory = undefined;
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true });
  }
}

async function shutdown(exitCode: number): Promise<never> {
  if (stopping) process.exit(exitCode);
  stopping = true;

  const activeWorker = worker;
  if (activeWorker?.pid !== undefined && activeWorker.exitCode === null && activeWorker.signalCode === null) {
    const { promise, resolve: resolveExit } = Promise.withResolvers<void>();
    activeWorker.once("exit", () => resolveExit());
    activeWorker.kill("SIGTERM");
    await promise;
  }

  await cleanup();
  process.exit(exitCode);
}

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(0);
});

async function main(): Promise<void> {
  runtimeDirectory = await mkdtemp(join(tmpdir(), "agentmate-e2e-"));
  const stateDirectory = join(runtimeDirectory, "wrangler-state");
  const seedPath = join(runtimeDirectory, "seed.sql");
  const environmentPath = join(runtimeDirectory, "empty.env");
  await Promise.all([
    writeFile(seedPath, e2eSeedSql(), "utf8"),
    writeFile(environmentPath, "", "utf8"),
  ]);

  await runWrangler(
    [
      "d1",
      "migrations",
      "apply",
      "arena",
      "--local",
      "--persist-to",
      stateDirectory,
    ],
    "D1 migrations",
  );
  await runWrangler(
    [
      "d1",
      "execute",
      "arena",
      "--local",
      "--persist-to",
      stateDirectory,
      "--file",
      seedPath,
      "--yes",
    ],
    "D1 seed",
  );

  worker = startWrangler([
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    PORT,
    "--persist-to",
    stateDirectory,
    "--env-file",
    environmentPath,
    "--var",
    `ARENA_FEATURED_SEASON:${SEASON_ID}`,
    "--log-level",
    "warn",
    "--show-interactive-dev-session=false",
  ]);

  worker.once("error", (error) => {
    if (stopping) return;
    console.error("Failed to start the E2E Wrangler runtime", error);
    void shutdown(1);
  });
  worker.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `E2E Wrangler runtime stopped unexpectedly${code === null ? ` with signal ${signal ?? "unknown"}` : ` with exit code ${code}`}`,
    );
    void shutdown(code ?? 1);
  });
}

main().catch((error: unknown) => {
  if (stopping) return;
  console.error("Failed to prepare the E2E runtime", error);
  void shutdown(1);
});
