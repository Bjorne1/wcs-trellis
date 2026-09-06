# Planning Artifacts

Read this when creating or converging a task's planning documents. Use existing project product/domain/spec documents when present; do not invent a parallel hierarchy.

## `prd.md`: Requirements and Acceptance

Record:

- goal and user value
- confirmed facts and constraints
- requirements
- observable acceptance criteria
- not-yet-specified items
- out-of-scope items
- open questions that still block planning

Keep technical design and execution checklists in their own documents.

**Not yet specified** is inside the task boundary but too vague to phrase as a decision yet. It becomes a question when earlier decisions make it concrete. **Out of scope** is outside the agreed boundary and is not pending work. If a question can already be phrased precisely, put it on the current frontier or defer it behind its unresolved prerequisite.

## `design.md`: Technical Design

Record:

- architecture, boundaries, data flow, and contracts
- compatibility and migration notes
- important trade-offs
- operational and rollback considerations
- for `kind=feature`, the test-seam list: public boundaries and observable behavior each test will exercise

Select ordinary test seams from the authorized requirements and the existing harness. Record why they cover the contract. Ask only when the choice changes user-owned behavior or exceeds the authorized scope.

## `implement.md`: Execution Plan

Record:

- an ordered slice checklist: one seam, one test, one minimal implementation per slice
- validation commands
- risky files and rollback points
- remaining checks before `task.py start`

During execution, keep each slice's redacted red output and completion evidence beside that slice.

`implement.md` does not replace `implement.jsonl` or `check.jsonl`. Those are spec/research manifests for sub-agent context, not execution plans. Each needs at least one real entry on sub-agent-dispatch workflows; inline workflows load artifacts and specs through `trellis-before-dev`.

## PRD Convergence Pass

Before declaring planning ready, rewrite `prd.md` against its final structure:

1. Collapse repeated facts into one authoritative section.
2. Fold temporary sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into the owning requirement or acceptance section.
3. Remove resolved questions and empty temporary sections.
4. Merge parallel defect and requirement lists when they describe the same work. Preserve severity, evidence, and file:line anchors on the owning requirement.
5. Preserve every decision, constraint, requirement ID, and acceptance mapping.
6. Read the result top to bottom. No blocking question may remain, and repeated facts must add information to justify their repetition.

Recheck `design.md` and `implement.md` against the converged PRD. Review and present all three artifacts before Phase 1.4; require another user response only when the skill's authorization rule calls for one.
