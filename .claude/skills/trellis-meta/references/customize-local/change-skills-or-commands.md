# Change Local Skills, Commands, Prompts, And Workflows

When the user wants to change AI entry points, auto-trigger rules, or explicit command behavior, edit skills, commands, prompts, or workflows in local platform directories.

Before editing, classify the skill you are about to touch:

- **Bundled upstream skill** — `trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`, `trellis-channel`. Source of truth lives in the Trellis CLI repo under `packages/cli/src/templates/common/bundled-skills/<name>/`; auto-dispatched to every platform's skill root by `getBundledSkillTemplates()` on `trellis init` / `trellis update`. Local edits here are tracked by `.trellis/.template-hashes.json` and will be flagged on the next update.
- **Project-local skill** — anything else under `.{platform}/skills/`. Owned by the user; not refreshed by `trellis update`.

The remainder of this file uses "skill" for the local file; the override and conflict rules differ between the two cases.

## Read These Files First

1. `.trellis/workflow.md`
2. Target platform skill/command/prompt/workflow directory
3. Related agent or hook files
4. Whether project rules already exist in `.trellis/spec/`
5. `.trellis/.template-hashes.json` — confirms whether the skill you are about to edit is upstream-owned (entry present) or project-local (entry absent)

## Which Entry Type To Choose

| Goal | Recommendation |
| --- | --- |
| AI should automatically know a capability | Add or modify a skill. |
| User wants to trigger manually with a command | Add or modify a command/prompt/workflow. |
| Team project conventions | Prefer `.trellis/spec/` or a project-local skill — never a bundled skill directory. |
| Tweak a bundled skill (`trellis-meta` et al.) for the user's own project | Create a project-local sibling skill (different name) that overrides intent, or edit `.trellis/spec/`. Edits inside the bundled skill directory survive only until the next `trellis update` and will need a "keep" choice each time. |
| Contribute the change back upstream | Edit `packages/cli/src/templates/common/bundled-skills/<name>/` in the Trellis CLI repo, not the deployed copy. |
| Change Trellis flow semantics | Synchronize `.trellis/workflow.md`. |

## Modify A Skill

A skill is usually:

```text
<skill-name>/
├── SKILL.md
└── references/
```

`SKILL.md` should be short and responsible for triggering/routing. Put long content in `references/` so AI can read it on demand.

The frontmatter description should specify when to use the skill. Example:

```yaml
description: "Use when customizing this project's deployment workflow and release checklist."
```

Do not write vague descriptions such as "helpful project skill"; they can trigger incorrectly.

### Bundled vs. Project-Local

The same directory shape is used by two very different ownership models:

| Aspect | Bundled (`trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`, `trellis-channel`) | Project-local |
| --- | --- | --- |
| Source of truth | `packages/cli/src/templates/common/bundled-skills/<name>/` in Trellis CLI repo | Inside the user project itself |
| Dispatch | Auto-dispatched to every platform skill root by `getBundledSkillTemplates()` (`packages/cli/src/templates/common/index.ts`) on `trellis init` / `trellis update` | Created by the user (or another skill) and never moved |
| Hash tracking | Every file recorded in `.trellis/.template-hashes.json`; conflict prompt on update | Not tracked |
| Editing locally | Allowed but will be marked "modified by user" on next update | Free editing |
| The right way to customize | Add a *new* project-local skill with a *different* name that supplements (or supersedes) the bundled one | Edit the file directly |

If the goal is "make my project's AI behave differently when discussing release notes," the answer is almost always a project-local skill, not surgery on `trellis-meta/`.

## How To Write It

The rules below apply to any document an agent consumes — a skill, a command, a workflow, an `AGENTS.md` line, a `.trellis/spec/` file. The packaging differs; the writing does not.

**Two budgets, and every addition spends one.** *Context load* is what always-loaded material costs on every turn: a skill description, an `AGENTS.md` line. *Cognitive load* is what it costs the human, who has to remember the thing exists and when to reach for it. Material behind a pointer escapes context load at the price of the pointer's own line. A description is permanent context load in exchange for the agent being able to fire the skill itself — worth paying only when the agent, or another skill, must reach it unprompted.

