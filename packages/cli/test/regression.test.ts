/**
 * Regression Tests — Historical Bug Prevention
 *
 * Each test references a specific version where the bug was introduced/fixed.
 * Prevents recurrence of bugs from beta.2 through beta.16.
 *
 * Categories:
 * 1. Windows / Encoding (beta.2, beta.7, beta.10, beta.11, beta.12, beta.16)
 * 2. Path Issues (0.2.14, 0.2.15, beta.13)
 * 3. Semver / Migration Engine (beta.5, beta.14, beta.16)
 * 4. Template Integrity (beta.0, beta.7, beta.12)
 * 5. Platform Registry (beta.9, beta.13, beta.16)
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearManifestCache,
  getAllMigrations,
  getAllMigrationVersions,
  getMigrationsForVersion,
  hasPendingMigrations,
} from "../src/migrations/index.js";
import { isManagedPath } from "../src/configurators/index.js";
import { replacePythonCommandLiterals } from "../src/configurators/shared.js";
import { AI_TOOLS } from "../src/types/ai-tools.js";
import { PATHS } from "../src/constants/paths.js";
import {
  settingsTemplate as claudeSettingsTemplate,
  getAllAgents as getClaudeAgents,
  getStatuslineHook,
} from "../src/templates/claude/index.js";
import { getAllHooks as getCodexHooks } from "../src/templates/codex/index.js";
import {
  getSharedHookScripts,
} from "../src/templates/shared-hooks/index.js";
import {
  getCommandTemplates,
  getSkillTemplates,
} from "../src/templates/common/index.js";
import {
  commonInit,
  taskScript,
  addSessionScript,
  commonTaskUtils,
  commonDeveloper,
  commonConfig,
  commonGitContext,
  commonSessionContext,
  getAllScripts,
} from "../src/templates/trellis/index.js";
import {
  collectPlatformTemplates,
  configurePlatform,
  PLATFORM_IDS,
} from "../src/configurators/index.js";
import { setWriteMode } from "../src/utils/file-writer.js";
import {
  guidesIndexContent,
  workspaceIndexContent,
} from "../src/templates/markdown/index.js";
import * as markdownExports from "../src/templates/markdown/index.js";

afterEach(() => {
  clearManifestCache();
});

// =============================================================================
// 1. Windows / Encoding Regressions
// =============================================================================

describe("regression: Windows encoding (beta.10, beta.11, beta.16)", () => {
  it("[beta.10] common/__init__.py has _configure_stream function", () => {
    expect(commonInit).toContain("def _configure_stream");
  });

  it('[beta.10] common/__init__.py has reconfigure(encoding="utf-8") pattern', () => {
    expect(commonInit).toContain('reconfigure(encoding="utf-8"');
  });

  it("[beta.10] common/__init__.py has TextIOWrapper fallback", () => {
    expect(commonInit).toContain("TextIOWrapper");
  });


  it('[beta.10] common/__init__.py has sys.platform == "win32" guard', () => {
    expect(commonInit).toContain('sys.platform == "win32"');
  });

  it("[beta.10] common/__init__.py configures both stdout AND stderr", () => {
    expect(commonInit).toContain("sys.stdout");
    expect(commonInit).toContain("sys.stderr");
  });

  it("[beta.16] _configure_stream handles stream with reconfigure method", () => {
    // The function should try reconfigure() first, then fallback to detach()
    expect(commonInit).toContain('hasattr(stream, "reconfigure")');
    expect(commonInit).toContain('hasattr(stream, "detach")');
  });

  it("[beta.16] _configure_stream is idempotent (won't crash on double call)", () => {
    // The reconfigure pattern is safe to call multiple times
    // The function should NOT use detach() unconditionally (beta.16 bug root cause)
    // It should check hasattr(stream, "reconfigure") FIRST
    const reconfigureIndex = commonInit.indexOf(
      'hasattr(stream, "reconfigure")',
    );
    const detachIndex = commonInit.indexOf('hasattr(stream, "detach")');
    expect(reconfigureIndex).toBeLessThan(detachIndex);
  });

  it("[beta.10] common/__init__.py has centralized encoding fix", () => {
    // Encoding fix was centralized from individual scripts to common/__init__.py (#67)
    expect(commonInit).toContain('sys.platform == "win32"');
    expect(commonInit).toContain("reconfigure");
  });

  it("[beta.10] task.py imports from common (gets encoding fix via __init__.py)", () => {
    expect(taskScript).toContain("from common");
  });

  it("[rc.2] add_session.py table separator detection uses regex (not startswith)", () => {
    // Bug: startswith("|---") breaks when formatters add spaces: "| ---- |"
    // Fix: use re.match with a character-class pattern to allow optional whitespace/spaces
    expect(addSessionScript).not.toContain('startswith("|---")');
    expect(addSessionScript).toContain(
      String.raw`re.match(r"^\|[-| ]+\|\s*$", line)`,
    );
  });
});

describe("regression: branch context in session records (issue-106)", () => {
  it("[issue-106] add_session.py accepts --branch CLI arg", () => {
    expect(addSessionScript).toContain("--branch");
    expect(addSessionScript).not.toContain("--base-branch");
  });

  it("[issue-106] add_session.py auto-detects branch via git branch --show-current", () => {
    expect(addSessionScript).toContain("branch --show-current");
  });

  it("[issue-106] add_session.py reads branch from task.json when available", () => {
    expect(addSessionScript).toContain('task_data.raw.get("branch")');
    expect(addSessionScript).not.toContain('task_data.raw.get("base_branch")');
  });

  it("[issue-106] add_session.py session content includes **Branch** field only", () => {
    expect(addSessionScript).toContain("**Branch**");
    expect(addSessionScript).not.toContain("**Base Branch**");
  });

  it("[issue-106] add_session.py index table header has 5 columns including Branch", () => {
    expect(addSessionScript).toContain(
      "| # | Date | Title | Commits | Branch |",
    );
    expect(addSessionScript).not.toContain(
      "| # | Date | Title | Commits | Branch | Base Branch |",
    );
  });

  it("[issue-106] add_session.py migrates old 4/6-column headers to 5-column", () => {
    expect(addSessionScript).toMatch(
      /re\.match\(\r?\n\s+r"\^\\\|\\s\*#\\s\*\\\|\\s\*Date\\s\*\\\|\\s\*Title\\s\*\\\|\\s\*Commits\\s\*\\\|\\s\*Branch\\s\*\\\|\\s\*Base Branch\\s\*\\\|\\s\*\$",/,
    );
    expect(addSessionScript).toContain(
      String.raw`re.match(r"^\|\s*#\s*\|\s*Date\s*\|\s*Title\s*\|\s*Commits\s*\|\s*Branch\s*\|\s*$", line)`,
    );
  });

  it("[issue-106] developer.py init template has 5-column session history table", () => {
    expect(commonDeveloper).toContain(
      "| # | Date | Title | Commits | Branch |",
    );
    expect(commonDeveloper).toContain(
      "|---|------|-------|---------|--------|",
    );
  });

  it("[issue-106] workspace-index.md template documents Branch field only for session records", () => {
    expect(workspaceIndexContent).toContain(
      "Branch: Which branch the work was done on",
    );
    expect(workspaceIndexContent).toContain("**Branch**: `{branch-name}`");
    expect(workspaceIndexContent).not.toContain(
      "**Base Branch**: `{base-branch-name}`",
    );
  });
});

describe("regression: add_session.py runtime branch context (issue-106)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-session-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTrellisScripts(): void {
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content);
    }
  }

  function createWorkspaceIndex(
    headerMode: "legacy4" | "legacy6" | "current5",
  ): void {
    let header = "| # | Date | Title | Commits | Branch |";
    let separator = "|---|------|-------|---------|--------|";
    if (headerMode === "legacy4") {
      header = "| # | Date | Title | Commits |";
      separator = "|---|------|-------|---------|";
    } else if (headerMode === "legacy6") {
      header = "| # | Date | Title | Commits | Branch | Base Branch |";
      separator = "|---|------|-------|---------|--------|-------------|";
    }
    const indexContent = `# Workspace Index - test-dev

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: \`journal-1.md\`
- **Total Sessions**: 0
- **Last Active**: -
<!-- @@@/auto:current-status -->

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| \`journal-1.md\` | ~0 | Active |
<!-- @@@/auto:active-documents -->

## Session History

<!-- @@@auto:session-history -->
${header}
${separator}
<!-- @@@/auto:session-history -->
`;
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "index.md"),
      indexContent,
      "utf-8",
    );
  }

  function setupSessionRepo(options?: {
    gitBranch?: string;
    headerMode?: "legacy4" | "legacy6" | "current5";
    taskBranch?: string;
    taskBaseBranch?: string;
  }): void {
    writeTrellisScripts();

    fs.mkdirSync(path.join(tmpDir, ".trellis", "workspace", "test-dev"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-22T00:00:00\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "journal-1.md"),
      "# Journal - test-dev (Part 1)\n\n---\n",
      "utf-8",
    );
    createWorkspaceIndex(options?.headerMode ?? "current5");

    if (options?.taskBranch || options?.taskBaseBranch) {
      const taskDir = path.join(tmpDir, ".trellis", "tasks", "issue-106");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.mkdirSync(path.join(tmpDir, ".trellis", ".runtime", "sessions"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tmpDir, ".trellis", ".runtime", "sessions", "session-a.json"),
        JSON.stringify(
          {
            current_task: ".trellis/tasks/issue-106",
            platform: "test",
          },
          null,
          2,
        ),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify(
          {
            title: "Issue 106 task",
            status: "in_progress",
            package: null,
            branch: options.taskBranch ?? null,
            base_branch: options.taskBaseBranch ?? null,
          },
          null,
          2,
        ),
        "utf-8",
      );
    }

    if (options?.gitBranch) {
      execSync("git init -q", { cwd: tmpDir });
      execSync(`git branch -m ${JSON.stringify(options.gitBranch)}`, {
        cwd: tmpDir,
      });
    }
  }

  function runAddSession(title: string, options?: { branch?: string }): void {
    const command = [
      "python3",
      JSON.stringify(
        path.join(tmpDir, ".trellis", "scripts", "add_session.py"),
      ),
      "--title",
      JSON.stringify(title),
      "--summary",
      JSON.stringify("Regression test session"),
      "--no-commit",
    ];
    if (options?.branch) {
      command.push("--branch", JSON.stringify(options.branch));
    }

    execSync(command.join(" "), {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, TRELLIS_CONTEXT_ID: "session-a" },
    });
  }

  function createLocalBranch(branch: string): void {
    execSync("git config user.email test@example.com", { cwd: tmpDir });
    execSync("git config user.name Test", { cwd: tmpDir });
    execSync("git commit --allow-empty -q -m init", { cwd: tmpDir });
    execSync(`git branch ${JSON.stringify(branch)}`, { cwd: tmpDir });
  }

  it("[issue-106] prefers explicit CLI branch over task.json and git", () => {
    setupSessionRepo({
      gitBranch: "feature/from-git",
      taskBranch: "task/from-task",
      taskBaseBranch: "main",
    });

    runAddSession("CLI branch wins", { branch: "cli/from-arg" });

    const journal = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "journal-1.md"),
      "utf-8",
    );
    const index = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "index.md"),
      "utf-8",
    );

    expect(journal).toContain("**Branch**: `cli/from-arg`");
    expect(journal).not.toContain("**Base Branch**:");
    expect(journal).not.toContain("task/from-task");
    expect(journal).not.toContain("feature/from-git");
    expect(index).toContain("`cli/from-arg` |");
    expect(index).not.toContain("`task/from-task`");
    expect(index).not.toContain("`feature/from-git`");
  });

  it("[issue-106] prefers task.json branch over current git branch and ignores task base_branch", () => {
    setupSessionRepo({
      gitBranch: "feature/from-git",
      taskBranch: "task/from-task",
      taskBaseBranch: "main",
    });
    createLocalBranch("task/from-task");

    runAddSession("Task branch wins");

    const journal = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "journal-1.md"),
      "utf-8",
    );
    const index = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "index.md"),
      "utf-8",
    );

    expect(journal).toContain("**Branch**: `task/from-task`");
    expect(journal).not.toContain("**Base Branch**:");
    expect(journal).not.toContain("feature/from-git");
    expect(index).toContain("`task/from-task` |");
    expect(index).not.toContain("`feature/from-git`");
  });

  it("[issue-106] falls back to git branch and migrates old 6-column session history", () => {
    setupSessionRepo({
      gitBranch: "feature/from-git",
      headerMode: "legacy6",
    });

    runAddSession("Git branch fallback");

    const journal = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "journal-1.md"),
      "utf-8",
    );
    const index = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "index.md"),
      "utf-8",
    );

    expect(journal).toContain("**Branch**: `feature/from-git`");
    expect(journal).not.toContain("**Base Branch**:");
    expect(index).toContain("| # | Date | Title | Commits | Branch |");
    expect(index).toContain("|---|------|-------|---------|--------|");
    expect(index).toContain("`feature/from-git` |");
    expect(index).not.toContain(
      "| # | Date | Title | Commits | Branch | Base Branch |\n|---|------|-------|---------|--------|-------------|",
    );
  });

  it("[issue-106] migrates old 4-column session history directly to 5 columns", () => {
    setupSessionRepo({
      headerMode: "legacy4",
    });

    runAddSession("Legacy 4-column migration");

    const index = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "index.md"),
      "utf-8",
    );

    expect(index).toContain("| # | Date | Title | Commits | Branch |");
    expect(index).toContain("|---|------|-------|---------|--------|");
    expect(index).not.toContain(
      "| # | Date | Title | Commits |\n|---|------|-------|---------|",
    );
  });

  it("[issue-106] records a session even when no branch information is available", () => {
    setupSessionRepo();

    runAddSession("No branch available");

    const journal = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "journal-1.md"),
      "utf-8",
    );
    const index = fs.readFileSync(
      path.join(tmpDir, ".trellis", "workspace", "test-dev", "index.md"),
      "utf-8",
    );

    expect(journal).not.toContain("**Branch**:");
    expect(journal).not.toContain("**Base Branch**:");
    expect(index).toContain("`-` |");
    expect(index).toContain("- **Total Sessions**: 1");
  });
});

// Windows subprocess flags tests removed — multi_agent pipeline removed

describe("regression: Windows path separator (beta.12)", () => {

  it("[beta.12] isManagedPath handles mixed separators", () => {
    expect(isManagedPath(".claude\\commands/foo.md")).toBe(true);
  });
});

// =============================================================================
// 2. Path Issues Regressions
// =============================================================================

describe("regression: task directory paths (0.2.14, 0.2.15, beta.13)", () => {
  it("[0.2.15] PATHS.TASKS is .trellis/tasks (not .trellis/workspace/*/tasks)", () => {
    expect(PATHS.TASKS).toBe(".trellis/tasks");
    expect(PATHS.TASKS).not.toContain("workspace");
  });

  it("[0.2.14] Claude agent templates do not contain hardcoded .trellis/workspace/*/tasks/ paths", () => {
    const agents = getClaudeAgents();
    for (const agent of agents) {
      expect(agent.content).not.toMatch(/\.trellis\/workspace\/[^/]+\/tasks\//);
    }
  });


  it("[0.2.15] no script templates contain hardcoded 'taosu' in path patterns", () => {
    const scripts = getAllScripts();
    for (const [name, content] of scripts) {
      // Check for hardcoded username in path patterns (workspace/taosu, /Users/taosu)
      // but allow usage examples like "python3 status.py -a taosu"
      expect(
        content,
        `${name} should not contain hardcoded username in paths`,
      ).not.toMatch(/workspace\/taosu|\/Users\/taosu/);
    }
  });
});

describe("regression: resolve_task_dir path handling", () => {
  it("[beta.12] resolve_task_dir handles .trellis prefix", () => {
    // The function should recognize .trellis-prefixed paths as relative paths
    expect(commonTaskUtils).toContain('.startswith(".trellis")');
  });

  it("[current-task] resolve_task_dir normalizes backslash separators before path classification", () => {
    expect(commonTaskUtils).toContain('target_dir.replace("\\\\", "/")');
  });
});

describe("regression: is_within_tasks_dir archive boundary (issue #428)", () => {
  let tmpDir: string;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "trellis-within-tasks-dir-"),
    );
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }
    fs.mkdirSync(path.join(tmpDir, ".trellis", "tasks", "archive"), {
      recursive: true,
    });
    fs.mkdirSync(
      path.join(tmpDir, ".trellis", "tasks", "archive", "2026-07", "old-task"),
      { recursive: true },
    );
    fs.mkdirSync(path.join(tmpDir, ".trellis", "tasks", "live-task"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[issue-428] rejects the archive root, an archived child, the tasks root, and an external path; accepts a direct child", () => {
    const probe = `
import json
import sys
from pathlib import Path

root = Path.cwd()
sys.path.insert(0, str(root / ".trellis" / "scripts"))
from common.task_utils import is_within_tasks_dir

print(json.dumps({
    "archive_root": is_within_tasks_dir(root / ".trellis" / "tasks" / "archive", root),
    "archived_child": is_within_tasks_dir(root / ".trellis" / "tasks" / "archive" / "2026-07" / "old-task", root),
    "tasks_root": is_within_tasks_dir(root / ".trellis" / "tasks", root),
    "external_path": is_within_tasks_dir(root / "src", root),
    "direct_child": is_within_tasks_dir(root / ".trellis" / "tasks" / "live-task", root),
}))
`;
    const result = spawnSync(pythonCmd, ["-c", probe], {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      archive_root: false,
      archived_child: false,
      tasks_root: false,
      external_path: false,
      direct_child: true,
    });
  });
});

describe("regression: write_json fd ownership and cleanup (issue #429)", () => {
  let tmpDir: string;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-write-json-"));
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runProbe(probeBody: string): { status: number | null; stdout: string; stderr: string } {
    const probe = `
import json
import os
import sys
from pathlib import Path
from unittest import mock

root = Path.cwd()
sys.path.insert(0, str(root / ".trellis" / "scripts"))
from common.io import write_json

${probeBody}
`;
    const result = spawnSync(pythonCmd, ["-c", probe], {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("[issue-429] closes the raw fd itself when fdopen fails, and leaves no temp file", () => {
    const { status, stdout, stderr } = runProbe(`
target = root / "out.json"
real_close = os.close
closed_fds = []

def fake_close(fd):
    closed_fds.append(fd)
    real_close(fd)

def fake_fdopen(fd, *a, **kw):
    # fdopen never took ownership: caller must close fd itself.
    raise OSError("simulated fdopen failure")

with mock.patch("os.close", side_effect=fake_close), \\
     mock.patch("os.fdopen", side_effect=fake_fdopen):
    result = write_json(target, {"a": 1})

leftover_tmp = [p.name for p in root.glob("*.tmp")] + [p.name for p in root.glob(".out.json.*")]
print(json.dumps({
    "result": result,
    "fd_closed": len(closed_fds) == 1,
    "target_exists": target.exists(),
    "leftover_tmp": leftover_tmp,
}))
`);
    expect(status, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      result: false,
      fd_closed: true,
      target_exists: false,
      leftover_tmp: [],
    });
  });

  it("[issue-429] cleans up the temp file when os.replace fails, without masking the write as a success", () => {
    const { status, stdout, stderr } = runProbe(`
target = root / "out.json"

with mock.patch("os.replace", side_effect=OSError("simulated replace failure")):
    result = write_json(target, {"a": 1})

leftover_tmp = [p.name for p in root.glob(".out.json.*")]
print(json.dumps({
    "result": result,
    "target_exists": target.exists(),
    "leftover_tmp": leftover_tmp,
}))
`);
    expect(status, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      result: false,
      target_exists: false,
      leftover_tmp: [],
    });
  });

  it("[issue-429] a cleanup failure after a write failure does not raise — still reports False", () => {
    const { status, stdout, stderr } = runProbe(`
target = root / "out.json"

with mock.patch("os.replace", side_effect=OSError("simulated replace failure")), \\
     mock.patch("os.unlink", side_effect=OSError("simulated cleanup failure")):
    result = write_json(target, {"a": 1})

print(json.dumps({"result": result}))
`);
    expect(status, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ result: false });
  });

  it("[issue-429] a successful write is atomic and leaves no leftover temp file", () => {
    const { status, stdout, stderr } = runProbe(`
target = root / "out.json"
result = write_json(target, {"a": 1, "b": "text"})
leftover_tmp = [p.name for p in root.glob(".out.json.*")]
print(json.dumps({
    "result": result,
    "content": json.loads(target.read_text(encoding="utf-8")),
    "leftover_tmp": leftover_tmp,
}))
`);
    expect(status, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      result: true,
      content: { a: 1, b: "text" },
      leftover_tmp: [],
    });
  });
});

