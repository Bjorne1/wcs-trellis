# Development Workflow

---

## Core Principles

1. **Plan before code** — figure out what to do before you start
2. **Specs injected, not remembered** — guidelines are injected via hook/skill, not recalled from memory
3. **Persist everything** — research, decisions, and lessons all go to files; conversations get compacted, files don't
4. **Incremental development** — one task at a time
5. **Capture learnings** — after each task, review and write new knowledge back to spec

---

## Trellis System

### Developer Identity

On first use, initialize your identity:

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

Creates `.trellis/.developer` (gitignored) + `.trellis/workspace/<your-name>/`.

### Spec System

`.trellis/spec/` holds coding guidelines organized by package and layer.

- `.trellis/spec/<package>/<layer>/index.md` — entry point with **Pre-Development Checklist** + **Quality Check**. Actual guidelines live in the `.md` files it points to.
- `.trellis/spec/guides/index.md` — cross-package thinking guides.

```bash
python3 ./.trellis/scripts/get_context.py --mode packages   # list packages / layers
```

**When to update spec**: new pattern/convention found · bug-fix prevention to codify · new technical decision.

### Task System

Every task has its own directory under `.trellis/tasks/{MM-DD-name}/` holding `task.json`, `prd.md`, optional `design.md`, optional `implement.md`, optional `research/`, and context manifests (`implement.jsonl`, `check.jsonl`) for sub-agent-capable platforms.

