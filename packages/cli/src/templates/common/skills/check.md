# Code Quality Check

Comprehensive quality verification for recently written code. Combines spec compliance, cross-layer safety, and pre-commit checks.

**Authorization**: a request to check or review is report-only beyond the mechanical local fixes Step 6 defines. Applying broader fixes, committing, or pushing needs the current turn to ask for it.

**Done when**: every changed file has been read against the task's acceptance criteria, the project's checks have run in this session with their output shown, and each finding is either fixed or recorded with a recommendation.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Run the project's lint, type-check, and test commands. A failure that is mechanical and local — the kinds Step 6 lists — gets fixed here and the checks re-run. Anything needing a judgment call, a public interface change, or an edit outside this task's scope stops here and goes to Step 6 as a finding; being mid-check is not authorization to make that change.

Red evidence gates the code that gets written; these three rules gate the green you report afterwards.

- **No unverified claims.** Do not write "tests pass", "I verified X", or "this fixes Y" unless that command's output is in this session's transcript. Where you reasoned from reading the code instead of running it, say so in those words.
- **A green that never ran the path is not a pass.** A pass counts only when at least one non-skipped, non-empty case exercised the code under review, and the assertion would fail if the output were empty. Three shapes report green without testing anything: a job skipped for a missing optional dependency that still prints OK; an early return leaving output empty so a true-on-empty assertion passes; a rendered surface declared fixed but never opened. A negative assertion ("output must not contain X") needs a paired positive case proving it can fail at all.
- **Classify the failure layer before calling the repo broken.** A verifier that dies before its assertions run — missing optional dependency, bootstrap noise, tool setup, a crashed build service — is a setup failure, not a product failure. Name which one it is; retry only with new evidence or a narrower environment.
- **When the environment cannot run a check at all, record that instead of claiming or skipping it.** Name the check, why this environment cannot run it (no browser, no display, no device, no credentials), and what remains unverified. An unrunnable check is a stated gap; it is never a box to tick.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] New function → unit test added?
- [ ] Bug fix → regression test added?
- [ ] Changed behavior → existing tests updated?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

### Scope Discipline

- [ ] Any tidying of code the task did not require?
- [ ] Any abstraction, config or extension point added for a case that does not exist yet?
- [ ] Any speculative fallback for a state that cannot occur?
- [ ] Any file changed that the acceptance criteria do not mention?
- [ ] Any workaround added at the caller instead of a fix where the behavior actually lives?

### Pattern-Fix Completeness

Required whenever this change fixed a defect. One fixed instance of a class-of-bug usually leaves siblings in the tree, and a local fix that ignores them leaves the rest of them shipped.

1. Name the **pattern signature** — the specific call, regex, selector, missing guard, lock acquisition, or input boundary that produced the defect.
2. Search that signature across the repo with `rg`, which respects `.gitignore` and so skips generated output, build artifacts, and vendored dependencies by default. (`grep -rn` excludes nothing and will walk `node_modules`.) For a class-of-bug ("every handler that skips the lock"), search the surrounding shape rather than the literal text.
3. Rule on **every** match in writing: same bug, or safe to leave with the reason, or unsure and put to the user. A match passed over silently is itself a finding.

Unrelated defects the sweep turns up get listed, not fixed here, unless the user agrees.

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step if your change is confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  grep -r "pattern" src/
  ```
- [ ] If the same value repeats, does it represent one stable concept whose callers must change together? Extract only then — two literals that merely happen to match today should stay separate.
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Report every violation you find. Then:

- Mechanical and local (lint nit, missing type, wrong import, dead branch, failing assertion) → fix in place, then re-run project checks.
- Design or judgment (naming a shared concept, moving a module boundary, changing a public interface, reassigning where behavior lives) → record the evidence and your recommendation, and stop. Do not rewrite it silently.

If a fix would touch files outside the current task's scope, say so and stop instead of widening the change.