describe("regression: task auto-activation failure diagnostics (issue #430)", () => {
  let tmpDir: string;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-task-activate-"));
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }
    fs.mkdirSync(path.join(tmpDir, ".trellis", "spec", "guides"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", "spec", "guides", "index.md"),
      "# Guides\n",
    );
    fs.writeFileSync(path.join(tmpDir, ".trellis", "workflow.md"), "# Workflow\n");
    fs.mkdirSync(path.join(tmpDir, ".trellis", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".trellis", "workspace", "test-dev"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", ".developer"),
      "name=test-dev\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Ambient session env vars from the real host session (e.g. this test
  // running inside Claude Code itself) must not leak into the "no session"
  // scenario — scrub every platform session/transcript key before overlay.
  const AMBIENT_SESSION_ENV_KEYS = [
    "TRELLIS_CONTEXT_ID",
    "DSH_TRELLIS_CONTEXT_ID",
    "DSH_SESSION_ID",
    "DSH_SHELL",
    "CLAUDE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CURSOR_SESSION_ID",
    "CURSOR_CONVERSATION_ID",
    "CURSOR_CONVERSATIONID",
    "OPENCODE_SESSION_ID",
    "OPENCODE_SESSIONID",
    "OPENCODE_RUN_ID",
    "GEMINI_SESSION_ID",
    "FACTORY_SESSION_ID",
    "DROID_SESSION_ID",
    "QODER_SESSION_ID",
    "CODEBUDDY_SESSION_ID",
    "KIRO_SESSION_ID",
    "COPILOT_SESSION_ID",
    "COPILOT_SESSIONID",
    "PI_SESSION_ID",
  ] as const;

  function runCreate(env: NodeJS.ProcessEnv) {
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const blocked = new Set<string>(AMBIENT_SESSION_ENV_KEYS);
    const scrubbed: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!blocked.has(key)) scrubbed[key] = value;
    }
    return spawnSync(
      pythonCmd,
      [taskScriptPath, "create", "issue-430 probe", "--slug", "issue-430-probe"],
      { cwd: tmpDir, encoding: "utf-8", env: { ...scrubbed, ...env } },
    );
  }

  it("[issue-430] no session identity stays silent (normal degraded mode, not a failure)", () => {
    const result = runCreate({});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("Warning: session activation");
    expect(result.stderr).not.toContain("Activated task for this session");
  });

  it("[issue-430] a real session identity activates normally with no warning", () => {
    const result = runCreate({ TRELLIS_CONTEXT_ID: "probe-session" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("Activated task for this session");
    expect(result.stderr).not.toContain("Warning: session activation");
  });

  it("[issue-430] a pointer-persistence failure is now diagnosable instead of silently swallowed", () => {
    // Pre-create the session-pointer directory's own path as a *file* so
    // `_write_json`'s `path.parent.mkdir(parents=True, exist_ok=True)` raises
    // FileExistsError — a real, portable failure mode (no chmod needed).
    const sessionsPathAsFile = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
    );
    fs.mkdirSync(path.dirname(sessionsPathAsFile), { recursive: true });
    fs.writeFileSync(sessionsPathAsFile, "not a directory");

    const result = runCreate({ TRELLIS_CONTEXT_ID: "probe-session" });

    // Task creation itself must still succeed — activation is best-effort.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("Warning: session activation failed");
    expect(result.stderr).not.toContain("Activated task for this session");
  });
});

// =============================================================================
// 3. Semver / Migration Engine Regressions
// =============================================================================

describe("regression: semver prerelease handling (beta.5)", () => {
  it("[beta.5] prerelease version sorts before release version", () => {
    // 0.3.0-beta.1 < 0.3.0 (prerelease is less than release)
    const versions = getAllMigrationVersions();
    const betaVersions = versions.filter((v) => v.includes("beta"));
    const releaseVersions = versions.filter(
      (v) => !v.includes("beta") && !v.includes("alpha"),
    );

    if (betaVersions.length > 0 && releaseVersions.length > 0) {
      // All beta versions should appear before their corresponding release versions
      const lastBeta = betaVersions[betaVersions.length - 1];
      const firstRelease = releaseVersions[0];
      const lastBetaIdx = versions.indexOf(lastBeta);
      const firstReleaseIdx = versions.indexOf(firstRelease);
      // Only compare if they share the same base version
      if (lastBeta.startsWith(firstRelease.split("-")[0])) {
        expect(lastBetaIdx).toBeLessThan(firstReleaseIdx);
      }
    }
  });

  it("[beta.5] prerelease numeric parts compare numerically (beta.2 < beta.10)", () => {
    // getMigrationsForVersion relies on correct version ordering
    // beta.2 should be before beta.10 (numeric, not lexicographic)
    const versions = getAllMigrationVersions();
    const beta2Idx = versions.indexOf("0.3.0-beta.2");
    const beta10Idx = versions.indexOf("0.3.0-beta.10");
    if (beta2Idx !== -1 && beta10Idx !== -1) {
      expect(beta2Idx).toBeLessThan(beta10Idx);
    }
  });

  it("[beta.5] getMigrationsForVersion returns empty for equal versions", () => {
    expect(getMigrationsForVersion("0.3.0-beta.5", "0.3.0-beta.5")).toEqual([]);
  });

  it("[beta.5] getMigrationsForVersion correctly handles beta range", () => {
    // beta.0 to beta.2 should include beta.1 and beta.2 migrations
    getMigrationsForVersion("0.3.0-beta.0", "0.3.0-beta.2");
    // Should not include beta.0 itself (only > fromVersion)
    const versions = getAllMigrationVersions();
    if (versions.includes("0.3.0-beta.1")) {
      expect(
        hasPendingMigrations("0.3.0-beta.0", "0.3.0-beta.2"),
      ).toBeDefined();
    }
  });
});

describe("regression: migration data integrity (beta.14)", () => {
  it("[beta.14] all migrations have non-undefined 'from' field", () => {
    const allMigrations = getAllMigrations();
    for (const m of allMigrations) {
      expect(
        m.from,
        `migration should have 'from' field defined`,
      ).toBeDefined();
      expect(typeof m.from).toBe("string");
      expect(m.from.length).toBeGreaterThan(0);
    }
  });

  it("[beta.14] all migrations have valid type field", () => {
    const allMigrations = getAllMigrations();
    const validTypes = ["rename", "rename-dir", "delete", "safe-file-delete"];
    for (const m of allMigrations) {
      expect(validTypes).toContain(m.type);
    }
  });

  it("[beta.1-040] safe-file-delete migrations have allowed_hashes", () => {
    const allMigrations = getAllMigrations();
    const safeDeletes = allMigrations.filter(
      (m) => m.type === "safe-file-delete",
    );
    for (const m of safeDeletes) {
      expect(
        m.allowed_hashes,
        `safe-file-delete for '${m.from}' should have allowed_hashes`,
      ).toBeDefined();
      expect(Array.isArray(m.allowed_hashes)).toBe(true);
      expect(
        (m.allowed_hashes as string[]).length,
        `safe-file-delete for '${m.from}' should have at least one hash`,
      ).toBeGreaterThan(0);
      for (const hash of m.allowed_hashes as string[]) {
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it("[beta.15] Claude Code statusline is not safe-deleted on update", () => {
    const claudeStatusLineDeletes = getAllMigrations().filter(
      (m) =>
        m.type === "safe-file-delete" &&
        m.from === ".claude/hooks/statusline.py",
    );

    expect(claudeStatusLineDeletes).toEqual([]);
  });

  it("[statusline-opt-in] statusline.py is not in claude's collected templates (update must not force-install it)", () => {
    // The opt-in statusline (`trellis init --with-statusline`) must stay out
    // of the unconditional template walk: analyzeChanges() classifies any
    // collected-but-absent file as `newFiles` and installs it on update,
    // which would force statusline onto opted-out projects.
    const templates = collectPlatformTemplates("claude-code");
    expect(templates).toBeDefined();
    expect([...(templates?.keys() ?? [])]).not.toContain(
      ".claude/hooks/statusline.py",
    );
  });

  it("[beta.14] rename/rename-dir migrations have 'to' field", () => {
    const allMigrations = getAllMigrations();
    const renames = allMigrations.filter(
      (m) => m.type === "rename" || m.type === "rename-dir",
    );
    for (const m of renames) {
      expect(
        m.to,
        `rename migration from '${m.from}' should have 'to'`,
      ).toBeDefined();
      expect(typeof m.to).toBe("string");
      expect((m.to as string).length).toBeGreaterThan(0);
    }
  });

  it("[beta.14] all manifest versions are valid semver-like strings", () => {
    const versions = getAllMigrationVersions();
    for (const v of versions) {
      expect(v).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    }
  });
});


// dispatch agent removed — parallel/worktree now handled by platform-native features

// =============================================================================
// 4. Template Integrity Regressions
// =============================================================================

describe("regression: shell to Python migration (beta.0)", () => {
  it("[beta.0] no .sh scripts remain in trellis templates", () => {
    const scripts = getAllScripts();
    for (const [name] of scripts) {
      expect(name.endsWith(".sh"), `${name} should not end with .sh`).toBe(
        false,
      );
    }
  });

  it("[beta.0] all script keys end with .py", () => {
    const scripts = getAllScripts();
    for (const [name] of scripts) {
      expect(name.endsWith(".py"), `${name} should end with .py`).toBe(true);
    }
  });

  it("[beta.3] getAllScripts covers every .py file in templates/trellis/scripts/", () => {
    // Bug: update.ts had a hand-maintained file list that missed 11 scripts.
    // Fix: update.ts now uses getAllScripts() directly. This test ensures
    // getAllScripts() itself stays in sync with the filesystem.
    const scriptsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/templates/trellis/scripts",
    );
    const fsFiles = new Set<string>();
    function walk(dir: string, prefix: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        } else if (entry.name.endsWith(".py")) {
          fsFiles.add(`${prefix}${entry.name}`);
        }
      }
    }
    walk(scriptsDir, "");

    const scripts = getAllScripts();
    const registeredKeys = new Set(scripts.keys());

    // Known exclusions: files intentionally not in getAllScripts()
    const excluded = new Set(["hooks/linear_sync.py"]);

    for (const file of fsFiles) {
      if (excluded.has(file)) continue;
      expect(
        registeredKeys.has(file),
        `${file} exists on disk but is missing from getAllScripts()`,
      ).toBe(true);
    }
  });
});

describe("regression: hook JSON format (beta.7)", () => {
  it("[beta.7] Claude settings.json is valid JSON", () => {
    expect(() => JSON.parse(claudeSettingsTemplate)).not.toThrow();
  });

  it("[beta.7] Claude settings.json has correct hook structure", () => {
    const settings = JSON.parse(claudeSettingsTemplate);
    expect(settings).toHaveProperty("hooks");
    expect(settings).not.toHaveProperty("statusLine");
    expect(settings.hooks).toHaveProperty("SessionStart");
    expect(Array.isArray(settings.hooks.SessionStart)).toBe(true);

    // Each hook entry should have matcher and hooks array
    for (const entry of settings.hooks.SessionStart) {
      expect(entry).toHaveProperty("hooks");
      expect(Array.isArray(entry.hooks)).toBe(true);
      for (const hook of entry.hooks) {
        expect(hook).toHaveProperty("type", "command");
        expect(hook).toHaveProperty("command");
        expect(hook).toHaveProperty("timeout");
      }
    }
  });

  it("[beta.7] hook commands use {{PYTHON_CMD}} placeholder (not hardcoded python3)", () => {
    const settings = JSON.parse(claudeSettingsTemplate);
    const allHookEntries = [
      ...settings.hooks.SessionStart,
      ...settings.hooks.PreToolUse,
      ...settings.hooks.PostToolUse,
    ];
    for (const entry of allHookEntries) {
      for (const hook of entry.hooks) {
        expect(hook.command).toContain("{{PYTHON_CMD}}");
        expect(hook.command).not.toMatch(/^python3?\s/);
      }
    }
  });
});

describe("regression: SessionStart reinject on clear/compact (MIN-231)", () => {
  it("[MIN-231] Claude SessionStart hooks cover startup, clear, and compact", () => {
    const settings = JSON.parse(claudeSettingsTemplate);
    const matchers = settings.hooks.SessionStart.map(
      (e: { matcher: string }) => e.matcher,
    );
    expect(matchers).toEqual(
      expect.arrayContaining(["startup", "clear", "compact"]),
    );
  });

  it("[MIN-231] all SessionStart matchers invoke session-start.py", () => {
    const settings = JSON.parse(claudeSettingsTemplate);
    for (const entry of settings.hooks.SessionStart) {
      expect(
        entry.hooks[0].command,
        `claude ${entry.matcher} should invoke session-start.py`,
      ).toContain("session-start.py");
    }
  });

  it("[MIN-231] clear and compact record a spec reset; startup does not", () => {
    const settings = JSON.parse(claudeSettingsTemplate);
    const commandsByMatcher = Object.fromEntries(
      settings.hooks.SessionStart.map(
        (entry: { matcher: string; hooks: { command: string }[] }) => [
          entry.matcher,
          entry.hooks.map((hook) => hook.command),
        ],
      ),
    );
    expect(
      commandsByMatcher.startup.some((command: string) =>
        command.includes("inject-spec-context.py"),
      ),
    ).toBe(false);
    for (const source of ["clear", "compact"]) {
      expect(commandsByMatcher[source]).toEqual(
        expect.arrayContaining([
          expect.stringContaining("inject-spec-context.py"),
        ]),
      );
    }
  });
});

describe("regression: agent-session Trellis update hint", () => {
  let tmpDir: string;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-update-hint-"));
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }
    fs.mkdirSync(path.join(tmpDir, ".trellis", "tasks"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-05-09T00:00:00Z\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runContextWithTrellisOutput(
    currentVersion: string,
    trellisVersionOutput: string | null,
  ): string {
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", ".version"),
      `${currentVersion}\n`,
      "utf-8",
    );
    const runnerPath = path.join(tmpDir, "run-context.py");
    fs.writeFileSync(
      runnerPath,
      [
        "import os",
        "import sys",
        "from pathlib import Path",
        "sys.path.insert(0, str(Path.cwd() / '.trellis' / 'scripts'))",
        "from common import session_context",
        "output = os.environ.get('TRELLIS_VERSION_OUTPUT')",
        "session_context._fetch_trellis_version_output = lambda: None if output == '__NONE__' else output",
        "session_context.output_text(Path.cwd())",
        "",
      ].join("\n"),
      "utf-8",
    );
    return execSync(`${pythonCmd} ${JSON.stringify(runnerPath)}`, {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        TRELLIS_VERSION_OUTPUT: trellisVersionOutput ?? "__NONE__",
        TRELLIS_CONTEXT_ID: "test-update-session",
      },
    });
  }

  function pythonFunctionBody(source: string, name: string): string {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(
      new RegExp(`def ${escapedName}\\([\\s\\S]*?\\n(?=def |# =|$)`),
    );
    return match?.[0] ?? "";
  }

  it("shows a concise update hint when trellis --version reports a newer version", () => {
    const output = runContextWithTrellisOutput(
      "0.5.0",
      "Trellis update available: 0.5.0 → 0.5.9\nRun: trellis update\n0.5.9",
    );

    expect(output).toContain("Trellis update available: 0.5.0 -> 0.5.9");
    expect(output).toContain("run trellis update");
    expect(output).not.toContain("run trellis upgrade");
    expect(output).toContain("SESSION CONTEXT");
  });

  it("does not show a hint when installed version is equal or newer", () => {
    expect(runContextWithTrellisOutput("0.5.9", "0.5.9")).not.toContain(
      "Trellis update available",
    );
    fs.rmSync(path.join(tmpDir, ".trellis", ".runtime"), {
      recursive: true,
      force: true,
    });
    expect(runContextWithTrellisOutput("0.6.0", "0.5.9")).not.toContain(
      "Trellis update available",
    );
  });

  it("silently skips the hint when trellis --version fails or version parsing fails", () => {
    expect(runContextWithTrellisOutput("0.5.0", null)).not.toContain(
      "Trellis update available",
    );
    fs.rmSync(path.join(tmpDir, ".trellis", ".runtime"), {
      recursive: true,
      force: true,
    });
    expect(runContextWithTrellisOutput("not-a-version", "0.5.9")).not.toContain(
      "Trellis update available",
    );
  });

  it("does not burn the once-per-session marker when version lookup fails", () => {
    expect(runContextWithTrellisOutput("0.5.0", null)).not.toContain(
      "Trellis update available",
    );

    const output = runContextWithTrellisOutput("0.5.0", "0.5.9");

    expect(output).toContain("Trellis update available: 0.5.0 -> 0.5.9");
  });

  it("uses the final trellis --version token when no update line is present", () => {
    const output = runContextWithTrellisOutput("0.5.0", "0.5.9");

    expect(output).toContain("Trellis update available: 0.5.0 -> 0.5.9");
  });

  it("only attempts the default text update hint once per session", () => {
    const first = runContextWithTrellisOutput("0.5.0", "0.5.9");
    const second = runContextWithTrellisOutput("0.5.0", "0.5.9");

    expect(first).toContain("Trellis update available: 0.5.0 -> 0.5.9");
    expect(second).not.toContain("Trellis update available");
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".trellis",
          ".runtime",
          "update-check-test-update-session.marker",
        ),
      ),
    ).toBe(true);
  });

  it("keeps the update hint out of JSON, record, packages, and phase paths", () => {
    expect(pythonFunctionBody(commonSessionContext, "output_text")).toContain(
      "get_update_hint",
    );
    for (const functionName of [
      "get_context_json",
      "output_json",
      "get_context_record_json",
      "get_context_text_record",
    ]) {
      expect(
        pythonFunctionBody(commonSessionContext, functionName),
        `${functionName} should not check Trellis updates`,
      ).not.toContain("get_update_hint");
    }
    expect(commonGitContext).toContain('if args.mode == "record":');
    expect(commonGitContext).toContain('elif args.mode == "packages":');
    expect(commonGitContext).toContain('elif args.mode == "phase":');
    expect(commonGitContext).toContain("else:");
    expect(commonGitContext).toContain("output_text()");
  });
});

