#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task Management Script.

Usage:
    python task.py create "<title>" --description "<desc>" [--slug <name>] [--assignee <dev>] [--priority P0|P1|P2|P3] [--parent <dir>] [--package <pkg>] [--no-start] [--force]
    python task.py add-context <dir> <file> <path> [reason] # Add jsonl entry
    python task.py validate <dir>              # Validate jsonl files
    python task.py list-context <dir>          # List jsonl entries
    python task.py start <dir>                 # Set active task
    python task.py current [--source] [--json] # Show active task
    python task.py finish                      # Clear active task
    python task.py workflow <id>|--clear       # Set/clear per-task workflow selection
    python task.py set-branch <dir> <branch>   # Set git branch
    python task.py set-base-branch <dir> <branch>  # Set PR target branch
    python task.py set-scope <dir> <scope>     # Set scope for PR title
    python task.py set-meta <dir> <key> <value>  # Set a task metadata key
    python task.py archive <task-dir>          # Archive completed task
    python task.py deprecate <task-dir> [--reason <text>]  # Abandon task, then archive
    python task.py list                        # List active tasks
    python task.py list-archive [month]        # List archived tasks
    python task.py add-subtask <parent-dir> <child-dir>     # Link child to parent
    python task.py remove-subtask <parent-dir> <child-dir>  # Unlink child from parent
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from common.log import Colors, colored
from common.paths import (
    DIR_WORKFLOW,
    DIR_TASKS,
    FILE_TASK_JSON,
    get_repo_root,
    get_developer,
    get_tasks_dir,
    get_current_task,
)
from common.active_task import (
    clear_active_task,
    mark_session_engaged,
    resolve_active_task,
    resolve_context_key,
    set_active_task,
    write_pending_claim,
)
from common.io import (
    describe_json_read_failure,
    read_json_checked,
    write_json,
)
from common.task_utils import resolve_task_dir, run_task_hooks
from common.tasks import iter_active_tasks, children_progress
from common.workflow_selection import WORKFLOW_ID_RE, workflow_md_for_task

# Import command handlers from split modules (also re-exports for plan.py compatibility)
from common.task_store import (
    DEFAULT_DEPRECATE_REASON,
    cmd_create,
    cmd_archive,
    cmd_deprecate,
    cmd_set_branch,
    cmd_set_base_branch,
    cmd_set_scope,
    cmd_set_meta,
    cmd_add_subtask,
    cmd_remove_subtask,
)
from common.task_context import (
    cmd_add_context,
    cmd_validate,
    cmd_list_context,
)


# =============================================================================
# Command: engage / start / finish
# =============================================================================

def cmd_engage(args: argparse.Namespace) -> int:
    """Opt this session into the Trellis workflow."""
    repo_root = get_repo_root()
    context_key = mark_session_engaged(repo_root)

    if context_key:
        print(colored(f"✓ Trellis engaged for this session: {context_key}", Colors.GREEN))
        return 0

    # No session identity in this shell child. That is not an anomaly — it is
    # every shell child on Codex, whose exec path injects no session id at all.
    # Failing here (what this command used to do) made the entire workflow
    # unusable on that platform: no engaged flag means all three injection hooks
    # stay silent for the whole session, with no way for the user to recover.
    # Record the intent instead. The hooks DO get a session id on stdin, and the
    # next hook run binds this claim to it (`promote_pending_claim`), after which
    # the session holds ordinary per-session state.
    claim_path = write_pending_claim(repo_root, engaged=True)
    if claim_path is None:
        print(colored(
            "Error: cannot engage — no session identity, and the pending claim "
            "could not be written",
            Colors.RED,
        ))
        print(colored(
            f"Check that {repo_root / DIR_WORKFLOW / '.runtime'} is writable.",
            Colors.YELLOW,
        ))
        return 1

    print(colored("✓ Trellis engaged (pending session binding)", Colors.GREEN))
    print(colored(
        "This shell exposes no session identity, so the opt-in was recorded as a "
        "pending claim. The next hook run binds it to this session; the per-turn "
        "breadcrumb starts from the next message.",
        Colors.YELLOW,
    ))
    return 0