```bash
# Task lifecycle
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py start <name>          # set active task (session-scoped when available)
python3 ./.trellis/scripts/task.py current --source      # show active task and source
python3 ./.trellis/scripts/task.py finish                # clear active task (triggers after_finish hooks)
python3 ./.trellis/scripts/task.py archive <name>        # move to archive/{year-month}/
python3 ./.trellis/scripts/task.py list [--mine] [--status <s>]
python3 ./.trellis/scripts/task.py list-archive

# Code-spec context (injected into implement/check agents via JSONL).
# `implement.jsonl` / `check.jsonl` are seeded on `task create` for sub-agent-capable
# platforms; the AI curates real spec + research entries during planning when needed.
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py list-context <name> [action]
python3 ./.trellis/scripts/task.py validate <name>

# Task metadata
python3 ./.trellis/scripts/task.py set-branch <name> <branch>
python3 ./.trellis/scripts/task.py set-base-branch <name> <branch>    # PR target
python3 ./.trellis/scripts/task.py set-scope <name> <scope>

# Hierarchy (parent/child)
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py remove-subtask <parent> <child>

# PR creation
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

> Run `python3 ./.trellis/scripts/task.py --help` to see the authoritative, up-to-date list.

**Current-task mechanism**: `task.py create` creates the task directory and (when session identity is available) auto-sets the per-session active-task pointer so the planning breadcrumb fires immediately. `task.py start` writes the same pointer (idempotent if already set) and flips `task.json.status` from `planning` to `in_progress`. State is stored under `.trellis/.runtime/sessions/`. If no context key is available from hook input, `TRELLIS_CONTEXT_ID`, or a platform-native session environment variable, there is no active task and `task.py start` fails with a session identity hint. `task.py finish` deletes the current session file (status unchanged). `task.py archive <task>` writes `status=completed`, moves the directory to `archive/`, and deletes any runtime session files that still point at the archived task.

### Workspace System

Records every AI session for cross-session tracking under `.trellis/workspace/<developer>/`.

- `journal-N.md` — session log. **Max 2000 lines per file**; a new `journal-(N+1).md` is auto-created when exceeded.
- `index.md` — personal index (total sessions, last active).

```bash
python3 ./.trellis/scripts/add_session.py --title "Title" --commit "hash" --summary "Summary"
```

### Context Script

```bash
python3 ./.trellis/scripts/get_context.py                            # full session runtime
python3 ./.trellis/scripts/get_context.py --mode packages            # available packages + spec layers
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>  # detailed guide for a workflow step
```

---

<!--
  WORKFLOW-STATE BREADCRUMB CONTRACT (read this before editing the tag blocks below)

  The [workflow-state:STATUS] blocks embedded in the ## Phase Index section
  below are the SINGLE source of truth for the per-turn `<workflow-state>`
  breadcrumb that every supported AI platform's UserPromptSubmit hook
  reads. inject-workflow-state.py (Python platforms) and
  inject-workflow-state.js (OpenCode plugin) only parse them — there is no
  fallback dict baked into the scripts after v0.5.0-rc.0.

  The breadcrumb is opt-in: inject-workflow-state.py emits nothing until the
  session runs `task.py engage` via `trellis-start` / `trellis-continue` /
  `trellis-finish-work`. Every block below therefore speaks only to sessions
  that asked for Trellis.

  STATUS charset: [A-Za-z0-9_-]+. When the hook can't find a tag, it
  degrades to a generic "Refer to workflow.md for current step." line —
  intentionally visible so users notice and fix a broken workflow.md.

  INVARIANT (test/regression.test.ts):
    Every workflow-walkthrough step marked `[required · once]` must have a
    matching enforcement line in its phase's [workflow-state:*] block. The
    breadcrumb is the only per-turn channel; if a mandatory step isn't
    mentioned there, the AI silently skips it (Phase 1 planning gate
    skip and Phase 3.4 commit skip both manifested via this gap).

  TAG ↔ PHASE scoping:
    [workflow-state:no_task]      → engaged with no active task: before
                                    Phase 1, or after task.py finish/archive
    [workflow-state:planning]     → all of Phase 1 (status='planning')
    [workflow-state:planning-inline] → Codex inline variant of Phase 1
    [workflow-state:in_progress]  → Phase 2 + Phase 3.2-3.4
                                    (status stays 'in_progress' from
                                    task.py start until task.py archive)
    [workflow-state:in_progress-inline] → Codex inline variant of Phase 2/3
    [workflow-state:completed]    → currently DEAD: cmd_archive flips
                                    status and moves the dir in the same
                                    call, so the resolver loses the
                                    pointer (block kept for a future
                                    explicit in_progress→completed
                                    transition)

  Editing checklist:
    - When you change a [workflow-state:STATUS] block, also check the
      matching phase's `[required · once]` walkthrough steps for sync
    - Run `trellis update` after editing to push the new bodies to
      downstream user projects (block-level managed replacement)
    - Full runtime contract:
      .trellis/spec/cli/backend/workflow-state-contract.md
-->

## Phase Index

```
Phase 1: Plan    → create the task on explicit request, then write planning artifacts
Phase 2: Execute → implement only after task status is in_progress
Phase 3: Finish  → verify, commit, and wrap up
```

### Request Triage

- Trellis is opt-in per session. Until the user invokes `trellis-start`, `trellis-continue` or `trellis-finish-work`, no Trellis context is injected and there is nothing to route — work inline.
- Do not ask whether to create a Trellis task, and do not offer, suggest, or infer that a request warrants one. The user owns that judgment and expresses it by invoking `trellis-start`.
- An in-flight task from another session is not this session's task. Only `trellis-continue` adopts it.
- Creating a task is not approval to start implementation. Planning still happens first, and every task gets the full artifact set.

### Planning Artifacts

- `prd.md` — requirements, constraints, and acceptance criteria. Do not put technical design or execution checklists here.
- `design.md` — technical design: boundaries, contracts, data flow, tradeoffs, compatibility, rollout / rollback shape. For `kind=feature` it also carries the confirmed test-seam list.
- `implement.md` — execution plan: ordered slice checklist, validation commands, review gates, and rollback points.
- `implement.jsonl` / `check.jsonl` — spec and research manifests for sub-agent context. They do not replace `implement.md`.
- Every task needs `prd.md`, `design.md`, and `implement.md` before `task.py start`. There is no PRD-only tier — a task the user explicitly asked for is by definition worth the full artifact set.

### Task Kind and the Red-Evidence Gate

Every task records its kind in `task.json` under `meta.kind`, set at creation with `task.py create ... --meta kind=<kind>` or afterwards with `task.py set-meta <task-dir> kind <kind>`.

| `meta.kind` | Red evidence | Where it lives | Enforced at |
|---|---|---|---|
| `bug` | A red-capable command you have already executed: it drives the real code path, asserts the reported symptom, is deterministic (or has a workable flake rate), and is fast enough to re-run | `research/repro-<topic>.md` — the redacted invocation plus its red output | Phase 1.4, before `task.py start` |
| `feature` | A confirmed test-seam list: the public boundaries the tests will sit on, agreed with the user | `design.md` | Phase 1.4 for the seam list; red-before-green per slice in Phase 2.1 |
| `chore` | Exempt | — | — |

Rules:

- **Never guess the kind.** If `meta.kind` is missing, ask the user to set it and do not proceed to `task.py start`.
- Redact secrets before pasting any command or output into a task artifact. Substitute `<REDACTED>`.
- If no red-capable command can be built, say so explicitly in the artifact — list what you tried and what you need (environment access, a redacted log/HAR, approval to instrument). Never skip the gate silently and never mark it satisfied by a lint, build, or type-check that cannot observe the reported failure.
- `chore` is for config, docs, scaffolding, and mechanical moves. Do not label a behavior change `chore` to escape the gate.

### Parent / Child Task Trees

Use a parent task when one user request contains several independently verifiable deliverables. The parent task owns the source requirement set, the task map, cross-child acceptance criteria, and final integration review; it normally should not be the implementation target unless it also has direct work.

Use child tasks for deliverables that can be planned, implemented, checked, and archived independently. Parent/child structure is not a dependency system: if one child must wait for another, write that ordering in the child `prd.md` / `implement.md` and keep each child's acceptance criteria testable.

Create new children with `task.py create "<title>" --slug <name> --parent <parent-dir>`. Link existing tasks with `task.py add-subtask <parent> <child>`, and unlink mistakes with `task.py remove-subtask <parent> <child>`.

<!-- Per-turn breadcrumb: shown in an engaged session that has no active task —
     either `trellis-start` has not created one yet, or `task.py finish` /
     archive cleared the pointer mid-session. An unengaged session gets no
     breadcrumb at all, so this block never speaks for one. -->

[workflow-state:no_task]
No active task. Work inline; create a Trellis task only when the user explicitly asks for one.
[/workflow-state:no_task]

### Phase 1: Plan
- 1.0 Create task `[required · once]` (only on explicit user request, i.e. `trellis-start`)
- 1.1 Requirement exploration `[required · repeatable]` (`prd.md`, `design.md`, `implement.md` — all three)
- 1.2 Research `[optional · repeatable]` (required for `kind=bug`: this is where the repro is built)
- 1.3 Configure context `[required · once]` — Claude Code, Cursor, OpenCode, Codex, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Grok, Kimi Code (sub-agent-dispatch platforms only; inline platforms skip)
- 1.4 Activate task `[required · once]` (review gate + red-evidence gate, then `task.py start`; status → in_progress)
- 1.5 Completion criteria

<!-- Per-turn breadcrumb: shown throughout Phase 1 (status='planning') -->

[workflow-state:planning]
Load `trellis-brainstorm`; stay in planning. Ask the whole current frontier per round, not one question per message.
Finish `prd.md`, `design.md`, and `implement.md` — all three, every task; ask for review before `task.py start`.
Red-evidence gate keyed on `task.json` `meta.kind`: `bug` needs an already-executed red-capable repro command plus its redacted red output in `research/`; `feature` needs a user-confirmed test-seam list in `design.md`; `chore` is exempt. If `meta.kind` is missing, ask the user to set it with `task.py set-meta <task-dir> kind <kind>` — never guess.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; dependencies must be written in child artifacts, not implied by tree position.
Sub-agent mode: curate `implement.jsonl` and `check.jsonl` as spec/research manifests before start.
[/workflow-state:planning]

<!-- Per-turn breadcrumb: shown throughout Phase 1 when codex.dispatch_mode=inline.
     Codex-only opt-in alternate to [workflow-state:planning]. The main agent
     edits code directly in Phase 2, so jsonl curation is skipped —
     the inline workflow loads `trellis-before-dev` instead of injecting JSONL
     into a sub-agent. -->

[workflow-state:planning-inline]
Load `trellis-brainstorm`; stay in planning. Ask the whole current frontier per round, not one question per message.
Finish `prd.md`, `design.md`, and `implement.md` — all three, every task; ask for review before `task.py start`.
Red-evidence gate keyed on `task.json` `meta.kind`: `bug` needs an already-executed red-capable repro command plus its redacted red output in `research/`; `feature` needs a user-confirmed test-seam list in `design.md`; `chore` is exempt. If `meta.kind` is missing, ask the user to set it with `task.py set-meta <task-dir> kind <kind>` — never guess.
Multi-deliverable scope: consider a parent task plus independently verifiable child tasks; dependencies must be written in child artifacts, not implied by tree position.
Inline mode: skip jsonl curation; Phase 2 reads artifacts/specs via `trellis-before-dev`.
[/workflow-state:planning-inline]

### Phase 2: Execute
- 2.1 Implement `[required · repeatable]`
- 2.2 Quality check `[required · repeatable]`
- 2.3 Rollback `[on demand]`

<!-- Per-turn breadcrumb: shown while status='in_progress'.
     Scope: all of Phase 2 + Phase 3.2-3.4 (status stays 'in_progress' from
     task.py start until task.py archive; only archive flips it). The body
     therefore must cover every required step from implementation through
     commit, including Phase 3.3 spec update and Phase 3.4 commit. -->

Sub-agent dispatch protocol applies to all platforms and all sub-agents, including native Codex `SubagentStart` context injection with child-side pull fallback, class-2 Gemini/Qoder/Copilot/Reasonix/Trae/Grok/Kimi Code/DeepSeek Harness, hook-backed ZCode/Snow, and `trellis-research`: every dispatch prompt starts with `Active task: <task path from task.py current>` before role-specific instructions. On Grok Build, use `spawn_subagent` with `subagent_type` set to the Trellis agent name (e.g. `trellis-implement`). On Kimi Code, dispatch the built-in `coder` / `explore` sub-agent with the matching `.kimi-code/skills/trellis-<role>/SKILL.md` instructions. On DeepSeek Harness, tell the child to load the matching `.dsh/skills/trellis-agent-<role>/SKILL.md` exactly once, then choose the synchronization path by capability. If the optional companion plugin exposes `trellis_wait`, dispatch `subagent` in its default continuable background mode, continue independent work, and call `trellis_wait` once per dependent child id when a dependent gate is next; each call returns only after DSH has queued that child's native settlement notice. Without `trellis_wait`, dispatch each child with `run_in_background: false` from the outset so no dependent gate can overtake it. Never simulate waiting with shell sleep, polling loops, `job_output`, repeated `list_agents`, or another long-running command, and never leave a background child without an event-driven wait path.

[workflow-state:in_progress]
Tools: `trellis-implement` / `trellis-research` name sub-agent roles dispatched through your platform's sub-agent mechanism, not skills the main session loads itself (on Claude Code: use the Task/Agent tool, never the Skill tool). `trellis-update-spec` is a skill. `trellis-check` exists as both; prefer the Agent/role form when verifying after code changes.
On DeepSeek Harness, role instructions ship as collision-free `trellis-agent-implement` / `trellis-agent-check` / `trellis-agent-research` skills under `.dsh/skills/`. The main session must not load them itself: tell the child to load the matching role skill exactly once. If `trellis_wait` is available, use the default background mode, do independent work, then call `trellis_wait` once per dependent child id and consume each native settlement notice before entering the dependent gate. If it is unavailable, dispatch every child with `run_in_background: false` from the outset. Do not poll, sleep, or start a background child without an event-driven wait path.
Flow: `trellis-implement` -> `trellis-check` -> commit (Phase 3.4) -> `/trellis:finish-work`. Spec update (3.3) is on demand — run it when the user asks, not as part of the default flow.
Red before green: work the `implement.md` slice checklist one slice at a time — test at a seam confirmed in `design.md`, run it, paste the redacted red output into that slice entry, then write the minimum code to pass. No horizontal slicing, no tautological assertions, no refactoring inside a red-green cycle. `kind=chore` and repos with no runnable harness must state that in the slice entry instead of skipping silently. Load the `trellis-tdd` skill for the full contract.
Main-session default: dispatch implement/check sub-agents. Sub-agent self-exemption: if already running as `trellis-implement`, do NOT spawn another `trellis-implement` or `trellis-check`; if already running as `trellis-check`, do NOT spawn another `trellis-check` or `trellis-implement`. Dispatch is main session only.
Dispatch prompt starts with `Active task: <task path from task.py current>`. Read context: jsonl entries -> `prd.md` -> `design.md` -> `implement.md`.
[/workflow-state:in_progress]

<!-- Per-turn breadcrumb: shown while status='in_progress' when
     codex.dispatch_mode=inline. Codex-only opt-in alternate to
     [workflow-state:in_progress]. The main session edits code directly
     instead of dispatching sub-agents. -->

[workflow-state:in_progress-inline]
Flow: `trellis-before-dev` -> edit -> `trellis-check` -> validation -> commit (Phase 3.4) -> `/trellis:finish-work`. Spec update (3.3) is on demand — run it when the user asks, not as part of the default flow.
Red before green: work the `implement.md` slice checklist one slice at a time — test at a seam confirmed in `design.md`, run it, paste the redacted red output into that slice entry, then write the minimum code to pass. No horizontal slicing, no tautological assertions, no refactoring inside a red-green cycle. `kind=chore` and repos with no runnable harness must state that in the slice entry instead of skipping silently. Load the `trellis-tdd` skill for the full contract.
Do not dispatch implement/check sub-agents in inline mode.
Read context: `prd.md` -> `design.md` -> `implement.md`, plus relevant spec/research loaded by skills.
[/workflow-state:in_progress-inline]

### Phase 3: Finish
- 3.2 Debug retrospective `[on demand]`
- 3.3 Spec update `[on demand]`
- 3.4 Commit changes `[required · once]`
- 3.5 Wrap-up reminder

> Note: step 3.1 was folded into 2.2 (last-iteration full-scope check) and 3.4 (commit preamble). Numbering kept stable to avoid breaking external references.

<!-- Per-turn breadcrumb: shown while status='completed'.
     Currently DEAD in normal flow: cmd_archive writes status='completed' in
     the same call that moves the task dir to archive/, so the active-task
     resolver loses the pointer and the hook never fires on archived tasks.
     Block preserved for a future status-transition redesign (e.g. an
     explicit in_progress→completed command). Edit through the same spec
     channel as the live blocks. -->

[workflow-state:completed]
Code committed. Run `/trellis:finish-work`; if dirty, return to Phase 3.4 first.
[/workflow-state:completed]

### Rules

1. Identify which Phase you're in, then continue from the next step there
2. Run steps in order inside each Phase; `[required]` steps can't be skipped
3. Phases can roll back (e.g., Execute reveals a prd defect → return to Plan to fix, then re-enter Execute)
4. Steps tagged `[once]` are skipped if the output already exists; don't re-run
5. Every task carries `prd.md`, `design.md`, and `implement.md`; a missing one means planning is incomplete, not that the task is lightweight.

### Active Task Routing

When a user request matches one of these intents inside an active task, route first, then load the detailed phase step if needed.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

- Planning or unclear requirements -> `trellis-brainstorm`.
- `in_progress` implementation/check -> dispatch `trellis-implement` / `trellis-check`.
- Writing a failing test, or reproducing a reported bug -> `trellis-tdd`.
- Repeated debugging -> `trellis-break-loop`; spec updates -> `trellis-update-spec`.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

- Planning or unclear requirements -> `trellis-brainstorm`.
- Before editing -> `trellis-before-dev`; after editing -> `trellis-check`.
- Writing a failing test, or reproducing a reported bug -> `trellis-tdd`.
- Repeated debugging -> `trellis-break-loop`; spec updates -> `trellis-update-spec`.

[/codex-inline, Kilo, Antigravity, Devin]

### Guardrails

- Never ask whether to create a task. With no active task, work inline; the user asks when they want one.
- Creating a task is not implementation approval; implementation waits for `task.py start` after artifact review.
- Every task needs `prd.md`, `design.md`, and `implement.md`. There is no PRD-only tier.
- `meta.kind` is never guessed. Without it, the red-evidence gate cannot be evaluated and `task.py start` must wait.
- No production code before red evidence: a `bug` needs an executed repro, a `feature` needs a failing test at a confirmed seam. "Cannot build one" is a valid outcome only when written down with what was tried.
- Planning must be persisted to task artifacts; checks must run before reporting completion.

### Loading Step Detail

At each step, run this to fetch detailed guidance:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <step>
# e.g. python3 ./.trellis/scripts/get_context.py --mode phase --step 1.1
```

