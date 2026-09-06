# Conditional Update Templates

Use only the structure needed by the learning. Read the target spec first and follow its established form when that already works.

## Design Decision

```markdown
### Design Decision: <name>

**Context**: The problem and constraints.
**Options**: The credible alternatives and their trade-offs.
**Decision**: The selected option and evidence for it.
**Example**: A concrete implementation or contract.
**Extension**: How future work can extend the design safely, when relevant.
```

## Convention or Pattern

```markdown
### <convention or pattern name>

**Problem**: The behavior or failure this addresses.
**Rule**: The specific convention or mechanism.
**Example**: A correct example and, when useful, the failing pattern.
**Why**: The reason this works in the project.
**Related**: Links to the owning contracts or tests.
```

For a forbidden pattern, show the concrete failure and its replacement together. A prohibition without the safe implementation leaves the next reader guessing.

## Common Mistake

```markdown
### Common Mistake: <description>

**Symptom**: What goes wrong.
**Cause**: Why it happens.
**Fix**: How to correct it.
**Prevention**: The check or rule that prevents recurrence.
```

## Local Gotcha

```markdown
> **Gotcha**: The non-obvious behavior, when it occurs, and what to do.
```

Keep this beside the passage it qualifies.

## Failure-Derived Rule

Default to a row when one sentence carries the prevention mechanism:

```markdown
## Rules learned the hard way

| What happened | Rule |
| --- | --- |
| A signature changed and three dynamically dispatched call sites were missed | Inspect dynamic callers as well as running the type checker |
```

`What happened` describes the actual failure, not an abstract possibility. `Rule` is one imperative sentence. Expand to a common-mistake block only when the causal chain cannot be preserved in one row.

## Selecting a Useful Learning

When unsure what to capture, inspect the completed change and ask yourself:

- What decision, convention, contract, or non-obvious behavior was established?
- Will someone need it to maintain the feature or avoid a repeat failure?
- Which package/layer owns it?
- Is it already documented?

These are editing prompts for the agent. Ask the user only when a missing decision cannot be recovered from the task and repository evidence.