def _flip_status_to_in_progress(task_json_path: Path, label: str = "") -> None:
    """Move a freshly started task from planning to in_progress.

    Tolerant on purpose — a broken task.json does not fail `start`, because the
    session pointer is the point of the command. But the read overwrites the
    file it just read, so neither failure may be silent: without a message the
    absent status line looks like the task simply was not in planning.
    """
    data, reason = read_json_checked(task_json_path)
    if data is None:
        problem, hint = describe_json_read_failure(task_json_path, reason)
        print(
            colored(f"Warning: {problem}; status not updated.", Colors.YELLOW),
            file=sys.stderr,
        )
        print(hint, file=sys.stderr)
        return

    if data.get("status") != "planning":
        return

    data["status"] = "in_progress"
    if write_json(task_json_path, data):
        print(colored(f"✓ Status: planning → in_progress{label}", Colors.GREEN))
    else:
        print(
            colored(
                f"Warning: Failed to write {task_json_path}; status stays 'planning'.",
                Colors.YELLOW,
            ),
            file=sys.stderr,
        )


def cmd_start(args: argparse.Namespace) -> int:
    """Set active task."""
    repo_root = get_repo_root()
    task_input = args.dir

    if not task_input:
        print(colored("Error: task directory or name required", Colors.RED))
        return 1

    # Resolve task directory (supports task name, relative path, or absolute path)
    full_path = resolve_task_dir(task_input, repo_root)

    if full_path is None:
        # resolve_task_dir already named the exact reason on stderr. A second,
        # generic line on stdout would split one diagnosis across two streams
        # and bury the specific message.
        return 1

    if not full_path.is_dir():
        print(colored(f"Error: Task not found: {task_input}", Colors.RED))
        print("Hint: Use task name (e.g., 'my-task') or full path (e.g., '.trellis/tasks/01-31-my-task')")
        return 1

    # Convert to relative path for storage. repo_root is resolved because
    # full_path already is (resolve_task_dir only returns paths inside the
    # resolved root), so an unresolved repo_root would mismatch under a
    # symlink (e.g. /tmp on macOS) and reject a perfectly normal task.
    try:
        task_dir = full_path.relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        # resolve_task_dir already refused everything outside the repo, so
        # this is unreachable in practice. Refuse rather than fall back to
        # str(full_path) — that fallback (a lexical relative_to() paired with
        # an absolute-path fallback) is exactly the pattern that let a `..`
        # ref escape into storage before this fix.
        print(colored(f"Error: Task not found: {task_input}", Colors.RED))
        print("Hint: Use task name (e.g., 'my-task') or full path (e.g., '.trellis/tasks/01-31-my-task')")
        return 1

    task_json_path = full_path / FILE_TASK_JSON

    if not resolve_context_key():
        # No session identity available (Codex shell children, Windows + Claude
        # Code, --continue resume path, hooks disabled, ...). The per-session
        # pointer cannot be written from here, so record it as a pending claim:
        # shell commands later in this same turn resolve the task through the
        # claim, and the next hook run promotes it to a real session pointer.
        claim_path = write_pending_claim(repo_root, current_task=task_dir)
        if claim_path is None:
            print(colored(
                "ℹ Session identity not available and the pending claim could not "
                "be written; active-task pointer not persisted (degraded mode). "
                "AI continues based on conversation context.",
                Colors.YELLOW,
            ))
        else:
            print(colored(f"✓ Current task recorded (pending session binding): {task_dir}", Colors.GREEN))
            print(colored(
                "This shell exposes no session identity; the next hook run binds "
                "the pointer to this session.",
                Colors.YELLOW,
            ))

        # Still flip task.json status: planning → in_progress so downstream phases proceed.
        if task_json_path.is_file():
            _flip_status_to_in_progress(task_json_path, " (degraded)")
            run_task_hooks("after_start", task_json_path, repo_root)
        return 0

    active = set_active_task(task_dir, repo_root)
    if active:
        print(colored(f"✓ Current task set to: {task_dir}", Colors.GREEN))
        print(f"Source: {active.source}")

        if task_json_path.is_file():
            _flip_status_to_in_progress(task_json_path)

        print()
        print(colored("The hook will now inject context from this task's jsonl files.", Colors.BLUE))

        run_task_hooks("after_start", task_json_path, repo_root)
        return 0
    else:
        print(colored("Error: Failed to set current task", Colors.RED))
        return 1