---

## Phase 1: Plan

Goal: turn an explicitly requested task into the planning artifacts and red evidence required before implementation.

#### 1.0 Create task `[required · once]`

Create the task directory only when the user explicitly asked for a task — in practice, when they invoked `trellis-start`, which owns this step. Do not ask whether to create one, and do not create one on your own initiative. The command sets status to `planning`, writes `task.json`, creates a default `prd.md`, and auto-targets the new task when session identity is available:

```bash
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name> --meta kind=<bug|feature|chore>
```

`--slug` is the human-readable name only. Do **not** include the `MM-DD-` date prefix; `task.py create` adds that prefix automatically.

`--meta kind=` records the task kind in `task.json` under `meta.kind`, which selects the red-evidence gate. Set it here, or afterwards with `task.py set-meta <task-dir> kind <kind>`. If you do not know the kind, ask the user — never guess it, and never default it.

For task trees, create the parent task first and then create each child with `--parent <parent-dir>`. Do not start the parent just because children exist; start the child that owns the next independently verifiable deliverable. Each child carries its own `meta.kind`.

After this command succeeds, the per-turn breadcrumb auto-switches to `[workflow-state:planning]`, telling the AI to stay in planning.

Run only `create` here — do not also run `start`. `start` flips status to `in_progress`, which switches the breadcrumb to the implementation phase before planning artifacts are reviewed. Save `start` for step 1.4.

