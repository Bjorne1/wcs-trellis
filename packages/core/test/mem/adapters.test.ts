/**
 * Fixture-based tests for the persisted-session adapters.
 *
 * The adapters derive session-store paths from `os.homedir()` at module-load
 * time (`internal/paths.ts`), so `node:os` is mocked via `vi.hoisted` to point
 * `homedir()` at a per-suite tmpdir before any mem module resolves.
 *
 * Migrated from the CLI `mem-platforms` suite when the adapters moved into
 * `@blulotus/trellis-core/mem`.
 */

import {
  describe,
  it,
  expect,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const { fakeHome, snapshotTestState } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const o = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require("node:path") as typeof import("node:path");
  const fakeHome = f.mkdtempSync(p.join(o.tmpdir(), "trellis-mem-home-"));
  return {
    fakeHome,
    snapshotTestState: {
      unstablePath: null as string | null,
      mainDbStatReads: 0,
    },
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => fakeHome };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    statSync: (...args: Parameters<typeof actual.statSync>) => {
      const stat = actual.statSync(...args);
      if (String(args[0]) !== snapshotTestState.unstablePath) return stat;
      snapshotTestState.mainDbStatReads += 1;
      if (snapshotTestState.mainDbStatReads % 2 !== 0) return stat;

      const changed = Object.create(stat) as typeof stat;
      Object.defineProperty(changed, "mtimeMs", {
        value: stat.mtimeMs + snapshotTestState.mainDbStatReads,
      });
      return changed;
    },
  };
});

const { claudeListSessions, claudeExtractDialogue, claudeSearch } =
  await import("../../src/mem/adapters/claude.js");
const { claudeProjectDirFromCwd } =
  await import("../../src/mem/internal/paths.js");
const { codexListSessions, codexExtractDialogue, codexSearch } =
  await import("../../src/mem/adapters/codex.js");

import type { MemFilter } from "../../src/mem/types.js";

/** Minimal global-scope filter; overrides merge in. */
function mkFilter(overrides: Partial<MemFilter> = {}): MemFilter {
  return { platform: "all", limit: 50, cwd: undefined, ...overrides };
}

// =============================================================================
// shared fixture helpers
// =============================================================================

const CLAUDE_PROJECTS = nodePath.join(fakeHome, ".claude", "projects");
const CODEX_SESSIONS = nodePath.join(fakeHome, ".codex", "sessions");