def cmd_finish(args: argparse.Namespace) -> int:
    """Clear active task."""
    repo_root = get_repo_root()
    active = clear_active_task(repo_root)
    current = active.task_path

    if not current:
        print(colored("No current task set", Colors.YELLOW))
        return 0

    # Resolve task.json path before clearing
    task_json_path = repo_root / current / FILE_TASK_JSON

    print(colored(f"✓ Cleared current task (was: {current})", Colors.GREEN))
    print(f"Source: {active.source}")

    if task_json_path.is_file():
        run_task_hooks("after_finish", task_json_path, repo_root)
    return 0


def cmd_current(args: argparse.Namespace) -> int:
    """Show active task."""
    repo_root = get_repo_root()
    active = resolve_active_task(repo_root)

    if getattr(args, "json", False):
        task_obj = None
        read_error = None
        if active.task_path:
            task_json_path = repo_root / active.task_path / FILE_TASK_JSON
            data, reason = read_json_checked(task_json_path)
            if data is None:
                # Without this, a corrupt task.json emits null for every field
                # — indistinguishable from a task whose fields really are null.
                problem, hint = describe_json_read_failure(task_json_path, reason)
                read_error = {
                    "file": str(task_json_path),
                    "reason": reason,
                    "message": f"{problem}. {hint}",
                }
                data = {}
            task_obj = {
                "dir": active.task_path,
                "id": data.get("id") or data.get("name"),
                "title": data.get("title"),
                "status": data.get("status"),
                "parent": data.get("parent"),
                "children": data.get("children", []),
                "branch": data.get("branch"),
                "base_branch": data.get("base_branch"),
            }
        payload = {
            "current_task": task_obj,
            "source": active.source,
            "stale": active.stale,
        }
        # Only present when the read failed, so the healthy shape is unchanged.
        if read_error:
            payload["error"] = read_error
        print(json.dumps(payload, ensure_ascii=False))
        return 0 if active.task_path else 1

    if args.source:
        print(f"Current task: {active.task_path or '(none)'}")
        print(f"Source: {active.source}")
        if active.stale:
            print("State: stale")
        return 0 if active.task_path else 1

    if active.task_path:
        print(active.task_path)
        return 0

    return 1


# =============================================================================
# Command: workflow
# =============================================================================

def cmd_workflow(args: argparse.Namespace) -> int:
    """Set or clear the workflow selection on the current session's active task."""
    repo_root = get_repo_root()

    if args.clear and args.id:
        print(colored("Error: pass either <id> or --clear, not both", Colors.RED))
        return 1
    if not args.clear and not args.id:
        print(colored("Error: workflow id required (or --clear)", Colors.RED))
        print("Usage: python task.py workflow <id> | --clear")
        return 1

    active = resolve_active_task(repo_root)
    if not active.task_path:
        print(colored("Error: No current task set", Colors.RED))
        print("Hint: run task.py start <dir> first")
        return 1

    task_dir = repo_root / active.task_path
    task_json_path = task_dir / FILE_TASK_JSON
    if not task_json_path.is_file():
        print(colored(f"Error: task.json not found at {task_dir}", Colors.RED))
        return 1

    data, reason = read_json_checked(task_json_path)
    if data is None:
        problem, hint = describe_json_read_failure(task_json_path, reason)
        print(colored(f"Error: {problem}", Colors.RED))
        print(hint)
        return 1

    if args.clear:
        if data.pop("workflow", None) is None:
            print(colored("No workflow selection set on this task", Colors.YELLOW))
        else:
            if not write_json(task_json_path, data):
                print(colored("Error: failed to update task.json", Colors.RED))
                return 1
            print(colored("✓ Workflow selection cleared", Colors.GREEN))
    else:
        workflow_id = args.id
        if not WORKFLOW_ID_RE.match(workflow_id):
            print(colored(
                f"Error: invalid workflow id '{workflow_id}' (allowed: letters, digits, '-', '_')",
                Colors.RED,
            ))
            return 1
        data["workflow"] = workflow_id
        if not write_json(task_json_path, data):
            print(colored("Error: failed to update task.json", Colors.RED))
            return 1
        print(colored(f"✓ Workflow set to: {workflow_id}", Colors.GREEN))

    # workflow_md_for_task warns on stderr itself when the selected variant
    # file is missing (it can be saved later via `trellis workflow --save`).
    effective = workflow_md_for_task(repo_root, task_dir)
    try:
        effective_display = effective.relative_to(repo_root).as_posix()
    except ValueError:
        effective_display = str(effective)
    print(f"Effective workflow: {effective_display}")
    return 0


