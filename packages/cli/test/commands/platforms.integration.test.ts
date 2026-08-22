/**
 * Integration test for #396 — `trellis platforms [--json]`.
 *
 * Exposes which platforms are configured in a repo in a machine-readable
 * way, so downstream tooling doesn't have to hand-maintain marker-file
 * tables per platform. Spawns the real built CLI binary (`bin/trellis.js`)
 * since the subcommand is wired up in `src/cli/index.ts`, which has
 * import-time side effects that make direct unit import brittle.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bin/trellis.js",
);

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

/**
 * `spawnSync` blocks the vitest worker for a whole cold Node start plus the
 * CLI's import graph. Measured standalone that is ~0.5s, but the rest of this
 * suite saturates the machine with Python subprocess integration tests, and
 * under that contention the global 10s `testTimeout` is reachable — it went red
 * on two of three full-suite runs while passing in 0.5s on its own. A timeout
 * here reports as a product failure when it is a harness one, so these two get
 * headroom. Kept far below anything a real hang would fit inside.
 */
const SPAWN_TIMEOUT_MS = 60_000;

function writeTrackedPlatforms(cwd: string, relativePaths: string[]): void {
  const trellisDir = path.join(cwd, ".trellis");
  fs.mkdirSync(trellisDir, { recursive: true });
  fs.writeFileSync(
    path.join(trellisDir, ".template-hashes.json"),
    JSON.stringify({
      __version: 2,
      hashes: Object.fromEntries(relativePaths.map((item) => [item, "hash"])),
    }),
  );
}

describe("trellis platforms (#396)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-platforms-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "--json reports an empty list when no platform is configured",
    () => {
      const result = runCli(tmpDir, ["platforms", "--json"]);

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { platforms: unknown[] };
      expect(parsed.platforms).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "human output lists configured platforms without --json",
    () => {
      fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
      writeTrackedPlatforms(tmpDir, [".claude/commands/trellis/continue.md"]);

      const result = runCli(tmpDir, ["platforms"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Claude Code");
      expect(result.stdout).toContain(".claude");
    },
    SPAWN_TIMEOUT_MS,
  );
});