**Disclose by branch.** Rank each piece by how immediately the agent needs it: in-file step (what it does, in order), in-file reference (consulted on demand), then disclosed reference in `references/` behind a pointer. The test is branching: inline what every path needs, push behind a pointer what only some paths reach. A flat set of peer rules all on one rung is a fine arrangement, not a smell. Sprawl is the failure mode — a document too long even when every line is live, because attention thins across the excess.

**End every step on a checkable completion criterion.** "Understanding reached" invites stopping early; "every changed file accounted for" does not. How much the criterion demands is what drives the digging the agent does inside the step, so wording it weakly quietly reduces the work performed.

**Prefer a word the model already holds.** A compact pretrained concept — *tight* loop, the loop goes *red*, the question *frontier*, a test *seam* — anchors a whole region of behavior in one token, and repeating that token builds a distributed definition. Repeat the word, never the sentence. Coining your own works only if you define it, and you pay in definition tokens what an existing word gives free.

**State the target, not the ban.** A prohibition drags the forbidden behavior into context and makes it more available, not less; the negation is a weak modifier over a strongly activated concept. Prefer "keep comments to one line" over "do not write long comments". Reserve a bare prohibition for a hard guardrail that has no positive phrasing, and even then pair it with the positive target.

**Delete no-ops.** An instruction the model already follows by default pays load and buys nothing. The test is against the *model's* default, not a reader's expectation — settle a disagreement by running the document, not by arguing. A leading word too weak to beat the default is a no-op too, and the fix is a stronger word rather than a different technique.

**Keep one source of truth.** Duplicated meaning costs maintenance and inflates that meaning's apparent rank. The environment is a source of truth as well — `package.json` scripts, config files, `--help` output — so a document restating it is a cache that earns its load only when the lookup is expensive. Cache the unwritten convention and the reason behind a choice; leave one-command lookups to the environment where they cannot go stale.

## Modify A Command/Prompt/Workflow

Explicit entry points should state:

- How the user triggers it.
- Which `.trellis/` files to read.
- Which scripts to run.
- How to report after completion.

If a command only repeats workflow rules, prefer making it reference/read `.trellis/workflow.md` instead of maintaining a second copy of the flow.

## Common Paths

| Platform | Entry directories |
| --- | --- |
| Claude Code | `.claude/skills/`, `.claude/commands/` |
| Codex | `.agents/skills/`, `.codex/skills/` |

Every directory above is a deploy target for the four bundled skills. Each platform receives a full copy on `trellis init` and refresh on `trellis update`; nothing has to be wired by hand.

## Add A Project-Local Skill

If the user wants to document team-private customizations, create a project-local skill — never put project-private content into a bundled skill directory, since `trellis update` will overwrite it.

```text
.claude/skills/project-trellis-local/
└── SKILL.md
```

For multi-platform projects, add equivalent versions in each platform skill directory, or use the shared `.agents/skills/` layer that Codex reads.

Pick a name that does **not** collide with the bundled set:

- `trellis-meta`
- `trellis-spec-bootstrap`
- `trellis-session-insight`
- `trellis-channel`

A reused name causes `getBundledSkillTemplates()` to overwrite the project-local copy on the next update. A common convention is to prefix the project name: `acme-trellis-deploy`, `acme-trellis-onboarding`.

## Notes

- Do not mix every platform's syntax into one file.
- Do not change only one platform entry point while claiming all platforms are supported.
- Do not hide long-term engineering conventions inside a command; write them to `.trellis/spec/`.
- Do not hand-edit files inside `trellis-meta/`, `trellis-spec-bootstrap/`, `trellis-session-insight/`, or `trellis-channel/` under any `.{platform}/skills/` directory expecting the change to persist — they are bundled and refreshed by `trellis update`. Either contribute upstream or add a project-local skill that complements them.
- After `trellis update` reports a "modified by you" conflict on a bundled skill file, choose **keep** only if you accept maintaining the divergence by hand; otherwise accept the overwrite and re-apply the intent as a project-local skill.