# =============================================================================
# Command: list
# =============================================================================

def _display_status(t, all_statuses: dict) -> str:
    """Return the status label to show for a task in `list` output.

    A parent task's stored status stays "planning" until someone runs
    `task.py start` on the parent directly, even while its children are
    actively being worked — a misleading label for anyone scanning the
    list (#399 item 3). Show "active" instead when at least one child is
    past planning; the stored status.json value is left untouched.
    """
    if t.status == "planning" and t.children:
        child_in_flight = any(
            all_statuses.get(c) not in (None, "planning") for c in t.children
        )
        if child_in_flight:
            return "active"
    return t.status


def cmd_list(args: argparse.Namespace) -> int:
    """List active tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    current_task = get_current_task(repo_root)
    developer = get_developer(repo_root)
    filter_mine = args.mine
    filter_status = args.status
    as_json = getattr(args, "json", False)

    # Single pass: collect all tasks via shared iterator
    all_tasks = {t.dir_name: t for t in iter_active_tasks(tasks_dir)}
    all_statuses = {name: t.status for name, t in all_tasks.items()}

    if as_json:
        if filter_mine and not developer:
            print(json.dumps({"error": "No developer set"}), file=sys.stderr)
            return 1

        items = []
        for dir_name in sorted(all_tasks.keys()):
            t = all_tasks[dir_name]
            if filter_mine and (t.assignee or "-") != developer:
                continue
            if filter_status and t.status != filter_status:
                continue
            items.append({
                "dir": f"{DIR_WORKFLOW}/{DIR_TASKS}/{dir_name}",
                "id": t.raw.get("id") or dir_name,
                "title": t.title,
                "status": t.status,
                "display_status": _display_status(t, all_statuses),
                "priority": t.priority,
                "assignee": t.assignee or None,
                "parent": t.parent,
                "children": list(t.children),
                "package": t.package,
            })
        print(json.dumps({"tasks": items}, ensure_ascii=False))
        return 0

    if filter_mine:
        if not developer:
            print(colored("Error: No developer set. Run init_developer.py first", Colors.RED), file=sys.stderr)
            return 1
        print(colored(f"My tasks (assignee: {developer}):", Colors.BLUE))
    else:
        print(colored("All active tasks:", Colors.BLUE))
    print()

    # Display tasks hierarchically
    count = 0

    def _print_task(dir_name: str, indent: int = 0) -> None:
        nonlocal count
        t = all_tasks[dir_name]

        # Apply --mine filter
        if filter_mine and (t.assignee or "-") != developer:
            return

        # Apply --status filter
        if filter_status and t.status != filter_status:
            return

        relative_path = f"{DIR_WORKFLOW}/{DIR_TASKS}/{dir_name}"
        marker = ""
        if relative_path == current_task:
            marker = f" {colored('<- current', Colors.GREEN)}"

        # Children progress
        progress = children_progress(t.children, all_statuses)
        status_label = _display_status(t, all_statuses)

        # Package tag
        pkg_tag = f" @{t.package}" if t.package else ""

        prefix = "  " * indent + "  - "

        if filter_mine:
            print(f"{prefix}{dir_name}/ ({status_label}){pkg_tag}{progress}{marker}")
        else:
            print(f"{prefix}{dir_name}/ ({status_label}){pkg_tag}{progress} [{colored(t.assignee or '-', Colors.CYAN)}]{marker}")
        count += 1

        # Print children indented
        for child_name in t.children:
            if child_name in all_tasks:
                _print_task(child_name, indent + 1)

    # Display only top-level tasks: those without a parent, plus orphans
    # whose recorded parent is not (or no longer) in the active set — a
    # dangling parent ref must still render flat instead of disappearing.
    for dir_name in sorted(all_tasks.keys()):
        parent = all_tasks[dir_name].parent
        if not parent or parent not in all_tasks:
            _print_task(dir_name)

    if count == 0:
        if filter_mine:
            print("  (no tasks assigned to you)")
        else:
            print("  (no active tasks)")

    print()
    print(f"Total: {count} task(s)")
    return 0


# =============================================================================
# Command: list-archive
# =============================================================================

def cmd_list_archive(args: argparse.Namespace) -> int:
    """List archived tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    archive_dir = tasks_dir / "archive"
    month = args.month

    print(colored("Archived tasks:", Colors.BLUE))
    print()

    if month:
        month_dir = archive_dir / month
        if month_dir.is_dir():
            print(f"[{month}]")
            for d in sorted(month_dir.iterdir()):
                if d.is_dir():
                    print(f"  - {d.name}/")
        else:
            print(f"  No archives for {month}")
    else:
        if archive_dir.is_dir():
            for month_dir in sorted(archive_dir.iterdir()):
                if month_dir.is_dir():
                    month_name = month_dir.name
                    count = sum(1 for d in month_dir.iterdir() if d.is_dir())
                    print(f"[{month_name}] - {count} task(s)")

    return 0


