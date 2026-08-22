import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getConfiguredPlatforms,
  configurePlatform,
  collectPlatformTemplates,
  PLATFORM_IDS,
} from "../../src/configurators/index.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";
import {
  setWriteMode,
  startRecordingWrites,
  stopRecordingWrites,
} from "../../src/utils/file-writer.js";
import { initializeHashes } from "../../src/utils/template-hash.js";
import {
  getAllAgents as getAllCodexAgents,
  getConfigTemplate as getCodexConfigTemplate,
  getHooksConfig as getCodexHooksConfig,
} from "../../src/templates/codex/index.js";
import {
  settingsTemplate as claudeSettingsTemplate,
  getStatuslineHook,
} from "../../src/templates/claude/index.js";
import {
  resolvePlaceholders,
  replacePythonCommandLiterals,
  setResolvedPythonCommand,
  resetResolvedPythonCommand,
} from "../../src/configurators/shared.js";


// =============================================================================
// configure ⟷ collectTemplates parity oracle
//
// `collectTemplates` is the single description of a platform's file set;
// `configure` writes it. Both directions must hold, and only the forward one
// ("every collected file is on disk") used to be asserted — which is how
// 0.5.5 shipped `.agents/skills/trellis-start/SKILL.md` from `configureCodex`
// with no matching `collectTemplates` entry, leaving upgraders without the
// file after `trellis update` (see manifests/0.5.7.json).
// =============================================================================

/**
 * Paths `configure` writes on purpose that `collectTemplates` does not
 * describe. Exactly one, and it is deliberate.
 *
 * `.claude/hooks/statusline.py` is written only by
 * `trellis init --with-statusline`. Keeping it out of `collectTemplates` is
 * intentional and separately locked by regression.test.ts
 * "[statusline-opt-in] statusline.py is not in claude's collected templates":
 * `analyzeChanges()` classifies a collected-but-absent file as a new file and
 * would force-install the statusline onto projects that opted out.
 *
 * Known consequence, documented but deliberately NOT fixed here (see
 * `.trellis/tasks/08-06-converge-platform-templates/research/configure-vs-collect-inventory.md`):
 * init records the file in `.template-hashes.json`, then
 * `pruneOrphanManifestKeys` drops it as an orphan because it is in neither
 * `collectTemplates` nor a migration — so an opted-in user's `statusline.py`
 * is frozen after their first `trellis update` and is left behind by
 * `trellis uninstall`.
 */
const CONFIGURE_ONLY_PATHS = new Set([".claude/hooks/statusline.py"]);

/**
 * Directories `configure` creates with no file underneath. A
 * `Map<path, content>` cannot express an empty directory, so each one is
 * named here against the platform that needs it.
 */
const CONFIGURE_ONLY_EMPTY_DIRS: Partial<Record<(typeof PLATFORM_IDS)[number], string[]>> =
  {
    // Trellis ships no Codex-specific skills (they all land in
    // `.agents/skills/`, which Codex reads too). The directory is still
    // created so users have the conventional place for their own.
    codex: [".codex/skills"],
  };

/** Every file under `root`, as POSIX paths relative to `root`. */
function walkFiles(root: string, rel = ""): string[] {
  const found: string[] = [];
  const absDir = rel ? path.join(root, ...rel.split("/")) : root;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const relEntry = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...walkFiles(root, relEntry));
    } else {
      found.push(relEntry);
    }
  }
  return found;
}

/** Directories under `root` with no file anywhere beneath them. */
function walkEmptyDirs(root: string, rel = ""): string[] {
  const found: string[] = [];
  const absDir = rel ? path.join(root, ...rel.split("/")) : root;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relEntry = rel ? `${rel}/${entry.name}` : entry.name;
    if (walkFiles(root, relEntry).length === 0) {
      found.push(relEntry);
    } else {
      found.push(...walkEmptyDirs(root, relEntry));
    }
  }
  return found;
}

/** Snapshot every file under `root` as path → content. */
function snapshotDir(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const relPath of walkFiles(root)) {
    snapshot.set(relPath, readConfiguredFile(root, relPath));
  }
  return snapshot;
}

// =============================================================================
// getConfiguredPlatforms — detects Trellis-owned platform files
// =============================================================================

