---
name: trellis-brainstorm
description: "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, models the work as a decision tree and asks each round's whole question frontier at once with recommendations, researches technical choices, and converges on MVP scope plus the test seams or bug reproduction the task will be verified against. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task."
---

# Trellis Brainstorm

## Non-Negotiable Planning Contract

A request to build, implement, fix, refactor, or "go ahead" is not approval to leave planning. Asking for a task is also not implementation approval.

For every task, the user must respond at least once after the initial request before implementation begins. If no clarification is needed, that response must approve the final planning summary described below.

While any user-owned product, scope, UX, compatibility, risk, or acceptance decision remains unresolved, end the turn with the current frontier of questions as described in Question Rules. Do not edit product code, dispatch implementation, or run `task.py start`.

## Non-Negotiable Evidence Rule

If a question can be answered by exploring the codebase, explore the codebase instead.

This is mandatory. Before asking the user a question, first check whether the answer is already available in code, tests, configs, docs, existing specs, or task history.

Do not ask the user to confirm facts that the repository can answer. Ask only for product intent, preference, scope, risk tolerance, acceptance behavior, or decisions that remain ambiguous after inspection.

Repository evidence establishes current behavior and technical constraints. The user's intended behavior, feature scope boundaries, and UX preferences are never answerable by repository evidence alone, even when an existing pattern exists; existing patterns are options and recommendation evidence, not decisions.

---

Use this skill during Phase 1 planning to turn the user's request into clear requirements and planning artifacts.

## Preconditions

Use this skill only when the user has explicitly asked for a Trellis task. Never ask whether to create one — with no active task, work inline instead.

If the user asked for a task and none exists yet, create one:

```bash
TASK_DIR=$(python ./.trellis/scripts/task.py create "<short task title>" --slug <slug> --meta kind=<bug|feature|chore>)
```

Use a concise title from the user's request. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

`meta.kind` selects the red-evidence gate this task must satisfy before `task.py start`: `bug` needs an already-executed reproduction, `feature` needs a user-confirmed test-seam list, `chore` is exempt. If the kind is not obvious from the request, it belongs on the first question frontier — never guess it and never default it. Set it later with `python ./.trellis/scripts/task.py set-meta <task-dir> kind <kind>`.

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Inspect available evidence before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
3. Model the remaining work as a decision tree, where each decision spawns the sub-decisions hanging beneath it. Separate what you found into:
   - confirmed facts
   - decisions on the current **frontier** — every user-owned decision whose prerequisites are already resolved, answerable now without guessing at replies you have not received
   - decisions still blocked by an unresolved prerequisite, deferred to a later round
   - likely out-of-scope items
4. If the frontier is non-empty, ask the whole frontier in one round per Question Rules, then stop. Do not perform implementation work in the same turn.
5. After each round of answers, update `prd.md`, recompute the tree — resolved items push the frontier outward and unlock previously blocked decisions — and repeat from step 2.
6. When the frontier is empty, create or update `design.md` and `implement.md`. For `kind=feature`, converge the test-seam list into `design.md`. For `kind=bug`, confirm the reproduction recorded in `research/` is the acceptance criterion.
7. Run the requirement convergence gate, then the PRD convergence pass.
8. Present the final planning summary and stop. Do not run `task.py start` or edit product code in the same turn.
9. Only a subsequent user message that explicitly approves the latest planning summary authorizes `task.py start` and implementation. If the artifacts change materially after approval, repeat the final review.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Question Rules

Ask in rounds, not one question at a time. Each round puts the **entire current frontier** to the user at once — every user-owned decision whose prerequisites are already resolved. Then stop and wait.

Each question in a round must include:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Round shape:

- Number every item so the user can answer by number.
- State your recommendation on its own line, distinct from the question itself.
- Never mix in a question whose answer depends on another question in the same round — that one belongs to a later round.
- Where the host provides a native multi-question prompt, use it and let it carry the round; otherwise emit the round as numbered text in one message.

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

Facts are your responsibility, never the user's. If a frontier question needs environment data — filesystem state, tool output, a live check — go get it rather than asking. An in-flight investigation counts as an unresolved prerequisite for the questions that depend on it only; ask the rest of the frontier immediately instead of stalling the whole round.

