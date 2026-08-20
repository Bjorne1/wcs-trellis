/**
 * Regression guard for default hook timeouts (GitHub issue #267).
 *
 * Windows Python cold start + session-start.py + nested subprocess calls
 * routinely exceed 10s, causing silent SessionStart drops. The defaults were
 * bumped from 10/5 seconds to 30/15 seconds across all hook-based platforms.
 * This test iterates the platform config list dynamically so future drift
 * surfaces immediately.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const TEMPLATES_ROOT = join(
  dirname(__filename),
  "..",
  "..",
  "src",
  "templates",
);

/**
 * Per-platform hook config descriptor.
 *
 * - `sessionStartEvent`: null when the platform has no SessionStart hook
 *   (codex). Used to look up entries in `parsed.hooks[event]`.
 * - `userPromptEvent`: event key for the inject-workflow-state hook.
 *
 * Add new hook-based platforms here when introduced.
 */
const PLATFORM_HOOK_CONFIGS = [
  {
    platform: "claude",
    path: "claude/settings.json",
    sessionStartEvent: "SessionStart",
    userPromptEvent: "UserPromptSubmit",
  },
  {
    platform: "codex",
    path: "codex/hooks.json",
    // Codex's SessionStart entry also carries the 15s spec-injection hook, so
    // only the per-turn event has a uniform floor to assert here.
    sessionStartEvent: null,
    userPromptEvent: "UserPromptSubmit",
  },
] as const;

/**
 * Extract every leaf hook descriptor (with `timeout`) under an event entry.
 * Both remaining platforms use the nested schema:
 * `[{matcher, hooks: [...]}]`.
 */
function extractHookEntries(events: unknown): Record<string, unknown>[] {
  if (!Array.isArray(events)) return [];
  const out: Record<string, unknown>[] = [];
  for (const entry of events) {
    if (!entry || typeof entry !== "object") continue;
    const inner = (entry as { hooks?: unknown }).hooks;
    if (Array.isArray(inner)) {
      for (const hook of inner) {
        if (hook && typeof hook === "object") {
          out.push(hook as Record<string, unknown>);
        }
      }
    }
  }
  return out;
}

describe("hook-timeouts: default timeouts survive Windows Python cold start (issue #267)", () => {
  const MIN_SESSION_START_S = 30;
  const MIN_USER_PROMPT_S = 15;

  for (const cfg of PLATFORM_HOOK_CONFIGS) {
    describe(cfg.platform, () => {
      const raw = readFileSync(join(TEMPLATES_ROOT, cfg.path), "utf-8");
      const parsed = JSON.parse(raw) as {
        hooks?: Record<string, unknown>;
      };

      if (cfg.sessionStartEvent !== null) {
        it(`SessionStart timeout >= ${MIN_SESSION_START_S}s`, () => {
          const events = parsed.hooks?.[cfg.sessionStartEvent];
          const hooks = extractHookEntries(events);
          expect(hooks.length).toBeGreaterThan(0);
          for (const hook of hooks) {
            const value = hook.timeout;
            expect(typeof value).toBe("number");
            expect(value as number).toBeGreaterThanOrEqual(
              MIN_SESSION_START_S,
            );
          }
        });
      }

      it(`${cfg.userPromptEvent} (inject-workflow-state) timeout >= ${MIN_USER_PROMPT_S}s`, () => {
        const events = parsed.hooks?.[cfg.userPromptEvent];
        const hooks = extractHookEntries(events);
        expect(hooks.length).toBeGreaterThan(0);
        for (const hook of hooks) {
          const value = hook.timeout;
          expect(typeof value).toBe("number");
          expect(value as number).toBeGreaterThanOrEqual(MIN_USER_PROMPT_S);
        }
      });
    });
  }
});
