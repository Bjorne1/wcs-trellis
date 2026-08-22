import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadVisualDesignMode } from "../../src/configurators/workflow.js";
import { DIR_NAMES } from "../../src/constants/paths.js";

// ---------------------------------------------------------------------------
// spec.visual_design
//
// The knob decides whether a backend-only layer gets
// `spec/frontend/visual-design.md`. It is hand-parsed out of config.yaml, so
// the block-scoping and the invalid-value path both need holding down: a
// silently-wrong parse would look exactly like "the user never set it".
// ---------------------------------------------------------------------------

describe("loadVisualDesignMode", () => {
  let tmpDir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-visual-design-"));
    fs.mkdirSync(path.join(tmpDir, DIR_NAMES.WORKFLOW), { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(content: string): void {
    fs.writeFileSync(
      path.join(tmpDir, DIR_NAMES.WORKFLOW, "config.yaml"),
      content,
    );
  }

  it("defaults to auto when config.yaml does not exist", () => {
    fs.rmSync(path.join(tmpDir, DIR_NAMES.WORKFLOW), {
      recursive: true,
      force: true,
    });
    expect(loadVisualDesignMode(tmpDir)).toBe("auto");
    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults to auto when the key is absent or still commented out", () => {
    writeConfig(
      "session_auto_commit: false\n# spec:\n#   visual_design: always\n",
    );
    expect(loadVisualDesignMode(tmpDir)).toBe("auto");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads always, tolerating an inline comment and quotes", () => {
    writeConfig('spec:\n  visual_design: "always"   # backend touches UI\n');
    expect(loadVisualDesignMode(tmpDir)).toBe("always");
  });

  it("reads always from the shipped template's own layout", () => {
    // The template documents the block after other top-level keys, so the
    // parser has to survive everything above it.
    writeConfig(
      [
        'session_commit_message: "chore: record journal"',
        "session_auto_commit: false",
        "",
        "channel:",
        "  worker_guard:",
        "    idle_timeout: 5m",
        "",
        "spec:",
        "  visual_design: always",
        "",
        "prompt_injection:",
        '  skip_keyword: "no-trellis"',
        "",
      ].join("\n"),
    );
    expect(loadVisualDesignMode(tmpDir)).toBe("always");
  });

  it("ignores visual_design nested under a different top-level block", () => {
    // Without block scoping this would read "always" out of someone else's
    // section, which is a silently wrong answer rather than a visible failure.
    writeConfig("channel:\n  visual_design: always\n");
    expect(loadVisualDesignMode(tmpDir)).toBe("auto");
  });

  it("warns and falls back to auto on an unknown value", () => {
    writeConfig("spec:\n  visual_design: never\n");
    expect(loadVisualDesignMode(tmpDir)).toBe("auto");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      'unknown spec.visual_design value "never"',
    );
  });
});