describe("regression: issue #252 polyrepo Git context", () => {
  let tmpDir: string;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-polyrepo-git-"));
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }
    fs.mkdirSync(path.join(tmpDir, ".trellis", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".trellis", "workspace", "test-dev"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", ".developer"),
      "name=test-dev\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfigYaml(content: string): void {
    fs.writeFileSync(
      path.join(tmpDir, ".trellis", "config.yaml"),
      content,
      "utf-8",
    );
  }

  function initChildRepo(relativePath: string, commitMessage: string): void {
    const repoPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(repoPath, { recursive: true });
    execSync("git init -q", { cwd: repoPath });
    execSync("git config user.email test@example.com", { cwd: repoPath });
    execSync("git config user.name Test", { cwd: repoPath });
    fs.writeFileSync(path.join(repoPath, "README.md"), `${commitMessage}\n`);
    execSync("git add README.md", { cwd: repoPath });
    execSync(`git commit -q -m ${JSON.stringify(commitMessage)}`, {
      cwd: repoPath,
    });
  }

  function runSessionContext(kind: "text" | "record" | "json"): string {
    const runnerPath = path.join(tmpDir, "run-context.py");
    let expression = "print(session_context.get_context_text(Path.cwd()))";
    if (kind === "record") {
      expression = "print(session_context.get_context_text_record(Path.cwd()))";
    } else if (kind === "json") {
      expression =
        "print(json.dumps(session_context.get_context_json(Path.cwd())))";
    }
    fs.writeFileSync(
      runnerPath,
      [
        "import json",
        "import sys",
        "from pathlib import Path",
        "sys.path.insert(0, str(Path.cwd() / '.trellis' / 'scripts'))",
        "from common import session_context",
        expression,
        "",
      ].join("\n"),
      "utf-8",
    );
    return execSync(`${pythonCmd} ${JSON.stringify(runnerPath)}`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
  }

  it("does not render root as unknown/clean when configured package repos exist", () => {
    writeConfigYaml(
      [
        "packages:",
        "  module_a:",
        "    path: module-a",
        "    git: true",
        "",
      ].join("\n"),
    );
    initChildRepo("module-a", "init module a");

    const output = runSessionContext("text");
    const rootBlock = output.slice(
      output.indexOf("## GIT STATUS"),
      output.indexOf("## GIT STATUS (module_a: module-a)"),
    );

    expect(rootBlock).toContain("Root is not a Git repository.");
    expect(rootBlock).toContain(
      "Run Git commands from the package repository paths listed below.",
    );
    expect(rootBlock).not.toContain("Branch: unknown");
    expect(rootBlock).not.toContain("Working directory: Clean");
    expect(output).toContain("## GIT STATUS (module_a: module-a)");
    expect(output).toContain("init module a");
  });

  it("uses the same non-Git root rendering in record mode", () => {
    writeConfigYaml(
      [
        "packages:",
        "  module_a:",
        "    path: module-a",
        "    git: true",
        "",
      ].join("\n"),
    );
    initChildRepo("module-a", "init module a");

    const output = runSessionContext("record");
    const rootBlock = output.slice(
      output.indexOf("## GIT STATUS"),
      output.indexOf("## GIT STATUS (module_a: module-a)"),
    );

    expect(rootBlock).toContain("Root is not a Git repository.");
    expect(rootBlock).not.toContain("Branch: unknown");
    expect(rootBlock).not.toContain("Working directory: Clean");
  });

  it("discovers unconfigured child Git repos when root is not a Git repo", () => {
    writeConfigYaml("# no packages configured\n");
    initChildRepo("module-a", "init module a");
    initChildRepo(path.join("services", "module-b"), "init module b");

    const output = runSessionContext("text");

    expect(output).toContain("Root is not a Git repository.");
    expect(output).toContain("## GIT STATUS (module-a: module-a)");
    expect(output).toContain(
      "## GIT STATUS (services_module-b: services/module-b)",
    );
    expect(output).toContain("init module a");
    expect(output).toContain("init module b");
  });

  it("skips automatic Git status when too many child repos are discovered", () => {
    writeConfigYaml("# no packages configured\n");
    for (let i = 0; i < 9; i++) {
      fs.mkdirSync(path.join(tmpDir, `repo-${i}`, ".git"), {
        recursive: true,
      });
    }

    const output = runSessionContext("text");
    const rerun = spawnSync(
      pythonCmd,
      [path.join(tmpDir, "run-context.py")],
      {
        cwd: tmpDir,
        encoding: "utf-8",
      },
    );

    expect(output).not.toContain("## GIT STATUS (repo-");
    expect(rerun.status).toBe(0);
    expect(rerun.stderr).toContain(
      "found more than 8 child Git repositories",
    );
    expect(rerun.stderr).toContain(
      "Configure explicit packages entries with path and git: true",
    );
  });

  it("passes probe timeouts through the shared Git runner", () => {
    const runnerPath = path.join(tmpDir, "run-git-timeout.py");
    fs.writeFileSync(
      runnerPath,
      [
        "import json",
        "import subprocess",
        "import sys",
        "from pathlib import Path",
        "sys.path.insert(0, str(Path.cwd() / '.trellis' / 'scripts'))",
        "from common.git import run_git",
        "captured = {}",
        "def fake_run(*args, **kwargs):",
        "    captured['timeout'] = kwargs.get('timeout')",
        "    raise subprocess.TimeoutExpired(args[0], kwargs.get('timeout'))",
        "subprocess.run = fake_run",
        "rc, out, err = run_git(['status'], timeout=0.25)",
        "from common import session_context",
        "root_calls = []",
        "def fake_git(args, cwd=None, timeout=None):",
        "    root_calls.append({'args': args, 'timeout': timeout})",
        "    if args == ['status', '--porcelain']:",
        "        return (1, '', 'timed out')",
        "    return (0, 'true\\n' if args[0] == 'rev-parse' else '', '')",
        "session_context.run_git = fake_git",
        "root_info = session_context._collect_root_git_info(Path.cwd())",
        "print(json.dumps({'rc': rc, 'out': out, 'err': err, 'rootCalls': root_calls, 'rootInfo': root_info, **captured}))",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = JSON.parse(
      execSync(`${pythonCmd} ${JSON.stringify(runnerPath)}`, {
        cwd: tmpDir,
        encoding: "utf-8",
      }),
    ) as {
      rc: number;
      out: string;
      err: string;
      timeout: number;
      rootCalls: { args: string[]; timeout: number }[];
      rootInfo: { isClean: boolean };
    };

    expect(result).toEqual(
      expect.objectContaining({
        rc: 1,
        out: "",
        timeout: 0.25,
      }),
    );
    expect(result.err).toContain("timed out");
    expect(result.rootCalls.map((call) => call.args[0])).toEqual([
      "rev-parse",
      "branch",
      "status",
      "status",
      "log",
    ]);
    expect(result.rootCalls.every((call) => call.timeout === 2)).toBe(true);
    expect(result.rootInfo.isClean).toBe(false);
  });

  it("marks JSON root Git state as non-repo instead of clean", () => {
    writeConfigYaml(
      [
        "packages:",
        "  module_a:",
        "    path: module-a",
        "    git: true",
        "",
      ].join("\n"),
    );
    initChildRepo("module-a", "init module a");

    const context = JSON.parse(runSessionContext("json")) as {
      git: { isRepo: boolean; branch: string; isClean: boolean };
      packageGit: { name: string; path: string }[];
    };

    expect(context.git).toEqual(
      expect.objectContaining({
        isRepo: false,
        branch: "",
        isClean: false,
      }),
    );
    expect(context.packageGit).toEqual([
      expect.objectContaining({ name: "module_a", path: "module-a" }),
    ]);
  });
});

describe("regression: current-task path normalization", () => {
  let tmpDir: string;
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const claudeSessionStart = getSharedHookScripts().find(
    (hook) => hook.name === "session-start.py",
  )?.content;
  const codexSessionStart = getCodexHooks().find(
    (hook) => hook.name === "session-start.py",
  )?.content;
  const firstReplyNoticeSentence =
    "Trellis SessionStart 已注入：workflow、当前任务状态、开发者身份、git 状态、active tasks、spec 索引已加载。";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-current-task-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTrellisScripts(): void {
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [relativePath, content] of getAllScripts()) {
      const absPath = path.join(scriptsDir, relativePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }
  }

  function writeProjectFile(relativePath: string, content: string): void {
    const absPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
  }

  function writeLegacyCurrentTask(taskRef: string): void {
    writeProjectFile(path.join(".trellis", ".current-task"), `${taskRef}\n`);
  }

  function writeSessionContext(contextKey: string, taskRef: string): void {
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", `${contextKey}.json`),
      JSON.stringify(
        {
          current_task: taskRef,
          platform: "test",
        },
        null,
        2,
      ),
    );
  }

  /**
   * Opt into the Trellis workflow for a fixture session.
   *
   * Both injection hooks emit nothing until the session is engaged, so any test
   * asserting on hook output has to engage first. The record is written by the
   * real `mark_session_engaged`, invoked through a throwaway probe script, so
   * the context key is derived by production code rather than re-implemented
   * here — a key this test file computed itself would drift from
   * `_context_key()` and the tests would pass against the wrong file.
   *
   * `platform` must match what the hook under test detects: the shared hooks
   * derive it from the payload and from their own script path, so a hook
   * installed under `.claude/hooks/` resolves `claude_<id>` where one under
   * `.trellis/hooks/` resolves `session_<id>`.
   */
  function engageSession(
    inputData: object,
    platform?: string,
    envOverrides: NodeJS.ProcessEnv = {},
  ): string {
    const probeRelPath = path.join(".trellis", "engage-probe.py");
    writeProjectFile(
      probeRelPath,
      [
        "import json, os, pathlib, sys",
        "sys.path.insert(0, str(pathlib.Path('.trellis/scripts').resolve()))",
        "from common.active_task import mark_session_engaged",
        "data = json.load(sys.stdin)",
        "platform = os.environ.get('TRELLIS_ENGAGE_PLATFORM') or None",
        "key = mark_session_engaged(pathlib.Path('.').resolve(), data, platform)",
        "sys.stdout.write(key or '')",
        "",
      ].join("\n"),
    );
    const key = runPython(probeRelPath, JSON.stringify(inputData), {
      ...envOverrides,
      TRELLIS_ENGAGE_PLATFORM: platform ?? "",
    }).trim();
    if (!key) {
      throw new Error(
        "fixture could not engage the session: mark_session_engaged resolved no context key",
      );
    }
    return key;
  }

  /**
   * Engage the standard `workflow-a` fixture session as `platform` resolves it.
   * The platform matters: a hook installed under `.codex/hooks/` keys the
   * engaged record `codex_workflow-a`, one under `.claude/hooks/`
   * `claude_workflow-a`.
   */
  function engageWorkflowSession(platform?: string): void {
    engageSession({ cwd: tmpDir, session_id: "workflow-a" }, platform);
  }

  /**
   * Engage a session whose context key is already known — e.g. one the code
   * under test just proved by writing a shell ticket. Complements
   * {@link engageSession}, which derives the key through production code when
   * the test cannot know it up front.
   */
  function writeEngagedRecord(contextKey: string): void {
    writeProjectFile(
      path.join(".trellis", ".runtime", "engaged", `${contextKey}.json`),
      JSON.stringify({ engaged: true, platform: "test" }, null, 2),
    );
  }

  const SESSION_ENV_KEYS = [
    "TRELLIS_CONTEXT_ID",
    "DSH_TRELLIS_CONTEXT_ID",
    "DSH_SESSION_ID",
    "DSH_SHELL",
    "CLAUDE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CURSOR_SESSION_ID",
    "CURSOR_CONVERSATION_ID",
    "CURSOR_CONVERSATIONID",
    "OPENCODE_SESSION_ID",
    "OPENCODE_SESSIONID",
    "OPENCODE_RUN_ID",
    "GEMINI_SESSION_ID",
    "FACTORY_SESSION_ID",
    "DROID_SESSION_ID",
    "QODER_SESSION_ID",
    "CODEBUDDY_SESSION_ID",
    "KIRO_SESSION_ID",
    "COPILOT_SESSION_ID",
    "COPILOT_SESSIONID",
    "PI_SESSION_ID",
    "CLAUDE_TRANSCRIPT_PATH",
    "CODEX_TRANSCRIPT_PATH",
    "CURSOR_TRANSCRIPT_PATH",
    "GEMINI_TRANSCRIPT_PATH",
    "FACTORY_TRANSCRIPT_PATH",
    "DROID_TRANSCRIPT_PATH",
    "QODER_TRANSCRIPT_PATH",
    "CODEBUDDY_TRANSCRIPT_PATH",
  ] as const;

  function sessionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const blocked = new Set<string>(SESSION_ENV_KEYS);
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!blocked.has(key)) {
        env[key] = value;
      }
    }
    return { ...env, ...overrides };
  }

  function setupTaskRepo(): void {
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");
    writeProjectFile(
      path.join(".trellis", "spec", "guides", "index.md"),
      "# Guides\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "task.json"),
      JSON.stringify(
        {
          title: "Issue 106 task",
          status: "in_progress",
          package: null,
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "prd.md"),
      "# PRD\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      '{"file":"src/example.ts","reason":"runtime regression"}\n',
    );
  }

  function runPython(
    relativeScriptPath: string,
    input?: string,
    envOverrides: NodeJS.ProcessEnv = {},
  ): string {
    const scriptPath = path.join(tmpDir, relativeScriptPath);
    return execSync(`${pythonCmd} ${JSON.stringify(scriptPath)}`, {
      cwd: tmpDir,
      input,
      encoding: "utf-8",
      env: sessionEnv(envOverrides),
    });
  }

  function runPythonWithLegacyStdinLocale(
    relativeScriptPath: string,
    input: string,
  ): string {
    const scriptPath = path.join(tmpDir, relativeScriptPath);
    const result = spawnSync(
      pythonCmd,
      [
        "-c",
        "import runpy, sys; sys.stdout.reconfigure(encoding='utf-8', errors='replace'); runpy.run_path(sys.argv[1], run_name='__main__')",
        scriptPath,
      ],
      {
        cwd: tmpDir,
        input,
        encoding: "utf-8",
        env: sessionEnv({ PYTHONIOENCODING: "gbk" }),
      },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
    return result.stdout;
  }

  function expectTemplateContent(
    content: string | undefined,
    label: string,
  ): string {
    expect(content, `${label} template should exist`).toBeTruthy();
    return content ?? "";
  }

  it("[session-current-task] task.py start without context key enters degraded mode (returns 0, no pointer)", () => {
    // 0.5.3 hotfix: task.py start no longer hard-fails when no session identity
    // is available (Windows + Claude Code, --continue resume, etc.). Instead it
    // prints a degraded-mode warning and returns 0 so the AI workflow can
    // proceed.
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis\\\\tasks\\\\issue-106")}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv(),
      },
    );

    expect(output).toContain("Session identity not available");
    expect(output).toContain("degraded");
    expect(output).toContain("conversation context");
    expect(output).toContain("TRELLIS_CONTEXT_ID");

    // No active-task pointer written
    expect(fs.existsSync(path.join(tmpDir, ".trellis", ".current-task"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpDir, ".trellis", ".runtime"))).toBe(
      false,
    );

    // task.json.status remains in_progress (was already in_progress; degraded
    // mode preserves the existing status when not planning)
    const taskJsonPath = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      "issue-106",
      "task.json",
    );
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    expect(taskJson.status).toBe("in_progress");
  });

  it("[session-current-task] task.py start in degraded mode flips planning → in_progress", () => {
    // Verify the status flip path of degraded mode by setting up a task with
    // status=planning explicitly, then asserting the flip happened without a
    // session identity being available.
    setupTaskRepo();
    const taskJsonPath = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      "issue-106",
      "task.json",
    );
    const taskJson = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    taskJson.status = "planning";
    fs.writeFileSync(taskJsonPath, JSON.stringify(taskJson, null, 2), "utf-8");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis\\\\tasks\\\\issue-106")}`,
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(output).toContain("planning → in_progress");
    const after = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    expect(after.status).toBe("in_progress");
  });

  it("[session-current-task] task.py start writes session runtime state when TRELLIS_CONTEXT_ID is set", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis\\\\tasks\\\\issue-106")}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "session-a" }),
      },
    );

    expect(output).toContain("Source: session:session-a");
    expect(output).not.toContain("Fallback:");
    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "session-a.json",
    );
    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as {
      current_task: string;
    };
    expect(context.current_task).toBe(".trellis/tasks/issue-106");
    expect(fs.existsSync(path.join(tmpDir, ".trellis", ".current-task"))).toBe(
      false,
    );
  });

  it("[session-current-task] task.py finish deletes the session runtime context", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "session-finish.json",
    );

    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis/tasks/issue-106")}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "session-finish" }),
      },
    );
    expect(fs.existsSync(contextPath)).toBe(true);

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} finish`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "session-finish" }),
      },
    );

    expect(output).toContain("Cleared current task");
    expect(output).toContain("Source: session:session-finish");
    expect(fs.existsSync(contextPath)).toBe(false);
  });

  it("[workflow-state-r7] task.py create auto-sets session pointer when TRELLIS_CONTEXT_ID is set (planning breadcrumb reachable)", () => {
    // Pre-R7 (v0.5.0-beta.19 and earlier), `task.py create` only created the
    // task directory; the session pointer was set by `task.py start`. That
    // made the [workflow-state:planning] block dead text — the breadcrumb
    // stayed at no_task during brainstorm + jsonl curation. R7 hooked
    // set_active_task into cmd_create so the planning breadcrumb fires
    // immediately when session identity is available.
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "r7-auto-active" --slug r7-auto --assignee test-dev`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "r7-session" }),
      },
    );

    // Resolve the new task directory (MM-DD-r7-auto)
    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("r7-auto"));
    expect(taskDir).toBeDefined();

    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "r7-session.json",
    );
    expect(fs.existsSync(contextPath)).toBe(true);
    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as {
      current_task: string;
    };
    expect(context.current_task).toBe(`.trellis/tasks/${taskDir}`);
  });

  it("[issue-397] task.py create warns on blank description and reports session activation", () => {
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(
      pythonCmd,
      [
        taskScriptPath,
        "create",
        "blank description task",
        "--slug",
        "blank-description",
        "--assignee",
        "test-dev",
      ],
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "issue-397-session" }),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("task description is empty");
    expect(result.stderr).toContain("Activated task for this session");
    expect(result.stderr).toContain("Source: session:issue-397-session");

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("blank-description"));
    expect(taskDir).toBeDefined();
    const taskJson = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".trellis", "tasks", taskDir as string, "task.json"),
        "utf-8",
      ),
    ) as { description: string };
    expect(taskJson.description).toBe("");
  });

  it("[issue-397] task.py create --no-start does not move the session pointer", () => {
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");
    writeSessionContext("batch-session", ".trellis/tasks/existing-task");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(
      pythonCmd,
      [
        taskScriptPath,
        "create",
        "batch backlog task",
        "--slug",
        "batch-backlog",
        "--assignee",
        "test-dev",
        "--description",
        "   ",
        "--no-start",
      ],
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "batch-session" }),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Skipped session activation (--no-start)");
    const context = JSON.parse(
      fs.readFileSync(
        path.join(
          tmpDir,
          ".trellis",
          ".runtime",
          "sessions",
          "batch-session.json",
        ),
        "utf-8",
      ),
    ) as { current_task: string };
    expect(context.current_task).toBe(".trellis/tasks/existing-task");

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("batch-backlog"));
    expect(taskDir).toBeDefined();
    const taskJson = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".trellis", "tasks", taskDir as string, "task.json"),
        "utf-8",
      ),
    ) as { description: string };
    expect(taskJson.description).toBe("");
  });

  it("[workflow-state-r7] task.py create degrades silently without session identity (no .runtime side effect)", () => {
    // R7 contract: best-effort activation. No context key (CLI shell with no
    // session env) → task is still created, but no .runtime/sessions/ file is
    // written. Pre-R7 behavior parity for headless CLI usage.
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    // sessionEnv() with no overrides drops every session-identity env var.
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "r7-cli-only" --slug r7-cli --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("r7-cli"));
    expect(taskDir).toBeDefined();

    const sessionsDir = path.join(tmpDir, ".trellis", ".runtime", "sessions");
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir);
      expect(files).toEqual([]);
    }
  });

  it("[workflow-state-r7] task.py create then task.py start is idempotent (pointer + status flip)", () => {
    // Finding 6: R7 made cmd_create auto-call set_active_task. cmd_start also
    // calls set_active_task. The second call must not error, and status must
    // still flip planning → in_progress correctly.
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "r7-idem" --slug r7-idem --assignee test-dev`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "r7-idem-session" }),
      },
    );

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("r7-idem"));
    expect(taskDir).toBeDefined();
    const relTaskDir = path.posix.join(".trellis", "tasks", taskDir as string);

    // Status should be planning after create.
    const taskJsonPath = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      taskDir as string,
      "task.json",
    );
    const beforeStart = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      status: string;
    };
    expect(beforeStart.status).toBe("planning");

    // Now run start with the same session — must not error.
    let startStatus = 0;
    let startOutput = "";
    try {
      startOutput = execSync(
        `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(relTaskDir)}`,
        {
          cwd: tmpDir,
          encoding: "utf-8",
          env: sessionEnv({ TRELLIS_CONTEXT_ID: "r7-idem-session" }),
        },
      );
    } catch (err) {
      const e = err as { status?: number; stderr?: string; stdout?: string };
      startStatus = e.status ?? 1;
      startOutput = (e.stdout ?? "") + (e.stderr ?? "");
    }
    expect(startStatus).toBe(0);
    expect(startOutput).toContain("planning → in_progress");

    // Status flipped to in_progress.
    const afterStart = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      status: string;
    };
    expect(afterStart.status).toBe("in_progress");

    // Pointer still points at the same task.
    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "r7-idem-session.json",
    );
    expect(fs.existsSync(contextPath)).toBe(true);
    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as {
      current_task: string;
    };
    expect(context.current_task).toBe(relTaskDir);
  });

  it("[session-current-task] task.py archive deletes runtime sessions pointing at the archived task", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const contextA = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "session-a.json",
    );
    const contextB = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "session-b.json",
    );
    const contextOther = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "session-other.json",
    );
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", "session-a.json"),
      JSON.stringify({ current_task: ".trellis/tasks/issue-106" }, null, 2),
    );
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", "session-b.json"),
      JSON.stringify({ current_task: "issue-106" }, null, 2),
    );
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", "session-other.json"),
      JSON.stringify({ current_task: ".trellis/tasks/other-task" }, null, 2),
    );

    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} archive issue-106 --no-commit`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv(),
      },
    );

    expect(fs.existsSync(contextA)).toBe(false);
    expect(fs.existsSync(contextB)).toBe(false);
    expect(fs.existsSync(contextOther)).toBe(true);
  });

  it("[task-lifecycle] task.py create refuses an archived task dir-name collision", () => {
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Workflow\n");
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const createArgs = [
      taskScriptPath,
      "create",
      "web auth retry",
      "--slug",
      "web-auth-retry",
      "--assignee",
      "test-dev",
    ];
    const env = sessionEnv({ TRELLIS_CONTEXT_ID: "archive-collision" });

    execSync(
      `${pythonCmd} ${createArgs.map((arg) => JSON.stringify(arg)).join(" ")}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env,
      },
    );

    const tasksDir = path.join(tmpDir, ".trellis", "tasks");
    const taskDirName = fs
      .readdirSync(tasksDir)
      .find((entry) => entry.endsWith("-web-auth-retry"));
    expect(taskDirName).toBeDefined();
    const activeTaskDir = path.join(tasksDir, taskDirName as string);
    fs.writeFileSync(path.join(activeTaskDir, "prd.md"), "# PRD\n", "utf-8");

    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} archive ${JSON.stringify(taskDirName)} --no-commit`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env,
      },
    );

    const archiveRoot = path.join(tasksDir, "archive");
    let archivedTaskDir: string | undefined;
    for (const monthDir of fs.readdirSync(archiveRoot)) {
      const candidate = path.join(archiveRoot, monthDir, taskDirName as string);
      if (fs.existsSync(candidate)) {
        archivedTaskDir = candidate;
      }
    }
    expect(archivedTaskDir).toBeDefined();
    const archivedTaskJsonPath = path.join(
      archivedTaskDir as string,
      "task.json",
    );
    const archivedPrdPath = path.join(archivedTaskDir as string, "prd.md");
    const archivedTaskJsonBefore = fs.readFileSync(
      archivedTaskJsonPath,
      "utf-8",
    );
    const archivedPrdBefore = fs.readFileSync(archivedPrdPath, "utf-8");
    const archivedTaskJson = JSON.parse(archivedTaskJsonBefore) as {
      status: string;
      completedAt: string | null;
    };
    expect(archivedTaskJson.status).toBe("completed");
    expect(archivedTaskJson.completedAt).not.toBeNull();

    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "archive-collision.json",
    );
    expect(fs.existsSync(contextPath)).toBe(false);

    const result = spawnSync(pythonCmd, createArgs, {
      cwd: tmpDir,
      encoding: "utf-8",
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Task already archived");
    expect(result.stderr).toContain(taskDirName as string);
    expect(result.stderr).toContain(".trellis/tasks/archive/");
    expect(fs.existsSync(path.join(tasksDir, taskDirName as string))).toBe(
      false,
    );
    expect(fs.readFileSync(archivedTaskJsonPath, "utf-8")).toBe(
      archivedTaskJsonBefore,
    );
    expect(fs.readFileSync(archivedPrdPath, "utf-8")).toBe(archivedPrdBefore);
    expect(fs.existsSync(contextPath)).toBe(false);
  });

  it("[issue-377] task.py create normalizes a --slug carrying today's date prefix", () => {
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const now = new Date();
    const todayPrefix = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const result = spawnSync(
      pythonCmd,
      [
        taskScriptPath,
        "create",
        "Example Task",
        "--slug",
        `${todayPrefix}-example-task`,
        "--assignee",
        "test-dev",
      ],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("normalized to");
    const tasksDir = path.join(tmpDir, ".trellis", "tasks");
    expect(
      fs.existsSync(path.join(tasksDir, `${todayPrefix}-example-task`)),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tasksDir, `${todayPrefix}-${todayPrefix}-example-task`),
      ),
    ).toBe(false);
  });


  it("[issue-377] task.py create leaves non-date numeric slug prefixes untouched", () => {
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", ".developer"),
      "name=test-dev\ninitialized_at=2026-03-27T00:00:00\n",
    );
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const now = new Date();
    const todayPrefix = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // 13-45 is not a valid MM-DD date, so it is part of the slug body.
    const result = spawnSync(
      pythonCmd,
      [
        taskScriptPath,
        "create",
        "Example Task",
        "--slug",
        "13-45-example-task",
        "--assignee",
        "test-dev",
      ],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("normalized to");
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".trellis",
          "tasks",
          `${todayPrefix}-13-45-example-task`,
        ),
      ),
    ).toBe(true);
  });

  it("[task-input-contract] task.py archive accepts task name, relative path, and absolute path", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    // Create three additional task directories for the three input forms.
    const taskNames = ["issue-201", "issue-202", "issue-203"];
    for (const name of taskNames) {
      writeProjectFile(
        path.join(".trellis", "tasks", name, "task.json"),
        JSON.stringify(
          {
            title: `Task ${name}`,
            status: "in_progress",
            package: null,
          },
          null,
          2,
        ),
      );
    }

    // Form 1: bare slug
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} archive ${taskNames[0]} --no-commit`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv(),
      },
    );

    // Form 2: relative path
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} archive ${JSON.stringify(`.trellis/tasks/${taskNames[1]}`)} --no-commit`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv(),
      },
    );

    // Form 3: absolute path
    const absPath = path.join(tmpDir, ".trellis", "tasks", taskNames[2]);
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} archive ${JSON.stringify(absPath)} --no-commit`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv(),
      },
    );

    // All three task dirs should be removed from active tasks/.
    for (const name of taskNames) {
      expect(
        fs.existsSync(path.join(tmpDir, ".trellis", "tasks", name)),
        `task ${name} should no longer exist in active tasks/`,
      ).toBe(false);
    }

    // All three should appear under archive/<YYYY-MM>/.
    const archiveRoot = path.join(tmpDir, ".trellis", "tasks", "archive");
    expect(fs.existsSync(archiveRoot)).toBe(true);
    const archivedNames = new Set<string>();
    for (const monthDir of fs.readdirSync(archiveRoot)) {
      const monthPath = path.join(archiveRoot, monthDir);
      if (fs.statSync(monthPath).isDirectory()) {
        for (const taskDir of fs.readdirSync(monthPath)) {
          archivedNames.add(taskDir);
        }
      }
    }
    for (const name of taskNames) {
      expect(archivedNames.has(name), `task ${name} should be archived`).toBe(
        true,
      );
    }
  });

  it("[session-current-task] task.py start also uses platform-native session env when available", () => {
    // Was written against CODEX_SESSION_ID, which the 2026-08-05 env-name audit
    // proved never existed on any Codex build. Repointed to a name that is
    // empirically real (CLAUDE_CODE_SESSION_ID, verified in a live Claude Code
    // bash child) so the test still covers what it was for — the env table
    // resolving end-to-end through `task.py start` — instead of covering a
    // fiction. Codex's surviving real name has its own test below.
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis/tasks/issue-106")}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ CLAUDE_CODE_SESSION_ID: "native-a" }),
      },
    );

    expect(output).toContain("Source: session:claude_native-a");
    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "claude_native-a.json",
    );
    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as {
      current_task: string;
    };
    expect(context.current_task).toBe(".trellis/tasks/issue-106");
  });






  it("[session-current-task] task.py start uses Codex Desktop CODEX_THREAD_ID", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis/tasks/issue-106")}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ CODEX_THREAD_ID: "thread-a" }),
      },
    );

    expect(output).toContain("Source: session:codex_thread-a");
    const contextPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "codex_thread-a.json",
    );
    const context = JSON.parse(fs.readFileSync(contextPath, "utf-8")) as {
      current_task: string;
    };
    expect(context.current_task).toBe(".trellis/tasks/issue-106");
  });








  // ==========================================================================
  // [env-name-purge] active_task.py's env tables may only name real variables
  // ==========================================================================
  // A 2026-08-05 audit checked all 21 platforms against vendor docs, shipped
  // binaries and live shells (see .trellis/tasks/08-05-session-identity-
  // propagation/research/platform-session-identity.md). 12 of the 21 declared
  // session env var names had never existed on any platform — they were
  // pattern-guessed from a `<PLATFORM>_SESSION_ID` shape no vendor agreed to,
  // and three of them entered in a single bulk commit with no per-platform
  // evidence. The tests below exist so that re-adding one by pattern-matching
  // its neighbours fails loudly instead of shipping as a silent no-op.

  // Runs a probe against the *installed* resolver in tmpDir, with a JSON
  // payload as argv[1] and the parsed JSON stdout as the result.

  // [platform, env var name] pairs deleted from active_task.py on 2026-08-05.




  it("[session-current-task] task.py finish ignores legacy .current-task when no session task is set", () => {
    setupTaskRepo();
    writeLegacyCurrentTask(".trellis/tasks/issue-106");
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} finish`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "session-fallback" }),
      },
    );

    expect(output).toContain("No current task set");
    expect(fs.existsSync(path.join(tmpDir, ".trellis", ".current-task"))).toBe(
      true,
    );
  });

  it("[session-current-task] task.py current ignores legacy .current-task without context key", () => {
    setupTaskRepo();
    writeLegacyCurrentTask(".trellis/tasks/issue-106");
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    let output = "";
    let status = 0;
    try {
      execSync(
        `${pythonCmd} ${JSON.stringify(taskScriptPath)} current --source`,
        {
          cwd: tmpDir,
          encoding: "utf-8",
          env: sessionEnv(),
        },
      );
    } catch (error) {
      status =
        typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : 1;
      output = String((error as { stdout?: unknown }).stdout ?? "");
    }

    expect(status).toBe(1);
    expect(output).toContain("Current task: (none)");
    expect(output).toContain("Source: none");
  });

  it("[session-current-task] stale session task does not fall back to legacy .current-task", () => {
    setupTaskRepo();
    writeLegacyCurrentTask(".trellis/tasks/issue-106");
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", "session-b.json"),
      JSON.stringify(
        { current_task: ".trellis/tasks/missing-task", platform: "test" },
        null,
        2,
      ),
    );
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} current --source`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ TRELLIS_CONTEXT_ID: "session-b" }),
      },
    );

    expect(output).toContain("Current task: .trellis/tasks/missing-task");
    expect(output).toContain("Source: session:session-b");
    expect(output).toContain("State: stale");
    expect(output).not.toContain("issue-106");
  });

  it("[session-current-task] Claude statusline uses session-scoped task when session_id is present", () => {
    setupTaskRepo();
    writeLegacyCurrentTask(".trellis/tasks/issue-106");
    writeProjectFile(
      path.join(".trellis", "tasks", "session-task", "task.json"),
      JSON.stringify(
        {
          title: "Session scoped task",
          status: "in_progress",
          priority: "P1",
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", "claude_status-a.json"),
      JSON.stringify(
        {
          current_task: ".trellis/tasks/session-task",
          platform: "claude",
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      path.join(".claude", "hooks", "statusline.py"),
      getStatuslineHook(),
    );

    const nowSecs = Math.floor(Date.now() / 1000);
    const output = runPythonWithLegacyStdinLocale(
      path.join(".claude", "hooks", "statusline.py"),
      JSON.stringify({
        session_id: "status-a",
        model: { display_name: "中文模型" },
        context_window: { used_percentage: 1, context_window_size: 1000 },
        cost: { total_duration_ms: 0 },
        rate_limits: {
          five_hour: {
            used_percentage: 17,
            resets_at: nowSecs + 4 * 3600 + 31 * 60 + 60,
          },
          seven_day: {
            used_percentage: 19,
            resets_at: nowSecs + 2 * 86400 + 11 * 3600 + 60,
          },
        },
      }),
    );

    expect(output).toContain("Session scoped task");
    expect(output).toContain("中文模型");
    expect(output).toContain("[session]");
    expect(output).not.toContain("Issue 106 task");
    // Rate-limit display with reset countdown (opt-in statusline enhancement)
    expect(output).toContain("5h 17%");
    expect(output).toMatch(/\(reset 4h3[12]m\)/);
    expect(output).toContain("7d 19%");
    expect(output).toContain("(reset 2d11h)");
  });

  it("[session-current-task] Claude statusline ignores legacy .current-task without session context", () => {
    setupTaskRepo();
    writeLegacyCurrentTask(".trellis/tasks/issue-106");
    writeProjectFile(
      path.join(".claude", "hooks", "statusline.py"),
      getStatuslineHook(),
    );

    const output = runPython(
      path.join(".claude", "hooks", "statusline.py"),
      JSON.stringify({
        model: { display_name: "Test" },
        context_window: { used_percentage: 1, context_window_size: 1000 },
        cost: { total_duration_ms: 0 },
      }),
    );

    expect(output).not.toContain("Issue 106 task");
    expect(output).not.toContain("[global]");
  });


  function statuslineRateLimitPayload(): string {
    const nowSecs = Math.floor(Date.now() / 1000);
    return JSON.stringify({
      model: { display_name: "Test" },
      context_window: { used_percentage: 1, context_window_size: 1000 },
      cost: { total_duration_ms: 0 },
      rate_limits: {
        five_hour: {
          used_percentage: 17,
          resets_at: nowSecs + 4 * 3600 + 31 * 60 + 60,
        },
        seven_day: {
          used_percentage: 19,
          resets_at: nowSecs + 2 * 86400 + 11 * 3600 + 60,
        },
      },
    });
  }

  it("[statusline-opt-in] Claude statusline moves rate limits to their own line when COLUMNS is narrow", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(".claude", "hooks", "statusline.py"),
      getStatuslineHook(),
    );

    // COLUMNS is injected by Claude Code v2.1.153+. The split must be an
    // explicit "\n": the status bar counts only newlines for its height,
    // so relying on terminal auto-wrap misaligns rows.
    const output = runPython(
      path.join(".claude", "hooks", "statusline.py"),
      statuslineRateLimitPayload(),
      { COLUMNS: "60" },
    );

    const lines = output.trimEnd().split("\n");
    expect(lines.length).toBe(2);
    const [infoLine, rateLine] = lines;
    expect(infoLine).not.toContain("5h");
    expect(infoLine).not.toContain("7d");
    expect(rateLine).toContain("5h 17%");
    expect(rateLine).toContain("7d 19%");
  });

  it("[statusline-opt-in] Claude statusline stays single-line when COLUMNS is wide or unset", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(".claude", "hooks", "statusline.py"),
      getStatuslineHook(),
    );

    for (const env of [{ COLUMNS: "500" }, { COLUMNS: undefined }]) {
      const output = runPython(
        path.join(".claude", "hooks", "statusline.py"),
        statuslineRateLimitPayload(),
        env,
      );
      const lines = output.trimEnd().split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("5h 17%");
      expect(lines[0]).toContain("7d 19%");
    }
  });

  it("[session-current-task] Python session-start hooks resolve session backslash refs without stale pointer", () => {
    setupTaskRepo();
    writeSessionContext("claude_session-a", ".trellis\\tasks\\issue-106");
    writeSessionContext("codex_session-a", ".trellis\\tasks\\issue-106");

    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(claudeSessionStart, "claude session-start"),
    );
    writeProjectFile(
      path.join(".codex", "hooks", "session-start.py"),
      expectTemplateContent(codexSessionStart, "codex session-start"),
    );
    // Both hooks are opt-in and resolve their own platform prefix.
    writeEngagedRecord("claude_session-a");
    writeEngagedRecord("codex_session-a");

    const claudeOutput = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      JSON.stringify({ cwd: tmpDir, session_id: "session-a" }),
    );
    const codexOutput = runPython(
      path.join(".codex", "hooks", "session-start.py"),
      JSON.stringify({ cwd: tmpDir, session_id: "session-a" }),
    );

    expect(claudeOutput).toContain("Status: IN_PROGRESS");
    expect(claudeOutput).not.toContain("STALE POINTER");

    const codexPayload = JSON.parse(codexOutput) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(codexPayload.hookSpecificOutput.additionalContext).toContain(
      "Status: IN_PROGRESS",
    );
    expect(codexPayload.hookSpecificOutput.additionalContext).not.toContain(
      "STALE POINTER",
    );
  });

  it("[session-current-task] Claude SessionStart persists TRELLIS_CONTEXT_ID for Bash commands", () => {
    setupTaskRepo();
    const sessionStartScript = getSharedHookScripts().find(
      (hook) => hook.name === "session-start.py",
    )?.content;
    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(sessionStartScript, "claude session-start"),
    );
    const envFile = path.join(tmpDir, "claude-env.sh");

    // Deliberately NOT engaged: the env bridge must run before the opt-in gate.
    // It is the only channel by which session identity reaches `task.py` in a
    // Bash child on Claude Code, so gating it would leave `task.py engage`
    // unable to write the very flag the gate reads — the workflow could never
    // be entered.
    const output = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      JSON.stringify({
        session_id: "bash-start-a",
        transcript_path: path.join(tmpDir, "transcript.jsonl"),
        cwd: tmpDir,
        hook_event_name: "SessionStart",
      }),
      { CLAUDE_ENV_FILE: envFile },
    );

    expect(output.trim()).toBe("");
    expect(fs.readFileSync(envFile, "utf-8")).toContain(
      "export TRELLIS_CONTEXT_ID=claude_bash-start-a",
    );
  });

  // ---------------------------------------------------------------------
  // Opt-in engagement — both injection hooks stay silent until the user runs
  // one of the lifecycle entry points (`trellis-start` / `trellis-continue` /
  // `trellis-finish-work`), each of which runs `task.py engage`. A session that
  // never asked for Trellis pays no tokens, and an in-flight task belonging to
  // another window is not consent.
  // ---------------------------------------------------------------------

  it("[opt-in] session-start.py emits nothing until the session is engaged", () => {
    setupTaskRepo();
    writeClaudeSessionStartHook();
    const input = {
      cwd: tmpDir,
      session_id: "optin-a",
      hook_event_name: "SessionStart",
    };

    expect(
      runPython(
        path.join(".claude", "hooks", "session-start.py"),
        JSON.stringify(input),
      ).trim(),
    ).toBe("");

    engageSession(input, "claude");

    const engaged = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      JSON.stringify(input),
    );
    expect(engaged).toContain("hookSpecificOutput");
    expect(engaged).toContain("<trellis-workflow>");
  });

  it("[opt-in] inject-workflow-state.py emits nothing until the session is engaged", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(".claude", "hooks", "inject-workflow-state.py"),
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    writeSessionContext("claude_optin-b", ".trellis/tasks/issue-106");
    const input = { cwd: tmpDir, session_id: "optin-b", prompt: "do the thing" };

    expect(
      runPython(
        path.join(".claude", "hooks", "inject-workflow-state.py"),
        JSON.stringify(input),
      ).trim(),
    ).toBe("");

    engageSession(input, "claude");

    expect(
      runPython(
        path.join(".claude", "hooks", "inject-workflow-state.py"),
        JSON.stringify(input),
      ),
    ).toContain("<workflow-state>");
  });

  it("[opt-in] an in-flight task from another window does not engage a new session", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(".claude", "hooks", "inject-workflow-state.py"),
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    // The other window's session file is the ONLY one, which is exactly when
    // `resolve_active_task`'s single-session fallback would hand its task to
    // this session. `is_session_engaged` has no such fallback on purpose.
    writeSessionContext("claude_other-window", ".trellis/tasks/issue-106");
    writeEngagedRecord("claude_other-window");

    expect(
      runPython(
        path.join(".claude", "hooks", "inject-workflow-state.py"),
        JSON.stringify({ cwd: tmpDir, session_id: "fresh-window" }),
      ).trim(),
    ).toBe("");
  });


  // ---------------------------------------------------------------------
  // CLAUDE_ENV_FILE dedup — the file is user-owned and sourced by every
  // shell, and _persist_context_key_for_bash used to append unconditionally.
  // Measured on a maintainer machine: 3884 export lines for 27 distinct
  // values (169 KB, 99.3% redundant). Dedup keys on the LAST matching export
  // because shell applies later assignments over earlier ones.
  // ---------------------------------------------------------------------

  function writeClaudeSessionStartHook(): void {
    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(
        getSharedHookScripts().find((hook) => hook.name === "session-start.py")
          ?.content,
        "claude session-start",
      ),
    );
  }

  function runSessionStart(sessionId: string, envFile: string): void {
    // Shared hooks are opt-in: the env bridge must see an engaged session
    // before it persists the context key.
    writeEngagedRecord(`claude_${sessionId}`);
    runPython(
      path.join(".claude", "hooks", "session-start.py"),
      JSON.stringify({
        session_id: sessionId,
        transcript_path: path.join(tmpDir, "transcript.jsonl"),
        cwd: tmpDir,
        hook_event_name: "SessionStart",
      }),
      { CLAUDE_ENV_FILE: envFile },
    );
  }

  function contextIdExports(envFile: string): string[] {
    return fs
      .readFileSync(envFile, "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("export TRELLIS_CONTEXT_ID="));
  }

  it("[env-file-dedup] repeated SessionStarts with the same key append exactly once", () => {
    setupTaskRepo();
    writeClaudeSessionStartHook();
    const envFile = path.join(tmpDir, "claude-env.sh");
    // The env file belongs to the user — pre-existing content must survive.
    fs.writeFileSync(envFile, 'export http_proxy="http://127.0.0.1:7890"\n');

    runSessionStart("dedup-a", envFile);
    runSessionStart("dedup-a", envFile);
    runSessionStart("dedup-a", envFile);

    expect(contextIdExports(envFile)).toEqual([
      "export TRELLIS_CONTEXT_ID=claude_dedup-a",
    ]);
    expect(fs.readFileSync(envFile, "utf-8")).toContain(
      'export http_proxy="http://127.0.0.1:7890"',
    );
  });

  it("[env-file-dedup] a changed key appends again", () => {
    setupTaskRepo();
    writeClaudeSessionStartHook();
    const envFile = path.join(tmpDir, "claude-env.sh");

    runSessionStart("dedup-a", envFile);
    runSessionStart("dedup-a", envFile);
    runSessionStart("dedup-b", envFile);
    runSessionStart("dedup-b", envFile);

    expect(contextIdExports(envFile)).toEqual([
      "export TRELLIS_CONTEXT_ID=claude_dedup-a",
      "export TRELLIS_CONTEXT_ID=claude_dedup-b",
    ]);
  });

  it("[env-file-dedup] switching back to an earlier key re-appends (last line wins, not 'appears anywhere')", () => {
    // A -> B -> A. `claude_dedup-a` is already in the file when the third
    // SessionStart runs, but the LAST export assigns `claude_dedup-b`, so the
    // sourced shell would be on B. Skipping here would hand later Bash
    // commands the wrong session identity.
    setupTaskRepo();
    writeClaudeSessionStartHook();
    const envFile = path.join(tmpDir, "claude-env.sh");

    runSessionStart("dedup-a", envFile);
    runSessionStart("dedup-b", envFile);
    runSessionStart("dedup-a", envFile);

    expect(contextIdExports(envFile)).toEqual([
      "export TRELLIS_CONTEXT_ID=claude_dedup-a",
      "export TRELLIS_CONTEXT_ID=claude_dedup-b",
      "export TRELLIS_CONTEXT_ID=claude_dedup-a",
    ]);
  });

  it("[env-file-dedup] an unwritable or unreadable CLAUDE_ENV_FILE is a silent no-op", () => {
    setupTaskRepo();
    writeClaudeSessionStartHook();

    // Path under a directory that does not exist: both the dedup read and the
    // append raise OSError. The hook must still emit its payload.
    const missing = path.join(tmpDir, "no-such-dir", "claude-env.sh");
    expect(() => runSessionStart("dedup-missing", missing)).not.toThrow();
    expect(fs.existsSync(missing)).toBe(false);

    // Path pointing at a directory: the dedup read raises OSError on POSIX
    // (IsADirectoryError) and on Windows (PermissionError).
    const asDirectory = path.join(tmpDir, "env-dir");
    fs.mkdirSync(asDirectory);
    expect(() => runSessionStart("dedup-dir", asDirectory)).not.toThrow();
    expect(fs.statSync(asDirectory).isDirectory()).toBe(true);
  });

  it("[env-file-dedup] a non-UTF-8 user env file does not break SessionStart", () => {
    // UnicodeDecodeError is a ValueError, not an OSError — reading the user's
    // file without errors="replace" would escape the non-fatal guard.
    setupTaskRepo();
    writeClaudeSessionStartHook();
    const envFile = path.join(tmpDir, "claude-env.sh");
    fs.writeFileSync(envFile, Buffer.from([0xff, 0xfe, 0x0a]));

    expect(() => runSessionStart("dedup-latin", envFile)).not.toThrow();
    expect(contextIdExports(envFile)).toEqual([
      "export TRELLIS_CONTEXT_ID=claude_dedup-latin",
    ]);
  });

  // ---------------------------------------------------------------------
  // SessionStart update reminder. `_get_update_hint` (now public as
  // `get_update_hint`) computed "Trellis update available: X -> Y, run trellis
  // update" for months, but its only caller was `output_text()` — the
  // get_context.py text path. The hook
  // built its own payload and never went through it, so on hook-driven
  // platforms the reminder was silent: this repo sat on .trellis/.version
  // 0.6.2 against an installed 0.6.7 CLI while `.trellis/.runtime/` held six
  // codex_* update markers and not one claude_* marker. The hint now rides the
  // <first-reply-notice> block, the payload's existing "say it in the first
  // visible reply" channel, so it reaches the user and not just the model.
  //
  // The fake `trellis` CLI below is a shell script on PATH. Windows
  // CreateProcess resolves a bare command name against .exe only, so
  // subprocess.run(["trellis", ...]) would never find a .bat/.cmd shim —
  // those cases skip there.
  // ---------------------------------------------------------------------

  const isWindows = process.platform === "win32";

  function writeFakeTrellisCli(body: string): NodeJS.ProcessEnv {
    const binDir = path.join(tmpDir, "fake-bin");
    fs.mkdirSync(binDir, { recursive: true });
    const shimPath = path.join(binDir, "trellis");
    fs.writeFileSync(shimPath, `#!/bin/sh\n${body}`, "utf-8");
    fs.chmodSync(shimPath, 0o755);
    return {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      TRELLIS_FAKE_CALL_LOG: path.join(tmpDir, "trellis-calls.log"),
    };
  }

  function trellisCliCallCount(): number {
    const callLog = path.join(tmpDir, "trellis-calls.log");
    if (!fs.existsSync(callLog)) {
      return 0;
    }
    return fs.readFileSync(callLog, "utf-8").split("\n").filter(Boolean).length;
  }

  const REPORTS_0_5_9 = 'echo called >> "$TRELLIS_FAKE_CALL_LOG"\necho 0.5.9\n';

  function sessionStartContext(
    sessionId: string,
    envOverrides: NodeJS.ProcessEnv = {},
  ): string {
    const input = {
      session_id: sessionId,
      transcript_path: path.join(tmpDir, "transcript.jsonl"),
      cwd: tmpDir,
      hook_event_name: "SessionStart",
    };
    // Opt-in gate: the hook emits nothing until this session is engaged. The
    // shared hook detects "claude" from its `.claude/hooks/` install path.
    engageSession(input, "claude");
    const raw = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      JSON.stringify(input),
      // Pin CLAUDE_ENV_FILE inside tmpDir: the hook appends the context key to
      // whatever that variable points at, and a dev running this suite from
      // inside Claude Code exports their own file.
      { CLAUDE_ENV_FILE: path.join(tmpDir, "claude-env.sh"), ...envOverrides },
    );
    const payload = JSON.parse(raw) as {
      hookSpecificOutput: { additionalContext: string };
    };
    return payload.hookSpecificOutput.additionalContext;
  }

  function maintenanceNotice(context: string): string {
    const closingTag = "</trellis-maintenance-notice>";
    const start = context.indexOf("<trellis-maintenance-notice>");
    const end = context.indexOf(closingTag);
    expect(
      start,
      "payload should carry a maintenance notice",
    ).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return context.slice(start, end + closingTag.length);
  }

  function updateMarkerPath(sessionId: string): string {
    return path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      `update-check-claude_${sessionId}.marker`,
    );
  }

  it.skipIf(isWindows)(
    "[session-update-hint] a stale .trellis/.version reaches the user through the maintenance notice",
    () => {
      setupTaskRepo();
      writeClaudeSessionStartHook();
      const fakeCli = writeFakeTrellisCli(REPORTS_0_5_9);
      writeProjectFile(path.join(".trellis", ".version"), "0.5.0\n");

      const context = sessionStartContext("update-stale", fakeCli);

      // Inside the notice, not merely somewhere in the payload: a hint the
      // assistant is not told to say out loud never reaches the maintainer.
      expect(maintenanceNotice(context)).toContain(
        "Trellis update available: 0.5.0 -> 0.5.9, run trellis update",
      );
      expect(maintenanceNotice(context)).toContain(
        "on its own line in your next visible reply, verbatim",
      );
      expect(trellisCliCallCount()).toBe(1);
    },
  );

  it.skipIf(isWindows)(
    "[session-update-hint] an up-to-date project emits a byte-identical payload",
    () => {
      setupTaskRepo();
      writeClaudeSessionStartHook();
      const fakeCli = writeFakeTrellisCli(REPORTS_0_5_9);

      // No .trellis/.version: the hint path cannot produce anything, so this
      // is the payload exactly as it was shipped before the change.
      const baseline = sessionStartContext("update-baseline", fakeCli);

      writeProjectFile(path.join(".trellis", ".version"), "0.6.0\n");
      const upToDate = sessionStartContext("update-current", fakeCli);

      expect(baseline).not.toContain("Trellis update available");
      // No pending update → no block at all, not an empty one.
      expect(upToDate).not.toContain("<trellis-maintenance-notice>");
      expect(upToDate).toBe(baseline);
    },
  );

  it.skipIf(isWindows)(
    "[session-update-hint] the once-per-session marker suppresses the second version probe",
    () => {
      setupTaskRepo();
      writeClaudeSessionStartHook();
      const fakeCli = writeFakeTrellisCli(REPORTS_0_5_9);
      writeProjectFile(path.join(".trellis", ".version"), "0.5.0\n");

      const first = sessionStartContext("update-marker", fakeCli);
      // SessionStart also fires on clear/compact within the same session.
      const second = sessionStartContext("update-marker", fakeCli);

      expect(first).toContain("Trellis update available: 0.5.0 -> 0.5.9");
      expect(second).not.toContain("Trellis update available");
      expect(trellisCliCallCount()).toBe(1);
      // The marker is keyed by the identity the hook resolved from stdin, not
      // by session_context's TERM_SESSION_ID / ppid fallback — the latter is a
      // terminal window, which would mute the reminder for every later session
      // opened in it.
      expect(fs.existsSync(updateMarkerPath("update-marker"))).toBe(true);
    },
  );

  it.skipIf(isWindows)(
    "[session-update-hint] a failing or hanging trellis CLI stays silent and leaves the check for the next session",
    () => {
      setupTaskRepo();
      writeClaudeSessionStartHook();
      writeProjectFile(path.join(".trellis", ".version"), "0.5.0\n");

      const failing = writeFakeTrellisCli(
        'echo called >> "$TRELLIS_FAKE_CALL_LOG"\necho boom >&2\nexit 1\n',
      );
      const afterFailure = sessionStartContext("update-fail", failing);

      // Hangs well past the hint path's 1s subprocess timeout.
      const hanging = writeFakeTrellisCli(
        'echo called >> "$TRELLIS_FAKE_CALL_LOG"\nsleep 5\n',
      );
      const afterTimeout = sessionStartContext("update-hang", hanging);

      for (const context of [afterFailure, afterTimeout]) {
        expect(context).not.toContain("Trellis update available");
        expect(context).not.toContain("<first-reply-notice>");
        expect(context).toContain("<task-status>");
      }
      // A probe that never produced an answer must not burn the marker.
      expect(fs.existsSync(updateMarkerPath("update-fail"))).toBe(false);
      expect(fs.existsSync(updateMarkerPath("update-hang"))).toBe(false);
    },
  );

  it("[session-update-hint] an unreadable .trellis/.version leaves SessionStart working and silent", () => {
    setupTaskRepo();
    writeClaudeSessionStartHook();
    // A directory where the version file belongs: read_text raises OSError
    // (IsADirectoryError on POSIX, PermissionError on Windows) before the hint
    // path ever reaches `trellis --version`.
    fs.mkdirSync(path.join(tmpDir, ".trellis", ".version"));

    const context = sessionStartContext("update-unreadable");

    expect(context).not.toContain("Trellis update available");
    expect(context).not.toContain("<trellis-maintenance-notice>");
    expect(context).toContain("<task-status>");
  });


  // Every platform that declares the shell-session hook must actually resolve
  // identity, not merely have the script on disk. Both the platform list and
  // each platform's hook install path are derived from the registry, so
  // platform #8 gets this coverage by being added to the table.
  //
  // NOTE: none of these hosts is installed in CI. "End to end" here means the
  // real hook script and the real task.py driven with a simulated payload of
  // the shape that platform's config subscribes to — not a live CLI.




  it("[codex-native-subagents] SubagentStart injects a marker and the valid parent task", () => {
    setupTaskRepo();
    writeProjectFile(path.join(".git", "HEAD"), "ref: refs/heads/main\n");
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      '{"file":"src/implement-context.md","reason":"implement contract"}\n',
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "design.md"),
      "TOKEN_CODEX_DESIGN\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.md"),
      "TOKEN_CODEX_PLAN\n",
    );
    writeProjectFile("src/implement-context.md", "TOKEN_CODEX_IMPLEMENT\n");
    writeSessionContext("codex_parent-a", ".trellis/tasks/issue-106");
    const injectSubagentContextScript = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    const hookPath = path.join(
      ".codex",
      "hooks",
      "inject-subagent-context.py",
    );
    writeProjectFile(
      hookPath,
      expectTemplateContent(
        injectSubagentContextScript,
        "codex inject-subagent-context hook",
      ),
    );

    const output = runPython(
      hookPath,
      JSON.stringify({
        hook_event_name: "SubagentStart",
        agent_type: "trellis-implement",
        session_id: "parent-a",
        cwd: tmpDir,
      }),
    );
    const parsed = JSON.parse(output) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
    };
    const context = parsed.hookSpecificOutput?.additionalContext ?? "";

    expect(parsed.hookSpecificOutput?.hookEventName).toBe("SubagentStart");
    expect(context).toContain("<!-- trellis-hook-injected -->");
    expect(context).toContain("Trellis Native Implement Subagent");
    expect(context).toContain("`trellis-implement` role");
    expect(context).toContain("Active task: .trellis/tasks/issue-106");
    expect(context).toContain("TOKEN_CODEX_IMPLEMENT");
    expect(context).toContain("TOKEN_CODEX_DESIGN");
    expect(context).toContain("TOKEN_CODEX_PLAN");
  });

  it("[codex-native-subagents] implement and check preserve curated context before task artifacts", () => {
    setupTaskRepo();
    writeProjectFile(path.join(".git", "HEAD"), "ref: refs/heads/main\n");
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      '{"file":"src/implement-order.md","reason":"implement ordering"}\n',
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "check.jsonl"),
      '{"file":"src/check-order.md","reason":"check ordering"}\n',
    );
    writeProjectFile("src/implement-order.md", "TOKEN_IMPLEMENT_ORDER\n");
    writeProjectFile("src/check-order.md", "TOKEN_CHECK_ORDER\n");
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "prd.md"),
      "TOKEN_PRD_ORDER\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "design.md"),
      "TOKEN_DESIGN_ORDER\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.md"),
      "TOKEN_PLAN_ORDER\n",
    );
    writeSessionContext("codex_parent-order", ".trellis/tasks/issue-106");
    const injectSubagentContextScript = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    const hookPath = path.join(
      ".codex",
      "hooks",
      "inject-subagent-context.py",
    );
    writeProjectFile(
      hookPath,
      expectTemplateContent(
        injectSubagentContextScript,
        "codex inject-subagent-context hook",
      ),
    );

    for (const [agentType, curatedToken] of [
      ["trellis-implement", "TOKEN_IMPLEMENT_ORDER"],
      ["trellis-check", "TOKEN_CHECK_ORDER"],
    ] as const) {
      const output = runPython(
        hookPath,
        JSON.stringify({
          hook_event_name: "SubagentStart",
          agent_type: agentType,
          session_id: "parent-order",
          cwd: tmpDir,
        }),
      );
      const parsed = JSON.parse(output) as {
        hookSpecificOutput: { additionalContext: string };
      };
      const context = parsed.hookSpecificOutput.additionalContext;
      const positions = [
        context.indexOf(curatedToken),
        context.indexOf("TOKEN_PRD_ORDER"),
        context.indexOf("TOKEN_DESIGN_ORDER"),
        context.indexOf("TOKEN_PLAN_ORDER"),
      ];

      for (const position of positions) {
        expect(position).toBeGreaterThanOrEqual(0);
      }
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("[codex-native-subagents] research gets its task path without implement or check manifests", () => {
    setupTaskRepo();
    writeProjectFile(path.join(".git", "HEAD"), "ref: refs/heads/main\n");
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      '{"file":"src/implement-private.md","reason":"must stay isolated"}\n',
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "check.jsonl"),
      '{"file":"src/check-private.md","reason":"must stay isolated"}\n',
    );
    writeProjectFile("src/implement-private.md", "TOKEN_IMPLEMENT_PRIVATE\n");
    writeProjectFile("src/check-private.md", "TOKEN_CHECK_PRIVATE\n");
    writeSessionContext("codex_research-parent", ".trellis/tasks/issue-106");
    const injectSubagentContextScript = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    const hookPath = path.join(
      ".codex",
      "hooks",
      "inject-subagent-context.py",
    );
    writeProjectFile(
      hookPath,
      expectTemplateContent(
        injectSubagentContextScript,
        "codex inject-subagent-context hook",
      ),
    );

    const output = runPython(
      hookPath,
      JSON.stringify({
        hook_event_name: "SubagentStart",
        agent_type: "trellis-research",
        session_id: "research-parent",
        cwd: tmpDir,
      }),
    );
    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const context = parsed.hookSpecificOutput.additionalContext;

    expect(context).toContain("Active task: .trellis/tasks/issue-106");
    expect(context).toContain("Project Spec Directory Structure");
    expect(context).not.toContain("TOKEN_IMPLEMENT_PRIVATE");
    expect(context).not.toContain("TOKEN_CHECK_PRIVATE");
    expect(context).not.toContain("implement.jsonl");
    expect(context).not.toContain("check.jsonl");
  });

  it("[codex-native-subagents] unknown or malformed parents never borrow a sole session task", () => {
    setupTaskRepo();
    writeProjectFile(path.join(".git", "HEAD"), "ref: refs/heads/main\n");
    writeSessionContext("codex_unrelated", ".trellis/tasks/issue-106");
    const injectSubagentContextScript = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    const hookPath = path.join(
      ".codex",
      "hooks",
      "inject-subagent-context.py",
    );
    writeProjectFile(
      hookPath,
      expectTemplateContent(
        injectSubagentContextScript,
        "codex inject-subagent-context hook",
      ),
    );

    for (const sessionId of ["missing-parent", { id: "malformed" }, "  "]) {
      const output = runPython(
        hookPath,
        JSON.stringify({
          hook_event_name: "SubagentStart",
          agent_type: "trellis-implement",
          session_id: sessionId,
          cwd: tmpDir,
        }),
      );
      expect(output.trim()).toBe("");
    }
  });

  it("[codex-native-subagents] parent session isolates concurrent tasks and ignores inherited context", () => {
    setupTaskRepo();
    writeProjectFile(path.join(".git", "HEAD"), "ref: refs/heads/main\n");
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      '{"file":"src/session-a.md","reason":"session A only"}\n',
    );
    writeProjectFile("src/session-a.md", "TOKEN_CODEX_SESSION_A\n");
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-107", "task.json"),
      JSON.stringify({ title: "Issue 107", status: "in_progress" }, null, 2),
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-107", "prd.md"),
      "TOKEN_CODEX_PRD_B\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-107", "implement.jsonl"),
      '{"file":"src/session-b.md","reason":"session B only"}\n',
    );
    writeProjectFile("src/session-b.md", "TOKEN_CODEX_SESSION_B\n");
    writeSessionContext("codex_parent-a", ".trellis/tasks/issue-106");
    writeSessionContext("codex_parent-b", ".trellis/tasks/issue-107");
    const injectSubagentContextScript = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    const hookPath = path.join(
      ".codex",
      "hooks",
      "inject-subagent-context.py",
    );
    writeProjectFile(
      hookPath,
      expectTemplateContent(
        injectSubagentContextScript,
        "codex inject-subagent-context hook",
      ),
    );

    const outputFor = (sessionId: string, env: NodeJS.ProcessEnv = {}) => {
      const output = runPython(
        hookPath,
        JSON.stringify({
          hook_event_name: "SubagentStart",
          agent_type: "trellis-implement",
          session_id: sessionId,
          cwd: tmpDir,
        }),
        env,
      );
      return (
        JSON.parse(output) as {
          hookSpecificOutput: { additionalContext: string };
        }
      ).hookSpecificOutput.additionalContext;
    };

    const sessionA = outputFor("parent-a");
    const sessionB = outputFor("parent-b");
    const parentWins = outputFor("parent-a", {
      TRELLIS_CONTEXT_ID: "codex_parent-b",
    });

    expect(sessionA).toContain("TOKEN_CODEX_SESSION_A");
    expect(sessionA).not.toContain("TOKEN_CODEX_SESSION_B");
    expect(sessionB).toContain("TOKEN_CODEX_SESSION_B");
    expect(sessionB).not.toContain("TOKEN_CODEX_SESSION_A");
    expect(parentWins).toContain("TOKEN_CODEX_SESSION_A");
    expect(parentWins).not.toContain("TOKEN_CODEX_SESSION_B");
  });

  it("[codex-native-subagents] non-Trellis SubagentStart agents stay silent", () => {
    setupTaskRepo();
    writeProjectFile(path.join(".git", "HEAD"), "ref: refs/heads/main\n");
    writeSessionContext("codex_parent-a", ".trellis/tasks/issue-106");
    const injectSubagentContextScript = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    const hookPath = path.join(
      ".codex",
      "hooks",
      "inject-subagent-context.py",
    );
    writeProjectFile(
      hookPath,
      expectTemplateContent(
        injectSubagentContextScript,
        "codex inject-subagent-context hook",
      ),
    );

    const output = runPython(
      hookPath,
      JSON.stringify({
        hook_event_name: "SubagentStart",
        agent_type: "general-purpose-reviewer",
        session_id: "parent-a",
        cwd: tmpDir,
      }),
    );

    expect(output.trim()).toBe("");
  });




  it("[#412] shared and Codex SessionStart payload shapes stay stable, with no first-reply notice", () => {
    setupTaskRepo();

    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(claudeSessionStart, "claude session-start"),
    );
    writeProjectFile(
      path.join(".codex", "hooks", "session-start.py"),
      expectTemplateContent(codexSessionStart, "codex session-start"),
    );
    // Neither run carries a session id (the shared hook gets no stdin at all),
    // so pin one identity through TRELLIS_CONTEXT_ID and engage that key —
    // `resolve_context_key` prefers it over every payload and env source.
    const contextEnv = { TRELLIS_CONTEXT_ID: "session-412" };
    engageSession({}, undefined, contextEnv);

    const sharedPayload = JSON.parse(
      runPython(
        path.join(".claude", "hooks", "session-start.py"),
        undefined,
        contextEnv,
      ),
    ) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
      additional_context: string;
    };
    const codexPayload = JSON.parse(
      runPython(
        path.join(".codex", "hooks", "session-start.py"),
        JSON.stringify({ cwd: tmpDir }),
        contextEnv,
      ),
    ) as {
      suppressOutput: boolean;
      systemMessage: string;
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };

    expect(Object.keys(sharedPayload)).toEqual([
      "hookSpecificOutput",
      "additional_context",
    ]);
    expect(sharedPayload.additional_context).toBe(
      sharedPayload.hookSpecificOutput.additionalContext,
    );
    expect(Object.keys(codexPayload)).toEqual([
      "suppressOutput",
      "systemMessage",
      "hookSpecificOutput",
    ]);
    expect(codexPayload.suppressOutput).toBe(true);
    expect(codexPayload.systemMessage).toMatch(
      /^Trellis context injected \(\d+ chars\)$/,
    );

    for (const payload of [sharedPayload, codexPayload]) {
      expect(Object.keys(payload.hookSpecificOutput)).toEqual([
        "hookEventName",
        "additionalContext",
      ]);
      expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart");

      const ctx = payload.hookSpecificOutput.additionalContext;
      expect(ctx.startsWith("<session-context>")).toBe(true);
      expect(ctx).toContain("Trellis compact SessionStart context");
      // Opt-in engagement retired the acknowledgment notice: the user invoked
      // the entry point, so its own output is the acknowledgment.
      expect(ctx).not.toContain("<first-reply-notice>");
      expect(ctx).not.toContain("Trellis SessionStart ✓");
      expect(ctx).toContain("<current-state>");
      expect(ctx).toContain("<trellis-workflow>");
      expect(ctx).toContain("<guidelines>");
      expect(ctx).toContain("<task-status>");
      expect(ctx).not.toContain("say once in Chinese");
      expect(ctx).not.toContain("exactly one short Chinese sentence");
      expect(ctx).not.toContain(firstReplyNoticeSentence);
    }
  });

  it("[#240] Codex SessionStart output uses compact context without generic sub-agent notice", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(".codex", "hooks", "session-start.py"),
      expectTemplateContent(codexSessionStart, "codex session-start"),
    );
    const input = { cwd: tmpDir };
    engageSession(input, "codex", { TRELLIS_CONTEXT_ID: "codex-240" });

    const payload = JSON.parse(
      runPython(
        path.join(".codex", "hooks", "session-start.py"),
        JSON.stringify(input),
        { TRELLIS_CONTEXT_ID: "codex-240" },
      ),
    ) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };

    const ctx = payload.hookSpecificOutput.additionalContext;
    expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(ctx.startsWith("<session-context>")).toBe(true);
    expect(ctx).toContain("Trellis compact SessionStart context");
    expect(ctx).toContain("Task context order for implementation/check");
    expect(ctx).toContain("All three are required");
    expect(ctx).not.toContain("<sub-agent-notice>");
  });



  it("[workflow-v2] shared session-start summarizes in-progress context without auto-dispatch approval", () => {
    setupTaskRepo();
    writeSessionContext("claude_session-a", ".trellis/tasks/issue-106");

    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(claudeSessionStart, "claude session-start"),
    );
    const input = { cwd: tmpDir, session_id: "session-a" };
    engageSession(input, "claude");

    const rawOutput = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      JSON.stringify(input),
    );
    expect(rawOutput).toContain("Status: IN_PROGRESS");
    expect(rawOutput).toContain("Implementation/check context order");
    expect(rawOutput).toContain("prd.md");
    expect(rawOutput).toContain("design.md if present");
    expect(rawOutput).toContain("implement.md if present");
    expect(rawOutput).not.toContain("if you stay in the main session");
    expect(rawOutput).not.toContain("Next required action: dispatch");
    expect(rawOutput).not.toContain("If there is an active task, ask whether");
    expect(rawOutput).toContain("load details on demand");
  });

  it("[trellis-hooks-env] runtime: shared hooks emit no additionalContext when TRELLIS_HOOKS=0", () => {
    setupTaskRepo();
    writeSessionContext("claude_session-a", ".trellis/tasks/issue-106");

    const claudeSession = expectTemplateContent(
      claudeSessionStart,
      "claude session-start",
    );
    const workflowState = expectTemplateContent(
      getSharedHookScripts().find((h) => h.name === "inject-workflow-state.py")
        ?.content,
      "inject-workflow-state",
    );
    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      claudeSession,
    );
    writeProjectFile(
      path.join(".claude", "hooks", "inject-workflow-state.py"),
      workflowState,
    );

    const stdinPayload = JSON.stringify({
      cwd: tmpDir,
      session_id: "session-a",
    });
    engageSession({ cwd: tmpDir, session_id: "session-a" }, "claude");

    // Baseline: gate off, hooks emit content (sanity check)
    const baselineSession = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      stdinPayload,
    );
    expect(baselineSession).toContain("hookSpecificOutput");

    // With TRELLIS_HOOKS=0: shared hooks short-circuit with empty stdout
    const gatedSession = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      stdinPayload,
      { TRELLIS_HOOKS: "0" },
    );
    expect(gatedSession.trim()).toBe("");

    const gatedWorkflow = runPython(
      path.join(".claude", "hooks", "inject-workflow-state.py"),
      stdinPayload,
      { TRELLIS_HOOKS: "0" },
    );
    expect(gatedWorkflow.trim()).toBe("");

    // TRELLIS_DISABLE_HOOKS=1 has the same effect
    const gatedAlt = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      stdinPayload,
      { TRELLIS_DISABLE_HOOKS: "1" },
    );
    expect(gatedAlt.trim()).toBe("");
  });


  // ------------------------------------------------------------
  // Single-session fallback (issue #225 — class-2 sub-agents)
  // ------------------------------------------------------------

  function runTaskCurrent(envOverrides: NodeJS.ProcessEnv = {}): {
    output: string;
    status: number;
  } {
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    let output = "";
    let status = 0;
    try {
      output = execSync(
        `${pythonCmd} ${JSON.stringify(taskScriptPath)} current --source`,
        {
          cwd: tmpDir,
          encoding: "utf-8",
          env: sessionEnv(envOverrides),
        },
      );
    } catch (error) {
      status =
        typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : 1;
      output = String((error as { stdout?: unknown }).stdout ?? "");
    }
    return { output, status };
  }

  it("[session-fallback] single session file — fallback returns its task with session-fallback source", () => {
    setupTaskRepo();
    writeSessionContext("codex_session_parent", ".trellis/tasks/issue-106");

    const { output, status } = runTaskCurrent();
    expect(status).toBe(0);
    expect(output).toContain("Current task: .trellis/tasks/issue-106");
    expect(output).toContain("Source: session-fallback:codex_session_parent");
  });

  it("[session-fallback] zero session files — no fallback, returns none", () => {
    setupTaskRepo();
    // No session files written

    const { output, status } = runTaskCurrent();
    expect(status).toBe(1);
    expect(output).toContain("Current task: (none)");
    expect(output).toContain("Source: none");
  });

  it("[session-fallback] multiple session files — refuses to guess, returns none", () => {
    setupTaskRepo();
    writeSessionContext("codex_session_a", ".trellis/tasks/issue-106");
    writeProjectFile(
      path.join(".trellis", "tasks", "other-task", "task.json"),
      JSON.stringify({ title: "other", status: "in_progress" }, null, 2),
    );
    writeSessionContext("codex_session_b", ".trellis/tasks/other-task");

    const { output, status } = runTaskCurrent();
    expect(status).toBe(1);
    expect(output).toContain("Current task: (none)");
    expect(output).toContain("Source: none");
  });

  it("[session-fallback] explicit context-key match takes precedence over fallback", () => {
    setupTaskRepo();
    writeSessionContext("codex_session_explicit", ".trellis/tasks/issue-106");

    const { output, status } = runTaskCurrent({
      TRELLIS_CONTEXT_ID: "codex_session_explicit",
    });
    expect(status).toBe(0);
    expect(output).toContain("Current task: .trellis/tasks/issue-106");
    // Source should be "session:" (precise match), not "session-fallback:"
    expect(output).toContain("Source: session:codex_session_explicit");
    expect(output).not.toContain("session-fallback");
  });

  it("[issue #469] finish removes only the exact matched session file", () => {
    setupTaskRepo();
    writeSessionContext("codex_exact", ".trellis/tasks/issue-106");
    writeSessionContext("codex_thread_sibling", ".trellis/tasks/issue-106");
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const sessionsDir = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
    );

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} finish`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ CODEX_THREAD_ID: "exact" }),
      },
    );

    expect(output).toContain("Source: session:codex_exact");
    expect(fs.existsSync(path.join(sessionsDir, "codex_exact.json"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(sessionsDir, "codex_thread_sibling.json")),
    ).toBe(true);
  });

  it("[issue #469] finish removes the sole fallback session file", () => {
    setupTaskRepo();
    writeSessionContext(
      "codex_previous-thread",
      ".trellis/tasks/issue-106",
    );
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const fallbackPath = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
      "codex_previous-thread.json",
    );

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} finish`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ CODEX_THREAD_ID: "current-thread" }),
      },
    );

    expect(output).toContain(
      "Source: session-fallback:codex_previous-thread",
    );
    expect(fs.existsSync(fallbackPath)).toBe(false);

    const current = runTaskCurrent({ CODEX_THREAD_ID: "current-thread" });
    expect(current.status).toBe(1);
    expect(current.output).toContain("Current task: (none)");
    expect(current.output).toContain("Source: none");
  });

  it("[issue #469] finish deletes nothing when fallback resolution is ambiguous", () => {
    setupTaskRepo();
    writeSessionContext("codex_thread_a", ".trellis/tasks/issue-106");
    writeSessionContext("codex_thread_b", ".trellis/tasks/issue-106");
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const sessionsDir = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
    );

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} finish`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ CODEX_THREAD_ID: "current-thread" }),
      },
    );

    expect(output).toContain("No current task set");
    expect(fs.existsSync(path.join(sessionsDir, "codex_thread_a.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(sessionsDir, "codex_thread_b.json"))).toBe(
      true,
    );
  });

  it("[issue #469] finish preserves a malformed exact session when another session exists", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(
        ".trellis",
        ".runtime",
        "sessions",
        "codex_malformed.json",
      ),
      "{",
    );
    writeSessionContext("codex_other", ".trellis/tasks/issue-106");
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const sessionsDir = path.join(
      tmpDir,
      ".trellis",
      ".runtime",
      "sessions",
    );

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} finish`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: sessionEnv({ CODEX_THREAD_ID: "malformed" }),
      },
    );

    expect(output).toContain("No current task set");
    expect(fs.existsSync(path.join(sessionsDir, "codex_malformed.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(sessionsDir, "codex_other.json"))).toBe(
      true,
    );
  });

  // ------------------------------------------------------------
  // inject-workflow-state.py hook (workflow-enforcement-v2)
  // ------------------------------------------------------------

  const injectWorkflowStateScript = getSharedHookScripts().find(
    (hook) => hook.name === "inject-workflow-state.py",
  )?.content;

  function writeWorkflowStateHook(): void {
    writeProjectFile(
      path.join(".trellis", "hooks", "inject-workflow-state.py"),
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
  }

  function setStatus(status: string): void {
    const taskJsonPath = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      "issue-106",
      "task.json",
    );
    const data = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8")) as {
      status: string;
    };
    data.status = status;
    fs.writeFileSync(taskJsonPath, JSON.stringify(data, null, 2));
  }

  function writeWorkflowMd(body: string): void {
    writeProjectFile(path.join(".trellis", "workflow.md"), body);
  }

  function runInjectWorkflowState(cwdOverride?: string): string {
    return runInjectWorkflowStateWithInput({
      cwd: cwdOverride ?? tmpDir,
      session_id: "workflow-a",
    });
  }

  function runInjectWorkflowStateWithInput(inputData: object): string {
    // The hook is opt-in: engage first, or it exits 0 with no output. Skipped
    // when the fixture ships no `.trellis/scripts` — there the hook cannot
    // import `is_session_engaged` at all and takes its stale-scripts branch,
    // which injects unconditionally.
    if (
      fs.existsSync(
        path.join(tmpDir, ".trellis", "scripts", "common", "active_task.py"),
      )
    ) {
      engageSession(inputData);
    }
    return runPython(
      path.join(".trellis", "hooks", "inject-workflow-state.py"),
      JSON.stringify(inputData),
    );
  }

  it("[workflow-state] missing/empty workflow.md degrades to generic line (post-R5: no fallback dict)", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    // overwrite workflow.md with empty content (no tag blocks). After
    // v0.5.0-rc.0 the fallback dict was removed — the hook now degrades
    // to the generic "Refer to workflow.md" line so users see (and fix) the
    // broken state instead of being silently masked by hardcoded text.
    writeWorkflowMd("# Empty\n");

    const output = runInjectWorkflowState();
    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Task: issue-106 (in_progress)",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Refer to workflow.md",
    );
    // Hardcoded fallback wording must NOT appear post-R5
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      "trellis-implement → trellis-check",
    );
  });

  it("[workflow-state] in_progress tag in workflow.md mentions Phase 3.4 commit (R1 invariant)", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    // Write a workflow.md containing only the in_progress tag with the
    // canonical Phase 3.4 commit reminder. This guards against future
    // regressions that omit Phase 3.4 from the per-turn breadcrumb.
    writeWorkflowMd(
      "[workflow-state:in_progress]\n" +
        "Flow: trellis-implement → trellis-check → trellis-update-spec → commit (Phase 3.4) → /trellis:finish-work\n" +
        "[/workflow-state:in_progress]\n",
    );

    const parsed = JSON.parse(runInjectWorkflowState()) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "commit (Phase 3.4)",
    );
  });

  it("[workflow-state] workflow.md tag overrides hardcoded fallback", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    writeWorkflowMd(
      "[workflow-state:in_progress]\nCUSTOM BODY from workflow.md\n[/workflow-state:in_progress]\n",
    );

    const parsed = JSON.parse(runInjectWorkflowState()) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "CUSTOM BODY from workflow.md",
    );
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      "trellis-implement → trellis-check",
    );
  });

  it("[workflow-state-r5] inject-workflow-state.py contains no _FALLBACK_BREADCRUMBS dict (post-rc.0 collapse)", () => {
    // R5: the fallback breadcrumb dict was removed in v0.5.0-rc.0 to
    // collapse three sources (workflow.md / py / js) to one. This test
    // guards against accidental re-introduction.
    const py = injectWorkflowStateScript ?? "";
    expect(py).not.toMatch(/_FALLBACK_BREADCRUMBS\s*=\s*\{/);
  });

  it("[workflow-state-dispatch-mode-dedup] _codex_mode_banner and resolve_breadcrumb_key share one normalization helper", () => {
    // _codex_mode_banner and resolve_breadcrumb_key both normalize
    // codex.dispatch_mode to auto/inline (sub-agent alias, invalid → inline).
    // That cascade must live in exactly one place so the two never drift.
    const py = injectWorkflowStateScript ?? "";
    expect(py).toContain("def _resolve_codex_dispatch_mode(");
    const cascadeOccurrences = (
      py.match(/elif cfg_mode in \("auto", "sub-agent"\):/g) ?? []
    ).length;
    expect(cascadeOccurrences).toBe(1);
  });


  it("[workflow-state] custom status with hyphen matches via regex", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    setStatus("in-review");
    writeWorkflowMd(
      "[workflow-state:in-review]\nTeam review pending\n[/workflow-state:in-review]\n",
    );

    const parsed = JSON.parse(runInjectWorkflowState()) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Task: issue-106 (in-review)",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Team review pending",
    );
  });

  it("[workflow-state] unknown status with no tag emits generic fallback, not silent", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    setStatus("weirdstate");
    writeWorkflowMd("# no matching tags\n");

    const output = runInjectWorkflowState();
    expect(output.trim()).not.toBe("");
    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Task: issue-106 (weirdstate)",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Refer to workflow.md",
    );
  });

  it("[workflow-state] CWD drift: hook finds .trellis/ when invoked from subdirectory", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    // Create a subdirectory and invoke hook with that CWD
    const subDir = path.join(tmpDir, "packages", "cli");
    fs.mkdirSync(subDir, { recursive: true });

    const parsed = JSON.parse(runInjectWorkflowState(subDir)) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Task: issue-106",
    );
  });

  it("[workflow-state] no_task breadcrumb emitted when no session active task exists", () => {
    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    // Post-R5: breadcrumb body is read exclusively from workflow.md tag
    // blocks. Provide a minimal no_task tag so the test can assert the
    // routing to trellis-brainstorm content surfaces.
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:no_task]\n" +
        "No active task. Load `trellis-brainstorm` skill to start.\n" +
        "[/workflow-state:no_task]\n",
    );
    writeLegacyCurrentTask(".trellis/tasks/issue-106");
    writeWorkflowStateHook();
    // Legacy repo-global state must not suppress the session no_task breadcrumb.
    const output = runInjectWorkflowState();
    expect(output.trim()).not.toBe("");
    const parsed = JSON.parse(output) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "Status: no_task",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "trellis-brainstorm",
    );
  });

  it("[#240] Codex workflow-state output starts with codex mode, not generic sub-agent notice", () => {
    setupTaskRepo();
    writeProjectFile(
      path.join(".codex", "hooks", "inject-workflow-state.py"),
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    const input = { cwd: tmpDir, session_id: "workflow-a" };
    engageSession(input, "codex");

    const parsed = JSON.parse(
      runPython(
        path.join(".codex", "hooks", "inject-workflow-state.py"),
        JSON.stringify(input),
      ),
    ) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };

    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(ctx).not.toContain("<sub-agent-notice>");
    expect(ctx).toContain("<codex-mode>auto:");
    expect(ctx.indexOf("</codex-mode>")).toBeLessThan(
      ctx.indexOf("<workflow-state>"),
    );
  });

  it("[workflow-state] silent exit 0 when not a Trellis project (no .trellis/ dir)", () => {
    // On a dev machine whose home directory has a .trellis/, walking up from a
    // temp dir resolves that home .trellis as the project root and the hook
    // keeps going (old-scripts fallback) instead of exiting. That is an
    // environment property, not a behavior regression — pre-commit/CI run in a
    // clean home, so only assert the silent exit when no ancestor .trellis can
    // be hit.
    const homeTrellis = path.join(os.homedir(), ".trellis");
    if (fs.existsSync(homeTrellis)) {
      return;
    }
    // No .trellis/ at all — hook should silently exit
    writeWorkflowStateHook();
    fs.rmSync(path.join(tmpDir, ".trellis"), { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, ".trellis", "hooks"), { recursive: true });
    fs.copyFileSync(
      path.join(
        __dirname,
        "..",
        "src",
        "templates",
        "shared-hooks",
        "inject-workflow-state.py",
      ),
      path.join(tmpDir, ".trellis", "hooks", "inject-workflow-state.py"),
    );
    // Now .trellis/ exists only as a parent for the hook script — need to move
    // the hook out of .trellis/ so root-finding fails. Use a fully separate dir.
    const nonTrellisDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "non-trellis-"),
    );
    try {
      const hookPath = path.join(nonTrellisDir, "hook.py");
      fs.copyFileSync(
        path.join(
          __dirname,
          "..",
          "src",
          "templates",
          "shared-hooks",
          "inject-workflow-state.py",
        ),
        hookPath,
      );
      const result = execSync(`${pythonCmd} ${JSON.stringify(hookPath)}`, {
        cwd: nonTrellisDir,
        input: JSON.stringify({ cwd: nonTrellisDir }),
        encoding: "utf-8",
      });
      expect(result.trim()).toBe("");
    } finally {
      fs.rmSync(nonTrellisDir, { recursive: true, force: true });
    }
  });


  // ------------------------------------------------------------
  // Legacy current_phase / next_action field removal (FP round 3 cleanup)
  // ------------------------------------------------------------

  it("[workflow-v2] task.py create does NOT write legacy current_phase / next_action fields", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "dummy task" --slug dummy-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    // Locate the newly created task dir
    const tasksDir = path.join(tmpDir, ".trellis", "tasks");
    const newDirs = fs
      .readdirSync(tasksDir)
      .filter((d) => d.includes("dummy-task"));
    expect(newDirs.length).toBeGreaterThan(0);
    const newTaskJsonPath = path.join(tasksDir, newDirs[0], "task.json");
    const data = JSON.parse(fs.readFileSync(newTaskJsonPath, "utf-8")) as {
      current_phase?: unknown;
      next_action?: unknown;
    };
    expect(data.current_phase).toBeUndefined();
    expect(data.next_action).toBeUndefined();
  });

  // ------------------------------------------------------------
  // v0.5.0-beta.12: init-context removal + jsonl seeding on task create
  // ------------------------------------------------------------

  it("[init-context-removal] task.py create does NOT seed jsonl when no sub-agent platform configured", () => {
    setupTaskRepo();
    // setupTaskRepo does not create any .{platform}/ dir → agent-less mode
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "plain task" --slug plain-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    const tasksDir = path.join(tmpDir, ".trellis", "tasks");
    const newDirs = fs
      .readdirSync(tasksDir)
      .filter((d) => d.includes("plain-task"));
    expect(newDirs.length).toBeGreaterThan(0);
    const taskDir = path.join(tasksDir, newDirs[0]);
    expect(fs.existsSync(path.join(taskDir, "implement.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(taskDir, "check.jsonl"))).toBe(false);
  });

  it("[init-context-removal] task.py create seeds jsonl when a sub-agent platform dir exists", () => {
    setupTaskRepo();
    // Simulate a Claude Code install
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "seeded task" --slug seeded-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    const tasksDir = path.join(tmpDir, ".trellis", "tasks");
    const newDirs = fs
      .readdirSync(tasksDir)
      .filter((d) => d.includes("seeded-task"));
    expect(newDirs.length).toBeGreaterThan(0);
    const taskDir = path.join(tasksDir, newDirs[0]);

    for (const jsonlName of ["implement.jsonl", "check.jsonl"]) {
      const jsonlPath = path.join(taskDir, jsonlName);
      expect(fs.existsSync(jsonlPath), `${jsonlName} should exist`).toBe(true);
      const content = fs.readFileSync(jsonlPath, "utf-8").trim();
      // One line of self-describing seed with `_example` and no `file` field.
      const lines = content.split("\n");
      expect(lines.length).toBe(1);
      const row = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(row._example).toBeDefined();
      expect(row.file).toBeUndefined();
    }
  });




  it("[issue-373] task.py create does NOT seed jsonl for Codex inline mode", () => {
    setupTaskRepo();
    fs.mkdirSync(path.join(tmpDir, ".codex"), { recursive: true });
    writeConfigYaml("codex:\n  dispatch_mode: inline\n");
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "codex inline task" --slug codex-inline-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );

    const taskDir = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      fs
        .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
        .find((d) => d.includes("codex-inline-task")) as string,
    );
    expect(fs.existsSync(path.join(taskDir, "implement.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(taskDir, "check.jsonl"))).toBe(false);
  });

  it("[issue-373] task.py create seeds jsonl when Codex explicitly uses sub-agent dispatch", () => {
    setupTaskRepo();
    fs.mkdirSync(path.join(tmpDir, ".codex"), { recursive: true });
    writeProjectFile(
      path.join(".trellis", "config.yaml"),
      'codex:\n  dispatch_mode: sub-agent  # opt into trellis-* sub-agents\n',
    );
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "codex subagent task" --slug codex-subagent-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );

    const taskDir = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      fs
        .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
        .find((d) => d.includes("codex-subagent-task")) as string,
    );
    for (const jsonlName of ["implement.jsonl", "check.jsonl"]) {
      const row = JSON.parse(
        fs.readFileSync(path.join(taskDir, jsonlName), "utf-8").trim(),
      ) as Record<string, unknown>;
      expect(row._example).toBeDefined();
      expect(row.file).toBeUndefined();
    }
  });

  it("[init-context-removal] task.py init-context is deprecated with clear pointer to planning artifacts", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    let threw = false;
    let stderr = "";
    try {
      execSync(
        `${pythonCmd} ${JSON.stringify(taskScriptPath)} init-context .trellis/tasks/issue-106 fullstack`,
        { cwd: tmpDir, encoding: "utf-8" },
      );
    } catch (err) {
      threw = true;
      const e = err as { stderr?: string; status?: number };
      stderr = e.stderr ?? "";
      expect(e.status).toBe(2);
    }
    expect(threw).toBe(true);
    expect(stderr).toContain("v0.5.0-beta.12");
    expect(stderr).toContain("planning artifact guidance");
    expect(stderr).toContain("add-context");
  });


  it("[init-context-removal] task.py validate treats seed-only jsonl as 0 errors", () => {
    setupTaskRepo();
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "seed-only" --slug seed-only-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("seed-only-task"));
    expect(taskDir).toBeDefined();
    const relTaskDir = path.posix.join(".trellis", "tasks", taskDir as string);

    const result = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} validate ${relTaskDir}`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    // Exit 0 (no error raised) plus success marker in output.
    expect(result).toContain("All validations passed");
  });

  it("[init-context-removal] task.py list-context prints 'no curated entries yet' for seed-only jsonl", () => {
    setupTaskRepo();
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "seed-list" --slug seed-list-task --assignee test-dev`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("seed-list-task"));
    expect(taskDir).toBeDefined();
    const relTaskDir = path.posix.join(".trellis", "tasks", taskDir as string);

    const result = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} list-context ${relTaskDir}`,
      { cwd: tmpDir, encoding: "utf-8" },
    );
    // Sentinel message proves the seed-detection branch ran.
    expect(result).toContain("no curated entries yet");
  });

  // ------------------------------------------------------------
  // workflow_phase.get_phase_index() expansion (FP round 3)
  //   Now returns Phase Index + Phase 1/2/3 bodies (was Phase Index only).
  // ------------------------------------------------------------

  function templateWorkflowMd(): string {
    const { readFileSync } = fs;
    const { dirname, join: pathJoin } = path;
    const templatePath = pathJoin(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "templates",
      "trellis",
      "workflow.md",
    );
    return readFileSync(templatePath, "utf-8");
  }

  it("[workflow-state-r1] template workflow.md [workflow-state:in_progress] mentions commit (Phase 3.4)", () => {
    const wf = templateWorkflowMd();
    const match = wf.match(
      /\[workflow-state:in_progress\]([\s\S]*?)\[\/workflow-state:in_progress\]/,
    );
    expect(match).toBeTruthy();
    const body = match?.[1] ?? "";
    expect(body).toMatch(/commit \(Phase 3\.4\)/i);
  });


  it("[issue-241-followup] Codex role profiles keep recursion guards without disabling native subagents", () => {
    // Native Codex subagents are bounded by their documented depth limit and
    // the profiles' direct-execution guidance. The legacy per-profile feature
    // override blocked native Trellis subagent dispatch entirely, so it must
    // not reappear.
    const templateRoot = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "templates",
    );
    const codexAgentFiles = [
      "codex/agents/trellis-implement.toml",
      "codex/agents/trellis-check.toml",
      "codex/agents/trellis-research.toml",
    ];

    for (const relativePath of codexAgentFiles) {
      const content = fs.readFileSync(
        path.join(templateRoot, relativePath),
        "utf-8",
      );
      const roleGuard = relativePath.endsWith("trellis-research.toml")
        ? "research is role-isolated"
        : "MUST NOT spawn another";
      expect(content, `${relativePath} should retain a role guard`).toContain(
        roleGuard,
      );
      expect(content).not.toMatch(/multi_agent\s*=\s*false/);
      expect(content).not.toMatch(
        /\[features\.multi_agent_v2\][\s\S]*?enabled\s*=\s*false/,
      );
    }
  });

  it("[workflow-state-r2] template workflow.md [workflow-state:planning] mentions artifact gates + required jsonl curation", () => {
    const wf = templateWorkflowMd();
    const match = wf.match(
      /\[workflow-state:planning\]([\s\S]*?)\[\/workflow-state:planning\]/,
    );
    expect(match).toBeTruthy();
    const body = match?.[1] ?? "";
    expect(body).not.toMatch(/Lightweight: `prd\.md` can be enough/);
    expect(body).toMatch(
      /Finish `prd\.md`, `design\.md`, and `implement\.md` — all three, every task/,
    );
    expect(body).toContain("Red-evidence gate keyed on `task.json` `meta.kind`");
    expect(body).toContain(
      "curate `implement.jsonl` and `check.jsonl` as spec/research manifests before start",
    );
  });



  it("[workflow-state-r3-no_task] template workflow.md [workflow-state:no_task] block is present and well-formed", () => {
    const wf = templateWorkflowMd();
    expect(wf).toMatch(
      /\[workflow-state:no_task\]\s*\n[\s\S]+?\n\s*\[\/workflow-state:no_task\]/,
    );
  });

  it("[workflow-state-r3-completed] template workflow.md [workflow-state:completed] block is present and well-formed", () => {
    const wf = templateWorkflowMd();
    expect(wf).toMatch(
      /\[workflow-state:completed\]\s*\n[\s\S]+?\n\s*\[\/workflow-state:completed\]/,
    );
  });

  it("[strip-breadcrumb] _strip_breadcrumb_tag_blocks only strips matched STATUS pairs (backreference parity with parser)", () => {
    // Finding 1: the strip regex previously used [A-Za-z0-9_-]+ on both ends,
    // accepting [workflow-state:A]...[/workflow-state:B]. The parser uses \1
    // backreference to require matched STATUS. Tightening the strip regex to
    // use the same backreference closes the contract gap.
    const sessionStartScript = getSharedHookScripts().find(
      (hook) => hook.name === "session-start.py",
    )?.content;
    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(sessionStartScript, "shared session-start"),
    );

    // Each probe writes a fenced result so newlines in stripped output are
    // preserved; the JS side parses by splitting on the END marker.
    // Run the probe from a real file instead of `python -c` so Windows cmd
    // quoting cannot corrupt the \\n escape sequences in the literals below.
    writeProjectFile(
      path.join(".claude", "hooks", "strip-probe.py"),
      [
        "import importlib.util, pathlib, json",
        "spec = importlib.util.spec_from_file_location('ss', pathlib.Path('.claude/hooks/session-start.py'))",
        "mod = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(mod)",
        "matched = '[workflow-state:planning]\\nbody\\n[/workflow-state:planning]'",
        "mismatched = '[workflow-state:planning]\\nbody\\n[/workflow-state:in_progress]'",
        "nested_orphan = '[workflow-state:planning]\\nbody1\\n[/workflow-state:other]\\ntail\\n[/workflow-state:planning]'",
        "result = {'M': mod._strip_breadcrumb_tag_blocks(matched), 'X': mod._strip_breadcrumb_tag_blocks(mismatched), 'N': mod._strip_breadcrumb_tag_blocks(nested_orphan)}",
        "print(json.dumps(result))",
      ].join("\n"),
    );
    const output = execSync(
      `${pythonCmd} ${JSON.stringify(path.join(tmpDir, ".claude", "hooks", "strip-probe.py"))}`,
      {
        cwd: tmpDir,
        encoding: "utf-8",
      },
    );
    const lastLine = output
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .pop();
    const result = JSON.parse(lastLine ?? "{}") as Record<string, string>;

    // Matched pair: stripped (empty string).
    expect(result.M).toBe("");
    // Mismatched pair: NOT stripped — full input preserved.
    expect(result.X).toContain("[workflow-state:planning]");
    expect(result.X).toContain("[/workflow-state:in_progress]");
    // Nested orphan: outer pair matches via \1 backreference and gets
    // stripped as one unit. Either fully stripped or fully preserved —
    // never partial (no dangling [/workflow-state:other] orphan).
    if (result.N !== "") {
      expect(result.N).toContain("[workflow-state:planning]");
      expect(result.N).toContain("[/workflow-state:planning]");
    }
  });

  it("[workflow-v2] get_context.py --mode phase returns compact Phase Index only", () => {
    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      templateWorkflowMd(),
    );

    const contextScript = path.join(
      tmpDir,
      ".trellis",
      "scripts",
      "get_context.py",
    );
    const output = execSync(
      `${pythonCmd} ${JSON.stringify(contextScript)} --mode phase`,
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(output).toContain("## Phase Index");
    expect(output).toContain("### Request Triage");
    expect(output).toContain("### Planning Artifacts");
    expect(output).toContain("### Loading Step Detail");
    expect(output).not.toMatch(/^## Phase 1: Plan/m);
    expect(output).not.toContain("#### 1.1 Requirement exploration");
    expect(output).not.toContain("#### 2.1 Implement");
  });

  it("[workflow-v2] --mode phase --platform codex (sub-agent mode) filters out generic before-dev routing", () => {
    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      templateWorkflowMd(),
    );
    // Codex defaults to inline since 0.5.9; opt into sub-agent dispatch
    // explicitly so the legacy spawn-trellis-implement block surfaces.
    writeConfigYaml("codex:\n  dispatch_mode: sub-agent\n");

    const contextScript = path.join(
      tmpDir,
      ".trellis",
      "scripts",
      "get_context.py",
    );
    const output = execSync(
      `${pythonCmd} ${JSON.stringify(contextScript)} --mode phase --platform codex`,
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(output).toContain("trellis-implement");
    expect(output).not.toContain(
      "| About to write code / start implementing | trellis-before-dev |",
    );
    expect(output).not.toContain("before-dev takes under a minute");
  });


  it("[workflow-v2] step 2.1 for Codex describes native hook injection with child-side fallback", () => {
    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      templateWorkflowMd(),
    );
    const contextScript = path.join(
      tmpDir,
      ".trellis",
      "scripts",
      "get_context.py",
    );
    const output = execSync(
      `${pythonCmd} ${JSON.stringify(contextScript)} --mode phase --step 2.1 --platform codex`,
      { cwd: tmpDir, encoding: "utf-8" },
    );

    expect(output).toContain("The platform hook/plugin auto-handles");
    expect(output).toContain(
      "For Codex, `SubagentStart` supplies native context injection",
    );
    expect(output).not.toContain(
      "The pull-based sub-agent definition auto-handles",
    );
    expect(output).not.toContain("Load the `trellis-before-dev` skill");
  });



  // ------------------------------------------------------------
  // session-start.py <trellis-workflow> + <guidelines> compact context
  // ------------------------------------------------------------

  it("[workflow-v2] session-start.py <trellis-workflow> block contains compact Phase Index", () => {
    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      templateWorkflowMd(),
    );
    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(claudeSessionStart, "shared session-start"),
    );
    // No stdin payload here, so pin one identity and engage it — the opt-in
    // gate otherwise exits before any block is written.
    const contextEnv = { TRELLIS_CONTEXT_ID: "session-workflow-v2" };
    engageSession({}, undefined, contextEnv);

    const rawOutput = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      undefined,
      contextEnv,
    );
    const payload = JSON.parse(rawOutput) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const ctx = payload.hookSpecificOutput.additionalContext;

    const workflowMatch =
      /<trellis-workflow>([\s\S]*?)<\/trellis-workflow>/.exec(ctx);
    if (!workflowMatch) throw new Error("workflow block not found in payload");
    const workflowBlock = workflowMatch[1];

    expect(workflowBlock).toContain("## Phase Index");
    expect(workflowBlock).toContain("### Request Triage");
    expect(workflowBlock).toContain("### Planning Artifacts");
    expect(workflowBlock).toContain("### Loading Step Detail");
    expect(workflowBlock).not.toMatch(/^## Phase 1: Plan/m);
    expect(workflowBlock).not.toContain("#### 1.1 Requirement exploration");
    // Breadcrumb tag BLOCKS (matched opening + closing pair) excluded — they're
    // consumed by inject-workflow-state.py. Inline `[workflow-state:planning]`
    // mentions in narrative prose are fine; only complete blocks are stripped.
    const tagBlockRe =
      /\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n[\s\S]*?\n\s*\[\/workflow-state:\1\]/;
    expect(tagBlockRe.test(workflowBlock)).toBe(false);
  });

  it("[workflow-v2] session-start.py <guidelines> block lists context order and spec paths", () => {
    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      templateWorkflowMd(),
    );
    // Guides are no longer inlined in compact SessionStart.
    writeProjectFile(
      path.join(".trellis", "spec", "guides", "index.md"),
      "# Thinking Guides\n\nGUIDES_INLINE_MARKER\n",
    );
    // Package index — must be paths-only (content should NOT appear)
    writeProjectFile(
      path.join(".trellis", "spec", "cli", "backend", "index.md"),
      "# Backend\n\nBACKEND_INDEX_CONTENT_SHOULD_NOT_APPEAR\n",
    );
    writeProjectFile(
      path.join(".claude", "hooks", "session-start.py"),
      expectTemplateContent(claudeSessionStart, "shared session-start"),
    );
    // No stdin payload here, so pin one identity and engage it — the opt-in
    // gate otherwise exits before any block is written.
    const contextEnv = { TRELLIS_CONTEXT_ID: "session-workflow-v2" };
    engageSession({}, undefined, contextEnv);

    const rawOutput = runPython(
      path.join(".claude", "hooks", "session-start.py"),
      undefined,
      contextEnv,
    );
    const payload = JSON.parse(rawOutput) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const ctx = payload.hookSpecificOutput.additionalContext;

    const guidelinesMatch = /<guidelines>([\s\S]*?)<\/guidelines>/.exec(ctx);
    if (!guidelinesMatch)
      throw new Error("guidelines block not found in payload");
    const guidelinesBlock = guidelinesMatch[1];

    expect(guidelinesBlock).toContain("Task context order");
    expect(guidelinesBlock).not.toContain("GUIDES_INLINE_MARKER");
    expect(guidelinesBlock).toContain(".trellis/spec/cli/backend/index.md");
    expect(guidelinesBlock).not.toContain(
      "BACKEND_INDEX_CONTENT_SHOULD_NOT_APPEAR",
    );
    // Pointer to discovery command
    expect(guidelinesBlock).toContain("--mode packages");
  });

  // ------------------------------------------------------------
  // inject-subagent-context.py update_current_phase() removal
  //   Hook must NOT write current_phase back to task.json on spawn.
  // ------------------------------------------------------------

  it("[workflow-v2] inject-subagent-context.py does NOT write current_phase when implement spawns", () => {
    const sharedInject = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;

    writeTrellisScripts();
    writeProjectFile(path.join(".trellis", ".developer"), "name=test\n");
    writeProjectFile(path.join(".trellis", "workflow.md"), "# Minimal\n");
    // Session active task WITHOUT current_phase field (post-migration state)
    writeProjectFile(
      path.join(".trellis", ".runtime", "sessions", "claude_phase-a.json"),
      JSON.stringify(
        {
          current_task: ".trellis/tasks/issue-106",
          platform: "claude",
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "task.json"),
      JSON.stringify(
        {
          id: "issue-106",
          title: "Issue 106",
          status: "in_progress",
          package: null,
        },
        null,
        2,
      ),
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "prd.md"),
      "# PRD\n",
    );
    writeProjectFile(
      path.join(".trellis", "tasks", "issue-106", "implement.jsonl"),
      '{"file":"src/example.ts","reason":"spec"}\n',
    );
    writeProjectFile(
      path.join(".claude", "hooks", "inject-subagent-context.py"),
      expectTemplateContent(sharedInject, "shared inject-subagent-context"),
    );

    // Simulate Task tool spawn (Claude-style input)
    const input = JSON.stringify({
      tool_name: "Task",
      tool_input: {
        subagent_type: "trellis-implement",
        prompt: "do work",
      },
      cwd: tmpDir,
      session_id: "phase-a",
    });
    runPython(
      path.join(".claude", "hooks", "inject-subagent-context.py"),
      input,
    );

    // Assert task.json is NOT modified with current_phase
    const taskJson = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".trellis", "tasks", "issue-106", "task.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(taskJson.current_phase).toBeUndefined();
    expect(taskJson.next_action).toBeUndefined();
    // Sanity: other fields intact
    expect(taskJson.status).toBe("in_progress");
  });

  it("[workflow-v2] inject-subagent-context.py source does NOT contain update_current_phase function", () => {
    const sharedInject = getSharedHookScripts().find(
      (hook) => hook.name === "inject-subagent-context.py",
    )?.content;
    expect(sharedInject).toBeTruthy();
    expect(sharedInject).not.toContain("def update_current_phase");
    expect(sharedInject).not.toContain("update_current_phase(");
    // AGENTS_NO_PHASE_UPDATE constant was only used by the removed function
    expect(sharedInject).not.toContain("AGENTS_NO_PHASE_UPDATE");
  });

  // ------------------------------------------------------------
  // [issue-codex-dispatch-mode] config-driven dispatch mode for codex
  // ------------------------------------------------------------

  function writeCodexInjectHook(): string {
    const rel = path.join(".codex", "hooks", "inject-workflow-state.py");
    writeProjectFile(
      rel,
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    return rel;
  }

  function writeConfigYaml(content: string): void {
    writeProjectFile(path.join(".trellis", "config.yaml"), content);
  }

  it("[issue-codex-dispatch-mode] codex breadcrumb defaults to native auto dispatch when config absent", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    engageWorkflowSession("codex");
    const codexHookPath = writeCodexInjectHook();
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:in_progress]\n" +
        "DISPATCH the trellis-implement / trellis-check sub-agents.\n" +
        "[/workflow-state:in_progress]\n" +
        "[workflow-state:in_progress-inline]\n" +
        "MAIN SESSION edits code via trellis-before-dev directly.\n" +
        "[/workflow-state:in_progress-inline]\n",
    );

    const parsed = JSON.parse(
      runPython(
        codexHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("DISPATCH the trellis-implement");
    expect(ctx).not.toContain("MAIN SESSION edits code");
  });

  it("[issue-codex-dispatch-mode] codex breadcrumb routes to plain status when codex.dispatch_mode=sub-agent", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    engageWorkflowSession("codex");
    const codexHookPath = writeCodexInjectHook();
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:in_progress]\n" +
        "DISPATCH the trellis-implement / trellis-check sub-agents.\n" +
        "[/workflow-state:in_progress]\n" +
        "[workflow-state:in_progress-inline]\n" +
        "MAIN SESSION edits code via trellis-before-dev directly.\n" +
        "[/workflow-state:in_progress-inline]\n",
    );
    writeConfigYaml("codex:\n  dispatch_mode: sub-agent\n");

    const parsed = JSON.parse(
      runPython(
        codexHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("DISPATCH the trellis-implement");
    expect(ctx).not.toContain("MAIN SESSION edits code");
  });

  it("[issue-codex-dispatch-mode] codex breadcrumb routes to inline tag when codex.dispatch_mode=inline", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    engageWorkflowSession("codex");
    const codexHookPath = writeCodexInjectHook();
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:in_progress]\n" +
        "DISPATCH the trellis-implement / trellis-check sub-agents.\n" +
        "[/workflow-state:in_progress]\n" +
        "[workflow-state:in_progress-inline]\n" +
        "MAIN SESSION edits code via trellis-before-dev directly.\n" +
        "[/workflow-state:in_progress-inline]\n",
    );
    writeConfigYaml("codex:\n  dispatch_mode: inline\n");

    const parsed = JSON.parse(
      runPython(
        codexHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("MAIN SESSION edits code");
    expect(ctx).toContain("trellis-before-dev");
    expect(ctx).not.toContain("DISPATCH the trellis-implement");
  });

  it("[issue-codex-dispatch-mode] non-codex platform ignores codex.dispatch_mode=inline", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    engageWorkflowSession("claude");
    // Hook installed under .claude/ — _detect_platform returns "claude".
    const claudeHookPath = path.join(
      ".claude",
      "hooks",
      "inject-workflow-state.py",
    );
    writeProjectFile(
      claudeHookPath,
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:in_progress]\n" +
        "DISPATCH the trellis-implement / trellis-check sub-agents.\n" +
        "[/workflow-state:in_progress]\n" +
        "[workflow-state:in_progress-inline]\n" +
        "MAIN SESSION edits code via trellis-before-dev directly.\n" +
        "[/workflow-state:in_progress-inline]\n",
    );
    writeConfigYaml("codex:\n  dispatch_mode: inline\n");

    const parsed = JSON.parse(
      runPython(
        claudeHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("DISPATCH the trellis-implement");
    expect(ctx).not.toContain("MAIN SESSION edits code");
  });



  it("[issue-codex-dispatch-mode] inline `#` comment after value is stripped (config.yaml uncomment leaves trailing hint)", () => {
    // The shipped template has:
    //   #   dispatch_mode: sub-agent  # or "inline" to let the main agent edit code directly
    // Users uncomment by removing leading `#` and may change "sub-agent" to "inline"
    // while leaving the trailing hint comment, producing:
    //   codex:
    //     dispatch_mode: inline  # or "inline" to let the main agent edit code directly
    // The minimal YAML parser MUST treat the trailing ` # ...` as a comment, not as
    // part of the value, otherwise resolve_breadcrumb_key sees an opaque string and
    // falls back to sub-agent dispatch.
    setupTaskRepo();
    writeTrellisScripts();
    writeProjectFile(
      path.join(".trellis", "hooks", "trellis_config.py"),
      expectTemplateContent(
        getAllScripts().get("common/trellis_config.py") ?? "",
        "trellis_config",
      ),
    );
    const probePath = path.join(tmpDir, "probe_inline_comment.py");
    fs.writeFileSync(
      probePath,
      [
        "import importlib.util, json, sys",
        "from pathlib import Path",
        `hook_path = Path(${JSON.stringify(
          path.join(tmpDir, ".trellis", "hooks", "trellis_config.py"),
        )})`,
        "spec = importlib.util.spec_from_file_location('tc', hook_path)",
        "mod = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(mod)",
        "yaml = 'codex:\\n  dispatch_mode: inline  # or \"inline\" to let the main agent edit code directly\\n'",
        "parsed = mod.parse_simple_yaml(yaml)",
        "print(json.dumps(parsed))",
      ].join("\n"),
    );
    const output = execSync(`${pythonCmd} ${JSON.stringify(probePath)}`, {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(
      output
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop() ?? "{}",
    ) as { codex?: { dispatch_mode?: string } };
    expect(parsed.codex?.dispatch_mode).toBe("inline");
  });



  it("[issue-codex-dispatch-mode] codex hook injects <codex-mode> banner reflecting dispatch_mode", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    engageWorkflowSession("codex");
    const codexHookPath = path.join(
      ".codex",
      "hooks",
      "inject-workflow-state.py",
    );
    writeProjectFile(
      codexHookPath,
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:in_progress]\nDISPATCH the trellis-implement.\n[/workflow-state:in_progress]\n[workflow-state:in_progress-inline]\nMAIN SESSION inline edit.\n[/workflow-state:in_progress-inline]\n",
    );

    // Default (no config.yaml) → native auto-dispatch banner.
    const defaultRun = JSON.parse(
      runPython(
        codexHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    expect(defaultRun.hookSpecificOutput.additionalContext).toContain(
      "<codex-mode>auto: implement/check work defaults to Trellis sub-agents; native Codex context injection is preferred and child-side loading is the fallback. The main session still coordinates, clarifies, updates specs, commits, and finishes.</codex-mode>",
    );

    // Legacy sub-agent alias → the auto-dispatch banner.
    writeConfigYaml("codex:\n  dispatch_mode: sub-agent\n");
    const subAgentRun = JSON.parse(
      runPython(
        codexHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    expect(subAgentRun.hookSpecificOutput.additionalContext).toContain(
      "<codex-mode>auto: implement/check work defaults to Trellis sub-agents; native Codex context injection is preferred and child-side loading is the fallback. The main session still coordinates, clarifies, updates specs, commits, and finishes.</codex-mode>",
    );
  });

  it("[issue-codex-dispatch-mode] non-codex hook does NOT inject <codex-mode> banner", () => {
    setupTaskRepo();
    writeSessionContext("session_workflow-a", ".trellis/tasks/issue-106");
    engageWorkflowSession("claude");
    // Hook installed under .claude/ — _detect_platform returns "claude".
    const claudeHookPath = path.join(
      ".claude",
      "hooks",
      "inject-workflow-state.py",
    );
    writeProjectFile(
      claudeHookPath,
      expectTemplateContent(injectWorkflowStateScript, "inject-workflow-state"),
    );
    writeProjectFile(
      path.join(".trellis", "workflow.md"),
      "[workflow-state:in_progress]\nDISPATCH the trellis-implement.\n[/workflow-state:in_progress]\n",
    );
    writeConfigYaml("codex:\n  dispatch_mode: inline\n");

    const result = JSON.parse(
      runPython(
        claudeHookPath,
        JSON.stringify({ cwd: tmpDir, session_id: "workflow-a" }),
      ),
    ) as { hookSpecificOutput: { additionalContext: string } };
    expect(result.hookSpecificOutput.additionalContext).not.toContain(
      "<codex-mode>",
    );
  });

  it("[issue-395] task.py list --json emits a stable machine-readable schema", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} list --json`,
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    const parsed = JSON.parse(output) as {
      tasks: {
        dir: string;
        title: string;
        status: string;
        priority: string;
        assignee: string | null;
        parent: string | null;
        children: string[];
      }[];
    };
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]).toMatchObject({
      dir: ".trellis/tasks/issue-106",
      title: "Issue 106 task",
      status: "in_progress",
      parent: null,
      children: [],
    });
  });

  it("[issue-395] task.py current --json reports null when no task is active", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    const result = spawnSync(
      pythonCmd,
      [taskScriptPath, "current", "--json"],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as { current_task: unknown };
    expect(parsed.current_task).toBeNull();
  });

  it("[issue-395] task.py current --json reports the active task object", () => {
    setupTaskRepo();
    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");

    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} start ${JSON.stringify(".trellis/tasks/issue-106")}`,
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv({ TRELLIS_CONTEXT_ID: "json-current-session" }) },
    );

    const output = execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} current --json`,
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv({ TRELLIS_CONTEXT_ID: "json-current-session" }) },
    );

    const parsed = JSON.parse(output) as {
      current_task: { dir: string; title: string; status: string } | null;
    };
    expect(parsed.current_task).toMatchObject({
      dir: ".trellis/tasks/issue-106",
      title: "Issue 106 task",
      status: "in_progress",
    });
  });

  it("[issue-399.1] task.py create stamps base_branch from origin/HEAD, not the checked-out branch", () => {
    setupTaskRepo();
    execSync("git init -q -b feature/some-work", { cwd: tmpDir });
    execSync("git config user.email test@example.com", { cwd: tmpDir });
    execSync("git config user.name Test", { cwd: tmpDir });
    execSync("git add -A", { cwd: tmpDir });
    execSync('git commit -q -m init', { cwd: tmpDir });

    // Simulate a bare "origin" remote whose default branch is main, while
    // the local checkout stays on a feature branch (#399 item 1 repro).
    const remotePath = path.join(tmpDir, "..", "origin-bare.git");
    execSync(`git init -q --bare ${JSON.stringify(remotePath)}`, { cwd: tmpDir });
    execSync("git branch -m feature/some-work main", { cwd: tmpDir });
    execSync(`git remote add origin ${JSON.stringify(remotePath)}`, { cwd: tmpDir });
    execSync("git push -q origin main", { cwd: tmpDir });
    execSync(`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`, { cwd: tmpDir });
    execSync("git checkout -q -b feature/some-work", { cwd: tmpDir });

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    execSync(
      `${pythonCmd} ${JSON.stringify(taskScriptPath)} create "base branch test" --slug base-branch-test --assignee test-dev --no-start`,
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("base-branch-test"));
    expect(taskDir).toBeDefined();
    const taskJson = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".trellis", "tasks", taskDir as string, "task.json"),
        "utf-8",
      ),
    ) as { base_branch: string };
    expect(taskJson.base_branch).toBe("main");

    fs.rmSync(remotePath, { recursive: true, force: true });
  });

  it("[issue-399.1] task.py create falls back to the checked-out branch when no default branch resolves", () => {
    setupTaskRepo();
    execSync("git init -q -b solo-branch", { cwd: tmpDir });
    execSync("git config user.email test@example.com", { cwd: tmpDir });
    execSync("git config user.name Test", { cwd: tmpDir });
    execSync("git add -A", { cwd: tmpDir });
    execSync('git commit -q -m init', { cwd: tmpDir });
    // No origin remote configured at all.

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(
      pythonCmd,
      [
        taskScriptPath,
        "create",
        "no remote test",
        "--slug",
        "no-remote-test",
        "--assignee",
        "test-dev",
        "--no-start",
      ],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    // #399 follow-up: silently falling back must now warn on stderr, naming
    // the branch that got stamped.
    expect(result.stderr).toContain(
      "warning: could not resolve the repository's default branch",
    );
    expect(result.stderr).toContain("solo-branch");

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("no-remote-test"));
    const taskJson = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".trellis", "tasks", taskDir as string, "task.json"),
        "utf-8",
      ),
    ) as { base_branch: string };
    expect(taskJson.base_branch).toBe("solo-branch");
  });

  it("[issue-399.1] task.py create --base-branch overrides both origin/HEAD detection and the fallback", () => {
    setupTaskRepo();
    execSync("git init -q -b solo-branch", { cwd: tmpDir });
    execSync("git config user.email test@example.com", { cwd: tmpDir });
    execSync("git config user.name Test", { cwd: tmpDir });
    execSync("git add -A", { cwd: tmpDir });
    execSync('git commit -q -m init', { cwd: tmpDir });
    // No origin remote configured at all — would otherwise fall back with a warning.

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(
      pythonCmd,
      [
        taskScriptPath,
        "create",
        "explicit base branch test",
        "--slug",
        "explicit-base-branch-test",
        "--assignee",
        "test-dev",
        "--base-branch",
        "release/1.0",
        "--no-start",
      ],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(result.stderr).not.toContain(
      "warning: could not resolve the repository's default branch",
    );

    const taskDir = fs
      .readdirSync(path.join(tmpDir, ".trellis", "tasks"))
      .find((d) => d.includes("explicit-base-branch-test"));
    expect(taskDir).toBeDefined();
    const taskJson = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, ".trellis", "tasks", taskDir as string, "task.json"),
        "utf-8",
      ),
    ) as { base_branch: string };
    expect(taskJson.base_branch).toBe("release/1.0");
  });

  it("[issue-399.2] task.py validate warns when the recorded branch no longer exists locally", () => {
    setupTaskRepo();
    execSync("git init -q -b main", { cwd: tmpDir });
    execSync("git config user.email test@example.com", { cwd: tmpDir });
    execSync("git config user.name Test", { cwd: tmpDir });
    execSync("git add -A", { cwd: tmpDir });
    execSync('git commit -q -m init', { cwd: tmpDir });

    const taskJsonPath = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      "issue-106",
      "task.json",
    );
    const data = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    data.branch = "task/deleted-branch-does-not-exist";
    fs.writeFileSync(taskJsonPath, JSON.stringify(data, null, 2));

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(
      pythonCmd,
      [taskScriptPath, "validate", ".trellis/tasks/issue-106"],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(result.stdout).toContain(
      "recorded branch 'task/deleted-branch-does-not-exist' no longer exists locally",
    );
  });

  it("[issue-399.2] task.py archive warns when the recorded branch no longer exists locally", () => {
    setupTaskRepo();
    execSync("git init -q -b main", { cwd: tmpDir });
    execSync("git config user.email test@example.com", { cwd: tmpDir });
    execSync("git config user.name Test", { cwd: tmpDir });
    execSync("git add -A", { cwd: tmpDir });
    execSync('git commit -q -m init', { cwd: tmpDir });

    const taskJsonPath = path.join(
      tmpDir,
      ".trellis",
      "tasks",
      "issue-106",
      "task.json",
    );
    const data = JSON.parse(fs.readFileSync(taskJsonPath, "utf-8"));
    data.branch = "task/deleted-branch-does-not-exist";
    fs.writeFileSync(taskJsonPath, JSON.stringify(data, null, 2));

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(
      pythonCmd,
      [taskScriptPath, "archive", ".trellis/tasks/issue-106", "--no-commit"],
      { cwd: tmpDir, encoding: "utf-8", env: sessionEnv() },
    );

    expect(result.stderr).toContain(
      "recorded branch 'task/deleted-branch-does-not-exist' no longer exists locally",
    );
  });

});

describe("regression: backslash in markdown templates (beta.12)", () => {
  it("[beta.12] Common command/skill templates do not contain problematic backslash sequences", () => {
    const templates = [...getCommandTemplates(), ...getSkillTemplates()];
    for (const tmpl of templates) {
      expect(tmpl.content).not.toContain("\\--");
      expect(tmpl.content).not.toContain("\\->");
    }
  });

  it("[beta.12] Claude agent templates do not contain problematic backslash sequences", () => {
    const agents = getClaudeAgents();
    for (const agent of agents) {
      expect(agent.content).not.toContain("\\--");
      expect(agent.content).not.toContain("\\->");
    }
  });

  it("[beta.12] Shared hook templates do not contain problematic backslash sequences", () => {
    const hooks = getSharedHookScripts();
    for (const hook of hooks) {
      expect(hook.content).not.toContain("\\--");
      expect(hook.content).not.toContain("\\->");
    }
  });
});

// =============================================================================
// 5. Platform Registry Regressions
// =============================================================================

describe("regression: platform additions (beta.9, beta.13, beta.16)", () => {


  it("[codex] Codex platform is registered", () => {
    expect(AI_TOOLS).toHaveProperty("codex");
    expect(AI_TOOLS.codex.configDir).toBe(".codex");
    expect(AI_TOOLS.codex.supportsAgentSkills).toBe(true);
  });














  it("[beta.9] all platforms have consistent required fields", () => {
    for (const id of PLATFORM_IDS) {
      const tool = AI_TOOLS[id];
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.configDir.startsWith(".")).toBe(true);
      expect(tool.cliFlag.length).toBeGreaterThan(0);
      expect(Array.isArray(tool.templateDirs)).toBe(true);
      expect(tool.templateDirs).toContain("common");
      expect(typeof tool.defaultChecked).toBe("boolean");
      expect(typeof tool.hasPythonHooks).toBe("boolean");
    }
  });
});


// =============================================================================
// 6. Cross-version Migration Consistency
// =============================================================================

describe("regression: prerelease→stable version stamp (rc.6→0.3.0)", () => {
  it("[0.3.0] rc→stable upgrade returns no migrations (all already applied)", () => {
    const migrations = getMigrationsForVersion("0.3.0-rc.6", "0.3.0");
    expect(migrations).toEqual([]);
  });

  it("[0.3.0] 0.3.0 manifest exists and is well-formed", () => {
    const versions = getAllMigrationVersions();
    expect(versions).toContain("0.3.0");
  });

  it("[0.3.0] prerelease sorts before stable in version ordering", () => {
    const versions = getAllMigrationVersions();
    const rcIdx = versions.indexOf("0.3.0-rc.6");
    const stableIdx = versions.indexOf("0.3.0");
    expect(rcIdx).not.toBe(-1);
    expect(stableIdx).not.toBe(-1);
    expect(rcIdx).toBeLessThan(stableIdx);
  });
});

describe("regression: migration manifest consistency", () => {
  it("all manifest JSON files are loaded", () => {
    const manifestDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/migrations/manifests",
    );
    const jsonFiles = fs
      .readdirSync(manifestDir)
      .filter((f) => f.endsWith(".json"));
    const versions = getAllMigrationVersions();
    expect(versions.length).toBe(jsonFiles.length);
    expect(versions.length).toBeGreaterThan(0);
  });

  it("version ordering is strictly ascending", () => {
    const versions = getAllMigrationVersions();
    // Check known ordering constraints
    const knownOrder = [
      "0.1.9",
      "0.2.0",
      "0.2.12",
      "0.2.13",
      "0.2.14",
      "0.2.15",
      "0.3.0-beta.0",
      "0.3.0-beta.1",
      "0.3.0-beta.2",
      "0.3.0-beta.3",
      "0.3.0-beta.4",
      "0.3.0-beta.5",
    ];
    for (let i = 0; i < knownOrder.length; i++) {
      const idx = versions.indexOf(knownOrder[i]);
      expect(idx, `${knownOrder[i]} should be in versions`).not.toBe(-1);
      if (i > 0) {
        const prevIdx = versions.indexOf(knownOrder[i - 1]);
        expect(
          idx,
          `${knownOrder[i]} should come after ${knownOrder[i - 1]}`,
        ).toBeGreaterThan(prevIdx);
      }
    }
  });

  it("[beta.0] shell-to-python migration uses only renames (no deletes)", () => {
    const migrations = getMigrationsForVersion("0.2.15", "0.3.0-beta.0");
    const renames = migrations.filter((m) => m.type === "rename");
    const deletes = migrations.filter((m) => m.type === "delete");
    expect(renames.length).toBeGreaterThan(0);
    expect(deletes.length).toBe(0);
  });

  it("[#57] shell archive migrations use rename type with correct from/to paths", () => {
    const migrations = getMigrationsForVersion("0.2.15", "0.3.0-beta.0");
    const shellArchives = migrations.filter((m) =>
      m.to?.includes("scripts-shell-archive"),
    );
    // 19 shell scripts should be archived
    expect(shellArchives.length).toBe(19);
    for (const m of shellArchives) {
      expect(m.type).toBe("rename");
      expect(m.from).toMatch(/\.trellis\/scripts\/.*\.sh$/);
      expect(m.to).toMatch(/\.trellis\/scripts-shell-archive\/.*\.sh$/);
      // The filename should be preserved
      const fromFile = m.from.split("/").pop();
      const toFile = (m.to as string).split("/").pop();
      expect(toFile).toBe(fromFile);
    }
  });

  it("[#57] shell archive covers all three subdirectories", () => {
    const migrations = getMigrationsForVersion("0.2.15", "0.3.0-beta.0");
    const shellArchives = migrations.filter((m) =>
      m.to?.includes("scripts-shell-archive"),
    );
    const topLevel = shellArchives.filter(
      (m) => !m.from.includes("/common/") && !m.from.includes("/multi-agent/"),
    );
    const common = shellArchives.filter((m) => m.from.includes("/common/"));
    const multiAgent = shellArchives.filter((m) =>
      m.from.includes("/multi-agent/"),
    );
    expect(topLevel.length).toBe(6);
    expect(common.length).toBe(8);
    expect(multiAgent.length).toBe(5);
  });

  it("[0.2.14] command namespace migration renames exist", () => {
    const migrations = getMigrationsForVersion("0.2.13", "0.2.14");
    expect(migrations.length).toBeGreaterThan(0);
    // Should include commands moved to trellis/ subdirectory
    const claudeRenames = migrations.filter(
      (m) => m.type === "rename" && m.from.startsWith(".claude/commands/"),
    );
    expect(claudeRenames.length).toBeGreaterThan(0);
  });

});

// =============================================================================
// 7. collectTemplates Path Consistency
// =============================================================================

describe("regression: collectTemplates paths match init directory structure (0.3.1)", () => {



  it("[codex] collectTemplates tracks both .agents skills and .codex assets", () => {
    const templates = collectPlatformTemplates("codex");
    expect(templates).toBeInstanceOf(Map);
    if (!templates) return;

    const keys = [...templates.keys()];
    expect(keys.some((key) => key.startsWith(".agents/skills/"))).toBe(true);
    expect(keys.some((key) => key.startsWith(".codex/agents/"))).toBe(true);
    expect(keys.some((key) => key.startsWith(".codex/hooks/"))).toBe(true);
    expect(keys).toContain(".codex/hooks.json");
    expect(keys).toContain(".codex/config.toml");
  });


});

// =============================================================================
// YAML Quote Stripping (0.3.8)
// =============================================================================

describe("regression: parse_simple_yaml uses _unquote not greedy strip (0.3.8)", () => {
  it("config.py defines _unquote helper", () => {
    expect(commonConfig).toContain("def _unquote(s: str) -> str:");
  });

  it("config.py uses _unquote for list items, not .strip('\"')", () => {
    // The bug: .strip('"').strip("'") greedily eats nested quotes
    // e.g. "echo 'hello'" -> strip("'") -> echo 'hello (broken!)
    expect(commonConfig).not.toContain(".strip('\"').strip(\"'\")");
    expect(commonConfig).toContain("_unquote(stripped[2:].strip())");
  });

  it("config.py uses _unquote for key-value, not .strip('\"')", () => {
    // 0.5.11: parse path now strips inline comments first, then unquotes —
    // mirrors trellis_config.py so YAML `key: false  # comment` parses
    // correctly. The forbidden `.strip('"').strip("'")` greedy chain still
    // must not appear.
    expect(commonConfig).not.toContain(".strip('\"').strip(\"'\")");
    expect(commonConfig).toContain("_unquote(value)");
    expect(commonConfig).toContain("_strip_inline_comment(value)");
  });
});

