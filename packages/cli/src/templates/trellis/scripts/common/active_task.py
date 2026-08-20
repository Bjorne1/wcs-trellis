#!/usr/bin/env python3
"""Session-scoped active task resolution.

The user-facing concept is a single "active task". Trellis stores that pointer
per AI session/window under `.trellis/.runtime/sessions/`; without a stable
session key there is no active task.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DIR_WORKFLOW = ".trellis"
DIR_TASKS = "tasks"
DIR_RUNTIME = ".runtime"
DIR_SESSIONS = "sessions"
DIR_SHELL_TICKETS = "shell-tickets"
# Session engagement lives in its own runtime directory, NOT as a field on the
# session file. `clear_task_from_sessions` (archive) and `clear_active_task`
# (`task.py finish`) both *delete* the session file, which would silently
# un-engage a session that is mid-Phase-3 — dropping the per-turn breadcrumb
# that enforces 3.4 commit. Keeping the flag on a separate path also leaves the
# `sessions/` file count that `_resolve_single_session_fallback` depends on
# exactly as it was.
DIR_ENGAGED = "engaged"
SHELL_TICKET_TTL_SECONDS = 30
TASK_SESSION_COMMANDS = {"start", "current", "finish", "engage"}

_SESSION_KEYS = ("session_id", "sessionId", "sessionID")
_CONVERSATION_KEYS = ("conversation_id", "conversationId", "conversationID")
_TRANSCRIPT_KEYS = ("transcript_path", "transcriptPath", "transcript")
_NESTED_KEYS = ("input", "properties", "event", "hook_input", "hookInput")
_KNOWN_PLATFORMS = {
    "claude",
    "codex",
}

# Every name below records how it was checked. Do NOT add a name by analogy
# with a neighbour: a 2026-08-05 audit found several declared names had never
# existed anywhere — they were pattern-guessed from `<PLATFORM>_SESSION_ID`
# shape no vendor agreed to, and the uniformity was the only "evidence" behind
# them. A platform with no verified name belongs in no table; it resolves
# through TRELLIS_CONTEXT_ID or its hook bridge.
_ENV_SESSION_KEYS: tuple[tuple[str, tuple[str, ...]], ...] = (
    # REAL, undocumented (verified 2026-08-05 in a live Claude Code 2.1.221 bash
    # child; absent from code.claude.com/docs/en/env-vars). CLAUDE_SESSION_ID
    # was removed here — verified absent from that same live environment.
    ("claude", ("CLAUDE_CODE_SESSION_ID",)),
    # REAL, undocumented (verified 2026-08-05: injected by codex-cli 0.146.0
    # into shell children, absent from the parent env; openai/codex#19937).
    # CODEX_SESSION_ID was removed — absent from a live `codex exec` env.
    ("codex", ("CODEX_THREAD_ID",)),
)
_ENV_PLATFORM_ALIASES = {
    "claude-code": "claude",
}


@dataclass(frozen=True)
class ActiveTask:
    """Resolved active task state."""

    task_path: str | None
    source_type: str
    context_key: str | None = None
    stale: bool = False

    @property
    def source(self) -> str:
        """Human-readable source label."""
        if self.source_type == "session" and self.context_key:
            return f"session:{self.context_key}"
        if self.source_type == "session-fallback" and self.context_key:
            return f"session-fallback:{self.context_key}"
        return self.source_type


def normalize_task_ref(task_ref: str) -> str:
    """Normalize a task ref for stable storage and comparison."""
    normalized = task_ref.strip()
    if not normalized:
        return ""

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        return str(path_obj)

    normalized = normalized.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    if normalized.startswith(f"{DIR_TASKS}/"):
        return f"{DIR_WORKFLOW}/{normalized}"

    return normalized


def resolve_task_ref(task_ref: str, repo_root: Path) -> Path | None:
    """Resolve a task ref to an absolute task directory inside the repo.

    Mirrors `paths.resolve_task_ref` (same containment check). Duplicated
    rather than imported because this module is loaded standalone — hooks add
    it to `sys.path` directly — so it stays zero-relative-import on purpose.
    """
    normalized = normalize_task_ref(task_ref)
    if not normalized:
        return None

    path_obj = Path(normalized)
    if path_obj.is_absolute():
        candidate = path_obj
    elif normalized.startswith(f"{DIR_WORKFLOW}/"):
        candidate = repo_root / path_obj
    else:
        candidate = repo_root / DIR_WORKFLOW / DIR_TASKS / path_obj

    # Both sides are resolved because repo_root itself may sit behind a
    # symlink (/tmp on macOS does), and resolve() is what collapses `..`
    # instead of leaving it for a lexical relative_to() to wave through.
    try:
        resolved = candidate.resolve()
        root = repo_root.resolve()
    except OSError:
        return None

    try:
        resolved.relative_to(root)
    except ValueError:
        return None

    return resolved


def _runtime_sessions_dir(repo_root: Path) -> Path:
    return repo_root / DIR_WORKFLOW / DIR_RUNTIME / DIR_SESSIONS


def _runtime_engaged_dir(repo_root: Path) -> Path:
    return repo_root / DIR_WORKFLOW / DIR_RUNTIME / DIR_ENGAGED


def _sanitize_key(raw: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw.strip())
    safe = safe.strip("._-")
    return safe[:160] if safe else ""


def _hash_value(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _string_value(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _lookup_string(data: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = _string_value(data.get(key))
        if value:
            return value

    for nested_key in _NESTED_KEYS:
        nested = _as_dict(data.get(nested_key))
        if not nested:
            continue
        value = _lookup_string(nested, keys)
        if value:
            return value

    return None


def _detect_platform(platform_input: dict[str, Any] | None, platform: str | None) -> str:
    if platform:
        return _sanitize_key(platform) or "session"
    if platform_input:
        for key in ("_trellis_platform", "trellis_platform", "platform", "source"):
            value = _string_value(platform_input.get(key))
            if value:
                return _sanitize_key(value) or "session"
    return "session"


def _context_key(platform_name: str, kind: str, value: str) -> str:
    if kind == "transcript":
        return f"{platform_name}_transcript_{_hash_value(value)}"
    safe_value = _sanitize_key(value)
    if safe_value:
        return f"{platform_name}_{safe_value}"
    return f"{platform_name}_{_hash_value(value)}"


def _iter_env_keys(
    env_keys: tuple[tuple[str, tuple[str, ...]], ...],
    platform_name: str | None,
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Narrow an env-key table to one platform, or return all of it.

    A platform with no entry yields an empty tuple, and the caller's `for` loop
    simply does not run. That is the normal case, not an error: platforms with
    no verified env var name are deliberately absent from these tables.
    """
    if not platform_name:
        return env_keys
    matched = tuple((name, keys) for name, keys in env_keys if name == platform_name)
    return matched