Recommendations are not default selections. Never choose a recommended product decision on the user's behalf merely because the user asked for implementation.

Leave no silent assumptions. A decision you skipped because it seemed obvious is still a branch of the tree; either resolve it from evidence and record it as a confirmed fact, or put it on the frontier.

Do not manufacture clarification questions when the request and repository evidence already resolve every decision. In that case, proceed directly to the final planning summary, which still requires a subsequent explicit approval.

The final review is a required phase-transition gate, not a prohibited process question. The user's task request, the initial implementation request, and approval given before the latest final summary do not satisfy this gate.

## Decisions Prose Cannot Settle

Some decisions are neither facts you can look up nor questions a round of prose can settle: what a screen should look like, whether a state model admits a state it should forbid. Listing three options in words leaves the user unable to tell them apart.

Climb only as far as the decision needs, and stop at the first rung that settles it.

| Rung | Form | Reach for it when |
|---|---|---|
| 1 | One line describing the layout or shape | Default |
| 2 | An ASCII sketch carried inside the round's question, through the host's structured-question tool (Claude Code: `AskUserQuestion`, with the sketch in an option's `preview`; Codex: `request_user_input`) | Two or more arrangements are defensible and they differ structurally |
| 3 | Build one version, then show the rendered result | Only one arrangement is defensible and what is left is finish |
| 4 | A throwaway prototype | Rung 2 failed to settle it **and** the user authorised the cost in this turn |

Rung 2 carries exactly what drives rework: which region is primary, what sits where, how many zones, the information hierarchy. What it cannot carry — type, colour, motion feel — is the part that is cheap to change once it exists. So a sketch plus one build pass beats three built variants nearly every time.

Never climb to rung 4 on your own initiative. Name the decision rung 2 failed to settle, state what the prototype costs, and ask.

### Rung 4, once authorised

Two shapes, not equally worth their cost.

A **logic prototype** answers "can this state exist when it must not" for a state machine, reducer, or data model. One self-contained HTML file: the logic as a pure module touching no DOM, a panel showing full state after every action, one button per action for free play, plus a few ordered scenarios covering the awkward cases. Label everything in the project's domain language so a non-developer can drive it. Cheap, and it pays twice — the validated module lifts into real code, and a model that admits an illegal state costs far more to correct after implementation.

A **UI variant prototype** answers "what should this look like" with several structurally different versions behind one URL parameter, switchable in place. Mount them on the real page with its real data and density; variants judged in an empty route all look fine. They must disagree about layout and hierarchy, not colour. Expensive, and since it needs the host page to already exist, rung 3 usually beats it.

Either way record the question, the options, and the resolution in `research/prototype-<topic>.md`. Fold the winning decision into real code and keep the prototype itself out of the main branch, pointed at from the task artifact.

## Thinking Framework: First Principles Analysis

When requirements are vague, solutions feel over-engineered, or you're about to add complexity "because everyone does" — decompose to fundamental truths before reasoning upward.

### Step 1: Restate the Problem

Strip away implementation details to one sentence.

> Bad: "We need to add Redis caching to the user profile endpoint"
> Good: "User profile data takes too long to load"

### Step 2: List Fundamental Truths

What is absolutely true (not opinion or convention)?

| Category | Examples |
|----------|----------|
| **Physical constraints** | Network latency ≥ 0, disk I/O has limits |
| **Business rules** | "Users must see their own data" |
| **Technical invariants** | "Data must be consistent" |
| **User needs** | "The user wants X within Y seconds" |

### Step 3: Challenge Assumptions

For each component of the current plan:

- **Fact or convention?** "We always use REST" — why?
- **What if we removed this?** If nothing breaks, it's unnecessary.
- **Solving the actual problem or a symptom?** Trace the causal chain.
- **Who benefits from this complexity?** If "nobody", simplify.

### Step 4: Build Up from Truths

1. Start with the minimum viable mechanism satisfying all truths
2. Add complexity only when a specific truth demands it
3. Each addition must answer: "Which truth requires this?"

### Step 5: Validate

- Does the solution solve the original problem?
- What assumptions need verification?
- What's the simplest experiment to test this?

## Requirement Convergence Gate

Before final review, verify all of the following:

- the user outcome and product value are explicit
- in-scope and out-of-scope behavior are explicit
- acceptance criteria describe observable outcomes
- user-owned product, scope, UX, compatibility, and risk decisions are resolved
- the question frontier is empty and no decision was silently assumed
- blocking open questions are empty
- technical unknowns are researched or explicitly deferred without changing MVP behavior
- `task.json` has `meta.kind`, and that kind's red evidence is in place: `bug` has an executed reproduction plus its red output in `research/`, `feature` has a user-confirmed test-seam list in `design.md`, `chore` is exempt

Every task produces `prd.md`, `design.md`, and `implement.md`. None of them may skip evidence inspection, requirement convergence, final review, or fresh implementation approval.

The final planning summary must show Goal, In Scope, Out of Scope, Acceptance Criteria, Key Decisions, relevant Risks or Deferred Items, and artifact status.

## Artifact Rules

`prd.md` records requirements and acceptance:

- goal and user value
- confirmed facts
- requirements
- acceptance criteria
- not yet specified
- out of scope
- open questions that still block planning

**Not yet specified** and **out of scope** are different rejections and must not be merged. Not-yet-specified is inside this task's boundary but not sharp enough to state as a question yet; it graduates into a real question once an earlier decision clears the way. Out-of-scope is ruled outside the boundary and never graduates. The test is sharpness, not answerability: if you can phrase the question precisely right now, it belongs on the frontier or in a later round even when nothing can answer it yet. Collapsing the two loses work in both directions — a vague item gets treated as decided against, or a decided-against item gets treated as pending.

`design.md` records technical design:

- architecture and boundaries
- data flow and contracts
- compatibility and migration notes
- important trade-offs
- operational or rollback considerations
- for `kind=feature`: the confirmed test-seam list — the public boundaries the tests will sit on, agreed with the user. Implementation may not invent a seam that is not here.

`implement.md` records execution planning:

- an ordered **slice** checklist, where each slice is one seam, one test, one minimal implementation
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

Every task must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

`implement.md` is not a replacement for `implement.jsonl`. On sub-agent-dispatch workflows, `implement.jsonl` and `check.jsonl` must each contain at least one real spec/research entry before `task.py start`; the seed `_example` row does not count. Inline workflows skip this JSONL gate because Phase 2 loads context through `trellis-before-dev`.

## PRD Convergence Pass

Before declaring planning ready or running `task.py start`, rewrite `prd.md` once against the final structure described in the artifact rules above. This is not optional cleanup; it is the final planning gate.

The pass must be lossless:

- Collapse repeated facts into one authoritative section.
- Fold temporary brainstorm sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into Goal, Background, Requirements, Technical Notes, or Acceptance Criteria.
- Remove resolved open questions instead of leaving empty or already-answered sections.
- Merge parallel bug and requirement lists when they describe the same work; keep each defect's severity, evidence, and file:line anchors on the owning requirement.
- Preserve every file:line anchor, decision, constraint, requirement ID, and acceptance-criteria mapping.
- Do not proceed to final review while any blocking open question remains.

After the pass, read `prd.md` top to bottom and verify that no fact is repeated across sections unless the repetition adds new information.

## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- `prd.md` has passed the PRD convergence pass: no unresolved temporary brainstorm sections, no duplicate facts across sections, and no lost anchors, decisions, or acceptance mappings.
- Repository-answerable questions have already been answered through inspection.
- The question frontier is empty; blocking open questions are empty.
- `design.md` and `implement.md` exist, and `implement.md` is a slice checklist.
- `task.json` has `meta.kind`, and that kind's red evidence is in place — or its impossibility is written down with what was tried and what is needed.
- Sub-agent-dispatch tasks have real curated entries in both `implement.jsonl` and `check.jsonl`; seed-only manifests are not ready.
- The latest final planning summary has been presented to the user.
- In a subsequent message, the user explicitly approved that summary for implementation.

Do not start implementation merely because the user originally asked for implementation.
