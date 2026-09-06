---
name: trellis-update-spec
description: "Use when recording a verified implementation contract, project convention, or reusable debugging lesson in .trellis/spec/."
---

# Update Code-Spec

Capture verified contracts and reusable lessons in the project specs that own them. Keep one-off implementation details in the task record.

## Choose the Owning Document

Read `.trellis/spec/` indexes and the relevant code/tests before editing. Respect the repository's existing package and layer structure.

| Knowledge | Destination |
| --- | --- |
| How to implement safely: signatures, contracts, boundary behavior, examples | The owning package/layer code-spec |
| Why a design was chosen | The owning spec's design-decision section |
| A reusable failure or non-obvious behavior | The owning spec's rules or common-mistakes section |
| What to consider before implementation | A short checklist in `guides/`, pointing to the detailed spec |

Guides are thinking prompts; code-specs are executable implementation contracts. Avoid duplicating a rule across them.

## Update Process

1. State the verified learning, the failure it prevents, and the owning spec.
2. Read that spec and its index. Find the existing section before adding another.
3. Write the smallest useful update with concrete evidence, examples, and rationale. Preserve established contracts and user decisions.
4. Apply the contract-depth rule below when relevant. Otherwise use [the update templates](references/update-templates.md) only when an example structure helps.
5. Update the index if a document, linked section, or completion status changes.
6. Check the result against the actual code, tests, and related specs.

## Contract Depth

Changes to command/API signatures, cross-layer request/response contracts, database schemas or migrations, and infrastructure integrations require concrete code-spec depth.

For those changes, read [the contract template](references/contract-template.md) and cover all seven sections: scope/trigger, signatures, contracts, validation/error matrix, good/base/bad cases, test assertion points, and a wrong/correct example.

For a small convention or isolated lesson, use the shortest form that preserves the reason and the rule. Do not force a seven-section document onto an unrelated editorial update.

## Failure-Derived Rules

A one-line prevention rule normally belongs in a `Rules learned the hard way` table with the specific failure and the corrective action. Use a common-mistake block only when the causal chain needs more detail; place a local gotcha beside the passage it qualifies. See [the examples](references/update-templates.md#failure-derived-rule).

When consuming a `trellis-break-loop` retrospective, place each prevention mechanism in the spec that owns that area. Do not leave the actionable result only in chat.

## Completion Check

- The rule is specific, evidence-backed, and useful beyond this one change.
- The content lives in the owning spec and does not duplicate existing guidance.
- Examples and signatures match the implementation.
- Triggered contract updates include all seven sections and meaningful assertion points.
- Links and index entries resolve, and a new reader can tell when the rule applies.

Report what was captured and where. `trellis-session-insight` can supply historical evidence when needed; this skill owns the resulting spec edit.