Skip when `python3 ./.trellis/scripts/task.py current --source` already points to a task.

#### 1.1 Requirement exploration `[required · repeatable]`

Load the `trellis-brainstorm` skill and explore requirements interactively with the user per the skill's guidance.

The brainstorm skill will guide you to:
- Model the work as a decision tree and ask the whole current frontier in one numbered round, each item carrying your recommendation and its trade-off
- Prefer researching over asking the user
- Update `prd.md` immediately after each round of answers
- Split large scopes into a parent task plus child tasks when the deliverables can be verified independently
- Keep `prd.md` focused on requirements and acceptance criteria
- Produce `design.md` and `implement.md` before implementation starts — for every task, not only large ones
- For `kind=feature`, converge on the test-seam list and record it in `design.md`; for `kind=bug`, make the reproduction the acceptance criterion

When considering a parent/child split:
- Use a parent task when one request contains several independently verifiable deliverables.
- Parent tasks own source requirements, child-task mapping, cross-child acceptance criteria, and final integration review.
- Child tasks own actual deliverables that can be planned, implemented, checked, and archived independently.
- Parent/child structure is not a dependency system. If child B depends on child A, write that ordering in child B's `prd.md` / `implement.md`.
- Start the child task that owns the next deliverable. Do not start the parent unless the parent itself has direct implementation work.

