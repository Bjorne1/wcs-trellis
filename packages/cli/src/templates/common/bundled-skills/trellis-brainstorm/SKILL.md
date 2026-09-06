---
name: trellis-brainstorm
description: "Use when planning an explicitly requested Trellis task with unclear requirements or unresolved product, scope, UX, or acceptance decisions."
---

# Trellis Brainstorm

Turn the user's request into requirements, design, and an execution plan before activating a Trellis task.

## Authorization and Planning

Honor the user's instructions and authorization across the session:

- An explicit request to build, implement, fix, refactor, or proceed authorizes work within that scope. Creating a task alone does not.
- If the user says "discuss first", "plan only", or "先讨论", stay in planning until they explicitly authorize implementation. A later clear instruction to proceed lifts that restriction.
- Ask about unresolved user-owned product, scope, UX, compatibility, risk, or acceptance decisions before dependent implementation. Continue independent evidence gathering while waiting.
- Once the planning artifacts and evidence are ready, review them and present the final summary. If existing authorization covers the settled plan, continue to Phase 1.4 without requiring another reply. Ask for approval only when implementation is not yet authorized or the plan materially expands that authorization.

Routine implementation and test-boundary choices within the authorized scope belong to the agent. Record their rationale; do not turn them into approval gates.

## Preconditions

Use this skill for an explicitly requested Trellis task. With no task request, work inline; do not create or propose a task on the user's behalf.

If the user asked for a task and none exists, create it:

```bash
{{PYTHON_CMD}} ./.trellis/scripts/task.py create "<short task title>" --description "<one-line summary>" --slug <slug> --meta kind=<bug|feature|chore>
```

Use a non-empty title and description. The slug has no date prefix; `create` adds it. Set `meta.kind` from the request: `bug` needs an executed reproduction, `feature` needs a documented test-seam list, and `chore` is exempt. If the kind is ambiguous, ask rather than defaulting it. Set a missing kind with `task.py set-meta <task-dir> kind <kind>` before start.

`create` seeds `prd.md`. Update it with the current understanding before asking follow-up questions.

## Evidence Before Questions

Inspect code, tests, fixtures, configs, docs, specs, and relevant task history before asking for facts. Repository evidence establishes current behavior and constraints; it does not override the user's requested behavior.

Separate findings into:

- confirmed facts and decisions already made by the user
- routine technical choices supported by evidence
- unresolved user-owned decisions that are answerable now: the current question frontier
- decisions blocked by an earlier answer or investigation
- out-of-scope work

Do not invent questions when the request and evidence already settle the plan. Do not silently pick unresolved product preferences merely because implementation was requested.

## Planning Flow

1. Capture the goal, constraints, known facts, and acceptance criteria in `prd.md`.
2. Inspect evidence and identify the current question frontier.
3. Ask the whole answerable frontier in one round. Keep dependent implementation pending; continue work that does not depend on the answers.
4. Incorporate answers into `prd.md`, resolve newly unlocked questions, and repeat only while decisions remain.
5. Write `design.md` and `implement.md` using [the artifact guide](references/artifact-guide.md). Every task requires all three planning documents.
6. For `kind=bug`, record the executed reproduction and redacted red output in `research/repro-<topic>.md`. For `kind=feature`, select test seams from the agreed behavior and existing public boundaries, and record them in `design.md`.
7. Run the convergence gate below and the artifact guide's PRD convergence pass.
8. Present the final planning summary: Goal, In Scope, Out of Scope, Acceptance Criteria, Key Decisions, relevant Risks or Deferred Items, and artifact status.
9. Apply the authorization rule above, then Phase 1.4 of `.trellis/workflow.md`. Existing implementation authorization remains valid for the settled scope; a planning-only request still needs explicit authorization to proceed.

## Question Rules

Each question names the decision, why it matters, the recommendation, and the trade-off. Use the host's structured question tool when available; otherwise present the round as numbered questions. Never include a question whose answer depends on another unanswered question in the same round.

Recommendations are options, not submitted answers. Silence is not approval. Ask only for missing intent, preferences, scope, risk tolerance, or acceptance behavior; collect environment and repository facts yourself.

For decisions prose cannot settle, or when assumptions drive unnecessary complexity, read [the decision aids](references/decision-aids.md). Load that reference only for those cases.

## Test-Seam Ownership

A seam is the public boundary exercised by a test. Choose and document ordinary seams from the accepted behavior and the existing test harness. Ask the user only when a choice changes the public contract, scope, compatibility, cost, or acceptance behavior.

During implementation, a newly discovered seam within the same authorized contract can be added to `design.md` with its rationale before writing the test. Return to planning for a changed contract or unresolved user decision, not for every test placement.

## Convergence Gate

Before activating the task, verify:

- The outcome, scope boundaries, and observable acceptance criteria are explicit.
- The question frontier and blocking open questions are empty; user-owned decisions have not been silently assumed.
- Technical unknowns are researched or explicitly deferred without changing the agreed behavior.
- `prd.md`, `design.md`, and `implement.md` exist, have been reviewed, and agree.
- `meta.kind` is set and its evidence is recorded: executed repro for a bug, documented test seams for a feature, or the chore exemption. If a repro cannot be built, record what was tried and what is needed; do not claim verification succeeded.
- Sub-agent-dispatch tasks have real spec/research entries in both `implement.jsonl` and `check.jsonl`. Empty manifests and legacy `_example` rows do not count. Inline workflows skip this manifest gate.
- The final planning summary has been presented and the settled plan is covered by the user's implementation authorization.
