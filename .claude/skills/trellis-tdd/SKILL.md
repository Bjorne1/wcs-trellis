---
name: trellis-tdd
description: "Red-before-green contract for behavior work: build a red-capable command that asserts the exact symptom or desired behavior, watch it fail, then write the minimum code to pass, one slice at a time. Covers bug reproduction and minimisation, test-seam confirmation, and the explicit no-harness fallback. Use when reproducing a reported bug, writing a failing test, or implementing a slice of a feature that changes behavior."
---

# Red Before Green

No production code before red evidence.

Red evidence is one command you have **already executed** that goes red on the exact thing you are about to change. For a bug that is the reproduction; for a feature it is a failing test at a confirmed seam. Both are the same primitive, and both exist so that "it works now" is a claim you can check instead of a claim you make.

A lint pass, a successful build, or a green type-check is not red evidence. None of them can observe the behavior in question.

**Authorization**: building the loop, reproducing, minimising, and hypothesising are report-only. Writing production code needs the current turn to ask for a fix — a request to reproduce or diagnose is not one. The red evidence is required either way.

**Done when**: the red command has been run and its redacted output recorded in the artifact named under Recording the Evidence; and, for a fix, that same command has been re-run against the original scenario and observed green.

---

## Which Path Applies

Read `meta.kind` from the active task's `task.json`.

| `meta.kind` | Path | Gate |
|---|---|---|
| `bug` | Reproduce first — see **Bug Path** | Repro recorded in `research/repro-<topic>.md` before `task.py start` |
| `feature` | Confirm seams, then slice — see **Feature Path** | Seam list in `design.md` before `task.py start`; red before green per slice |
| `chore` | Exempt | — |

If `meta.kind` is missing, ask the user and set it with `task.py set-meta <task-dir> kind <kind>`. Never guess it. `chore` covers config, docs, scaffolding, and mechanical moves — do not label a behavior change `chore` to escape the gate.

---

## Redact First

This work captures commands and their output into task artifacts. Before pasting anything:

- Replace secrets, tokens, credentials, private hostnames, and user data with `<REDACTED>`.
- Read credentials from environment variables so they never appear in shown output.
- Quote only the signal-bearing lines of a captured artifact.
- If redaction removes so much that the evidence stops being useful, say so and ask the user how to proceed.

---

## Bug Path

### 1. Build the loop

A tight pass/fail signal that goes red on *this* bug is what makes everything downstream work. Invest disproportionate effort here — a theory assembled from reading code, with no command that goes red, is not a diagnosis.

Approaches, roughly cheapest-first:

- a failing test at any seam that reaches the bug
- an HTTP script against a dev server
- a CLI run against a fixture, diffed against known-good output
- a headless browser script asserting on DOM, console, or network
- replay of a saved trace or payload
- a throwaway harness with the irrelevant dependencies stubbed
- a property or fuzz loop over many generated inputs
- a bisection harness suitable for `git bisect run`
- differential runs of two versions or two configs

Then tighten it: faster (cache setup, narrow scope), sharper (assert the specific symptom, not "something threw"), more deterministic (pin time, seed RNG, isolate filesystem and network). A flaky thirty-second loop is barely better than no loop.

For intermittent bugs, aim at a workable reproduction *rate* rather than perfect determinism — loop it, parallelise it, add stress or injected delays. Around half the runs failing is workable; one percent is not.

**Exit criterion**: name one command you have already run at least once, showing its redacted invocation and red output, that drives the real code path, asserts the user's exact symptom, is deterministic (or reliably flaky), is fast, and can be re-run without a human. Without that command, do not move on.

**If you cannot build one**: stop and say so. List what you tried, and ask for what would unblock it — environment access, a redacted log/HAR/trace/core dump, or approval to instrument temporarily. Writing that down is a legitimate outcome. Quietly proceeding to a fix is not.

### 2. Reproduce and minimise

Run the loop and watch it fail. Verify the failure is the one that was reported, not a neighbouring one — the wrong bug gets the wrong fix.