Return to this step whenever requirements change and revise the relevant artifact.

#### 1.2 Research `[optional · repeatable]`

Research can happen at any time during requirement exploration. It isn't limited to local code — you can use any available tool (MCP servers, skills, web search, etc.) to look up external information, including third-party library docs, industry practices, API references, etc.

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

Spawn the research sub-agent:

- **Agent type**: `trellis-research`
- **Task description**: Research <specific question>
- **Key requirement**: Research output MUST be persisted to `{TASK_DIR}/research/`
- **DeepSeek Harness**: tell the child to load `trellis-agent-research` exactly once. If `trellis_wait` is available, use the default continuable background mode, dispatch independent questions concurrently when useful, continue unrelated work, then call `trellis_wait` once per child id and consume each settlement notice before advancing. Without `trellis_wait`, dispatch each required child with `run_in_background: false`; do not poll or sleep.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

Do the research in the main session directly and write findings into `{TASK_DIR}/research/`. `codex-inline` is the explicit mode that keeps work in the main session.

[/codex-inline, Kilo, Antigravity, Devin]

**Research artifact conventions**:
- One file per research topic (e.g. `research/auth-library-comparison.md`)
- Record third-party library usage examples, API references, version constraints in files
- Note relevant spec file paths you discovered for later reference

**Bug reproduction (`meta.kind=bug`) — required, not optional**:

This step is where the red-capable command gets built, and Phase 2 cannot start without it. Write it to `research/repro-<topic>.md` with:

- the redacted invocation, and the red output you actually saw when you ran it
- what symptom it asserts, stated precisely enough to re-verify after the fix
- its determinism: reliably red, or a reproduction rate you can work with
- the minimised scenario — strip inputs, callers, config, and steps one at a time, re-running after each, until every remaining element is load-bearing

Invest heavily here. A theory built from reading code, with no command that goes red, is not a diagnosis. If you genuinely cannot build one, write that down: list what you tried and what you need (environment access, a redacted log/HAR/trace, approval to instrument), and stop rather than guessing at a fix.

Redact secrets first — substitute `<REDACTED>` and read credentials from environment variables so they never appear in captured output.

Brainstorm and research can interleave freely — pause to research a technical question, then return to talk with the user.

**Key principle**: Research output must be written to files, not left only in the chat. Conversations get compacted; files don't.

#### 1.3 Configure context `[required · once]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

Curate `implement.jsonl` and `check.jsonl` so the Phase 2 sub-agents get the right spec/research context. These files were seeded on `task create` with a single self-describing `_example` line; your job here is to fill in real entries.

**Location**: `{TASK_DIR}/implement.jsonl` and `{TASK_DIR}/check.jsonl` (already exist).

**Format**: one JSON object per line — `{"file": "<path>", "reason": "<why>"}`. Paths are repo-root relative.

**What to put in**:
- **Spec files** — `.trellis/spec/<package>/<layer>/index.md` and any specific guideline files (`error-handling.md`, `conventions.md`, etc.) relevant to this task
- **Research files** — `{TASK_DIR}/research/*.md` that the sub-agent will need to consult