describe("getConfiguredPlatforms", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-platforms-"));
    setWriteMode("force");
  });

  afterEach(() => {
    stopRecordingWrites();
    setWriteMode("ask");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty set when no platform dirs exist", () => {
    const result = getConfiguredPlatforms(tmpDir);
    expect(result.size).toBe(0);
  });

  it("does not treat native platform directories as Trellis installations", () => {
    for (const id of PLATFORM_IDS) {
      fs.mkdirSync(path.join(tmpDir, AI_TOOLS[id].configDir), {
        recursive: true,
      });
    }

    expect([...getConfiguredPlatforms(tmpDir)]).toEqual([]);
  });


  // Cost scales with the whole platform × file matrix (21 platforms, each fully
  // configured and hashed), so it sits well above the 10s global timeout on
  // Windows under full-suite load.
  it("detects every platform from the files Trellis tracked for it", async () => {
    for (const id of PLATFORM_IDS) {
      const platformRoot = path.join(tmpDir, id);
      fs.mkdirSync(platformRoot, { recursive: true });
      const written = startRecordingWrites(platformRoot);
      try {
        await configurePlatform(id, platformRoot);
      } finally {
        stopRecordingWrites();
      }
      fs.mkdirSync(path.join(platformRoot, ".trellis"), { recursive: true });
      initializeHashes(platformRoot, { trackedPaths: written });

      expect([...getConfiguredPlatforms(platformRoot)]).toEqual([id]);
    }
  }, 60_000);

  it("ignores unrelated directories", () => {
    fs.mkdirSync(path.join(tmpDir, ".vscode"));
    fs.mkdirSync(path.join(tmpDir, ".git"));
    const result = getConfiguredPlatforms(tmpDir);
    expect(result.size).toBe(0);
  });
});

// =============================================================================
// configurePlatform — copies templates to target directory
// =============================================================================

function readConfiguredFile(root: string, relativePath: string): string {
  return fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf-8");
}

