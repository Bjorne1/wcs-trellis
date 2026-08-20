/**
 * Unit tests for uninstall-scrubbers.
 *
 * Each scrubber gets coverage for:
 *  - Strips trellis content
 *  - Preserves user-added content
 *  - Reports `fullyEmpty: true` when nothing meaningful remains
 */

import { describe, it, expect } from "vitest";
import {
  scrubHooksJson,
  scrubCodexConfigToml,
  scrubManagedMarkdownBlock,
} from "../../src/utils/uninstall-scrubbers.js";

const CLAUDE_DELETE_PATHS = [
  ".claude/hooks/session-start.py",
  ".claude/hooks/inject-subagent-context.py",
  ".claude/hooks/inject-workflow-state.py",
];


const TEST_BLOCK_START = "<!-- TRELLIS:TEST:START -->";
const TEST_BLOCK_END = "<!-- TRELLIS:TEST:END -->";

describe("scrubHooksJson — nested schema", () => {
  it("strips trellis hook entries from a Claude-style file", () => {
    const input = {
      env: { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1" },
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/session-start.py",
                timeout: 10,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/inject-workflow-state.py",
                timeout: 5,
              },
            ],
          },
        ],
      },
      enabledPlugins: {},
    };

    const { content, fullyEmpty } = scrubHooksJson(
      JSON.stringify(input, null, 2),
      CLAUDE_DELETE_PATHS,
      "nested",
    );
    const parsed = JSON.parse(content);
    expect(parsed.hooks).toBeUndefined();
    expect(parsed.env).toEqual(input.env);
    expect(parsed.enabledPlugins).toEqual({});
    expect(fullyEmpty).toBe(false);
  });

  it("preserves user-added hook entry inside the same matcher block", () => {
    const input = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/session-start.py",
                timeout: 10,
              },
              {
                type: "command",
                command: "python3 .claude/hooks/my-custom-hook.py",
                timeout: 5,
              },
            ],
          },
        ],
      },
    };

    const { content, fullyEmpty } = scrubHooksJson(
      JSON.stringify(input, null, 2),
      CLAUDE_DELETE_PATHS,
      "nested",
    );
    const parsed = JSON.parse(content);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe(
      "python3 .claude/hooks/my-custom-hook.py",
    );
    expect(fullyEmpty).toBe(false);
  });

  it("reports fullyEmpty when only trellis hooks existed", () => {
    const input = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/session-start.py",
                timeout: 10,
              },
            ],
          },
        ],
      },
    };

    const { content, fullyEmpty } = scrubHooksJson(
      JSON.stringify(input, null, 2),
      CLAUDE_DELETE_PATHS,
      "nested",
    );
    expect(fullyEmpty).toBe(true);
    // Content should still be valid JSON (an empty object).
    expect(JSON.parse(content)).toEqual({});
  });

  it("does NOT strip hook entries that merely mention a deleted path inside a string argument", () => {
    // Regression: substring-only matching would incorrectly delete a user
    // hook whose command happens to embed a manifest path in an echo/log arg.
    const input = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command:
                  'echo "see .claude/hooks/session-start.py for inspiration" && python3 my-hook.py',
              },
            ],
          },
        ],
      },
    };
    const { content, fullyEmpty } = scrubHooksJson(
      JSON.stringify(input, null, 2),
      CLAUDE_DELETE_PATHS,
      "nested",
    );
    const parsed = JSON.parse(content);
    // Token-based matcher should preserve the user's hook intact.
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks).toHaveLength(1);
    expect(fullyEmpty).toBe(false);
  });

  it("collapses empty matcher blocks (whole block dropped when its hooks list goes to 0)", () => {
    const input = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/session-start.py",
              },
            ],
          },
          {
            matcher: "user",
            hooks: [
              { type: "command", command: "python3 .claude/hooks/user.py" },
            ],
          },
        ],
      },
    };
    const { content } = scrubHooksJson(
      JSON.stringify(input, null, 2),
      CLAUDE_DELETE_PATHS,
      "nested",
    );
    const parsed = JSON.parse(content);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].matcher).toBe("user");
  });
});