**What NOT to put in**:
- Code files (`src/**`, `packages/**/*.ts`, etc.) — those are read by the sub-agent during implementation, not pre-registered here
- Files you're about to modify — same reason

**Split between the two files**:
- `implement.jsonl` → specs + research the implement sub-agent needs to write code correctly
- `check.jsonl` → specs for the check sub-agent (quality guidelines, check conventions, same research if needed)

These manifests do not replace `implement.md`. `implement.md` is the human-readable slice checklist the red-green cycle walks; jsonl files only list context files to inject or load.

**How to discover relevant specs**:

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

Lists every package + its spec layers with paths. Pick the entries that match this task's domain.

**How to append entries**:

Either edit the jsonl file directly in your editor, or use:

```bash
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" implement "<path>" "<reason>"
python3 ./.trellis/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

Delete the seed `_example` line once real entries exist (optional — it's skipped automatically by consumers).

Ready gate: both `implement.jsonl` and `check.jsonl` must contain at least one real `{"file": "...", "reason": "..."}` entry before `task.py start`. The seed `_example` row alone is not ready.

Skip this step only when both files already have real curated entries.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

Skip this step. Context is loaded directly by the `trellis-before-dev` skill in Phase 2.

[/codex-inline, Kilo, Antigravity, Devin]

#### 1.4 Activate task `[required · once]`

After artifact review and the red-evidence gate, flip the task status to `in_progress`:

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

Before running it, all of the following must hold:

- `prd.md`, `design.md`, and `implement.md` exist and have been reviewed.
- `task.json` has `meta.kind`. If it does not, ask the user and set it — do not start on a guessed kind.
- Red evidence for that kind is in place: `kind=bug` has an executed repro command plus its red output in `research/`; `kind=feature` has a user-confirmed test-seam list in `design.md`; `kind=chore` is exempt. An explicit written "no red-capable command, here is what I tried and what I need" satisfies the gate; silence does not.
- On sub-agent-dispatch platforms, `implement.jsonl` and `check.jsonl` both have real curated entries. Runtime consumers tolerate missing or seed-only manifests for compatibility, but that tolerance is not a planning-ready state.

After this command succeeds, the breadcrumb auto-switches to `[workflow-state:in_progress]`, and the rest of Phase 2 / 3 follows.

If `task.py start` errors with a session-identity message (no context key from hook input, `TRELLIS_CONTEXT_ID`, or platform-native session env), follow the hint in the error to set up session identity, then retry.

#### 1.5 Completion criteria

| Condition | Required |
|------|:---:|
| `prd.md` exists | ✅ |
| `design.md` exists | ✅ |
| `implement.md` exists, with an ordered slice checklist | ✅ |
| `task.json` has `meta.kind` (never guessed) | ✅ |
| `kind=bug`: executed repro command + red output in `research/`, minimised | ✅ |
| `kind=feature`: user-confirmed test-seam list in `design.md` | ✅ |
| User confirms task should enter implementation | ✅ |
| `task.py start` has been run (status = in_progress) | ✅ |

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

| `implement.jsonl` and `check.jsonl` each contain at least one real curated entry (seed row does not count) | ✅ |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

---

## Phase 2: Execute

Goal: turn reviewed planning artifacts into code that passes quality checks.

#### 2.1 Implement `[required · repeatable]`

**Red before green — applies on every platform.** Implementation walks the `implement.md` slice checklist one slice at a time. Per slice:

1. Write the test at a seam already confirmed in `design.md`. Never invent a new seam here — if the right seam is missing, that is a Phase 1 defect; go back to 1.1.
2. Run it and watch it fail. Paste the redacted red output into that slice's checklist entry.
3. Write the minimum production code to make it pass. Run it again.
4. Move to the next slice.

Prohibited: horizontal slicing (all tests first, then all implementations), testing internals instead of public boundaries, tautological assertions that recompute the expectation the way the code does, mocking internal collaborators, and refactoring inside a red-green cycle.

For `meta.kind=bug`, the slice-1 test is the minimised reproduction from `research/repro-<topic>.md` converted into a regression test at a seam that exercises the real failing path. After it passes, re-run the original Phase 1.2 repro command against the full scenario — a passing narrow test with a still-red repro means the fix is incomplete. If no correct seam exists, that finding itself goes in the slice entry.

`meta.kind=chore` is exempt. A repo with no runnable harness is also exempt, but the slice entry must say so and why — never skip the cycle silently. Load the `trellis-tdd` skill for the full contract.

[Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts one `implement.md` slice at a time, red before green at the seams confirmed in `design.md`, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

The platform hook/plugin auto-handles:
- Reads `implement.jsonl` and injects referenced spec/research files into the agent prompt
- Injects `prd.md`, `design.md` if present, and `implement.md` if present
- For Codex, `SubagentStart` supplies native context injection; the agent profile keeps child-side loading as the fallback

[/Claude Code, Cursor, OpenCode, codex-sub-agent, CodeBuddy, Droid, Pi, ZCode, Snow, Oh My Pi]

[Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts one `implement.md` slice at a time, red before green at the seams confirmed in `design.md`, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then explicitly say the spawned agent is already `trellis-implement` and must implement directly without spawning another `trellis-implement` / `trellis-check`.
- **DeepSeek Harness**: tell the child to load `trellis-agent-implement` exactly once. If `trellis_wait` is available, use the default background mode, continue independent work, then wait once for that child id and consume its successful native settlement notice before Phase 2.2. Without `trellis_wait`, dispatch that child with `run_in_background: false`. Do not poll or sleep.

The pull-based sub-agent definition auto-handles the context load requirement:
- Resolves the active task with `task.py current --source`, then reads `prd.md`, `design.md` if present, and `implement.md` if present
- Reads `implement.jsonl` and requires the agent to load each referenced spec/research file before coding

[/Gemini, Qoder, Copilot, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[Kiro]

Spawn the implement sub-agent:

- **Agent type**: `trellis-implement`
- **Task description**: Implement the reviewed task artifacts one `implement.md` slice at a time, red before green at the seams confirmed in `design.md`, consulting materials under `{TASK_DIR}/research/`; finish by running project lint and type-check
- **Dispatch prompt guard**: Tell the spawned agent it is already the `trellis-implement` sub-agent and must implement directly, not spawn another `trellis-implement` / `trellis-check`.

The platform prelude auto-handles the context load requirement:
- Reads `implement.jsonl` and injects referenced spec/research files into the agent prompt
- Injects `prd.md`, `design.md` if present, and `implement.md` if present

[/Kiro]

[codex-inline, Kilo, Antigravity, Devin]

1. Load the `trellis-before-dev` skill to read project guidelines
2. Read `{TASK_DIR}/prd.md`, then `design.md`, then `implement.md`
3. Consult materials under `{TASK_DIR}/research/`
4. Load the `trellis-tdd` skill and walk the `implement.md` slice checklist red-before-green, one slice at a time
5. Run project lint and type-check

[/codex-inline, Kilo, Antigravity, Devin]

#### 2.2 Quality check `[required · repeatable]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