# =============================================================================
# Help
# =============================================================================

def show_usage() -> None:
    """Show usage help."""
    print("""Task Management Script

Usage:
  python task.py create <title> --description <desc>  Create new task directory (both required, non-empty)
  python task.py create <title> --description <desc> --package <pkg>   Create task for a specific package
  python task.py create <title> --description <desc> --parent <dir>    Create task as child of parent
  python task.py create <title> --description <desc> --no-start        Create without making it active in this session
  python task.py create <title> --description <desc> --workflow <id>   Create task pinned to a workflow variant
  python task.py add-context <dir> <jsonl> <path> [reason]  Add entry to jsonl
  python task.py validate <dir>                     Validate jsonl files
  python task.py list-context <dir>                 List jsonl entries
  python task.py engage                             Opt this session into the Trellis workflow
  python task.py start <dir>                        Set active task
  python task.py current [--source]                 Show active task
  python task.py finish                             Clear active task
  python task.py workflow <id>                      Select workflow variant for active task
  python task.py workflow --clear                   Clear selection (use default resolution)
  python task.py set-branch <dir> <branch>          Set git branch
  python task.py set-base-branch <dir> <branch>     Set PR target branch
  python task.py set-scope <dir> <scope>            Set scope for PR title
  python task.py set-meta <dir> <key> <value>       Set/overwrite a task metadata key
  python task.py archive <task-dir>                 Archive completed task
  python task.py deprecate <task-dir> [--reason <text>]  Abandon a task, then archive it
  python task.py add-subtask <parent> <child>       Link child task to parent
  python task.py remove-subtask <parent> <child>    Unlink child from parent
  python task.py list [--mine] [--status <status>] [--json]  List tasks
  python task.py list-archive [YYYY-MM]             List archived tasks

Monorepo options:
  --package <pkg>      Package name (validated against config.yaml packages)

List options:
  --mine, -m           Show only tasks assigned to current developer
  --status, -s <s>     Filter by status (planning, in_progress, review, completed)
  --json               Output machine-readable JSON (also available on `current`)

Examples:
  python task.py create "Add login feature" --description "Email + password sign-in" --slug add-login
  python task.py create "Add login feature" --description "Email + password sign-in" --slug add-login --package cli
  python task.py create "Add login feature" --description "Email + password sign-in" --meta linear=ENG-123 --meta epic=auth
  python task.py create "Child task" --description "Session cookie handling" --slug child --parent .trellis/tasks/01-21-parent
  python task.py add-context <dir> implement .trellis/spec/cli/backend/auth.md "Auth guidelines"
  python task.py set-branch <dir> task/add-login
  python task.py start .trellis/tasks/01-21-add-login
  python task.py current --source
  python task.py finish
  python task.py archive add-login
  python task.py add-subtask parent-task child-task  # Link existing tasks
  python task.py remove-subtask parent-task child-task
  python task.py list                               # List all active tasks
  python task.py list --mine                        # List my tasks only
  python task.py list --mine --status in_progress   # List my in-progress tasks
""")