describe("scrubManagedMarkdownBlock", () => {
  it("removes the managed block and preserves user markdown", () => {
    const input = `# User Guidance

Keep this.

${TEST_BLOCK_START}
# Managed
Remove this.
${TEST_BLOCK_END}

## Tail

Also keep this.
`;

    const { content, fullyEmpty } = scrubManagedMarkdownBlock(
      input,
      TEST_BLOCK_START,
      TEST_BLOCK_END,
    );

    expect(content).toBe(`# User Guidance

Keep this.

## Tail

Also keep this.
`);
    expect(fullyEmpty).toBe(false);
  });

  it("reports fullyEmpty when only the managed block remains", () => {
    const { content, fullyEmpty } = scrubManagedMarkdownBlock(
      `${TEST_BLOCK_START}\nmanaged\n${TEST_BLOCK_END}\n`,
      TEST_BLOCK_START,
      TEST_BLOCK_END,
    );

    expect(content).toBe("");
    expect(fullyEmpty).toBe(true);
  });

  it("leaves malformed marker pairs untouched", () => {
    const input = `${TEST_BLOCK_START}\nmanaged\n`;
    const { content, fullyEmpty } = scrubManagedMarkdownBlock(
      input,
      TEST_BLOCK_START,
      TEST_BLOCK_END,
    );

    expect(content).toBe(input);
    expect(fullyEmpty).toBe(false);
  });
});


describe("scrubCodexConfigToml", () => {
  const TEMPLATE = `# Project-scoped Codex defaults for Trellis workflows.
# Codex loads this after ~/.codex/config.toml when you work in this project.

# Keep AGENTS.md as the primary project instruction file.
project_doc_fallback_filenames = ["AGENTS.md"]

# NOTE: Trellis's SessionStart + UserPromptSubmit hooks require opt-in.
# Add the following to your USER-level config at ~/.codex/config.toml
# (not this project file — features.* must be enabled globally):
#
#   [features]
#   codex_hooks = true
#
# Without this flag, hooks.json is ignored and Trellis context won't
# be injected into Codex sessions.
`;

  it("removes the entire trellis-shipped file and reports fullyEmpty", () => {
    const { content, fullyEmpty } = scrubCodexConfigToml(TEMPLATE);
    expect(fullyEmpty).toBe(true);
    expect(content.trim()).toBe("");
  });

  it("preserves user-added TOML content", () => {
    const userContent = `${TEMPLATE}
# My custom config
[my_section]
my_key = "value"
`;
    const { content, fullyEmpty } = scrubCodexConfigToml(userContent);
    expect(fullyEmpty).toBe(false);
    expect(content).toContain("[my_section]");
    expect(content).toContain('my_key = "value"');
    expect(content).not.toContain("project_doc_fallback_filenames");
    expect(content).not.toContain("Trellis's SessionStart");
  });

  it("strips just the assignment line when comments are absent", () => {
    const minimal = `project_doc_fallback_filenames = ["AGENTS.md"]
[user_section]
key = 1
`;
    const { content, fullyEmpty } = scrubCodexConfigToml(minimal);
    expect(fullyEmpty).toBe(false);
    expect(content).not.toContain("project_doc_fallback_filenames");
    expect(content).toContain("[user_section]");
  });

  it("strips the new `hooks = true` marker line (Codex 0.129+) alongside the legacy `codex_hooks` line", () => {
    const newTemplate = `# Project-scoped Codex defaults for Trellis workflows.
# Codex loads this after ~/.codex/config.toml when you work in this project.

# Keep AGENTS.md as the primary project instruction file.
project_doc_fallback_filenames = ["AGENTS.md"]

# NOTE: Trellis's SessionStart + UserPromptSubmit hooks require opt-in.
# Add the following to your USER-level config at ~/.codex/config.toml
# (not this project file — features.* must be enabled globally):
#
#   [features]
#   hooks = true
#   codex_hooks = true
#
# Without this flag, hooks.json is ignored and Trellis context won't
# be injected into Codex sessions.
`;
    const { content, fullyEmpty } = scrubCodexConfigToml(newTemplate);
    expect(fullyEmpty).toBe(true);
    expect(content.trim()).toBe("");
  });
});