Spawn the check sub-agent:

- **Agent type**: `trellis-check`
- **Task description**: Review all code changes against specs and task artifacts; fix any findings directly; ensure lint and type-check pass
- **Dispatch prompt guard**: The prompt MUST start with `Active task: <task path>`, then tell the spawned agent it is already the `trellis-check` sub-agent and must review/fix directly, not spawn another `trellis-check` / `trellis-implement`.
- **DeepSeek Harness**: tell the child to load `trellis-agent-check` exactly once. If `trellis_wait` is available, use the default background mode, continue independent work, then wait once for that child id and consume its successful native settlement notice before Phase 3. Without `trellis_wait`, dispatch that child with `run_in_background: false`. Do not poll or sleep.

The check agent's job:
- Review code changes against specs
- Review code changes against `prd.md`, `design.md`, and `implement.md`
- Verify the red-evidence trail: each completed `implement.md` slice records the red output it started from, and for `kind=bug` the Phase 1.2 repro command has been re-run green against the full scenario. A slice claiming green with no recorded red is a finding, not a pass.
- Auto-fix issues it finds
- Run lint and typecheck to verify
- A required check that cannot run, is skipped, or exits non-zero is blocked/failed, never passed. Do not weaken or rewrite acceptance criteria to advance the workflow.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code, DeepSeek Harness]

[codex-inline, Kilo, Antigravity, Devin]

Load the `trellis-check` skill and verify the code per its guidance:
- Spec compliance
- lint / type-check / tests
- Cross-layer consistency (when changes span layers)

If issues are found → fix → re-check, until green.

[/codex-inline, Kilo, Antigravity, Devin]

**Final pass (before Phase 3.4 commit)**: the last 2.2 of a task must run full-scope, not just on the latest implement chunk. List all affected packages with `python3 ./.trellis/scripts/get_context.py --mode packages`, then load each package's spec index Quality Check section. This catches cross-layer / multi-package issues a mid-iteration local 2.2 cannot.

#### 2.3 Rollback `[on demand]`

- `check` reveals a prd defect → return to Phase 1, fix `prd.md`, then redo 2.1
- Implementation went wrong → revert code, redo 2.1
- Need more research → research (same as Phase 1.2), write findings into `research/`

---

## Phase 3: Finish

Goal: ensure code quality, capture lessons, record the work.

#### 3.2 Debug retrospective `[on demand]`

If this task involved repeated debugging (the same issue was fixed multiple times), load the `trellis-break-loop` skill to:
- Classify the root cause
- Explain why earlier fixes failed
- Propose prevention

The goal is to capture debugging lessons so the same class of issue doesn't recur.

#### 3.3 Spec update `[on demand]`

Run this when the user asks for it. Do not run it as a routine end-of-task step, and do not write to `.trellis/spec/` unasked.

When asked, load the `trellis-update-spec` skill and record what this task actually taught:
- Newly discovered patterns or conventions
- Pitfalls you hit
- New technical decisions

Update the docs under `.trellis/spec/` accordingly.

#### 3.4 Commit changes `[required · once]`

**Spec-sync preamble**: if this task fixed a bug whose root cause is not yet captured in `.trellis/spec/`, say so in one line and *propose* the spec update. Do not write it unasked, and do not hold the commit for it. Spec writes happen in Phase 3.3, which only runs when the user asks.

The AI drives a batched commit of this task's code changes so `/finish-work` can run cleanly afterwards. Goal: produce work commits FIRST, then bookkeeping (archive + journal) commits land after — never interleaved.

