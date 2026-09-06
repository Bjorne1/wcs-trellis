# Conditional Decision Aids

Read the relevant section only when prose cannot settle a decision or the proposed design rests on questionable assumptions.

## Decisions Prose Cannot Settle

Use the cheapest representation that makes the decision assessable:

| Form | Use when |
| --- | --- |
| One sentence describing the layout or model | The alternatives are easy to distinguish in words |
| An ASCII sketch inside the structured question | Several layouts are defensible and differ in hierarchy or placement |
| One rendered implementation within the authorized scope | The structure is settled and the remaining work is finish |
| A throwaway prototype | A sketch cannot settle the issue and authorization covers the additional cost and scope |

A sketch should show the primary region, zone placement, and information hierarchy. Do not build several variants just to compare color or minor styling.

For a prototype, name the unresolved decision and the expected cost. If existing authorization does not cover that work, obtain approval before building it. An explicit planning-only instruction still applies.

### Logic Prototype

Use this to test whether a state machine, reducer, or model admits an illegal state. A self-contained HTML file can expose the logic as a pure module, show the full state after each action, and offer domain-named actions plus ordered edge-case scenarios. Keep the logic separate from the DOM so validated behavior can be reused.

### UI Variant Prototype

Use this when several genuinely different layouts need comparison. Render them with the real page's data and density, switchable through a URL parameter. Variants must differ in structure and hierarchy to justify the extra work.

Record the decision, options, and resolution in `research/prototype-<topic>.md`. Carry the chosen decision into the task artifacts and real implementation; keep throwaway prototype code out of the deliverable.

## First Principles Analysis

Use this when requirements are vague or complexity is being justified by convention alone:

1. Restate the problem without prescribing the mechanism: "profile data loads too slowly", rather than "add Redis".
2. List facts: physical limits, business rules, technical invariants, and the user's stated needs.
3. Challenge each assumption: fact or convention, required or removable, actual problem or symptom, and who benefits.
4. Build the smallest mechanism satisfying those facts. Every added component must answer which constraint requires it.
5. Check that it solves the original problem, identify remaining assumptions, and choose the smallest useful experiment.