def _env_platform_name(platform_name: str | None) -> str | None:
    if not platform_name or platform_name == "session":
        return None
    return _ENV_PLATFORM_ALIASES.get(platform_name, platform_name)


def _lookup_env_context_key(platform_name: str | None) -> str | None:
    """Resolve a context key from platform-provided environment variables.

    Hooks pass `TRELLIS_CONTEXT_ID` to subprocesses they launch, but an AI-run
    shell command can only see session identity if the host platform exports it
    in the command environment. These names are best-effort adapters; if none
    are present, there is no session-scoped active task.
    """
    env_platform_name = _env_platform_name(platform_name)

    for name, keys in _iter_env_keys(_ENV_SESSION_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "session", value)

    return None


def _find_repo_root_from_cwd() -> Path | None:
    current = Path.cwd().resolve()
    while True:
        if (current / DIR_WORKFLOW).is_dir():
            return current
        if current == current.parent:
            return None
        current = current.parent


def _shell_ticket_dirs(repo_root: Path) -> tuple[Path, ...]:
    runtime_dir = repo_root / DIR_WORKFLOW / DIR_RUNTIME
    return (runtime_dir / DIR_SHELL_TICKETS,)


def _remove_file(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _task_refs_match(left: str | None, right: str | None, repo_root: Path) -> bool:
    if not left or not right:
        return False
    left_path = resolve_task_ref(left, repo_root)
    right_path = resolve_task_ref(right, repo_root)
    if left_path is not None and right_path is not None:
        return left_path == right_path
    return normalize_task_ref(left) == normalize_task_ref(right)


def _pending_ticket_matches_args(ticket: dict[str, Any], repo_root: Path) -> bool:
    if Path(sys.argv[0]).name != "task.py":
        return False
    args = tuple(sys.argv[1:])
    if not args:
        return False

    command_name = args[0]
    if command_name not in TASK_SESSION_COMMANDS:
        return False

    subcommands = ticket.get("subcommands")
    if not isinstance(subcommands, list):
        return False

    for subcommand in subcommands:
        if not isinstance(subcommand, dict):
            continue
        if _string_value(subcommand.get("name")) != command_name:
            continue
        if command_name != "start":
            return True
        task_ref = args[1] if len(args) > 1 else None
        if _task_refs_match(_string_value(subcommand.get("task_ref")), task_ref, repo_root):
            return True

    return False


def _ticket_is_fresh(ticket: dict[str, Any], ticket_path: Path, now: float) -> bool:
    expires_at = ticket.get("expires_at_epoch")
    if isinstance(expires_at, (int, float)) and expires_at < now:
        _remove_file(ticket_path)
        return False

    created_at = ticket.get("created_at_epoch")
    if isinstance(created_at, (int, float)):
        if now - created_at <= SHELL_TICKET_TTL_SECONDS:
            return True
        _remove_file(ticket_path)
        return False
    return True


def _ticket_cwd_matches_repo(ticket: dict[str, Any], repo_root: Path) -> bool:
    cwd = _string_value(ticket.get("cwd"))
    if not cwd:
        return True
    try:
        Path(cwd).resolve().relative_to(repo_root)
    except ValueError:
        return False
    return True


def _matching_ticket_context_key(
    ticket_path: Path,
    repo_root: Path,
    now: float,
) -> str | None:
    """Accept a ticket on its merits, never on which platform wrote it.

    The `platform` field a ticket carries is debugging metadata; gating on it
    would make this bridge invisible to every platform but the one that wrote
    the ticket.
    """
    ticket = _read_json(ticket_path)
    if ticket is None:
        return None
    if not _ticket_is_fresh(ticket, ticket_path, now):
        return None
    if not _ticket_cwd_matches_repo(ticket, repo_root):
        return None
    if not _pending_ticket_matches_args(ticket, repo_root):
        return None
    return _string_value(ticket.get("context_key"))


def _lookup_shell_ticket_context_key() -> str | None:
    """Resolve session identity from a short-lived shell ticket.

    No researched platform exports its session id into a shell child, but every
    hook-capable one hands that id to a hook. So the hook that runs just before
    a shell command writes a ticket, and this reads it back. A ticket counts
    only when it is fresh, was written for this repo, and matches the `task.py`
    subcommand now running — and only when exactly one fresh context key
    matches. Two concurrent windows therefore both degrade rather than one
    inheriting the other's pointer.
    """
    repo_root = _find_repo_root_from_cwd()
    if repo_root is None:
        return None

    now = time.time()
    candidates: set[str] = set()
    for ticket_dir in _shell_ticket_dirs(repo_root):
        if not ticket_dir.is_dir():
            continue
        for ticket_path in ticket_dir.glob("*.json"):
            context_key = _matching_ticket_context_key(ticket_path, repo_root, now)
            if context_key:
                candidates.add(context_key)

    if len(candidates) == 1:
        return next(iter(candidates))
    return None


def resolve_context_key(
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
    *,
    allow_environment_context: bool = True,
) -> str | None:
    """Resolve a stable session/window context key, if one is available.

    `TRELLIS_CONTEXT_ID` is an explicit context-key override used by CLI
    scripts and subprocesses. It does not store the task itself.
    """
    if allow_environment_context:
        override = _string_value(os.environ.get("TRELLIS_CONTEXT_ID"))
        if override:
            return _sanitize_key(override) or _hash_value(override)

    data = _as_dict(platform_input)
    platform_name = _detect_platform(data, platform) if data or platform else None

    if data:
        session_id = _lookup_string(data, _SESSION_KEYS)
        if session_id:
            return _context_key(platform_name or "session", "session", session_id)

        conversation_id = _lookup_string(data, _CONVERSATION_KEYS)
        if conversation_id:
            return _context_key(platform_name or "session", "conversation", conversation_id)

        transcript_path = _lookup_string(data, _TRANSCRIPT_KEYS)
        if transcript_path:
            return _context_key(platform_name or "session", "transcript", transcript_path)

    if allow_environment_context:
        env_context_key = _lookup_env_context_key(platform_name)
        if env_context_key:
            return env_context_key

    # Last in the chain on purpose: a platform that genuinely exports identity
    # into the shell outranks a ticket, and no platform name gates the lookup.
    if allow_environment_context:
        return _lookup_shell_ticket_context_key()
    return None


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return data if isinstance(data, dict) else None


def _write_json(path: Path, data: dict[str, Any]) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return True
    except OSError:
        return False


def _canonical_task_ref(task_path: str, repo_root: Path) -> str | None:
    normalized = normalize_task_ref(task_path)
    if not normalized:
        return None
    full_path = resolve_task_ref(normalized, repo_root)
    if full_path is None or not full_path.is_dir():
        return None
    try:
        return full_path.relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        # resolve_task_ref already refused everything outside the repo, so this
        # is unreachable. Refuse rather than fall back to an absolute path —
        # that fallback is how an out-of-repo ref used to reach the session
        # pointer and get replayed on every later turn.
        return None


def _active_from_ref(
    task_ref: str | None,
    repo_root: Path,
    source_type: str,
    context_key: str | None = None,
) -> ActiveTask | None:
    if not task_ref:
        return None
    resolved = resolve_task_ref(task_ref, repo_root)
    stale = resolved is None or not resolved.is_dir()
    return ActiveTask(task_ref, source_type, context_key, stale)


def _context_path(repo_root: Path, context_key: str) -> Path:
    return _runtime_sessions_dir(repo_root) / f"{context_key}.json"


def _engaged_path(repo_root: Path, context_key: str) -> Path:
    return _runtime_engaged_dir(repo_root) / f"{context_key}.json"


def resolve_active_task(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
    *,
    allow_single_session_fallback: bool = True,
    allow_environment_context: bool = True,
) -> ActiveTask:
    """Resolve the active task from session runtime state only.

    A stale session task is returned as stale. Missing context identity or a
    missing/empty session context falls back to single-session inference: if
    exactly one session file exists in the runtime, return its task with
    source_type="session-fallback" — covers pull-based sub-agents that don't
    inherit the parent's session id. ≥2
    files or 0 files yield ActiveTask(None) — refuses to guess across windows.
    """
    context_key = resolve_context_key(
        platform_input,
        platform,
        allow_environment_context=allow_environment_context,
    )
    if context_key:
        context = _read_json(_context_path(repo_root, context_key)) or {}
        task_ref = _string_value(context.get("current_task"))
        active = _active_from_ref(task_ref, repo_root, "session", context_key)
        if active:
            return active

    if allow_single_session_fallback:
        fallback = _resolve_single_session_fallback(repo_root)
        if fallback is not None:
            return fallback

    return ActiveTask(None, "none", context_key)


def _resolve_single_session_fallback(repo_root: Path) -> ActiveTask | None:
    """Return the task pointed at by the sole session file, if exactly one exists.

    Used when context-key resolution fails (typical for class-2 platform
    sub-agents). Returns None if 0 or ≥2 session files are present — refuses
    to pick across windows so 04-21's multi-session isolation contract holds.
    """
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return None

    session_files = sorted(sessions_dir.glob("*.json"))
    if len(session_files) != 1:
        return None

    session_file = session_files[0]
    context = _read_json(session_file) or {}
    task_ref = _string_value(context.get("current_task"))
    if not task_ref:
        return None

    fallback_key = session_file.stem
    return _active_from_ref(task_ref, repo_root, "session-fallback", fallback_key)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _context_metadata(
    platform_input: dict[str, Any] | None,
    platform: str | None,
    context_key: str | None = None,
) -> dict[str, Any]:
    data = _as_dict(platform_input) or {}
    platform_name = _detect_platform(data, platform)
    if platform_name == "session" and context_key:
        prefix = context_key.split("_", 1)[0]
        if prefix in _KNOWN_PLATFORMS:
            platform_name = prefix
    metadata: dict[str, Any] = {
        "platform": platform_name,
        "last_seen_at": _utc_now(),
    }
    for key in (*_SESSION_KEYS, *_CONVERSATION_KEYS, *_TRANSCRIPT_KEYS):
        value = _lookup_string(data, (key,))
        if value:
            metadata[key] = value
    return metadata


def mark_session_engaged(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> str | None:
    """Opt this session into the Trellis workflow.

    Context injection is opt-in: `session-start.py` and `inject-workflow-state.py`
    emit nothing until a session is engaged. The user engages by invoking one of
    the three lifecycle entry points (`trellis-start` / `trellis-continue` /
    `trellis-finish-work`), each of which runs `task.py engage` as its first
    step.

    Returns the context key on success, or None when no session identity is
    available. Callers must surface that as an error — reporting success without
    a written flag would leave the hooks permanently silent and the user with no
    way to tell why.
    """
    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return None

    engaged_path = _engaged_path(repo_root, context_key)
    record = _read_json(engaged_path) or {}
    record.update(_context_metadata(platform_input, platform, context_key))
    record["engaged"] = True
    # Re-running an entry point in the same session must not reset when the
    # session first opted in; `last_seen_at` above already carries recency.
    record.setdefault("engaged_at", _utc_now())
    if not _write_json(engaged_path, record):
        return None
    return context_key


def is_session_engaged(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> bool:
    """Report whether THIS session opted into the Trellis workflow.

    Deliberately has no single-session fallback, unlike `resolve_active_task`:
    inheriting engagement from a file another window left behind is exactly the
    failure the opt-in model exists to prevent. A new session that never ran an
    entry point must stay silent even while a task is mid-flight.
    """
    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return False
    record = _read_json(_engaged_path(repo_root, context_key)) or {}
    return record.get("engaged") is True


def set_active_task(
    task_path: str,
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask | None:
    """Set the active task in session scope.

    Returns None when no context key is available; callers should surface a
    user-facing error that explains how to provide session identity.
    """
    canonical = _canonical_task_ref(task_path, repo_root)
    if canonical is None:
        return None

    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return None

    context_path = _context_path(repo_root, context_key)
    context = _read_json(context_path) or {}
    context.update(_context_metadata(platform_input, platform, context_key))
    context["current_task"] = canonical
    context.setdefault("current_run", None)
    if not _write_json(context_path, context):
        return None
    return ActiveTask(canonical, "session", context_key)


def clear_active_task(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask:
    """Clear the active task by deleting its resolved session context file."""
    context_key = resolve_context_key(platform_input, platform)
    if not context_key:
        return ActiveTask(None, "none")

    previous = resolve_active_task(repo_root, platform_input, platform)
    if not previous.task_path or not previous.context_key:
        return previous

    context_path = _context_path(repo_root, previous.context_key)
    if context_path.is_file():
        _remove_file(context_path)
    return previous


def clear_task_from_sessions(task_path: str, repo_root: Path) -> int:
    """Delete all session runtime files that point at a task."""
    target = _canonical_task_ref(task_path, repo_root) or normalize_task_ref(task_path)
    if not target:
        return 0

    cleared = 0
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return cleared

    for session_path in sessions_dir.glob("*.json"):
        context = _read_json(session_path) or {}
        current = _string_value(context.get("current_task"))
        if not current:
            continue
        current_ref = _canonical_task_ref(current, repo_root) or normalize_task_ref(current)
        if current_ref != target:
            continue
        if session_path.is_file() and _remove_file(session_path):
            cleared += 1

    return cleared


def get_current_task_source(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> tuple[str, str | None, str | None]:
    """Return (`source_type`, `context_key`, `task_path`) for compatibility."""
    active = resolve_active_task(repo_root, platform_input, platform)
    return active.source_type, active.context_key, active.task_path