**Step-by-step**:

1. **Inspect dirty state**:
   ```bash
   git status --porcelain
   ```
   Snapshot every dirty path. If the working tree is clean, skip to 3.5.

2. **Learn commit style** from recent history (so drafted messages blend in):
   ```bash
   git log --oneline -5
   ```
   Note the prefix convention (`feat:` / `fix:` / `chore:` / `docs:` ...), language (中文/English), and length style.

3. **Classify dirty files into two groups**:
   - **AI-edited this session** — files you wrote/edited via Edit/Write/Bash tool calls in this session. You know what changed and why.
   - **Unrecognized** — dirty files you did NOT touch this session (could be the user's manual edits, leftover WIP from a previous session, or unrelated work). Do NOT silently include these.

4. **Draft a commit plan**. Group AI-edited files into logical commits (1 commit per coherent change unit, not 1 commit per file). Each entry: `<commit message>` + file list. List unrecognized files separately at the bottom.

5. **Present the plan once, ask for one-shot confirmation**. Format:
   ```
   Proposed commits (in order):
     1. <message>
        - <file>
        - <file>
     2. <message>
        - <file>

   Unrecognized dirty files (NOT in any commit — confirm include/exclude):
     - <file>
     - <file>

   Reply 'ok' / '行' to execute. Reply with edits, or '我自己来' / 'manual' to abort.
   ```

6. **On confirmation**: run `git add <files>` + `git commit -m "<msg>"` for each batch in order. Do not amend. Do not push.

7. **On rejection** (user replies "不行" / "我自己来" / "manual" / any pushback on the plan): stop. Do not attempt a second plan. The user will commit by hand; you skip ahead to 3.5 once they confirm.

**Rules**:
- No `git commit --amend` anywhere — three-stage three-commit flow (work commits → archive commit → journal commit).
- Never push to remote in this step.
- If the user wants different message wording but accepts the file grouping, edit the message and re-confirm once — but if they reject the grouping, exit to manual mode.
- The batched plan is one prompt; do not prompt per commit.

#### 3.5 Wrap-up reminder

After the above, remind the user they can run `/finish-work` to wrap up (archive the task, record the session).

---

## Customizing Trellis (for forks)

This section is for developers who want to modify the Trellis workflow itself. All customization is done by editing this file; the scripts are parsers only.

### Changing what a step means

Edit the corresponding step's walkthrough body in the Phase 1 / 2 / 3 sections above. Critical invariants:
- Trellis is opt-in per session: both injection hooks stay silent until an entry point runs `task.py engage`. Never move a required step's only enforcement out of the per-turn breadcrumb.
- With no active task, never ask whether to create one. A task is created only on the user's explicit request.
- Every task carries `prd.md`, `design.md`, and `implement.md` before start. There is no PRD-only tier.
- `meta.kind` is never guessed, and the red-evidence gate for that kind must be satisfied — or its impossibility written down — before `task.py start`.
- Every required execution path must keep the Phase 3.4 commit reminder reachable before `/trellis:finish-work`.

All tag blocks live in the `## Phase Index` section above, immediately after each phase summary:

| Scope | Corresponding tag |
|---|---|
| Engaged, no active task (before Phase 1, or after archive) | `[workflow-state:no_task]` (after the Phase Index ASCII art) |
| All of Phase 1 (task created → ready for implementation) | `[workflow-state:planning]` (after Phase 1 summary) |
| Codex inline Phase 1 | `[workflow-state:planning-inline]` |
| Phase 2 + Phase 3.2–3.4 (implementation + check + wrap-up) | `[workflow-state:in_progress]` (after Phase 2 summary) |
| Codex inline Phase 2 + Phase 3.2–3.4 | `[workflow-state:in_progress-inline]` |
| After Phase 3.5 (archived) | `[workflow-state:completed]` (after Phase 3 summary; **currently DEAD**) |

### Changing the per-turn prompt text

Directly edit the body of the corresponding `[workflow-state:STATUS]` block. After editing, run `trellis update` (if you're a template maintainer) or restart your AI session (if you're customizing your own project) — no script changes required.

### Adding a custom status

Add a new block:

```
[workflow-state:my-status]
your per-turn prompt text
[/workflow-state:my-status]
```

Constraints:
- STATUS charset: `[A-Za-z0-9_-]+` (underscores and hyphens allowed, e.g. `in-review`, `blocked-by-team`)
- A lifecycle hook must write `task.json.status` to your custom value, otherwise the tag is never read
- Lifecycle hooks live in `task.json.hooks.after_*` and bind to one of `after_create / after_start / after_finish / after_archive`

### Adding a lifecycle hook

Add a `hooks` field to your `task.json`:

```json
{
  "hooks": {
    "after_finish": [
      "your-script-or-command-here"
    ]
  }
}
```

Supported events: `after_create / after_start / after_finish / after_archive`. Note that `after_finish` ≠ a status change (it only clears the active-task pointer); use `after_archive` for "task is done" notifications.

### Full contract

For the workflow state machine's runtime contract, the locations of all status writers, pseudo-statuses (`no_task` / `stale_<source_type>`), the hook reachability matrix, and other deep details, see:

- `.trellis/spec/cli/backend/workflow-state-contract.md` — runtime contract + writer table + test invariants
- `.trellis/scripts/inject-workflow-state.py` — actual parser (reads workflow.md only, no embedded text)
