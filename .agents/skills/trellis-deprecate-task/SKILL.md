---
name: trellis-deprecate-task
description: "Abandon a Trellis task that should not continue — wrong direction, cancelled requirement, or gone obsolete: banner-marks its docs, records meta.deprecated in task.json, and archives it. Use when the user explicitly asks to deprecate, drop, abandon, or cancel a task (废弃 / 放弃 / 方向错了 / 需求取消 / 不做了). Not for work that finished — that is finish-work."
---

# Deprecate Task

Abandon a task that should not continue — wrong direction, cancelled requirement, gone obsolete — and archive it. This is **not** completion: there is no deliverable, and no code commit belongs to this flow. For work that actually finished, use `finish-work` (Trellis command).

Run this only on an explicit request to drop a task: `废弃` / `放弃` / `方向错了` / `需求取消` / `不做了` / "deprecate", "abandon", "drop this task". A task that merely looks stale is not a trigger — ask the user first.

## Step 1: Engage this session

```bash
python ./.trellis/scripts/task.py engage
```

No-op when the session already ran an entry point; the step that makes Step 2 see the active task when it did not.

`✓ Trellis engaged (pending session binding)` is success, not a warning: this shell exposes no session identity, so the opt-in was recorded as a pending claim and the next hook run binds it to this session. The per-turn breadcrumb starts from the next message; the rest of this command still resolves the active task normally.

## Step 2: Confirm the target

```bash
python ./.trellis/scripts/task.py current
python ./.trellis/scripts/task.py list
```

State the task name and the reason back to the user and get a yes before Step 3 — deprecating moves the task directory into `archive/` and is not a one-keystroke undo.

Parent and child tasks are dropped as a family. If the target has children, deprecate each child as well — one Step 3 call per task.

## Step 3: Deprecate

```bash
python ./.trellis/scripts/task.py deprecate <task-name> --reason "<why>"
```

Write the reason in the user's own words. The command prepends a `## DEPRECATED` banner to `prd.md` / `design.md` / `implement.md`, records `meta.deprecated` / `deprecatedAt` / `deprecatedReason` in `task.json`, then archives the task to `archive/{YYYY-MM}/`. Whether that produces a `chore(task): archive ...` commit follows `session_auto_commit` in `.trellis/config.yaml` (off by default) — same as a normal archive.

Code the abandoned task left behind is out of scope — this command never inspects the working tree, commits, or branches. If it left code that should be reverted, say so and let the user decide; do not revert on your own.

## Step 4: Record the session journal

```bash
python ./.trellis/scripts/add_session.py \
  --title "Deprecate task: <task-name>" \
  --commit - \
  --summary "<why it was dropped>"
```

`--commit -` records that no work commit belongs to this entry.
