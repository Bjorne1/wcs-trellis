# Start Trellis Task

Create a Trellis task for the request the user just made, then plan it. Invoking this **is** the explicit request for a task — do not ask whether the work warrants one.

Context injection is opt-in: until Step 1 runs, this session receives no Trellis context at all. Run the steps in order.

---

## Step 1: Engage this session

```bash
{{PYTHON_CMD}} ./.trellis/scripts/task.py engage
```

Marks this session as Trellis-managed, which turns on the per-turn workflow breadcrumb and re-injection after `/clear` or `/compact`.

If this exits non-zero, **stop and report it**. Without the flag every later phase runs unguided, and the planning and commit gates will not be enforced.

## Step 2: Load the workflow

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase
```

The first prints identity, git state, and any already-active tasks. The second prints the Phase Index, the planning artifact contract, and the red-evidence gate.

If the first output includes a line beginning `Trellis update available:`, relay that line verbatim to the user.

If it reports a task already active in this session, do not create a second one — switch to {{CMD_REF:continue}}.

## Step 3: Create the task

```bash
{{PYTHON_CMD}} ./.trellis/scripts/task.py create "<task title>" --slug <name> --meta kind=<bug|feature|chore>
```

- `--slug` is the human-readable name only; the `MM-DD-` prefix is added for you.
- `--meta kind=` selects the red-evidence gate: `bug` needs an executed repro with red output, `feature` needs a user-confirmed test-seam list, `chore` is exempt. **Never guess the kind** — if the request does not make it unambiguous, ask the user before running the command.
- Run only `create`. Do not run `task.py start`; that flips status to `in_progress` and skips the planning gate. `start` belongs to Phase 1.4, after the artifacts are reviewed.

Creating the task is not approval to implement.

## Step 4: Plan it

Load the `trellis-brainstorm` skill and align on requirements with the user.

Every task needs `prd.md`, `design.md`, and `implement.md` before `task.py start` — there is no PRD-only tier.

---

## Where this leaves you

You are in Phase 1 with status `planning`. From here the per-turn breadcrumb carries the phase rules; step detail is available with:

```bash
{{PYTHON_CMD}} ./.trellis/scripts/get_context.py --mode phase --step <X.Y> --platform {{CLI_FLAG}}
```

| User intent | Skill |
|---|---|
| Requirements unclear / new feature | `trellis-brainstorm` |
| About to write code | `trellis-before-dev` |
| Done coding / quality check | `trellis-check` |
| Stuck / fixed same bug repeatedly | `trellis-break-loop` |
| Learned something worth keeping | `trellis-update-spec` |

Full rules in `.trellis/workflow.md`.