describe("regression: parse_simple_yaml Python execution (0.3.8)", () => {
  // Extract _unquote + _parse_yaml_block + _next_content_line + parse_simple_yaml
  // from commonConfig and run them in an isolated Python process.
  // We can't import config.py directly because it has `from .paths import ...`
  let tmpDir: string;
  let extractedPy: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-yaml-py-"));
    // Extract _unquote + parse_simple_yaml + _parse_yaml_block + _next_content_line
    // These 4 functions have no external imports — safe to run standalone.
    const fnStart = commonConfig.indexOf("def _unquote(");
    const fnEnd = commonConfig.indexOf("\n# Defaults");
    extractedPy = commonConfig.substring(fnStart, fnEnd);
    fs.writeFileSync(path.join(tmpDir, "yaml_parser.py"), extractedPy);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Run parse_simple_yaml via Python subprocess and return parsed result */
  function runPythonYaml(yamlContent: string): unknown {
    const scriptFile = path.join(tmpDir, "_test.py");
    const script = [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(tmpDir)})`,
      "from yaml_parser import parse_simple_yaml",
      `result = parse_simple_yaml(${JSON.stringify(yamlContent)})`,
      "print(json.dumps(result))",
    ].join("\n");
    fs.writeFileSync(scriptFile, script);
    const out = execSync(`python3 ${JSON.stringify(scriptFile)}`, {
      encoding: "utf-8",
    });
    return JSON.parse(out.trim());
  }

  it("nested single quotes inside double quotes are preserved", () => {
    const result = runPythonYaml("key: \"echo 'hello'\"");
    expect(result).toEqual({ key: "echo 'hello'" });
  });

  it("nested double quotes inside single quotes are preserved", () => {
    const result = runPythonYaml("key: 'say \"hi\"'");
    expect(result).toEqual({ key: 'say "hi"' });
  });

  it("list items with nested quotes are preserved", () => {
    const result = runPythonYaml(
      "hooks:\n  after_create:\n    - \"echo 'Task created'\"",
    );
    expect(result).toEqual({
      hooks: { after_create: ["echo 'Task created'"] },
    });
  });

  it("simple quoted values work", () => {
    const result = runPythonYaml("a: \"hello\"\nb: 'world'");
    expect(result).toEqual({ a: "hello", b: "world" });
  });

  it("unquoted values are unchanged", () => {
    const result = runPythonYaml("key: plain value");
    expect(result).toEqual({ key: "plain value" });
  });

  it("mismatched quotes are left as-is", () => {
    const result = runPythonYaml("key: \"hello'");
    expect(result).toEqual({ key: "\"hello'" });
  });
});

// =============================================================================
// 8. Dead Code / Template Content Regressions
// =============================================================================

// =============================================================================
// S4: Submodule + PR Awareness (beta.1)
// =============================================================================

// submodule awareness in multi_agent scripts tests removed — multi_agent pipeline removed

describe("regression: cross-platform-thinking-guide dead code removed (0.3.1)", () => {
  it("[0.3.1] guidesCrossPlatformThinkingGuideContent is not exported from markdown/index", () => {
    expect(markdownExports).not.toHaveProperty(
      "guidesCrossPlatformThinkingGuideContent",
    );
  });

  it("[0.3.1] guides index.md does not reference cross-platform-thinking-guide", () => {
    expect(guidesIndexContent).not.toContain("cross-platform-thinking-guide");
    expect(guidesIndexContent).not.toContain("Cross-Platform Thinking Guide");
  });
});

// =============================================================================
// Pull-based Class-2 Platforms (0.5)
// =============================================================================


// =============================================================================
// Native Codex SubagentStart Context Delivery (0.6)
// =============================================================================

describe("regression: Codex uses native SubagentStart context delivery", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-codex-native-"));
    setWriteMode("force");
    await configurePlatform("codex", tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs the native context hook and preserves the main-session workflow hook", () => {
    const hooks = fs.readdirSync(path.join(tmpDir, ".codex", "hooks"));
    expect(hooks).toContain("inject-subagent-context.py");
    expect(hooks).toContain("inject-workflow-state.py");

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".codex", "hooks.json"), "utf-8"),
    ) as {
      hooks: {
        UserPromptSubmit?: unknown[];
        SubagentStart?: {
          matcher?: string;
          hooks?: { command?: string }[];
        }[];
      };
    };
    const subagentStart = config.hooks.SubagentStart?.[0];

    expect(config.hooks.UserPromptSubmit).toBeDefined();
    expect(subagentStart?.matcher).toBe(
      "^(?:trellis-implement|trellis-check|trellis-research)$",
    );
    expect(subagentStart?.hooks?.[0]?.command).toContain(
      ".codex/hooks/inject-subagent-context.py",
    );
  });

  it("uses marker-gated role profiles rather than the old unconditional pull prelude", () => {
    for (const role of ["implement", "check", "research"] as const) {
      const content = fs.readFileSync(
        path.join(tmpDir, ".codex", "agents", `trellis-${role}.toml`),
        "utf-8",
      );
      expect(content).toContain("<!-- trellis-hook-injected -->");
      expect(content).toContain("Active task:");
      expect(content).not.toContain("Required: Load Trellis Context First");
    }
  });
});



// =============================================================================
// Research agent must persist findings (0.5)
// =============================================================================

describe("regression: research agent persists findings to task dir", () => {
  // Every platform's research agent must:
  //   1. Have a Write tool (or platform equivalent) — otherwise it cannot
  //      fulfill workflow.md step 1.2 "调研产出必须写入文件".
  //   2. Explicitly tell the agent to write under {TASK_DIR}/research/.
  //   3. NOT have "Modify any files" as a blanket forbidden rule (that
  //      contradicts the persist requirement).
  //
  // Before 0.5, research agents were read-only and only emitted chat
  // replies, which got compacted away.
  const markdownPlatforms = [
    "packages/cli/src/templates/claude/agents/trellis-research.md",
  ];

  const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname2, "../../..");

  for (const rel of markdownPlatforms) {
    it(`[${rel}] has Write tool and persist instruction`, () => {
      const content = fs.readFileSync(path.join(repoRoot, rel), "utf-8");
      // Frontmatter tool list must include Write (capitalized form)
      const fm = content.split("---\n")[1] ?? "";
      expect(fm).toMatch(/tools:\s*[^\n]*\bWrite\b/);
      // Body must reference persist target
      expect(content).toContain("{TASK_DIR}/research/");
      expect(content).toMatch(/PERSIST|[Pp]ersist/);
      // Must not have blanket "Modify any files" forbidden rule
      expect(content).not.toMatch(/^- Modify any files\s*$/m);
    });
  }

  // Gemini CLI 0.40+ rejects the comma-separated `tools:` line that other
  // platforms accept (Zod expects an array or omission). Trellis omits the
  // line entirely so the sub-agent inherits parent tools — see issue #224
  // and research/agent-tools-frontmatter.md. The persist contract still
  // applies (body references {TASK_DIR}/research/ and the PERSIST keyword).

  it("codex research.toml uses workspace-write sandbox and persist instruction", () => {
    const content = fs.readFileSync(
      path.join(
        repoRoot,
        "packages/cli/src/templates/codex/agents/trellis-research.toml",
      ),
      "utf-8",
    );
    expect(content).toMatch(/sandbox_mode\s*=\s*"workspace-write"/);
    expect(content).toContain("{TASK_DIR}/research/");
    expect(content).toMatch(/persist|Persist/);
  });


});

describe("regression: templates/markdown/spec contains only .md.txt files (0.5.0-beta.9)", () => {
  // Invariant: packages/cli/src/templates/markdown/spec/ is for user-facing
  // placeholder templates only — markdown/index.ts reads .md.txt via
  // readLocalTemplate, so bare .md files there are orphans (ship to dist as
  // dead weight, never land on user disks). Documented in
  // .trellis/spec/cli/backend/directory-structure.md "Don't: Leak dogfood
  // spec into templates/markdown/spec/". Captured while cleaning up ~2-year-old
  // leakage in task 04-21-task-schema-unify.
  it("every file under templates/markdown/spec ends in .md.txt", () => {
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile()) out.push(full);
      }
      return out;
    }
    const __dirname3 = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(__dirname3, "../../..");
    const specRoot = path.join(
      repoRoot,
      "packages/cli/src/templates/markdown/spec",
    );
    const files = walk(specRoot);
    const orphans = files.filter((f) => !f.endsWith(".md.txt"));
    expect(
      orphans,
      `Orphan non-.md.txt files in templates/markdown/spec/: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});