# =============================================================================
# Main Entry
# =============================================================================

def main() -> int:
    """CLI entry point."""
    # Deprecation guard: `init-context` was removed in v0.5.0-beta.12.
    # Detect early so argparse doesn't mask the real reason with a generic
    # "invalid choice" error.
    if len(sys.argv) >= 2 and sys.argv[1] == "init-context":
        print(
            colored(
                "Error: `task.py init-context` was removed in v0.5.0-beta.12.",
                Colors.RED,
            ),
            file=sys.stderr,
        )
        print(
            "implement.jsonl / check.jsonl are now seeded on `task.py create` for",
            file=sys.stderr,
        )
        print(
            "sub-agent-capable platforms and curated by the AI during planning when needed.",
            file=sys.stderr,
        )
        print("See .trellis/workflow.md planning artifact guidance or run:", file=sys.stderr)
        print(
            "  python ./.trellis/scripts/get_context.py --mode phase --step 1",
            file=sys.stderr,
        )
        print(
            "Use `task.py add-context <dir> implement|check <path> <reason>` to append entries.",
            file=sys.stderr,
        )
        return 2

    parser = argparse.ArgumentParser(
        description="Task Management Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # create
    p_create = subparsers.add_parser("create", help="Create new task")
    p_create.add_argument("title", help="Task title (required, non-empty)")
    p_create.add_argument("--slug", "-s", help="Task slug without the MM-DD date prefix")
    p_create.add_argument("--assignee", "-a", help="Assignee developer")
    p_create.add_argument("--priority", "-p", default="P2", help="Priority (P0-P3)")
    p_create.add_argument(
        "--description",
        "-d",
        help="Task description (required, non-empty — an empty one is refused at archive)",
    )
    p_create.add_argument("--parent", help="Parent task directory (establishes subtask link)")
    p_create.add_argument("--package", help="Package name for monorepo projects")
    p_create.add_argument(
        "--base-branch",
        help="PR target branch (overrides origin/HEAD detection and the checked-out-branch fallback)",
    )
    p_create.add_argument(
        "--meta",
        action="append",
        help="Task metadata key=value (repeatable)",
    )
    p_create.add_argument(
        "--no-start",
        action="store_true",
        help="Create the task without making it active in this session",
    )
    p_create.add_argument(
        "--workflow",
        help="Workflow variant id for this task (.trellis/workflows/<id>.md)",
    )
    p_create.add_argument(
        "--force",
        action="store_true",
        help="Overwrite task.json when the task directory already exists",
    )

    # add-context
    p_add = subparsers.add_parser("add-context", help="Add context entry")
    p_add.add_argument("dir", help="Task directory")
    p_add.add_argument("file", help="JSONL file (implement|check)")
    p_add.add_argument("path", help="File path to add")
    p_add.add_argument("reason", nargs="?", help="Reason for adding")

    # validate
    p_validate = subparsers.add_parser("validate", help="Validate context files")
    p_validate.add_argument("dir", help="Task directory")

    # list-context
    p_listctx = subparsers.add_parser("list-context", help="List context entries")
    p_listctx.add_argument("dir", help="Task directory")

    # engage
    subparsers.add_parser("engage", help="Opt this session into the Trellis workflow")

    # start
    p_start = subparsers.add_parser("start", help="Set active task")
    p_start.add_argument("dir", help="Task directory")

    # current
    p_current = subparsers.add_parser("current", help="Show active task")
    p_current.add_argument("--source", action="store_true",
                           help="Show active task source")
    p_current.add_argument("--json", action="store_true",
                           help="Output machine-readable JSON")

    # finish
    subparsers.add_parser("finish", help="Clear active task")

    # workflow
    p_workflow = subparsers.add_parser("workflow", help="Set/clear per-task workflow selection")
    p_workflow.add_argument("id", nargs="?", help="Workflow id (.trellis/workflows/<id>.md)")
    p_workflow.add_argument("--clear", action="store_true",
                            help="Remove the workflow selection (use default resolution)")

    # set-branch
    p_branch = subparsers.add_parser("set-branch", help="Set git branch")
    p_branch.add_argument("dir", help="Task directory")
    p_branch.add_argument("branch", help="Branch name")

    # set-base-branch
    p_base = subparsers.add_parser("set-base-branch", help="Set PR target branch")
    p_base.add_argument("dir", help="Task directory")
    p_base.add_argument("base_branch", help="Base branch name (PR target)")

    # set-scope
    p_scope = subparsers.add_parser("set-scope", help="Set scope")
    p_scope.add_argument("dir", help="Task directory")
    p_scope.add_argument("scope", help="Scope name")

    # set-meta
    p_setmeta = subparsers.add_parser("set-meta", help="Set/overwrite a task metadata key")
    p_setmeta.add_argument("dir", help="Task directory")
    p_setmeta.add_argument("key", help="Metadata key")
    p_setmeta.add_argument("value", help="Metadata value")

    # archive
    p_archive = subparsers.add_parser("archive", help="Archive task")
    p_archive.add_argument("name", help="Task directory or name")
    p_archive.add_argument("--no-commit", action="store_true", help="Skip auto git commit after archive")

    # deprecate
    p_deprecate = subparsers.add_parser(
        "deprecate",
        help="Abandon a task (wrong direction / cancelled), then archive it",
    )
    p_deprecate.add_argument("name", help="Task directory or name")
    p_deprecate.add_argument("--reason", help=f"Why it is abandoned (default: {DEFAULT_DEPRECATE_REASON})")
    p_deprecate.add_argument("--no-commit", action="store_true", help="Skip auto git commit after archive")

    # list
    p_list = subparsers.add_parser("list", help="List tasks")
    p_list.add_argument("--mine", "-m", action="store_true", help="My tasks only")
    p_list.add_argument("--status", "-s", help="Filter by status")
    p_list.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    # add-subtask
    p_addsub = subparsers.add_parser("add-subtask", help="Link child task to parent")
    p_addsub.add_argument("parent_dir", help="Parent task directory")
    p_addsub.add_argument("child_dir", help="Child task directory")

    # remove-subtask
    p_rmsub = subparsers.add_parser("remove-subtask", help="Unlink child task from parent")
    p_rmsub.add_argument("parent_dir", help="Parent task directory")
    p_rmsub.add_argument("child_dir", help="Child task directory")

    # list-archive
    p_listarch = subparsers.add_parser("list-archive", help="List archived tasks")
    p_listarch.add_argument("month", nargs="?", help="Month (YYYY-MM)")

    args = parser.parse_args()

    if not args.command:
        show_usage()
        return 1

    commands = {
        "create": cmd_create,
        "add-context": cmd_add_context,
        "validate": cmd_validate,
        "list-context": cmd_list_context,
        "engage": cmd_engage,
        "start": cmd_start,
        "current": cmd_current,
        "finish": cmd_finish,
        "workflow": cmd_workflow,
        "set-branch": cmd_set_branch,
        "set-base-branch": cmd_set_base_branch,
        "set-scope": cmd_set_scope,
        "set-meta": cmd_set_meta,
        "archive": cmd_archive,
        "deprecate": cmd_deprecate,
        "add-subtask": cmd_add_subtask,
        "remove-subtask": cmd_remove_subtask,
        "list": cmd_list,
        "list-archive": cmd_list_archive,
    }

    if args.command in commands:
        return commands[args.command](args)
    else:
        show_usage()
        return 1


if __name__ == "__main__":
    sys.exit(main())