Then shrink to the smallest still-red scenario. Remove inputs, callers, config, data, and steps one at a time, re-running after each. Done when every remaining element is load-bearing. The minimal case narrows the hypothesis space and becomes the regression test.

### 3. Hypothesise before probing

List three to five ranked hypotheses *before* testing any of them. Each needs a prediction: *if X is the cause, then changing Y makes the bug disappear* (or *changing Z makes it worse*). A hypothesis with no prediction is a hunch — sharpen it or drop it.

### 4. Instrument

One probe per hypothesis, varying one thing at a time. Prefer a debugger or REPL over scattered logging; one breakpoint beats ten log lines. When you do log, log at the boundaries that distinguish hypotheses — never "log everything and grep".

Tag every debug line with a unique prefix such as `[DEBUG-a4f2]` so removal is one grep. Untagged debug output survives into production.

For performance regressions, logs are usually the wrong tool: take a baseline with a timing harness, profiler, or query plan, then bisect. Measure first, fix second.

### 5. Fix with a regression test

Convert the minimised reproduction into a failing test — but only at a seam that exercises the real bug pattern as it occurs at the call site. A single-caller unit test for a multi-caller bug gives false confidence. If no correct seam exists, that is itself the finding: record it as an architectural obstacle rather than testing at the wrong level.

Then: watch the test fail, apply the fix, watch it pass, and re-run the step-1 loop against the original full scenario. A narrow test passing while the original repro is still red means the fix is incomplete.

### 6. Clean up before claiming done

- the original reproduction no longer reproduces, verified by re-running the step-1 loop
- the regression test passes, or the missing seam is documented
- every `[DEBUG-...]` line is gone
- throwaway harnesses are deleted or moved to a clearly marked debug area
- the confirmed cause is recorded in the commit message

---

## Feature Path

### 1. Confirm the seams first

No test is written at an unconfirmed seam. The seam is the public boundary the test sits on, and choosing it is a design decision that belongs to the user — ask *what is the public interface, and which seams should we test?* during planning, and record the answer in `design.md`.

Implementation may not invent a seam. If the right seam is missing from `design.md`, that is a planning defect: go back to requirement exploration rather than improvising one.

### 2. One slice per cycle

A slice is one seam, one test, one minimal implementation. Per slice:

1. Write the test at the confirmed seam.
2. Run it. Watch it fail for the reason you expect — a test that fails because of a typo or a missing import is not red evidence.
3. Paste the redacted red output into that slice's entry in `implement.md`.
4. Write the minimum production code to make it pass. Run it again.
5. Move to the next slice.

Each cycle is a probe: let what it reveals reshape the remaining slices instead of committing to all of them up front.

---

## Prohibitions

Both paths:

- **No horizontal slicing** — writing every test first, then every implementation. That verifies imagined behavior and freezes the test structure before you have learned anything.
- **No testing internals.** Tests sit on public boundaries. Reaching into private methods, mocking internal collaborators, or asserting through a side channel such as reading the database instead of the interface all couple the test to the implementation. Diagnostic: the test breaks under a pure refactor while behavior is unchanged.
- **No tautological assertions.** An expected value must trace to an independent source — a known-good literal, a worked example, or the spec. Recomputing the expectation the same way the code does asserts nothing.
- **No refactoring inside a red-green cycle.** Finish the cycle, then refactor as its own step.
- **No speculative tests** for behavior nobody asked for yet.
- **No silent skips.** A repo with no runnable harness, or a slice you decided not to test, must say so in the slice entry with the reason. Absence of a test is a fact to record, not a gap to leave blank.

---

## Recording the Evidence

Nothing here lives only in the chat.

| Evidence | Goes in |
|---|---|
| Bug reproduction: command, red output, minimised scenario | `research/repro-<topic>.md` |
| Confirmed test seams | `design.md` |
| Per-slice red output and completion | the slice entry in `implement.md` |
| "No red-capable command", with what was tried and what is needed | `research/repro-<topic>.md`, or the slice entry |

The quality check reads this trail. A slice claiming green with no recorded red is a finding, not a pass.