function writeJsonl(file: string, lines: readonly unknown[]): void {
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
  nodeFs.writeFileSync(
    file,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

function writeJson(file: string, obj: unknown): void {
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
  nodeFs.writeFileSync(file, JSON.stringify(obj));
}

function rimraf(p: string): void {
  nodeFs.rmSync(p, { recursive: true, force: true });
}

afterAll(() => {
  rimraf(fakeHome);
});

// =============================================================================
// claudeProjectDirFromCwd — cwd → on-disk dir-name sanitization
//
// Claude replaces every path separator (`/` and Windows `\`), drive colon
// (`:`), `_`, and `.` with `-`. Confirmed empirically against a real
// `~/.claude/projects/` (e.g. `/Users/x/.codex/...` → `-Users-x--codex-...`,
// `snap_note` → `snap-note`). Regression guard for #300: the old `/[/_]/g`
// regex missed `\` and `:`, so Windows cwds resolved to a non-existent dir and
// `mem list --cwd` silently returned 0.
// =============================================================================

describe("claudeProjectDirFromCwd", () => {
  const dirName = (cwd: string): string =>
    nodePath.basename(claudeProjectDirFromCwd(cwd));

  it("sanitizes a POSIX cwd (separators + underscore)", () => {
    expect(dirName("/Users/me/workspace/snap_note")).toBe(
      "-Users-me-workspace-snap-note",
    );
  });

  it("sanitizes a Windows backslash path", () => {
    expect(dirName("D:\\code\\2026\\myapp")).toBe("D--code-2026-myapp");
  });

  it("sanitizes a drive-letter colon", () => {
    expect(dirName("C:\\Users\\me\\repo")).toBe("C--Users-me-repo");
  });

  it("sanitizes underscore and dot in a Windows path", () => {
    expect(dirName("D:\\code\\my_app\\.trellis")).toBe(
      "D--code-my-app--trellis",
    );
  });

  it("sanitizes mixed forward/back separators", () => {
    expect(dirName("D:/code\\2026/my_app")).toBe("D--code-2026-my-app");
  });
});

// =============================================================================
// Claude Code adapter
// =============================================================================

describe("claudeListSessions / claudeExtractDialogue", () => {
  const projectCwd = "/tmp/test-project";
  const encodedCwd = projectCwd.replace(/[/\\:_.]/g, "-");
  const projectDir = nodePath.join(CLAUDE_PROJECTS, encodedCwd);
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const sessionFile = nodePath.join(projectDir, `${sessionId}.jsonl`);

  beforeEach(() => {
    nodeFs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rimraf(CLAUDE_PROJECTS);
  });

  it("returns no sessions when ~/.claude/projects/ doesn't exist", () => {
    rimraf(CLAUDE_PROJECTS);
    expect(claudeListSessions(mkFilter())).toEqual([]);
  });

  it("lists a session and reads cwd/timestamp from the first event when index is missing", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "hello" },
      },
    ]);
    const found = claudeListSessions(mkFilter()).find(
      (s) => s.id === sessionId,
    );
    expect(found).toBeDefined();
    expect(found?.platform).toBe("claude");
    expect(found?.cwd).toBe(projectCwd);
    expect(found?.created).toBe("2026-04-15T10:00:00Z");
  });

  it("merges sessions-index.json metadata (title, cwd, created)", () => {
    writeJsonl(sessionFile, [
      { type: "user", message: { role: "user", content: "hi" } },
    ]);
    writeJson(nodePath.join(projectDir, "sessions-index.json"), {
      entries: [
        {
          id: sessionId,
          cwd: projectCwd,
          created: "2026-04-15T08:00:00Z",
          title: "fixed bug in foo",
        },
      ],
    });
    const found = claudeListSessions(mkFilter()).find(
      (s) => s.id === sessionId,
    );
    expect(found?.title).toBe("fixed bug in foo");
    expect(found?.cwd).toBe(projectCwd);
  });

  it("filters by --since (excludes sessions whose entire lifetime predates the window)", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "old session" },
      },
    ]);
    const oldT = new Date("2026-01-01T00:00:00Z");
    nodeFs.utimesSync(sessionFile, oldT, oldT);
    const r = claudeListSessions(mkFilter({ since: new Date("2026-04-01") }));
    expect(r.find((s) => s.id === sessionId)).toBeUndefined();
  });

  it("scopes to --cwd by encoding cwd to the on-disk dir name", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "x" },
      },
    ]);
    const otherEncoded = "/tmp/other".replace(/[/\\:_.]/g, "-");
    const otherFile = nodePath.join(
      CLAUDE_PROJECTS,
      otherEncoded,
      "22222222-2222-2222-2222-222222222222.jsonl",
    );
    writeJsonl(otherFile, [
      {
        type: "user",
        cwd: "/tmp/other",
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "x" },
      },
    ]);
    const ids = claudeListSessions(mkFilter({ cwd: projectCwd })).map(
      (s) => s.id,
    );
    expect(ids).toContain(sessionId);
    expect(ids).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("falls back to scanning all project dirs when the derived dir name doesn't exist (#300)", () => {
    // Simulate a future Claude naming scheme the derive fn can't reproduce: the
    // on-disk dir name is unrelated to `claudeProjectDirFromCwd(scopedCwd)`, so
    // the fast-path existsSync miss must NOT silently return 0 — the all-dirs
    // scan + per-session `sameProject(cwd, f.cwd)` filter still finds it.
    const scopedCwd = "/srv/projects/some-app";
    const mismatchedDir = nodePath.join(CLAUDE_PROJECTS, "opaque-hash-9f8e7d");
    const scopedFile = nodePath.join(
      mismatchedDir,
      "33333333-3333-3333-3333-333333333333.jsonl",
    );
    writeJsonl(scopedFile, [
      {
        type: "user",
        cwd: scopedCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "scoped session" },
      },
    ]);
    // a session in a different project must still be excluded by the scope
    const otherFile = nodePath.join(
      CLAUDE_PROJECTS,
      "another-opaque-hash",
      "44444444-4444-4444-4444-444444444444.jsonl",
    );
    writeJsonl(otherFile, [
      {
        type: "user",
        cwd: "/srv/projects/other-app",
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "other session" },
      },
    ]);

    // sanity: the derived dir really does not exist on disk
    expect(nodeFs.existsSync(claudeProjectDirFromCwd(scopedCwd))).toBe(false);

    const ids = claudeListSessions(mkFilter({ cwd: scopedCwd })).map(
      (s) => s.id,
    );
    expect(ids).toContain("33333333-3333-3333-3333-333333333333");
    expect(ids).not.toContain("44444444-4444-4444-4444-444444444444");
  });

  it("extractDialogue keeps user/assistant text turns and strips injection tags", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: {
          role: "user",
          content:
            "real question<system-reminder>secret</system-reminder> here",
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", text: "thinking aloud" },
            { type: "text", text: "real answer" },
            { type: "tool_use", input: { foo: 1 } },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "out" }],
        },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const turns = claudeExtractDialogue(s);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", text: "real question here" });
    expect(turns[1]).toEqual({ role: "assistant", text: "real answer" });
  });

  it("extractDialogue keeps pre-compact turns and marks the boundary", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "first turn" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "first answer" }],
        },
      },
      {
        type: "user",
        isCompactSummary: true,
        message: {
          role: "user",
          content: "summary of the previous conversation",
        },
      },
      {
        type: "user",
        message: { role: "user", content: "post-compact question" },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const turns = claudeExtractDialogue(s);
    expect(turns.map((t) => t.kind ?? "turn")).toEqual([
      "turn",
      "turn",
      "marker",
      "turn",
    ]);
    expect(turns[0]).toEqual({ role: "user", text: "first turn" });
    expect(turns[1]).toEqual({ role: "assistant", text: "first answer" });
    expect(turns[2]?.text).toContain("[compaction boundary]");
    expect(turns[2]?.text).toContain("summary of the previous conversation");
    expect(turns[3]).toEqual({ role: "user", text: "post-compact question" });
  });

  it("the compact summary is marker content, never a searchable turn", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "we talked about widgets" },
      },
      {
        type: "user",
        isCompactSummary: true,
        message: { role: "user", content: "the user asked about widgets" },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    // "widgets" appears in the real turn and again in the summary; only the
    // real turn may be counted, and the marker is out of the denominator.
    const hit = claudeSearch(s, "widgets");
    expect(hit.count).toBe(1);
    expect(hit.totalTurns).toBe(1);
  });

  it("drops AGENTS.md preamble turns from the user side", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: {
          role: "user",
          content: "# AGENTS.md instructions for /repo - rules go here",
        },
      },
      {
        type: "user",
        message: { role: "user", content: "actual user question" },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(claudeExtractDialogue(s).map((t) => t.text)).toEqual([
      "actual user question",
    ]);
  });

  it("returns empty turns array for a session with no parseable content", () => {
    writeJsonl(sessionFile, [
      { type: "user", cwd: projectCwd, timestamp: "2026-04-15T10:00:00Z" },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(claudeExtractDialogue(s)).toEqual([]);
  });

  it("claudeSearch counts keyword occurrences across user + assistant turns", () => {
    writeJsonl(sessionFile, [
      {
        type: "user",
        cwd: projectCwd,
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "memory leak in heap" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "the memory subsystem allocates" }],
        },
      },
    ]);
    const s = claudeListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const hit = claudeSearch(s, "memory");
    expect(hit.userCount).toBe(1);
    expect(hit.asstCount).toBe(1);
    expect(hit.count).toBe(2);
  });
});

