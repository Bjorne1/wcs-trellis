/**
 * Platform Registry — Single source of truth for platform functions and derived helpers
 *
 * All platform-specific lists (backup dirs, template dirs, configured platforms, etc.)
 * are derived from AI_TOOLS in types/ai-tools.ts. Adding a new platform requires:
 * 1. Adding to AI_TOOLS (data)
 * 2. Creating `configurators/<platform>.ts` with a `collect<Platform>Templates()`
 *    that returns the platform's file set — the one place it is described
 * 3. Adding to PLATFORM_FUNCTIONS below, normally `fromTemplates(collect…)`
 * 4. Creating the template directory
 */

import fs from "node:fs";
import path from "node:path";

import {
  AI_TOOLS,
  getManagedPaths,
  type AITool,
  type CliFlag,
} from "../types/ai-tools.js";
import { loadHashes } from "../utils/template-hash.js";

// Platform file sets — each `collect*Templates` is the single description of
// what its platform installs, and lives next to any residual behavior.
import { collectClaudeTemplates, configureClaude } from "./claude.js";
import { collectCodexTemplates, configureCodex } from "./codex.js";

// Shared utilities
import {
  renderTemplateMap,
  type PlatformConfigureOptions,
} from "./shared.js";

// =============================================================================
// Platform Functions Registry
// =============================================================================

interface PlatformFunctions {
  /** Configure platform during init (copy templates to project) */
  configure: (cwd: string, options?: PlatformConfigureOptions) => Promise<void>;
  /** Collect template files for update tracking. Undefined = platform skipped during update. */
  collectTemplates?: () => Map<string, string>;
}

/**
 * Both remaining platforms do something a `Map<path, content>` cannot express
 * — claude-code the opt-in `--with-statusline` file, codex the intentionally
 * empty `.codex/skills/` directory plus a stderr notice — so each spells out
 * `configure` and `collectTemplates` and keeps that residual behavior inline in
 * its own configurator. A platform whose configuration is exactly "write these
 * files" only needs `collectTemplates` and a `configure` derived from it.
 */
const PLATFORM_FUNCTIONS: Record<AITool, PlatformFunctions> = {
  "claude-code": {
    configure: configureClaude,
    collectTemplates: collectClaudeTemplates,
  },
  codex: { configure: configureCodex, collectTemplates: collectCodexTemplates },
};

// =============================================================================
// Derived Helpers — all derived from AI_TOOLS registry
// =============================================================================

/** All platform IDs */
export const PLATFORM_IDS = Object.keys(AI_TOOLS) as AITool[];

/** All platform config directory names (e.g., [".claude", ".cursor", ".opencode"]) */
export const CONFIG_DIRS = PLATFORM_IDS.map((id) => AI_TOOLS[id].configDir);

/** All managed paths for every platform (primary configDir + extra managed paths). */
export const PLATFORM_MANAGED_DIRS = PLATFORM_IDS.flatMap((id) =>
  getManagedPaths(id),
);

/** All directories managed by Trellis (including .trellis itself) */
export const ALL_MANAGED_DIRS = [".trellis", ...new Set(PLATFORM_MANAGED_DIRS)];

/**
 * Whether a template path is unambiguously Trellis-owned judged by its own
 * name, with no help from the hash manifest.
 *
 * Only `trellis`-marked path segments qualify. `.claude/settings.json`,
 * `.codex/config.toml`, `.codex/hooks.json` and the shared `hooks/*.py` script
 * names all occur in projects that never installed Trellis, so their presence
 * proves nothing about whether Trellis configured the platform.
 */
function isTrellisOwnedPath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => segment === "trellis" || segment.startsWith("trellis-"));
}