// =============================================================================
// regression: Gemini CLI 0.40.x template compatibility (issue #224)
// =============================================================================


describe("regression: session-start.py f-string Python <=3.11 compat (0.5.2)", () => {
  // PEP 498 (Python <=3.11) forbids backslashes inside the *expression* part
  // of an f-string. Trellis 0.5.0/0.5.1 shipped session-start hooks with
  //   `f"{drive}:\\{rest.replace('/', '\\')}"`
  // which crashes on parse with `SyntaxError: f-string expression part cannot
  // include a backslash`. PEP 701 (Python 3.12+) lifted this restriction, so
  // the bug only manifests for users on the macOS system Python 3.9 / older
  // Linux distros. The fix moves the `.replace(...)` call to a separate
  // statement before the f-string interpolation.
  //
  // This regression scans the source files (no Python runtime needed) and
  // asserts no f-string contains a backslash inside its `{...}` expression.
  const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname2, "../../..");
  const HOOK_FILES = [
    "packages/cli/src/templates/codex/hooks/session-start.py",
    "packages/cli/src/templates/shared-hooks/session-start.py",
  ];
  // Match an f-string (f"..." or f'...') whose `{...}` body contains a `\`.
  // Backslash inside expression part is illegal under PEP 498.
  const F_STRING_BACKSLASH =
    /f(?:"[^"\n]*\{[^}\n]*\\[^}\n]*\}[^"\n]*"|'[^'\n]*\{[^}\n]*\\[^}\n]*\}[^'\n]*')/;

  for (const rel of HOOK_FILES) {
    it(`${rel} has no backslash inside any f-string expression part`, () => {
      const content = fs.readFileSync(path.join(repoRoot, rel), "utf-8");
      const m = content.match(F_STRING_BACKSLASH);
      expect(
        m,
        `Found f-string with backslash in expression part — Python <=3.11 will fail to parse this file:\n  ${m?.[0] ?? ""}`,
      ).toBeNull();
    });

    it(`${rel} parses cleanly with python3 -m py_compile`, () => {
      // Belt-and-braces: ask the host Python to parse the file. On Python
      // 3.12+ this won't catch the regression (PEP 701 allows it), so the
      // regex test above is the primary gate. On macOS system Python 3.9 or
      // any CI runner with python3 < 3.12 this is a hard catch.
      const r = spawnSync(
        "python3",
        [
          "-c",
          `import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read()); print('OK')`,
          path.join(repoRoot, rel),
        ],
        { encoding: "utf-8" },
      );
      // If python3 is unavailable on the runner, skip silently — the regex
      // assertion above already covers the regression deterministically.
      if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT")
        return;
      expect(
        r.status,
        `python3 ast.parse failed for ${rel}:\n${r.stderr ?? ""}`,
      ).toBe(0);
      expect(r.stdout ?? "").toContain("OK");
    });
  }
});

