---
name: trellis-continue
description: "Resume work on the current task. Loads the workflow Phase Index, figures out which phase/step to pick up at, then pulls the step-level detail via get_context.py --mode phase. Use when coming back to an in-progress task and you need to know what to do next."
---

# Continue Current Task

Resume work on the current task — pick up at the right phase/step in `.trellis/workflow.md`.

Context injection is opt-in: until Step 1 runs, this session receives no Trellis context at all.

---

## Step 1: Engage this session

```bash
python ./.trellis/scripts/task.py engage
```

Marks this session as Trellis-managed, which turns on the per-turn workflow breadcrumb and re-injection after `/clear` or `/compact`.

If this exits non-zero, **stop and report it**. Without the flag the remaining phases run unguided, and the commit gate will not be enforced.

## Step 2: Load Current Context

```bash
python ./.trellis/scripts/get_context.py
```

Confirms: current task, git state, recent commits.

A task started in an earlier session is not automatically this session's task. If no current task is reported, ask the user which task to resume, then read its `task.json` status:

```bash
python ./.trellis/scripts/task.py list --mine
```

Re-point this session with `task.py start <task-dir>` **only** when that status is already `in_progress`. On a `planning` task `start` also flips the status, jumping the Phase 1.4 review gate — for those, work from the task directory and route by Step 4, accepting that the per-turn breadcrumb reports `no_task` until Phase 1.4 legitimately runs.

## Step 3: Load the Phase Index

```bash
python ./.trellis/scripts/get_context.py --mode phase
```

Shows the Phase Index (Plan / Execute / Finish) with routing + skill mapping.

## Step 4: Decide Where You Are

`get_context.py` shows the active task's `status` field. Route by `status` + artifact presence. This command replaces the user needing to remember the Trellis flow; it does not itself approve implementation.

- `status=planning` + no `prd.md` → **1.1** (load `trellis-brainstorm`)
- `status=planning` + `prd.md` only → decide whether the task is lightweight or complex. Lightweight can move to **1.4** review; complex returns to **1.1** to add `design.md` + `implement.md`.
- `status=planning` + complex artifacts complete + sub-agent jsonl not curated (only the seed `_example` row) → **1.3**
- `status=planning` + required artifacts complete + required jsonl curated or inline mode → **1.4** (ask for start review; only run `task.py start` after user confirms)
- `status=in_progress` + implementation not started → **2.1**
- `status=in_progress` + implementation done, not yet checked → **2.2**
- `status=in_progress` + check passed → **3.3** (spec update) → **3.4** (commit)
- `status=completed` (rare; usually archived immediately) → archive flow

Phase rules (full detail in `.trellis/workflow.md`):

1. Run steps **in order** within a phase — `[required]` steps must not be skipped
2. `[once]` steps are already done if the required output exists. Every task needs `prd.md`, `design.md`, and `implement.md`; `prd.md` alone means planning is unfinished.
3. You may go back to an earlier phase if discoveries require it

## Step 5: Load the Specific Step

Once you know which step to resume at:

```bash
python ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform codex
```

Follow the loaded instructions. After each `[required]` step completes, move to the next.

---

## Reference

Full workflow and detailed phase steps live in `.trellis/workflow.md`. This command is only an entry point — the canonical guidance is there.