/**
 * Detect platforms from Trellis-owned templates, not native config directories.
 *
 * A platform directory may predate Trellis. The template hash manifest records
 * only files Trellis actually wrote, while the platform template registry
 * supplies each platform's distinct file layout.
 *
 * Evidence is taken from two independent sources, either of which is enough:
 *
 * 1. the path is in the hash manifest, and
 * 2. the path is `trellis`-marked and present on disk.
 *
 * The second source exists because the manifest can lose its whole platform
 * section — `initializeHashes` only covers platform paths the run actually
 * wrote, so any init that rewrites the manifest while skipping already-present
 * platform files drops them from tracking. Detecting from the manifest alone
 * then reports "no platforms configured", and `collectTemplateFiles` silently
 * stops offering that platform's files, so a release adding a new command or
 * skill never reaches the project while `trellis update` still prints
 * "Already up to date". Disk presence recovers those projects on the next
 * update; a bare `.claude/` created by hand still detects nothing.
 */
export function getConfiguredPlatforms(cwd: string): Set<AITool> {
  const platforms = new Set<AITool>();
  const hashes = loadHashes(cwd);

  for (const id of PLATFORM_IDS) {
    const configDir = AI_TOOLS[id].configDir;
    const templates = collectPlatformTemplates(id);
    const hasTrellisTemplate = [...(templates?.keys() ?? [])].some(
      (relativePath) =>
        (relativePath === configDir ||
          relativePath.startsWith(`${configDir}/`)) &&
        (hashes[relativePath] !== undefined ||
          (isTrellisOwnedPath(relativePath) &&
            fs.existsSync(path.join(cwd, ...relativePath.split("/"))))),
    );
    if (hasTrellisTemplate) {
      platforms.add(id);
    }
  }
  return platforms;
}

/**
 * Get platform IDs that have Python hooks (for Windows encoding detection)
 */
export function getPlatformsWithPythonHooks(): AITool[] {
  return PLATFORM_IDS.filter((id) => AI_TOOLS[id].hasPythonHooks);
}

/**
 * Check if a path starts with any managed directory
 */
export function isManagedPath(dirPath: string): boolean {
  // Normalize Windows backslashes to forward slashes for consistent matching
  const normalized = dirPath.replace(/\\/g, "/");
  return ALL_MANAGED_DIRS.some(
    (d) => normalized.startsWith(d + "/") || normalized === d,
  );
}

/**
 * Check if a directory name is a managed root directory (should not be deleted)
 */
export function isManagedRootDir(dirName: string): boolean {
  return ALL_MANAGED_DIRS.includes(dirName);
}

/**
 * Get all managed paths for a platform.
 */
export function getPlatformManagedPaths(platformId: AITool): string[] {
  return getManagedPaths(platformId);
}

/**
 * Get the configure function for a platform
 */
export function configurePlatform(
  platformId: AITool,
  cwd: string,
  options?: PlatformConfigureOptions,
): Promise<void> {
  return PLATFORM_FUNCTIONS[platformId].configure(cwd, options);
}

/**
 * Collect template files for a specific platform (for update tracking).
 * Returns undefined if the platform doesn't support template tracking.
 */
export function collectPlatformTemplates(
  platformId: AITool,
): Map<string, string> | undefined {
  const map = PLATFORM_FUNCTIONS[platformId].collectTemplates?.();
  return map ? renderTemplateMap(map) : map;
}

/**
 * Build TOOLS array for interactive init prompt, derived from AI_TOOLS registry
 */
export function getInitToolChoices(): {
  key: CliFlag;
  name: string;
  defaultChecked: boolean;
  platformId: AITool;
}[] {
  return PLATFORM_IDS.map((id) => ({
    key: AI_TOOLS[id].cliFlag,
    name: AI_TOOLS[id].name,
    defaultChecked: AI_TOOLS[id].defaultChecked,
    platformId: id,
  }));
}

/**
 * Resolve CLI flag name to AITool id (e.g., "claude" → "claude-code")
 */
export function resolveCliFlag(flag: string): AITool | undefined {
  return PLATFORM_IDS.find((id) => AI_TOOLS[id].cliFlag === flag);
}