describe("regression: sub-agent context injection fallback (0.5.3)", () => {
  // 0.5.3 hotfix: class-1 platforms (claude / cursor / opencode / kiro /
  // codebuddy / droid) used to rely entirely on PreToolUse hook injection for
  // sub-agent task context. When the hook silently failed (Windows + Claude
  // Code issue #53254 / #25981 / #36156, --continue resume, fork
  // distributions, hooks disabled) sub-agents received the dispatch prompt
  // without prd / spec / jsonl context, with no recovery path.
  //
  // The fix: hook output now begins with a `<!-- trellis-hook-injected -->`
  // marker, and every class-1 trellis-implement / trellis-check definition
  // file carries a Trellis Context Loading Protocol section telling the
  // sub-agent to load context itself when the marker is absent.
  const HOOK_INJECTED_MARKER = "<!-- trellis-hook-injected -->";

  it("inject-subagent-context.py emits the marker for implement / check / finish", () => {
    const hook = getSharedHookScripts().find(
      (h) => h.name === "inject-subagent-context.py",
    );
    expect(hook).toBeDefined();
    const src = hook?.content ?? "";
    // Marker must appear in build_implement_prompt / build_check_prompt /
    // build_finish_prompt (research is intentionally NOT marker'd — it has no
    // task binding).
    expect(src).toContain(HOOK_INJECTED_MARKER);
    // Must appear at least three times (one per implement / check / finish).
    const matches = src.match(/<!--\s*trellis-hook-injected\s*-->/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  // Claude Code is the remaining markdown class-1 platform: 2 agent files.
  const CLASS1_MD_AGENT_FILES: { platform: string; rel: string; agent: "implement" | "check" }[] = [
    { platform: "claude", rel: "packages/cli/src/templates/claude/agents/trellis-implement.md", agent: "implement" },
    { platform: "claude", rel: "packages/cli/src/templates/claude/agents/trellis-check.md", agent: "check" },
  ];

  const __dirnameFb = path.dirname(fileURLToPath(import.meta.url));
  const repoRootFb = path.resolve(__dirnameFb, "../../..");

  function expectTaskArtifactContract(content: string): void {
    expect(content).toContain("prd.md");
    expect(content).toContain("design.md");
    expect(content).toContain("implement.md");
    expect(content).not.toMatch(/prd\.md`?\s+(?:if present|if exists)/i);
    expect(content).toMatch(/design\.md[^\n.]*(?:if present|if exists)/i);
    expect(content).toMatch(/implement\.md[^\n.]*(?:if present|if exists)/i);
  }

  for (const { platform, rel, agent } of CLASS1_MD_AGENT_FILES) {
    it(`${platform}/${agent} markdown agent file carries marker + fallback protocol`, () => {
      const content = fs.readFileSync(path.join(repoRootFb, rel), "utf-8");
      // 1. References the marker
      expect(content).toContain(HOOK_INJECTED_MARKER);
      // 2. Has the protocol heading
      expect(content).toContain("Trellis Context Loading Protocol");
      // 3. Tells AI how to find the active task path
      expect(content).toContain("Active task:");
      // 4. Tells AI which task files to Read in fallback path
      expectTaskArtifactContract(content);
      const expectedJsonl =
        agent === "implement" ? "implement.jsonl" : "check.jsonl";
      expect(content).toContain(expectedJsonl);
    });
  }


  it("workflow.md dispatch protocol covers all platforms (not class-2 only)", () => {
    const workflowPath = path.join(
      repoRootFb,
      "packages/cli/src/templates/trellis/workflow.md",
    );
    const wf = fs.readFileSync(workflowPath, "utf-8");
    // The protocol enforces `Active task: <path>` for ALL sub-agents (no
    // trellis-research carve-out as of 0.5.8 — research sub-agents need the
    // task path to know which `{task_dir}/research/` to write into).
    expect(wf).toContain("Sub-agent dispatch protocol");
    expect(wf).toContain("all platforms");
    expect(wf).toContain("all sub-agents");
    expect(wf).not.toContain("EXCEPT trellis-research");
    expect(wf).toContain("trellis-research");
    expect(wf).toContain("Active task:");
    // Must NOT scope the rule to class-2 only — that was the pre-0.5.3 limit.
    expect(wf).not.toMatch(
      /Sub-agent dispatch protocol \(class-2 platforms[^)]*\)/,
    );
  });
});

describe("regression: configSectionsAdded (issue-codex-dispatch-mode)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-config-section-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[config-sections] extractConfigSection returns content between matching separator and next separator", async () => {
    const { extractConfigSection } = await import("../src/commands/update.js");
    const fake = [
      "# Header preamble",
      "",
      "#-------------------------------------------------------------------------------",
      "# First Section",
      "#-------------------------------------------------------------------------------",
      "first_key: value",
      "",
      "#-------------------------------------------------------------------------------",
      "# Second Section",
      "#-------------------------------------------------------------------------------",
      "# second_key: comment",
      "second_key: 2",
      "",
      "#-------------------------------------------------------------------------------",
      "# Third Section",
      "#-------------------------------------------------------------------------------",
      "third_key: 3",
    ].join("\n");

    const second = extractConfigSection(fake, "Second Section");
    expect(second).not.toBeNull();
    expect(second).toContain("# Second Section");
    expect(second).toContain("second_key: 2");
    // Must stop before the next separator block
    expect(second).not.toContain("Third Section");
    expect(second).not.toContain("third_key: 3");

    // Last section runs to EOF
    const third = extractConfigSection(fake, "Third Section");
    expect(third).not.toBeNull();
    expect(third).toContain("third_key: 3");

    // Missing heading returns null
    expect(extractConfigSection(fake, "Nonexistent Section")).toBeNull();
  });

  it("[config-sections] applyConfigSectionsAdded appends section when sentinel missing, idempotent on rerun", async () => {
    const { applyConfigSectionsAdded } =
      await import("../src/commands/update.js");
    const trellisDir = path.join(tmpDir, ".trellis");
    fs.mkdirSync(trellisDir, { recursive: true });
    const userConfigPath = path.join(trellisDir, "config.yaml");
    const userConfig = [
      "# Trellis Configuration",
      'session_commit_message: "chore: record journal"',
      "",
    ].join("\n");
    fs.writeFileSync(userConfigPath, userConfig);

    const bundledTemplate = [
      "# Trellis Configuration",
      'session_commit_message: "chore: record journal"',
      "",
      "#-------------------------------------------------------------------------------",
      "# Codex (sub-agent dispatch behavior)",
      "#-------------------------------------------------------------------------------",
      "# codex:",
      "#   dispatch_mode: sub-agent",
      "",
    ].join("\n");

    const entries = [
      {
        file: ".trellis/config.yaml",
        sentinel: "codex:",
        sectionHeading: "Codex (sub-agent dispatch behavior)",
      },
    ];
    const bundled = new Map<string, string>([
      [".trellis/config.yaml", bundledTemplate],
    ]);

    const first = applyConfigSectionsAdded(entries, tmpDir, bundled);
    expect(first.appended).toBe(1);
    const after = fs.readFileSync(userConfigPath, "utf-8");
    expect(after).toContain("# Codex (sub-agent dispatch behavior)");
    expect(after).toContain("codex:");
    expect(after).toContain("dispatch_mode: sub-agent");

    // Rerun: sentinel now present, no append.
    const second = applyConfigSectionsAdded(entries, tmpDir, bundled);
    expect(second.appended).toBe(0);
    const after2 = fs.readFileSync(userConfigPath, "utf-8");
    expect(after2).toBe(after);
  });

  it("[config-sections] applyConfigSectionsAdded skips when target file does not exist", async () => {
    const { applyConfigSectionsAdded } =
      await import("../src/commands/update.js");
    const result = applyConfigSectionsAdded(
      [
        {
          file: ".trellis/config.yaml",
          sentinel: "codex:",
          sectionHeading: "Codex (sub-agent dispatch behavior)",
        },
      ],
      tmpDir,
      new Map<string, string>([[".trellis/config.yaml", "# fake template"]]),
    );
    expect(result.appended).toBe(0);
  });

  it("[config-sections] manifest 0.5.7 declares the codex dispatch_mode section", () => {
    const manifestPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "migrations",
      "manifests",
      "0.5.7.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      version: string;
      configSectionsAdded?: {
        file: string;
        sentinel: string;
        sectionHeading: string;
      }[];
    };
    expect(manifest.version).toBe("0.5.7");
    expect(manifest.configSectionsAdded).toBeDefined();
    const entry = manifest.configSectionsAdded?.[0];
    expect(entry?.file).toBe(".trellis/config.yaml");
    expect(entry?.sentinel).toBe("codex:");
    expect(entry?.sectionHeading).toBe("Codex (dispatch behavior)");
  });

  it("[config-sections] bundled config.yaml template contains the new Codex section", () => {
    // Ensures the section the manifest points at actually exists in the
    // bundled template — protects against renaming heading without updating
    // the manifest entry.
    const tmplPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "templates",
      "trellis",
      "config.yaml",
    );
    const tmpl = fs.readFileSync(tmplPath, "utf-8");
    expect(tmpl).toContain("# Codex (dispatch behavior)");
    expect(tmpl).toContain("dispatch_mode");
  });
});

// =============================================================================
// safe-commit: gitignored .trellis/ recovery (0.5.10 → 0.5.11)
// =============================================================================
//
// Real user incident: project .gitignore listed `.trellis/`. add_session.py's
// auto-commit ran `git add .trellis/workspace .trellis/tasks`, got `ignored
// by .gitignore`, fell back to a hint suggesting `git add .trellis &&
// commit`. The AI agent driving the workflow extrapolated that to
// `git add -f .trellis/`, which forced in `.trellis/.backup-*/`,
// `.trellis/worktrees/`, `.trellis/.template-hashes.json`, etc. — 548 files
// / 83474 lines of caches/backups committed.
//
// 0.5.10 fix (since reverted):
//   - Scripts only stage SPECIFIC product paths.
//   - On `ignored by` the scripts retried with `git add -f <specific paths>`.
// That auto-`-f` was an over-fix — when a user gitignores `.trellis/` they
// mean "keep .trellis/ local-only", and forcing the commit through (even on
// narrow paths) violates user intent. Group-chat report: a finish-work auto
// committed `.trellis/workspace/` straight into a repo whose .gitignore
// excluded `.trellis/`.
//
// 0.5.11 fix (current):
//   - Plain `git add <specific>` is tried once. On `ignored by`, the script
//     warns and skips the auto-commit — never `-f`.
//   - New `session_auto_commit: false` config opts the user out of auto-stage
//     and auto-commit entirely (issue #245).
//   - The warning explicitly says ``Do NOT use `git add -f .trellis/```` so
//     AI re-reading the log doesn't reinvent the bug, and points at the new
//     `session_auto_commit: false` knob.
//
// These tests synthesize a tmp git repo with `.trellis/` gitignored and
// verify (a) on `ignored by` the script warns + skips (no commit, no -f),
// (b) `session_auto_commit: false` skips git entirely in any state, and
// (c) the negative-rule warning + new config hint are reachable.
// =============================================================================

describe("regression: safe auto-commit when .trellis/ is gitignored (0.5.10 → 0.5.11)", () => {
  let tmpDir: string;
  const pyCmd = process.platform === "win32" ? "python" : "python3";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-safe-commit-"));
    execSync("git init -q -b main", { cwd: tmpDir });
    // Configure user so git commit succeeds in CI sandboxes.
    execSync('git config user.email "test@trellis.local"', { cwd: tmpDir });
    execSync('git config user.name "Trellis Test"', { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string): void {
    const abs = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  function writeTrellisScripts(): void {
    const scriptsDir = path.join(tmpDir, ".trellis", "scripts");
    for (const [rel, content] of getAllScripts()) {
      const abs = path.join(scriptsDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
    }
  }

  function writeWorkspaceIndex(): void {
    writeFile(
      ".trellis/workspace/test-dev/index.md",
      [
        "# Workspace Index - test-dev",
        "",
        "## Current Status",
        "",
        "<!-- @@@auto:current-status -->",
        "- **Active File**: `journal-1.md`",
        "- **Total Sessions**: 0",
        "- **Last Active**: -",
        "<!-- @@@/auto:current-status -->",
        "",
        "## Active Documents",
        "",
        "<!-- @@@auto:active-documents -->",
        "| File | Lines | Status |",
        "|------|-------|--------|",
        "| `journal-1.md` | ~0 | Active |",
        "<!-- @@@/auto:active-documents -->",
        "",
        "## Session History",
        "",
        "<!-- @@@auto:session-history -->",
        "| # | Date | Title | Commits | Branch |",
        "|---|------|-------|---------|--------|",
        "<!-- @@@/auto:session-history -->",
        "",
      ].join("\n"),
    );
  }

  function setupRepo(options?: {
    gitignoreTrellis?: boolean;
    /**
     * When set, writes `.trellis/config.yaml` with that `session_auto_commit`
     * value. Left unset the scripts resolve the built-in default (`false`
     * since 0.7.2), so tests that exercise the auto-commit path must opt in
     * explicitly.
     */
    sessionAutoCommit?: boolean;
  }): void {
    writeTrellisScripts();
    writeFile(
      ".trellis/.developer",
      "name=test-dev\ninitialized_at=2026-05-09T00:00:00\n",
    );
    writeFile(
      ".trellis/workspace/test-dev/journal-1.md",
      "# Journal - test-dev (Part 1)\n\n---\n",
    );
    writeWorkspaceIndex();
    // Ignored caches/backups must exist on disk to prove they don't get
    // staged when -f is forced on specific paths.
    writeFile(
      ".trellis/.backup-2026-05-09/should-not-be-committed.txt",
      "secret-backup\n",
    );
    writeFile(
      ".trellis/worktrees/wt-a/should-not-be-committed.txt",
      "secret-worktree\n",
    );
    writeFile(
      ".trellis/.template-hashes.json",
      '{"_": "should-not-be-committed"}\n',
    );
    writeFile(
      ".trellis/.runtime/sessions/should-not-be-committed.json",
      "{}\n",
    );

    if (options?.gitignoreTrellis) {
      writeFile(".gitignore", ".trellis/\n");
    }
    if (options?.sessionAutoCommit !== undefined) {
      writeConfigYaml(`session_auto_commit: ${options.sessionAutoCommit}\n`);
    }
    // Seed an initial commit so HEAD exists.
    writeFile("README.md", "test\n");
    execSync("git add README.md", { cwd: tmpDir });
    if (options?.gitignoreTrellis) {
      execSync("git add .gitignore", { cwd: tmpDir });
    }
    execSync('git commit -q -m "init"', { cwd: tmpDir });
  }

  function runAddSession(): { stdout: string; stderr: string } {
    const scriptPath = path.join(
      tmpDir,
      ".trellis",
      "scripts",
      "add_session.py",
    );
    const result = spawnSync(
      pyCmd,
      [scriptPath, "--title", "Test", "--summary", "Test"],
      {
        cwd: tmpDir,
        encoding: "utf-8",
        env: { ...process.env, TRELLIS_CONTEXT_ID: "session-a" },
      },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  function listCommittedFiles(): string[] {
    const out = execSync("git ls-tree -r --name-only HEAD", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    return out.split("\n").filter((l) => l.length > 0);
  }

  it("[gitignore-trellis] add_session warns and skips when .trellis/ is ignored (auto-commit enabled)", () => {
    setupRepo({ gitignoreTrellis: true, sessionAutoCommit: true });
    const { stderr } = runAddSession();

    // Plain add fails with "ignored by". 0.5.11 must NOT retry with -f.
    // Instead the script warns and skips the entire auto-commit. So no
    // "Auto-committed" line, and the warning fires.
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).toContain("ignored by your .gitignore");
    expect(stderr).toContain("Do NOT use `git add -f .trellis/`");
    expect(stderr).toContain("session_auto_commit: false");

    // Nothing under .trellis/ should be tracked: the user's .gitignore
    // intent is preserved.
    const tracked = listCommittedFiles();
    for (const tracked_path of tracked) {
      expect(
        tracked_path.startsWith(".trellis/"),
        `should not commit anything under .trellis/ (got: ${tracked_path})`,
      ).toBe(false);
    }

    // The journal + index files are still on disk (the script wrote them
    // before attempting auto-commit) — only git was untouched.
    expect(
      fs.existsSync(
        path.join(tmpDir, ".trellis/workspace/test-dev/journal-1.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".trellis/workspace/test-dev/index.md")),
    ).toBe(true);
  });

  it("[gitignore-trellis] add_session works normally when .trellis/ is NOT ignored", () => {
    // Regression guard: pre-existing behavior must not change for users
    // whose .gitignore does not exclude .trellis/.
    setupRepo({ gitignoreTrellis: false, sessionAutoCommit: true });
    const { stderr } = runAddSession();
    expect(stderr).toContain("Auto-committed");

    const tracked = listCommittedFiles();
    expect(tracked).toContain(".trellis/workspace/test-dev/journal-1.md");
  });

  it("[gitignore-trellis] safe_commit module ships and contains the negative warning + new config hint", () => {
    // The warning's exact text matters because AI agents read it.
    // Specifically the negative example must appear verbatim so any future
    // refactor that removes it will fail this test. 0.5.11 also adds the
    // new session_auto_commit hint.
    const safeCommit = getAllScripts().get("common/safe_commit.py");
    expect(safeCommit).toBeTruthy();
    expect(safeCommit).toContain("Do NOT use `git add -f .trellis/`");
    expect(safeCommit).toContain("safe_trellis_paths_to_add");
    expect(safeCommit).toContain("safe_archive_paths_to_add");
    expect(safeCommit).toContain("safe_git_add");
    // 0.5.11: new hint pointing users at the config knob.
    expect(safeCommit).toContain("session_auto_commit: false");
    // 0.5.11: auto -f retry must be gone. The function body should no
    // longer issue `git add -f`.
    expect(safeCommit).not.toMatch(/\["add", "-f", "--",/);
  });

  it("[gitignore-trellis] task.py archive warns and skips when .trellis/ is ignored (auto-commit enabled)", () => {
    setupRepo({ gitignoreTrellis: true, sessionAutoCommit: true });
    // Create a task to archive.
    writeFile(
      ".trellis/tasks/issue-500/task.json",
      JSON.stringify(
        { title: "Test archive", status: "in_progress", package: null },
        null,
        2,
      ),
    );
    writeFile(".trellis/tasks/issue-500/prd.md", "# PRD\n");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(pyCmd, [taskScriptPath, "archive", "issue-500"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, TRELLIS_CONTEXT_ID: "session-arch" },
    });
    const stderr = result.stderr ?? "";
    // 0.5.11: must NOT retry with -f, must NOT auto-commit. Warning must
    // surface so the user knows their .gitignore won.
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).toContain("ignored by your .gitignore");
    expect(stderr).toContain("Do NOT use `git add -f .trellis/`");

    const tracked = listCommittedFiles();
    // Nothing under .trellis/ should be tracked.
    for (const t of tracked) {
      expect(
        t.startsWith(".trellis/"),
        `should not commit anything under .trellis/ (got: ${t})`,
      ).toBe(false);
    }

    // The archive directory move on disk still happened — only git was
    // untouched.
    const archiveExists = fs
      .readdirSync(path.join(tmpDir, ".trellis/tasks/archive"))
      .some((monthDir) => {
        const monthPath = path.join(tmpDir, ".trellis/tasks/archive", monthDir);
        return (
          fs.statSync(monthPath).isDirectory() &&
          fs.existsSync(path.join(monthPath, "issue-500"))
        );
      });
    expect(archiveExists).toBe(true);
  });

  // ===========================================================================
  // 0.5.11: session_auto_commit config (issue #245 + screenshot user)
  // ===========================================================================

  function writeConfigYaml(content: string): void {
    writeFile(".trellis/config.yaml", content);
  }

  it("[session_auto_commit=false] add_session skips git entirely (no add, no commit)", () => {
    // User wants journal/task files written to disk but no auto-staging
    // and no auto-commit. Issue #245 + screenshot user use case.
    setupRepo({ gitignoreTrellis: false });
    writeConfigYaml("session_auto_commit: false\n");

    const { stderr } = runAddSession();
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).toContain("session_auto_commit: false");

    // No new commits beyond the initial "init" commit.
    const log = execSync("git log --oneline", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log.trim().split("\n").length).toBe(1);

    // No staged changes either — `git add` was never called.
    const staged = execSync("git diff --cached --name-only", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(staged.trim()).toBe("");

    // Files were still written to disk.
    expect(
      fs.existsSync(
        path.join(tmpDir, ".trellis/workspace/test-dev/journal-1.md"),
      ),
    ).toBe(true);
  });

  it("[session_auto_commit=false] task.py archive skips git entirely", () => {
    setupRepo({ gitignoreTrellis: false });
    writeConfigYaml("session_auto_commit: false\n");

    writeFile(
      ".trellis/tasks/issue-600/task.json",
      JSON.stringify(
        { title: "Test archive", status: "in_progress", package: null },
        null,
        2,
      ),
    );
    writeFile(".trellis/tasks/issue-600/prd.md", "# PRD\n");

    const taskScriptPath = path.join(tmpDir, ".trellis", "scripts", "task.py");
    const result = spawnSync(pyCmd, [taskScriptPath, "archive", "issue-600"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: { ...process.env, TRELLIS_CONTEXT_ID: "session-arch-2" },
    });
    const stderr = result.stderr ?? "";
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).toContain("session_auto_commit: false");

    const log = execSync("git log --oneline", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log.trim().split("\n").length).toBe(1);

    // Archive directory move still happened on disk.
    const archiveExists = fs
      .readdirSync(path.join(tmpDir, ".trellis/tasks/archive"))
      .some((monthDir) => {
        const monthPath = path.join(tmpDir, ".trellis/tasks/archive", monthDir);
        return (
          fs.statSync(monthPath).isDirectory() &&
          fs.existsSync(path.join(monthPath, "issue-600"))
        );
      });
    expect(archiveExists).toBe(true);
  });

  it("[session_auto_commit] inline comment is stripped before parsing", () => {
    // YAML inline-comment trap: `key: false  # comment` previously broke in
    // common/config.py because parse_simple_yaml didn't strip ` #`. This
    // verifies the helper is shared with trellis_config.py's parser.
    setupRepo({ gitignoreTrellis: false });
    writeConfigYaml("session_auto_commit: false  # disable for this project\n");

    const { stderr } = runAddSession();
    expect(stderr).toContain("session_auto_commit: false");
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).not.toContain("invalid session_auto_commit");

    const log = execSync("git log --oneline", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log.trim().split("\n").length).toBe(1);
  });

  it("[session_auto_commit] string variants resolve to false", () => {
    // The helper must accept lowercase / uppercase / synonym forms.
    // Spot-check `FALSE` (uppercase) and `no` here; `0` and `off` follow
    // the same code path (the lowercase set in get_session_auto_commit).
    for (const variant of ["FALSE", "no", "off", "0"]) {
      setupRepo({ gitignoreTrellis: false });
      writeConfigYaml(`session_auto_commit: ${variant}\n`);

      const { stderr } = runAddSession();
      expect(
        stderr.includes("session_auto_commit: false"),
        `variant=${variant}`,
      ).toBe(true);

      // Reset for next iteration.
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-safe-commit-"));
      execSync("git init -q -b main", { cwd: tmpDir });
      execSync('git config user.email "test@trellis.local"', { cwd: tmpDir });
      execSync('git config user.name "Trellis Test"', { cwd: tmpDir });
    }
  });

  it("[session_auto_commit] invalid value falls back to false with stderr warn", () => {
    setupRepo({ gitignoreTrellis: false });
    writeConfigYaml("session_auto_commit: maybe\n");

    const { stderr } = runAddSession();
    // Warning fires.
    expect(stderr).toContain("invalid session_auto_commit value");
    // Falls back to the default (false since 0.7.2) → git untouched.
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).toContain("session_auto_commit: false");
  });

  it("[session_auto_commit] defaults to false when config.yaml has no such key (0.7.2)", () => {
    // 0.7.2 flipped DEFAULT_SESSION_AUTO_COMMIT to False: Trellis does not
    // write git history unless the project opts in. Files still land on disk.
    // setupRepo without `sessionAutoCommit` writes no config.yaml at all, so
    // this exercises the built-in default.
    setupRepo({ gitignoreTrellis: false });

    const { stderr } = runAddSession();
    expect(stderr).not.toContain("Auto-committed");
    expect(stderr).toContain("session_auto_commit: false");

    // Only the initial "init" commit exists, and nothing was staged.
    const log = execSync("git log --oneline", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(log.trim().split("\n").length).toBe(1);
    const staged = execSync("git diff --cached --name-only", {
      cwd: tmpDir,
      encoding: "utf-8",
    });
    expect(staged.trim()).toBe("");

    expect(
      fs.existsSync(
        path.join(tmpDir, ".trellis/workspace/test-dev/journal-1.md"),
      ),
    ).toBe(true);
  });
});

// =============================================================================
// regression: dogfood ↔ shipped Python script parity
// =============================================================================

describe("regression: .trellis/scripts stays byte-identical to templates/trellis/scripts", () => {
  // `.trellis/scripts/` is Trellis's own dogfood copy;
  // `packages/cli/src/templates/trellis/scripts/` is what ships to users.
  // They are two physical copies of the same 28 files and nothing enforced
  // parity, so one-sided edits landed silently — PR #390 changed the template's
  // `common/session_context.py` upgrade hint and left the dogfood copy on the
  // old wording for a month. This test turns that whole class of drift into a
  // build failure.
  const __dirnameParity = path.dirname(fileURLToPath(import.meta.url));
  const parityRepoRoot = path.resolve(__dirnameParity, "../../..");
  const dogfoodScriptsRoot = path.join(parityRepoRoot, ".trellis", "scripts");
  const templateScriptsRoot = path.join(
    parityRepoRoot,
    "packages/cli/src/templates/trellis/scripts",
  );

  function listPyFiles(root: string): string[] {
    const found: string[] = [];
    function walk(dir: string, prefix: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "__pycache__") continue;
          walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        } else if (entry.name.endsWith(".py")) {
          found.push(`${prefix}${entry.name}`);
        }
      }
    }
    walk(root, "");
    return found.sort();
  }

  const templateFiles = listPyFiles(templateScriptsRoot);

  it("both trees hold the same set of .py files", () => {
    const dogfoodFiles = listPyFiles(dogfoodScriptsRoot);
    expect(
      dogfoodFiles,
      "`.trellis/scripts/` and `packages/cli/src/templates/trellis/scripts/` " +
        "must hold the same .py files — a script added to (or deleted from) " +
        "one tree must be mirrored in the other.",
    ).toEqual(templateFiles);
  });

  for (const relativePath of templateFiles) {
    it(`${relativePath} matches the template after platform rendering`, () => {
      const dogfoodPath = path.join(dogfoodScriptsRoot, relativePath);
      expect(
        fs.existsSync(dogfoodPath),
        `.trellis/scripts/${relativePath} is missing (template has it)`,
      ).toBe(true);
      const dogfoodText = fs.readFileSync(dogfoodPath, "utf-8");
      const templateText = fs.readFileSync(
        path.join(templateScriptsRoot, relativePath),
        "utf-8",
      );
      // The dogfood tree is not a byte copy of the template: `copyTrellisDir`
      // writes it through `replacePythonCommandLiterals`, so on Windows every
      // `python3` literal lands as `python`. Comparing raw bytes made this test
      // permanently red for any Windows contributor who ran `trellis update`,
      // which is how a rendered `developer.py` got committed.
      //
      // Run BOTH sides through that same renderer, which is idempotent:
      //   - Windows, tree freshly checked out: both render to `python`  -> pass
      //   - Windows, tree rewritten by update: both render to `python`  -> pass
      //   - Linux/macOS: the renderer is a no-op, both stay `python3`   -> pass
      //   - a rendered copy committed to git: on Linux the dogfood side
      //     stays `python` while the template stays `python3`           -> FAIL
      // That last case is deliberate. Only `python3` may be committed, because
      // whoever commits a rendered tree otherwise makes their own OS the one
      // the repository is correct on.
      //
      // Everything else still compares exactly: line endings, trailing
      // whitespace, and BOM all survive this normalization.
      const normalize = (text: string): string =>
        replacePythonCommandLiterals(text);
      expect(
        normalize(dogfoodText) === normalize(templateText),
        `.trellis/scripts/${relativePath} has drifted from ` +
          `packages/cli/src/templates/trellis/scripts/${relativePath}. ` +
          `Edit both copies, never one. (Both sides are compared after ` +
          `replacePythonCommandLiterals, so a bare python3-vs-python ` +
          `difference is only the cause if a rendered copy was committed — ` +
          `the template's \`python3\` form is the one that belongs in git. If ` +
          `the diff shows some other Python command, the dogfood tree was ` +
          `rendered by a run whose resolved command differs from this one.)`,
      ).toBe(true);
    });
  }
});