describe("configurePlatform", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-configure-"));
    // Use force mode to avoid interactive prompts
    setWriteMode("force");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setWriteMode("ask");
  });

  it("configurePlatform('claude-code') creates .claude directory", async () => {
    await configurePlatform("claude-code", tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".claude"))).toBe(true);
  });



  it("configurePlatform('codex') creates .agents/skills directory", async () => {
    await configurePlatform("codex", tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".agents", "skills"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".codex"))).toBe(true);
  });

  it("configurePlatform writes collected templates byte-for-byte for every platform", async () => {
    for (const id of PLATFORM_IDS) {
      const platformDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `trellis-parity-${id}-`),
      );
      try {
        await configurePlatform(id, platformDir);
        const templates = collectPlatformTemplates(id);
        expect(
          templates,
          `${id} should expose template tracking`,
        ).toBeInstanceOf(Map);
        if (!templates) {
          throw new Error(`${id} did not expose template tracking`);
        }

        for (const [relativePath, expectedContent] of templates) {
          const targetPath = path.join(platformDir, ...relativePath.split("/"));
          expect(
            fs.existsSync(targetPath),
            `${id} should write ${relativePath}`,
          ).toBe(true);
          expect(readConfiguredFile(platformDir, relativePath)).toBe(
            expectedContent,
          );
        }
      } finally {
        fs.rmSync(platformDir, { recursive: true, force: true });
      }
    }
  });

  it("configurePlatform writes no file collectTemplates does not describe, for every platform", async () => {
    // The reverse of the assertion above. Without it, "configure writes a file
    // collectTemplates forgot" passes the suite silently — the exact failure
    // mode that shipped in 0.5.5 (codex trellis-start).
    for (const id of PLATFORM_IDS) {
      const platformDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `trellis-reverse-${id}-`),
      );
      try {
        await configurePlatform(id, platformDir);
        const templates = collectPlatformTemplates(id);
        if (!templates) {
          throw new Error(`${id} did not expose template tracking`);
        }

        const undescribed = walkFiles(platformDir).filter(
          (relPath) =>
            !templates.has(relPath) && !CONFIGURE_ONLY_PATHS.has(relPath),
        );
        expect(
          undescribed,
          `${id} wrote files that collectTemplates does not describe`,
        ).toEqual([]);

        expect(
          walkEmptyDirs(platformDir),
          `${id} created empty directories not named in CONFIGURE_ONLY_EMPTY_DIRS`,
        ).toEqual(CONFIGURE_ONLY_EMPTY_DIRS[id] ?? []);

        // Idempotency: init runs configure, update runs collectTemplates, and
        // re-running init must not accumulate or rewrite anything.
        const first = snapshotDir(platformDir);
        await configurePlatform(id, platformDir);
        expect(snapshotDir(platformDir), `${id} is not idempotent`).toEqual(
          first,
        );
      } finally {
        fs.rmSync(platformDir, { recursive: true, force: true });
      }
    }
  });

  it("configurePlatform and collectTemplates agree under Windows python rendering", async () => {
    // `collectPlatformTemplates` rewrites python3 → python for the whole map in
    // one place; `configure` has to reach the same bytes. A site that writes
    // raw content is invisible on macOS/Linux, where the rewrite is a no-op.
    setResolvedPythonCommand("python");
    try {
      for (const id of PLATFORM_IDS) {
        const platformDir = fs.mkdtempSync(
          path.join(os.tmpdir(), `trellis-win-${id}-`),
        );
        try {
          await configurePlatform(id, platformDir);
          const templates = collectPlatformTemplates(id);
          if (!templates) {
            throw new Error(`${id} did not expose template tracking`);
          }

          const onDisk = walkFiles(platformDir);
          expect(
            onDisk.filter(
              (relPath) =>
                !templates.has(relPath) && !CONFIGURE_ONLY_PATHS.has(relPath),
            ),
            `${id} wrote undescribed files under Windows rendering`,
          ).toEqual([]);

          for (const [relativePath, expectedContent] of templates) {
            expect(
              onDisk.includes(relativePath),
              `${id} should write ${relativePath}`,
            ).toBe(true);
            expect(
              readConfiguredFile(platformDir, relativePath),
              `${id}: ${relativePath} differs under Windows rendering`,
            ).toBe(expectedContent);
          }
        } finally {
          fs.rmSync(platformDir, { recursive: true, force: true });
        }
      }
    } finally {
      resetResolvedPythonCommand();
    }
  });

  it("configurePlatform('claude-code', --with-statusline) writes exactly one undescribed file", async () => {
    // The one named exemption, exercised. `--with-statusline` is the only opt-in
    // that adds a file `collectTemplates` does not describe; if it ever adds a
    // second, CONFIGURE_ONLY_PATHS has to grow and say why.
    await configurePlatform("claude-code", tmpDir, { withStatusline: true });
    const templates = collectPlatformTemplates("claude-code");
    if (!templates) {
      throw new Error("claude-code did not expose template tracking");
    }

    const undescribed = walkFiles(tmpDir).filter(
      (relPath) => !templates.has(relPath),
    );
    expect(undescribed).toEqual([...CONFIGURE_ONLY_PATHS]);
    expect(readConfiguredFile(tmpDir, ".claude/hooks/statusline.py")).toBe(
      replacePythonCommandLiterals(getStatuslineHook()),
    );
  });


  it("configurePlatform('codex') writes custom agents and config", async () => {
    await configurePlatform("codex", tmpDir);

    const expectedAgents = getAllCodexAgents();
    const codexAgentsRoot = path.join(tmpDir, ".codex", "agents");
    const actualAgentNames = fs
      .readdirSync(codexAgentsRoot)
      .map((file) => file.replace(".toml", ""))
      .sort();

    expect(actualAgentNames).toEqual(
      expectedAgents.map((agent) => agent.name).sort(),
    );

    for (const agent of expectedAgents) {
      const agentPath = path.join(codexAgentsRoot, `${agent.name}.toml`);
      expect(fs.existsSync(agentPath)).toBe(true);
      const written = fs.readFileSync(agentPath, "utf-8");
      // Native SubagentStart injects context, while every profile retains a
      // marker-gated active-task pull fallback when the hook is unavailable.
      expect(written).toBe(replacePythonCommandLiterals(agent.content));
      expect(written).toContain("<!-- trellis-hook-injected -->");
      expect(written).toContain("Active task: <path>");
      expect(written).not.toContain("Required: Load Trellis Context First");
    }

    const config = getCodexConfigTemplate();
    const configPath = path.join(tmpDir, ".codex", config.targetPath);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(
      replacePythonCommandLiterals(config.content),
    );
  });

  it("configurePlatform('codex') resolves PYTHON_CMD in hooks.json", async () => {
    await configurePlatform("codex", tmpDir);

    const hooksPath = path.join(tmpDir, ".codex", "hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const content = fs.readFileSync(hooksPath, "utf-8");
    const expectedPythonCmd =
      process.platform === "win32" ? "python" : "python3";
    expect(content).toContain(
      `"command": "${expectedPythonCmd} -X utf8 .codex/hooks/inject-workflow-state.py"`,
    );
    expect(content).not.toContain("{{PYTHON_CMD}}");
  });
























  it("claude-code configuration includes commands directory", async () => {
    await configurePlatform("claude-code", tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".claude", "commands"))).toBe(true);
  });

  it("claude-code configuration includes settings.json", async () => {
    await configurePlatform("claude-code", tmpDir);
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    // Should be valid JSON
    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    expect(settings).not.toHaveProperty("statusLine");
    expect(
      fs.existsSync(path.join(tmpDir, ".claude", "hooks", "statusline.py")),
    ).toBe(false);
  });

  it("claude-code default settings.json is byte-identical to the resolved template (statusline off)", async () => {
    await configurePlatform("claude-code", tmpDir, { withStatusline: false });
    const content = fs.readFileSync(
      path.join(tmpDir, ".claude", "settings.json"),
      "utf-8",
    );
    expect(content).toBe(resolvePlaceholders(claudeSettingsTemplate));
    expect(content).not.toContain("statusLine");
  });

  it("claude-code with statusline opt-in installs statusline.py and statusLine settings entry", async () => {
    await configurePlatform("claude-code", tmpDir, { withStatusline: true });

    const hookPath = path.join(tmpDir, ".claude", "hooks", "statusline.py");
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, "utf-8")).toBe(
      replacePythonCommandLiterals(getStatuslineHook()),
    );

    const content = fs.readFileSync(
      path.join(tmpDir, ".claude", "settings.json"),
      "utf-8",
    );
    expect(content).not.toContain("{{PYTHON_CMD}}");
    const settings = JSON.parse(content) as Record<string, unknown>;
    expect(settings.statusLine).toEqual({
      type: "command",
      command: replacePythonCommandLiterals(
        "python3 .claude/hooks/statusline.py",
      ),
    });
    // statusLine is appended at the END — byte-parity with update's
    // preserveExistingClaudeStatusLine (parse → assign → stringify), so a
    // fresh opted-in project shows zero settings.json diff on update
    expect(Object.keys(settings)).toEqual([
      "env",
      "hooks",
      "enabledPlugins",
      "statusLine",
    ]);
    // Everything besides statusLine is unchanged from the default template
    const expected = JSON.parse(
      resolvePlaceholders(claudeSettingsTemplate),
    ) as Record<string, unknown>;
    expect(settings.env).toEqual(expected.env);
    expect(settings.hooks).toEqual(expected.hooks);
    expect(settings.enabledPlugins).toEqual(expected.enabledPlugins);
  });

  it("withStatusline option leaves all other platforms unaffected", async () => {
    for (const id of PLATFORM_IDS) {
      if (id === "claude-code") continue;
      await configurePlatform(id, tmpDir, { withStatusline: true });
    }

    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walk(full));
        } else {
          files.push(full);
        }
      }
      return files;
    };

    for (const file of walk(tmpDir)) {
      expect(path.basename(file)).not.toBe("statusline.py");
      if (path.basename(file) === "settings.json") {
        expect(JSON.parse(fs.readFileSync(file, "utf-8"))).not.toHaveProperty(
          "statusLine",
        );
      }
    }
  });








  it("does not throw for any platform", async () => {
    for (const id of PLATFORM_IDS) {
      const platformDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `trellis-cfg-${id}-`),
      );
      try {
        setWriteMode("force");
        await expect(configurePlatform(id, platformDir)).resolves.not.toThrow();
      } finally {
        fs.rmSync(platformDir, { recursive: true, force: true });
      }
    }
  });

  it("collectPlatformTemplates('codex') resolves placeholders in hooks.json", () => {
    const templates = collectPlatformTemplates("codex");
    expect(templates).toBeInstanceOf(Map);
    expect(templates?.get(".codex/hooks.json")).toBe(
      resolvePlaceholders(getCodexHooksConfig()),
    );
  });

  it("codex hooks.json template keeps PYTHON_CMD placeholder", () => {
    const rawTemplate = getCodexHooksConfig();
    expect(rawTemplate).toContain(
      "{{PYTHON_CMD}} -X utf8 .codex/hooks/inject-workflow-state.py",
    );
  });



});