// =============================================================================
// Codex adapter
// =============================================================================

describe("codexListSessions / codexExtractDialogue", () => {
  const sessionId = "abc-codex-session";
  const projectCwd = "/tmp/codex-project";
  const fileName = `rollout-2026-04-15T10-00-00-${sessionId}.jsonl`;
  const sessionFile = nodePath.join(
    CODEX_SESSIONS,
    "2026",
    "04",
    "15",
    fileName,
  );

  beforeEach(() => {
    nodeFs.mkdirSync(nodePath.dirname(sessionFile), { recursive: true });
  });

  afterEach(() => {
    rimraf(CODEX_SESSIONS);
  });

  it("returns no sessions when ~/.codex/sessions/ doesn't exist", () => {
    rimraf(CODEX_SESSIONS);
    expect(codexListSessions(mkFilter())).toEqual([]);
  });


  it("filters codex sessions by --cwd", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
    ]);
    const otherFile = nodePath.join(
      CODEX_SESSIONS,
      "2026",
      "04",
      "15",
      `rollout-2026-04-15T11-00-00-other.jsonl`,
    );
    writeJsonl(otherFile, [
      {
        timestamp: "2026-04-15T11:00:00Z",
        payload: { id: "other", cwd: "/elsewhere" },
      },
    ]);
    const ids = codexListSessions(mkFilter({ cwd: projectCwd })).map(
      (s) => s.id,
    );
    expect(ids).toContain(sessionId);
    expect(ids).not.toContain("other");
  });

  it("extractDialogue keeps user/assistant messages, drops developer/system", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "system prompt" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello world" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:03Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi back" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:04Z",
        payload: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: "should be dropped" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s)).toEqual([
      { role: "user", text: "hello world" },
      { role: "assistant", text: "hi back" },
    ]);
  });

  it("extractDialogue strips injection tags from inlined preamble content", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "real question<workflow-state>x</workflow-state> trailing",
            },
          ],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s)).toEqual([
      { role: "user", text: "real question trailing" },
    ]);
  });

  it("extractDialogue keeps pre-compact turns and recovers what only replacement_history holds", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "pre-compact turn" }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        type: "compacted",
        payload: {
          replacement_history: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "only in retained history" }],
            },
            // Already collected above — must not be duplicated.
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "pre-compact turn" }],
            },
          ],
        },
      },
      {
        timestamp: "2026-04-15T10:00:03Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "post-compact turn" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const turns = codexExtractDialogue(s);
    expect(turns.map((t) => t.text)).toEqual([
      "only in retained history",
      "pre-compact turn",
      turns[2]?.text ?? "",
      "post-compact turn",
    ]);
    expect(turns[2]?.kind).toBe("marker");
    expect(turns[2]?.text).toContain("[compaction boundary]");
  });

  it("a replacement_history that only repeats the pool adds no phantom turns", () => {
    const message = (text: string): Record<string, unknown> => ({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    });
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      { timestamp: "2026-04-15T10:00:01Z", payload: message("ok") },
      { timestamp: "2026-04-15T10:00:02Z", payload: message("ok") },
      {
        timestamp: "2026-04-15T10:00:03Z",
        type: "compacted",
        payload: { replacement_history: [message("ok"), message("ok")] },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const turns = codexExtractDialogue(s);
    // Two real "ok" turns survive as two; the two retained copies are dropped.
    expect(turns.filter((t) => t.kind !== "marker").map((t) => t.text)).toEqual([
      "ok",
      "ok",
    ]);
  });

  it("recovers a FINAL_ANSWER inter-agent envelope and reports encrypted ones", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        type: "response_item",
        payload: {
          type: "agent_message",
          author: "/root",
          recipient: "/root/child",
          content: [
            {
              type: "input_text",
              text: "Message Type: NEW_TASK\nTask name: /root/child\nSender: /root\nPayload:\n",
            },
            { type: "encrypted_content", encrypted_content: "gAAAAA" },
          ],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        type: "response_item",
        payload: {
          type: "agent_message",
          author: "/root/child",
          recipient: "/root",
          content: [
            {
              type: "input_text",
              text: "Message Type: FINAL_ANSWER\nTask name: /root/child\nSender: /root/child\nPayload:\nthe sub-agent's report",
            },
          ],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const warnings: { code: string; message: string }[] = [];
    const turns = codexExtractDialogue(s, warnings);
    expect(turns).toEqual([
      { role: "assistant", text: "the sub-agent's report" },
    ]);
    expect(warnings.map((w) => w.code)).toEqual(["codex-inter-agent-encrypted"]);
    expect(warnings[0]?.message).toContain("1 inter-agent message payload");
  });

  it("extractDialogue drops bootstrap (large INSTRUCTIONS) user turn", () => {
    const huge = "<INSTRUCTIONS>\n" + "x".repeat(5000) + "\n</INSTRUCTIONS>";
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: huge }],
        },
      },
      {
        timestamp: "2026-04-15T10:00:02Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "real question" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    expect(codexExtractDialogue(s)).toEqual([
      { role: "user", text: "real question" },
    ]);
  });

  it("codexSearch returns SearchHit with correct counts", () => {
    writeJsonl(sessionFile, [
      {
        timestamp: "2026-04-15T10:00:00Z",
        payload: { id: sessionId, cwd: projectCwd },
      },
      {
        timestamp: "2026-04-15T10:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "memory leak in heap" }],
        },
      },
    ]);
    const s = codexListSessions(mkFilter()).find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    if (!s) return;
    const hit = codexSearch(s, "memory");
    expect(hit.userCount).toBe(1);
    expect(hit.count).toBe(1);
  });
});

// =============================================================================
// Grok adapter
// =============================================================================


// =============================================================================
// Pi adapter
// =============================================================================



// =============================================================================
// OpenCode adapter (degraded — silent no-op; the "unavailable" notice is a CLI
// presentation concern, see packages/cli/src/commands/mem.ts).
// =============================================================================


// =============================================================================
// ZCode adapter — reads from `~/.zcode/cli/db/db.sqlite` via the zero-dependency
// SQLite parser. Fixtures are built with the system python sqlite3 module; the
// whole block is skipped when no python interpreter is available so CI without
// python does not regress.
// =============================================================================

/** Detect a python launcher with the sqlite3 stdlib module. */


/** Build a ZCode-shaped SQLite db at ZCODE_DB with session/message/part rows.
 * Columns are kept to the subset the adapter reads. */


